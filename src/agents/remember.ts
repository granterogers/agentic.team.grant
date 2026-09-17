/**
 * Writing down what Grant just told the office.
 *
 * `teaching.ts` decides what a message IS; this puts it in the right table and
 * says back what it did. Split in two because the reading is pure and heavily
 * tested, and the writing needs a database and cannot be.
 *
 * ## The say-back is the correction mechanism
 *
 * There is no review queue and there should not be one — ADR-0017 rejects
 * making Grant the bottleneck on the one thing meant to reduce his involvement.
 * What replaces it is that he is told, in the reply, exactly what was stored
 * and as what, so a misreading is visible in the next sentence he reads rather
 * than in an answer three weeks later. The say-back names the kind on purpose:
 * "noted as a standing preference" and "written down as a procedure" are
 * different claims and he can correct either.
 *
 * ## A refusal is reported, not swallowed
 *
 * ADR-0017's boundary refuses a procedure containing an address, and it refuses
 * Grant's as readily as an agent's — the rule is about what a stored procedure
 * can carry, not about who typed it. So when it refuses, he is told why and
 * what to say instead, because a rule that silently drops his instruction is
 * worse than one that argues with him.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Teaching } from './teaching.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const uuid = (v: string | null): string => (v === null || v === '' ? 'null' : `${lit(v)}::uuid`)

export interface Remembered {
  /** What to say back. Never empty — silence is the failure this prevents. */
  readonly said: string
  readonly stored: 'lesson' | 'skill' | null
}

/**
 * Store it, and return the sentence that admits what was stored.
 *
 * `staffSlug` scopes it. A teaching addressed to one person is theirs; one sent
 * to the office is everyone's, and getting that backwards means a rule for
 * Ruby quietly governing Daniel.
 */
export async function remember(
  db: SqlExecutor,
  teaching: Teaching,
  by: string,
  staffSlug: string | null,
  jobId: string | null,
): Promise<Remembered> {
  const scoped = staffSlug === null || staffSlug === '' ? null : staffSlug

  if (teaching.kind === 'lesson') {
    const { rows } = await db.execute(`
      select app.learn(
        ${scoped === null ? "'global'" : "'staff'"}::public.lesson_scope,
        ${lit(teaching.body)}, ${lit(by)}, null, ${scoped === null ? 'null' : lit(scoped)},
        null, ${uuid(jobId)},
        -- Grant saying it is not a hypothesis. A lesson an agent inferred
        -- starts at 0.50 and has to earn the rest; one he stated starts high,
        -- because the evidence is that he said it.
        0.95, null) as r
    `)
    const r = (rows[0] as { r?: { error?: string } })?.r ?? {}
    if (typeof r.error === 'string') {
      return { said: `I could not store that: ${r.error}`, stored: null }
    }
    return {
      said:
        `Noted as a standing preference${scoped === null ? ' for everyone' : ''}: “${teaching.body}” ` +
        'Tell me if I have taken it too broadly.',
      stored: 'lesson',
    }
  }

  let raw: { error?: string; skill_id?: string }
  try {
    const { rows } = await db.execute(`
      select app.teach_skill(
        ${lit(teaching.name)}, ${lit(teaching.whenToUse)}, ${lit(teaching.procedure)},
        ${lit(by)},
        ${scoped === null ? "'global'" : "'staff'"}::public.lesson_scope,
        null, ${scoped === null ? 'null' : lit(scoped)}, null,
        '{}'::text[], ${uuid(jobId)}, null) as r
    `)
    raw = (rows[0] as { r?: { error?: string; skill_id?: string } })?.r ?? {}
  } catch (error) {
    /*
      The ADR-0017 boundary, reaching Grant as a sentence.

      It raises rather than returning `{error}`, because it is a trigger and a
      trigger cannot return anything else. Translating it here rather than
      letting the job fail: he asked for something reasonable in a way the
      office cannot store, and the useful reply says which part and what to say
      instead.
    */
    const detail = error instanceof Error ? error.message : String(error)
    const boundary = /(URL|hostname|email address|IP address)/i.exec(detail)
    if (boundary !== null) {
      return {
        said:
          `I can hold that as a procedure, but not with ${boundary[0].toLowerCase()} in it — ` +
          'a written-down procedure that can name an address is one that could send our work ' +
          'somewhere nobody approved, so the rule is absolute. Say which of our tools it ' +
          'should use instead and I will store it. If we do not have that tool yet, tell me ' +
          'and I will put the request in front of you.',
        stored: null,
      }
    }
    if (/credential|token|secret|key/i.test(detail)) {
      return {
        said:
          'That looks like it has a credential in it, so I have not stored it. Send it again ' +
          'naming the vault key rather than the value and I will keep it.',
        stored: null,
      }
    }
    throw error
  }

  if (typeof raw.error === 'string') {
    return { said: `I could not store that: ${raw.error}`, stored: null }
  }
  return {
    said:
      `Written down as a procedure${scoped === null ? ' for the whole team' : ''}, ` +
      `filed under “${teaching.name}” for ${teaching.whenToUse.toLowerCase()}. ` +
      'It goes in front of the relevant work from now on. Rename or retire it on the ' +
      'dashboard if that is not what you meant.',
    stored: 'skill',
  }
}

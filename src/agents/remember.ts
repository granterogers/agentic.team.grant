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
import { boundToThisConversation, dimensionOf, restates, withdrawsARule } from './preference.ts'
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
  /**
   * The project this was said about, when the message carried one.
   *
   * Hardcoded null until #310. A preference Grant scoped to one project was
   * therefore stored `global` — *"on the bid, never put a due date on
   * anything"* became a rule for every project, permanently, and the say-back
   * said "for everyone" while quoting the words that said otherwise.
   *
   * Null where the message did not carry a project, which is a third of real
   * messages and half his voice notes (#308). That is a real limit and it is
   * left visible rather than guessed at: inventing the scope from the last
   * project mentioned would put a rule on a project he was not talking about,
   * and #308 is the thing that has to be fixed for that case, not this.
   */
  projectId: string | null = null,
): Promise<Remembered> {
  const scoped = staffSlug === null || staffSlug === '' ? null : staffSlug

  if (teaching.kind === 'lesson') {
    /*
      A PREFERENCE HAS A LIFE, and until #310 it only had a birth.

      Everything below is the same one insert it always was, with three
      questions asked first. Each is allowed to answer "I do not know", and
      each such answer leaves exactly today's behaviour — which is the
      asymmetry the whole design rests on: failing to retire a rule costs
      what we already live with, and retiring the wrong one destroys
      something Grant said.
    */

    /*
      1. IS IT EVEN A STANDING RULE?

      *"From now on IN THIS CONVERSATION, keep every answer to a single short
      paragraph"* was stored at global scope, permanently, six times. The
      sentence says how long it lasts. There is no conversation scope in
      `lesson_scope` and inventing one in the wrong column would be worse, so
      a rule that bounds itself to the conversation is not stored as a
      standing one at all — it belongs to the turn, and the say-back says so
      rather than claiming it is for ever.
    */
    if (boundToThisConversation(teaching.body)) {
      return {
        said:
          `Understood for this conversation: “${teaching.body}” ` +
          'I have not stored it as a standing rule, because you said it was for now. ' +
          'Say it again without that and I will keep it.',
        stored: null,
      }
    }

    /*
      THE UNNAMED PROJECT IS NOT A PROJECT (#310).

      `inbound_commands.project_id` is NOT NULL and defaults to
      `app.unnamed_project()`, so the handler never hands this a null — it
      hands it the id of a real row whose slug is `unnamed`. The first
      version tested `projectId === null` and therefore stored every rule
      from a follow-up turn at PROJECT scope on a project called "unnamed".

      Live on v707: "always give me your answers as clear bullet points" was
      stored once on the real project and once on `unnamed`, two rows for one
      rule, neither superseding the other, because a rule may only replace
      one at its own scope. The second copy the whole issue is about, created
      by the fix for it.

      One extra round trip, and only when something is actually being stored.
    */
    const onAProject =
      projectId === null
        ? null
        : await db
            .execute(`
              select case when ${uuid(projectId)} = app.unnamed_project()
                          then null else ${uuid(projectId)} end as id`)
            .then((r) => (r.rows[0] as { id: string | null } | undefined)?.id ?? null)
            .catch(() => null)

    /*
      The scope this rule is being stored AT, named once and used by both the
      lookup and the write, because they have to agree about it.
    */
    const scope = onAProject === null ? (scoped === null ? "'global'" : "'staff'") : "'project'"

    const dimension = dimensionOf(teaching.body)
    const withdrawing = withdrawsARule(teaching.body)

    /*
      What the office currently believes, asked THROUGH THE READER.

      `app.lessons_for` is what feeds the prompt, so asking it is asking the
      live set rather than a second opinion about it.

      SCOPED TO THE AUTHOR'S OWN CLASS OF TRAFFIC, which is 0546 and is not a
      testing convenience. Containment had only ever run one way — 0539 and
      0545 stop harness traffic REACHING a real prompt — and the moment this
      function could RETIRE a rule it needed the other direction. On its first
      run the suite's "do not put screenshots in anymore" retracted Grant's
      real "always paste the image URLs into the reply as well", because the
      reader correctly handed it the real set. A Shadow Grant session against
      the deployed office would have done the same thing.

      `app.harness_author` is the same predicate `lessons.is_fixture` is
      GENERATED from, named so it can be asked BEFORE the row exists.

      AND SCOPED TO ITS OWN LEVEL, which is the other half. `lessons_for`
      returns the global rules too, correctly — they apply here — and the
      first version therefore let a rule for one project SUPERSEDE a global
      one. *"on this project never paste image links"* retired *"always paste
      image links into every reply"* for every project, which is the opposite
      of an override. A specific rule wins where it applies because the
      reader orders by specificity; it must not retire the general one, and
      only a rule at the same level may replace another.
    */
    const believed =
      dimension === null
        ? []
        : await db
            .execute(`
              with mine as (select app.harness_author(${lit(by)}) as harness)
              select f.lesson_id::text as id, f.body
                from mine,
                     app.lessons_for(${uuid(onAProject)}, ${scoped === null ? 'null' : lit(scoped)},
                                     null, 200, mine.harness) f
                join public.lessons l on l.lesson_id = f.lesson_id
               where l.is_fixture = mine.harness
                 and l.scope = ${scope}
                 and l.project_id is not distinct from ${uuid(onAProject)}
                 and l.staff_slug is not distinct from ${scoped === null ? 'null' : lit(scoped)}`)
            .then((r) => r.rows as { id: string; body: string }[])
            .catch(() => [])

    /*
      The rule this one is about, if there is one. The FIRST match on the
      dimension, and the reader orders most-specific-then-newest, so that is
      the rule actually in force.
    */
    const inForce = believed.find((l) => dimensionOf(l.body) === dimension)

    /*
      2. IS HE TAKING ONE BACK?

      "do not use bullets anymore", "forget what I said about bullets". A
      withdrawal leaves nothing in its place, so the rule is RETIRED rather
      than replaced — `app.retract_lesson` has existed for this since it was
      written and had no caller anywhere in `src/`.
    */
    if (withdrawing !== null && inForce !== undefined) {
      const { rows } = await db.execute(`
        select app.retract_lesson(${lit(inForce.id)}::uuid, ${lit(by)},
          'Withdrawn: ' || ${lit(teaching.body.slice(0, 200))}) as r`)
      const r = (rows[0] as { r?: { error?: string; ok?: boolean } })?.r ?? {}
      if (typeof r.error === 'string') {
        return { said: `I could not take that back: ${r.error}`, stored: null }
      }
      return {
        said:
          `Dropped it: “${inForce.body}” is no longer a standing rule. ` +
          'Nothing has replaced it, so tell me if you want something in its place.',
        stored: 'lesson',
      }
    }
    if (withdrawing !== null) {
      /*
        He took back a rule the office does not hold. Saying so is better than
        storing the withdrawal as a rule, which is what produced the standing
        instruction *"Okay, never mind about that."* in every Chief of Staff
        prompt.
      */
      return {
        said:
          'I do not have a standing rule about that, so there is nothing to drop. ' +
          'Tell me what you would like instead and I will store that.',
        stored: null,
      }
    }

    /*
      3. DOES IT REPLACE ONE, OR REPEAT ONE?

      Both are `p_supersedes`, and that is the point: a repetition and an
      override are the same operation on the ledger, differing only in what
      the office says back. `app.learn` increments `observations` when it
      supersedes, so a rule Grant has now given twice gets STRONGER rather
      than duplicated — and the reader already sorts by observations, so the
      repetition does what he meant by repeating it.

      Six copies of one instruction existed because this was never asked.
    */
    const replacing = inForce === undefined ? null : inForce
    const repeating = replacing !== null && restates(teaching.body, replacing.body)

    const { rows } = await db.execute(`
      select app.learn(
        ${scope}::public.lesson_scope,
        ${lit(teaching.body)}, ${lit(by)}, ${uuid(onAProject)}, ${scoped === null ? 'null' : lit(scoped)},
        null, ${uuid(jobId)},
        -- Grant saying it is not a hypothesis. A lesson an agent inferred
        -- starts at 0.50 and has to earn the rest; one he stated starts high,
        -- because the evidence is that he said it.
        0.95, ${replacing === null ? 'null' : `${lit(replacing.id)}::uuid`}) as r
    `)
    const r = (rows[0] as { r?: { error?: string } })?.r ?? {}
    if (typeof r.error === 'string') {
      return { said: `I could not store that: ${r.error}`, stored: null }
    }
    /*
      The say-back names what happened to the OLD rule as well as the new one,
      because that is the part he can correct. ADR-0017's argument: a
      misreading has to be visible in the next sentence he reads.
    */
    const where = onAProject !== null ? ' for this project' : scoped === null ? ' for everyone' : ''
    if (repeating) {
      return {
        said:
          `Already had that one, so I have not made a second copy — it now carries more weight: ` +
          `“${teaching.body}”`,
        stored: 'lesson',
      }
    }
    if (replacing !== null) {
      return {
        said:
          `Noted${where}, and it replaces what you told me before: ` +
          `“${replacing.body}” is no longer in force. Tell me if I have taken it too broadly.`,
        stored: 'lesson',
      }
    }
    return {
      said:
        `Noted as a standing preference${where}: “${teaching.body}” ` +
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

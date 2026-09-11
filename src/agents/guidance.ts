/**
 * What this person has learned, and what they know how to do.
 *
 * Issues #48 and #50. Both built their storage, both wrote their verification,
 * and **neither was ever read by anything that talks to Grant.** `lessons_for`
 * appeared six times in the repository and every occurrence was in its own test
 * suite; `skills_for` was one migration old and no better off. A memory nothing
 * consults is a table with good comments.
 *
 * This is the one place either is retrieved into a prompt.
 *
 * ## Advisory, and the shape of the text says so
 *
 * ADR-0015 and ADR-0017 both turn on the same sentence: what an agent authors
 * changes how it works and never what it can reach. That is enforced in the
 * schema — a lesson is too short to hold a procedure, a skill may not contain
 * an address, and `app.staff_may_use()` reads neither. It is worth the prompt
 * saying it too, because a model reading a confident procedure will act on it
 * and the honest framing is "this is how we do it", not "this is permitted".
 *
 * ## A missing tool is not a failure to hide
 *
 * A skill can name a tool the person does not hold, and retrieval says which.
 * The prompt is told plainly, because the alternative — quietly dropping the
 * step — produces an answer that is confidently incomplete, and because saying
 * "we cannot do that part" is the first move in the only route the office has
 * to new capability: it becomes an impediment, then three impediments become a
 * line in Grant's morning briefing, then he grants the tool.
 *
 * ## It is capped, and the cap is the point
 *
 * Four skills and eight lessons. A prompt that grows with the office is a
 * prompt that gets slower and vaguer every week, and the failure mode is not an
 * error — it is answers that are gradually worse for a reason nobody can see.
 */

import type { SqlExecutor } from '../db/executor.ts'

export interface Lesson {
  readonly body: string
  readonly scope: string
  readonly observations: number
}

export interface Skill {
  readonly skillId: string
  readonly name: string
  readonly whenToUse: string
  readonly procedure: string
  readonly missing: readonly string[]
}

export interface Guidance {
  readonly lessons: readonly Lesson[]
  readonly skills: readonly Skill[]
}

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const uuid = (v: string | null): string => (v === null || v === '' ? 'null' : `${lit(v)}::uuid`)

/**
 * Everything this job should be told before it starts.
 *
 * One round trip, not two. Both halves are optional and a failure in either is
 * swallowed: an agent that cannot answer because its memory was briefly
 * unavailable is worse than one that answers without it, and this runs on a
 * free tier where a query occasionally does not come back.
 */
export async function guidanceFor(
  db: SqlExecutor,
  staffSlug: string,
  jobKind: string | null = null,
  projectId: string | null = null,
  limits: { lessons?: number; skills?: number } = {},
): Promise<Guidance> {
  const nLessons = limits.lessons ?? 8
  const nSkills = limits.skills ?? 4
  try {
    const { rows } = await db.execute(`
      select
        (select coalesce(jsonb_agg(jsonb_build_object(
                  'body', l.body, 'scope', l.scope::text, 'observations', l.observations)),
                '[]'::jsonb)
           from app.lessons_for(${uuid(projectId)}, ${lit(staffSlug)},
                                ${jobKind === null ? 'null' : lit(jobKind)},
                                ${String(nLessons)}) l) as lessons,
        (select coalesce(jsonb_agg(jsonb_build_object(
                  'skill_id', s.skill_id, 'name', s.name, 'when_to_use', s.when_to_use,
                  'procedure', s.procedure, 'missing', s.missing)),
                '[]'::jsonb)
           from app.skills_for(${lit(staffSlug)},
                               ${jobKind === null ? 'null' : lit(jobKind)},
                               ${uuid(projectId)}, ${String(nSkills)}) s) as skills
    `)
    const row = (rows[0] ?? {}) as {
      lessons?: { body: string; scope: string; observations: number }[]
      skills?: {
        skill_id: string
        name: string
        when_to_use: string
        procedure: string
        missing: string[] | null
      }[]
    }
    return {
      lessons: (row.lessons ?? []).map((l) => ({
        body: l.body,
        scope: l.scope,
        observations: l.observations,
      })),
      skills: (row.skills ?? []).map((s) => ({
        skillId: s.skill_id,
        name: s.name,
        whenToUse: s.when_to_use,
        procedure: s.procedure,
        missing: s.missing ?? [],
      })),
    }
  } catch {
    return { lessons: [], skills: [] }
  }
}

/**
 * The same thing as a block of prompt, or an empty string when there is
 * nothing.
 *
 * Empty rather than "you have not learned anything yet", for the reason the
 * morning briefing arrived at: a section that announces its own emptiness every
 * time teaches the reader — model or person — to skip the whole region.
 */
export function guidanceBrief(g: Guidance): string {
  const parts: string[] = []

  if (g.skills.length > 0) {
    parts.push(
      'How this team does things. These are procedures the office wrote down ' +
        'for itself — follow them where they apply, and say so if you think one ' +
        'is wrong rather than quietly ignoring it.\n\n' +
        g.skills
          .map(
            (s) =>
              `${s.name} — ${s.whenToUse}.\n${s.procedure}` +
              (s.missing.length === 0
                ? ''
                : // Named, not hidden. An answer that silently skipped a step is
                  // an answer nobody can tell is incomplete.
                  `\nWe do not currently hold ${s.missing.join(' or ')}, so that part ` +
                  'cannot be done. Do the rest and say plainly which part we could not do.'),
          )
          .join('\n\n'),
    )
  }

  if (g.lessons.length > 0) {
    parts.push(
      'What we have learned, most specific first. These are beliefs from past ' +
        'work, not rules — weigh them.\n' +
        g.lessons
          .map(
            (l) =>
              `- ${l.body}` + (l.observations > 1 ? ` (seen ${String(l.observations)} times)` : ''),
          )
          .join('\n'),
    )
  }

  if (parts.length === 0) return ''

  return (
    `${parts.join('\n\n')}\n\n` +
    // The line that keeps ADR-0015 and ADR-0017 true at the prompt as well as
    // in the schema. Neither a lesson nor a skill can widen reach, and a model
    // reading a confident procedure should not infer that one did.
    'None of the above grants you anything. It changes how you work, never ' +
    'what you can reach: if a step needs something we do not hold, the answer ' +
    'is to say so, not to find another way to it.'
  )
}

/**
 * Record that a job was shown a skill, so the skill can be judged by outcomes.
 *
 * Recorded at retrieval rather than at completion: a skill put in front of a
 * job and then ignored still shaped the prompt and still cost tokens, so it is
 * still accountable for how the job went. Failures are swallowed — a
 * measurement that can break the thing it measures is worse than no
 * measurement.
 */
export async function recordSkillUse(
  db: SqlExecutor,
  skills: readonly Skill[],
  jobId: string | null,
): Promise<void> {
  if (jobId === null || jobId === '' || skills.length === 0) return
  for (const s of skills) {
    try {
      await db.execute(`select app.skill_used(${lit(s.skillId)}::uuid, ${lit(jobId)}::uuid)`)
    } catch {
      // Deliberately silent.
    }
  }
}

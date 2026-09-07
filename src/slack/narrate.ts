/**
 * The channel where you can see the team working.
 *
 * Grant: *"create an additional channel in Slack where I see the communications
 * between the Chief of Staff and the rest of the members. I'd like to know kind
 * of what's going on. Obviously you'd need to turn it into some kind of
 * understandable English."*
 *
 * ## What there is to see, honestly
 *
 * There is no chat between the agents. This system routes; it does not hold
 * conversations with itself, and inventing a dialogue to put in a channel would
 * be theatre — eight characters saying plausible things that never happened.
 * §12 spends its length on not presenting inference as observation, and a
 * fabricated standup would be the most enjoyable possible way to break it.
 *
 * What DOES happen between them is a handoff, and it is recorded in full:
 * `routing_decisions` holds what Grant asked for, how it was read, whether it
 * duplicated something already in flight, who was convened and why so few. That
 * is the real internal traffic. Rendered as English, it reads the way a chief of
 * staff actually talks — *"Grant's asked for X. Reads like research, so it's
 * Emma's. Nothing else in flight on it."* — because that is what the row says.
 *
 * So: real events, told in someone's voice, and no line that is not backed by a
 * column.
 *
 * ## One narration per job, forever
 *
 * The dedupe key is the job id. `deliveries` already enforces uniqueness on it,
 * so a re-run posts nothing and there is no `narrated_at` column to keep in
 * step with the thing it claims to track.
 *
 * ## Why it is a separate channel and not a thread
 *
 * Because Grant asked to be able to ignore it. The project channels carry
 * results he needs; this carries process he is curious about. Mixing them makes
 * the first harder to read, which is the cost the second is not worth.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { SlackClient } from './api.ts'
import type { SlackOffice } from './office.ts'
import { ChannelProvisioner } from './provision.ts'

/** Named as a person would name it. */
export const NARRATION_CHANNEL = 'the_floor'

interface Handoff {
  job_id: string
  kind: string
  instruction: string | null
  intent_class: string
  confident: boolean
  intent_reason: string
  roster: string[]
  roster_reason: string
  duplicate_resolution: string
  candidate_count: number
  project: string | null
  chief_name: string
  chief_title: string
  chief_avatar: string | null
  taker_name: string | null
  taker_title: string | null
  decided_at: string
}

/**
 * How an intent class reads out loud.
 *
 * The stored value is a §6 vocabulary term — `light_investigation` — and
 * printing it verbatim is the "understandable English" Grant explicitly asked
 * us not to skip.
 */
const READS_AS: Record<string, string> = {
  thought: 'thinking out loud',
  question: 'a question',
  discussion: 'something to talk through',
  suggestion: 'a suggestion',
  light_investigation: 'a bit of digging',
  assignment: 'a job to do',
  direct_command: 'a straight instruction',
}

/** And what the duplicate scan concluded, in words. */
const SCAN_SAYS: Record<string, string> = {
  // `none_found`, which is the enum's actual spelling. The first version
  // guessed `no_candidates` from the column name and fell through to the
  // fallback branch, printing "Duplicate check: none found." — grammatical,
  // wrong register, and only visible by reading the channel.
  none_found: 'Nothing else in flight on it.',
  linked_to_existing:
    'We already had this one open, so I have linked it rather than starting again.',
  proceeded_distinct:
    'Close to something already running, but different enough to be its own thing.',
}

/**
 * The router's reason, with the paperwork taken off.
 *
 * `roster_reason` is written for an auditor: "thought needs no specialist (§9:
 * trivial work spawns no subagents)". True, and not English. Stripped rather
 * than rewritten by a model — the reason is a fact about a decision, and a
 * paraphrase of a fact is a worse fact.
 */
function plainly(reason: string, names: ReadonlyMap<string, string>): string {
  let stripped = reason
    .replace(/\s*\(§\d+[^)]*\)/g, '')
    .replace(/§\d+[':]?\s*/g, '')
    .trim()

  // Slugs and vocabulary terms out, people and English in. The router writes
  // "direct_command permits research-director, strategy-director" because that
  // is what an audit row should say; a channel Grant reads should say "a
  // straight instruction could go to Emma, Tom or Marcus".
  for (const [slug, name] of names) {
    stripped = stripped.replaceAll(slug, name)
  }
  for (const [term, said] of Object.entries(READS_AS)) {
    stripped = stripped.replaceAll(term, said)
  }

  if (stripped === '') return ''
  const sentence = stripped.charAt(0).toUpperCase() + stripped.slice(1)
  return ` ${sentence}${/[.!?]$/.test(sentence) ? '' : '.'}`
}

/**
 * What the Chief of Staff would say about this handoff.
 *
 * Assembled from the row, clause by clause, so that every sentence has a column
 * behind it. Deliberately not generated: a model writing this would produce a
 * fluent paragraph that is right most of the time, and the one time it smoothed
 * over "I was not confident about this" is the time Grant needed to read it.
 */
export function narrate(h: Handoff, names: ReadonlyMap<string, string> = new Map()): string {
  const asked =
    h.instruction === null || h.instruction.trim() === ''
      ? `Something came in (${h.kind}).`
      : `“${h.instruction.trim().replace(/\s+/g, ' ').slice(0, 240)}”`

  const read = h.confident
    ? `Reads to me like ${READS_AS[h.intent_class] ?? h.intent_class}.`
    : // The unconfident case is the one worth surfacing, and it is exactly the
      // one a generated summary would round off into confidence.
      `I am not certain how to read it — best guess is ${READS_AS[h.intent_class] ?? h.intent_class}.`

  const who =
    h.taker_name === null
      ? // No spec references in here. The channel exists so Grant can follow
        // what is happening in plain English, and "§9 says trivial work
        // convenes nobody" is the house style leaking into the one place it
        // was explicitly not wanted.
        'Small enough that I have not pulled anyone in — I am handling it.'
      : `${h.taker_name} has it — ${String(h.taker_title)}.`

  // The stored reason is written for an audit trail and says things like
  // "thought needs no specialist (§9: trivial work spawns no subagents)". This
  // channel is the one place that was explicitly asked to be understandable
  // English, so the spec citation comes off and the sentence is finished.
  const why = plainly(h.roster_reason, names)
  const scan =
    SCAN_SAYS[h.duplicate_resolution] ??
    `Duplicate check: ${h.duplicate_resolution.replace(/_/g, ' ')}.`

  return [asked, `${read}${why}`, who, scan, h.project === null ? '' : `Filed under ${h.project}.`]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * Post anything that has not been narrated yet.
 *
 * Returns what it said, so a caller that finds it silent for a week can tell
 * "nothing happened" from "this is broken" — the distinction the whole
 * `deliveries` table exists to keep.
 */
export async function narrateHandoffs(
  db: SqlExecutor,
  slack: SlackClient,
  office: SlackOffice,
  teamId: string,
  limit = 10,
): Promise<readonly { jobId: string; outcome: string }[]> {
  const provisioner = new ChannelProvisioner(db, slack, teamId)
  const channel = await provisioner.ensureNamedChannel(NARRATION_CHANNEL, 'general')
  if (channel.channelId === null) return []

  const { rows } = await db.execute(`
    select r.job_id::text as job_id,
           j.kind,
           j.pinned_config ->> 'instruction' as instruction,
           r.intent_class, r.confident, r.intent_reason,
           r.roster, r.roster_reason, r.duplicate_resolution::text as duplicate_resolution,
           jsonb_array_length(r.duplicate_candidates) as candidate_count,
           p.name as project,
           chief.name as chief_name, chief.title as chief_title,
           chief.avatar_ref as chief_avatar,
           taker.name as taker_name, taker.title as taker_title,
           r.decided_at::text as decided_at
      from public.routing_decisions r
      join public.jobs j on j.job_id = r.job_id
      left join public.projects p using (project_id)
      -- The narrator, always. This channel is her account of the day.
      join public.staff chief on chief.slug = 'chief-of-staff'
      left join public.staff taker on taker.slug = r.roster[1]
     where not exists (
             select 1 from public.deliveries d
              where d.dedupe_key = 'narration:' || r.job_id::text
           )
       -- Old decisions are not news. A first run after a quiet fortnight should
       -- not post a fortnight of backlog into a channel nobody had yet.
       and r.decided_at > now() - interval '6 hours'
     order by r.decided_at asc
     limit ${String(limit)}
  `)

  // Slug to first name, read once. The router records slugs because they are
  // stable identity; this channel needs the names of people.
  const names = new Map(
    (await db.execute('select slug, name from public.staff')).rows.map((r) => [
      String((r as { slug: string }).slug),
      String((r as { name: string }).name),
    ]),
  )

  const said: { jobId: string; outcome: string }[] = []
  for (const raw of rows) {
    const h = raw as unknown as Handoff
    const result = await office.deliver({
      dedupeKey: `narration:${h.job_id}`,
      teamId,
      channelId: channel.channelId,
      purpose: 'notice',
      staff: {
        slug: 'chief-of-staff',
        name: h.chief_name,
        title: h.chief_title,
        avatarRef: h.chief_avatar,
      },
      message: {
        staffTitle: h.chief_title,
        body: narrate(h, names),
        metadata: null,
        // The job's own correlation, so a press here is attributable like any
        // other. No buttons, though: this is a log of decisions already taken,
        // and a 👍 on one would be feedback with nothing to change.
        correlationId: h.job_id,
        actions: [],
      },
    })
    said.push({ jobId: h.job_id, outcome: result.outcome })
  }
  return said
}

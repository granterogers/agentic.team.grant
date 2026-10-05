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

/**
 * SQL for the office this workspace belongs to. The floor channel is one office's account of its own day: the sweeps
 * below read ONLY that office's jobs, because they post a job's words (its instruction, its answer) into the channel.
 */
const workspaceOffice = (teamId: string): string =>
  `(select w.office_id from public.slack_workspaces w where w.team_id = '${teamId.replace(/'/g, "''")}')`

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
  /*
    Only the terms that are not already English.

    This loop put `Reads to me like a question` in the channel correctly, and
    also put this in it:

        One specialist: the a question is about evidence, and forbids
        convening a team for it.

    The router's reason said "the question is about evidence" — using
    `question` as an ordinary English noun, because it is one — and the
    substitution replaced it with `a question`, article and all. Four of the
    seven §6 classes have this problem: `thought`, `question`, `discussion`
    and `suggestion` are words a person writing a sentence will use, and
    replacing them can only make the sentence worse.

    The three that genuinely need translating are the ones spelled as
    vocabulary rather than as English — `light_investigation`,
    `direct_command`, and anything added later in that shape. An underscore is
    what makes them recognisable, and it is also what guarantees a false match
    is impossible: no English sentence contains one.

    `narrate` still names the class in full, through `READS_AS` directly. That
    is a deliberate label of the classification, not a word caught inside
    somebody else's sentence, and it reads correctly because a whole clause was
    written around it.
  */
  for (const [term, said] of Object.entries(READS_AS)) {
    if (!term.includes('_')) continue
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
     where j.office_id = ${workspaceOffice(teamId)}
       and not exists (
             select 1 from public.deliveries d
              where d.dedupe_key = 'narration:' || r.job_id::text
           )
       /*
         Harness traffic is not the office working.

         Grant's floor channel was carrying "Filed under zz test slack
         80106050." and the same handoff twice — verification runs, narrated as
         though they were his day. CLAUDE.md has the rule and the reason:
         jobs.is_fixture exists precisely because harness traffic was once
         reported to him as the office collapsing, and this is the same mistake
         with the sign reversed. The flag is GENERATED from requested_by, so it
         cannot be got wrong by a caller.

         (And the backticks that were in this comment a minute ago ended the
         template literal, which is the trap CLAUDE.md lists first. It only
         checks the web folder.)
       */
       /*
         And the CANONICAL predicate (#378). is_fixture is generated from
         requested_by, and a voice-door test turn is requested_by voice:grant,
         so it read as real. app.harness_job reads the lineage and the
         command. The delivery guard is still what decides; this only stops
         asking it about work that was never going to be narrated.
       */
       and not app.harness_job(j.job_id)
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
      /*
        THE JOB, ON THE DELIVERY (#378). Without it app.claim_delivery could
        not tell whose work this was and let it through, and the witness,
        which joins deliveries to jobs, could not see it either: 381 of 523
        narrations were of harness work.
      */
      jobId: h.job_id,
      correlationId: h.job_id,
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

/**
 * WHAT CAME OF IT — the other half of the floor channel (#282).
 *
 * Grant asked to see the communications between the Chief of Staff and the
 * rest of the team. `narrateHandoffs` shows the DECISION: what came in, how it
 * was read, who it went to. That is the start of the conversation and the
 * channel has never shown the end of one.
 *
 * So a handoff reads *"Emma has it — Research Director"* and then nothing. Did
 * Emma answer? Did anything get made? Did the job die? Every one of those is
 * recorded and none of it was on the floor, which makes the channel a log of
 * intentions rather than a view of the office working.
 *
 * ## Still no line without a column
 *
 * The same discipline as `narrate`, and for the same reason: a model writing
 * this would produce a fluent paragraph that is right most of the time, and
 * the one time it smoothed over "this failed" is the time Grant needed to read
 * it. Each clause below names the table it came from.
 *
 * ## A failure is the most valuable line here
 *
 * #233's fan-out means a specialist's contribution is a CHILD job with its own
 * output, so "Emma had it and produced nothing" is a fact this can state. A
 * fabricated standup would never say it, which is precisely why it is worth
 * saying.
 */
interface Outcome {
  job_id: string
  state: string
  state_reason: string | null
  thread_ts: string | null
  lead_name: string | null
  lead_body: string | null
  chief_name: string
  chief_title: string
  chief_avatar: string | null
  /** One per convened specialist: their name and what they produced, if any. */
  contributions: { who: string | null; body: string | null; state: string }[]
  /** Work this turn started, by kind. */
  started: string[]
  tasks: string[]
  documents: string[]
}

/** A quotation short enough to read in a channel, ending on a word. */
const briefly = (text: string, most: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= most) return flat
  /*
    A cut mid-word reads as a bug, because it is one. CLAUDE.md records a table
    cell that said "client independe" for exactly this reason.
  */
  const cut = flat.slice(0, most)
  const at = cut.lastIndexOf(' ')
  return `${(at > most / 2 ? cut.slice(0, at) : cut).trimEnd()}…`
}

/** How a job kind reads out loud. Unknown kinds print themselves rather than vanish. */
const WORK_READS_AS: Record<string, string> = {
  'artifact.report': 'writing it up as a file',
  'browser.gather': 'reading a page',
  'office.extract_tasks': 'pulling out what needs doing',
  'web.research': 'looking it up on the web',
  'notebook.generate': 'making something in the notebook',
  'notebook.list_artifacts': 'looking through the notebook',
  'notebook.add_source': 'adding a source to the notebook',
  'office.notion_import': 'writing it into Notion',
  'office.instruction': 'a second pair of eyes',
}

/**
 * What the Chief of Staff would say about how it turned out.
 *
 * Exported for its own tests, because every branch here is a sentence Grant
 * will read and the shapes that matter — nobody answered, it failed, nothing
 * came of it — are the ones a live run produces least often.
 */
export function narrateOutcome(o: Outcome): string {
  const lines: string[] = []

  /*
    A DEAD JOB SAYS SO FIRST.

    #211's rule applied to the floor: a guard that can swallow a request has to
    say so somewhere the person looks. The channel is where Grant watches the
    office work, so a job that ended with nothing is news there, and it is the
    line a generated summary would round off.
  */
  if (o.state !== 'complete') {
    lines.push(
      o.state_reason === null || o.state_reason.trim() === ''
        ? `That one ended ${o.state} and I have nothing to show for it.`
        : `That one ended ${o.state}: ${briefly(o.state_reason, 180)}`,
    )
  }

  for (const c of o.contributions) {
    const who = c.who ?? 'Someone'
    if (c.body !== null && c.body.trim() !== '') {
      lines.push(`${who} came back with: “${briefly(c.body, 220)}”`)
    } else if (c.state === 'complete') {
      // Finished and wrote nothing. A real and unflattering fact about a turn.
      lines.push(`${who} had it and produced nothing.`)
    } else {
      lines.push(`${who} did not finish — ${c.state}.`)
    }
  }

  if (o.lead_body !== null && o.lead_body.trim() !== '') {
    lines.push(
      o.lead_name === null
        ? `The answer: “${briefly(o.lead_body, 260)}”`
        : `${o.lead_name} pulled it together: “${briefly(o.lead_body, 260)}”`,
    )
  }

  if (o.started.length > 0) {
    lines.push(`It also started ${o.started.map((k) => WORK_READS_AS[k] ?? k).join(', and ')}.`)
  }
  if (o.tasks.length > 0) {
    lines.push(
      o.tasks.length === 1
        ? `One thing went on the list: ${briefly(o.tasks[0] ?? '', 90)}`
        : `${String(o.tasks.length)} things went on the list: ${o.tasks
            .map((t) => briefly(t, 60))
            .join('; ')}`,
    )
  }
  if (o.documents.length > 0) {
    lines.push(
      o.documents.length === 1
        ? `And a document: “${briefly(o.documents[0] ?? '', 90)}”`
        : `And ${String(o.documents.length)} documents: ${o.documents
            .map((d) => briefly(d, 50))
            .join('; ')}`,
    )
  }

  /*
    NOTHING is a result, and saying so is the point.

    A turn that completed, answered nobody, made nothing and started nothing is
    exactly the shape that used to leave the floor channel silent — which reads
    as the office being busy rather than as a turn that did not land.
  */
  if (lines.length === 0) return 'That one finished without producing anything.'
  return lines.join('\n')
}

/**
 * Post the outcome of anything already narrated that has since settled.
 *
 * Threaded under its own decision message, so the channel reads as one
 * conversation per request rather than two unrelated streams — the thread ref
 * is `deliveries.message_ref` of the decision post, which is the only place
 * that mapping exists.
 */
export async function narrateOutcomes(
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
    select j.job_id::text as job_id,
           j.state::text as state,
           j.state_reason,
           -- The decision post, so this lands as a reply to it rather than as
           -- a second stream. Null is fine: it posts to the channel instead.
           (select d.message_ref from public.deliveries d
             where d.dedupe_key = 'narration:' || j.job_id::text
               and d.message_ref is not null
             order by d.created_at desc limit 1) as thread_ts,
           lead.name as lead_name,
           (select left(o.body, 900) from public.outputs o
             where o.job_id = j.job_id order by o.created_at desc limit 1) as lead_body,
           chief.name as chief_name, chief.title as chief_title,
           chief.avatar_ref as chief_avatar,
           /*
             Each convened specialist, as a CHILD instruction job with its own
             output. #233's fan-out is what makes a contribution a real row
             rather than a claim, and the left join is what lets this say
             "had it and produced nothing" instead of omitting them.
           */
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'who', s.name,
                      'state', c.state::text,
                      'body', (select left(co.body, 600) from public.outputs co
                                where co.job_id = c.job_id
                                order by co.created_at desc limit 1))
                      order by c.created_at)
               from public.jobs c
               left join public.staff s on s.slug = c.recipient_agent
              where c.parent_job_id = j.job_id
                and c.kind = 'office.instruction'), '[]'::jsonb) as contributions,
           coalesce((
             select jsonb_agg(distinct c.kind)
               from public.jobs c
              where c.parent_job_id = j.job_id
                and c.kind <> 'office.instruction'), '[]'::jsonb) as started,
           coalesce((
             select jsonb_agg(t.title order by t.created_at)
               from public.tasks t
              where t.job_id = j.job_id
                 or t.job_id in (select c.job_id from public.jobs c
                                  where c.parent_job_id = j.job_id)), '[]'::jsonb) as tasks,
           coalesce((
             select jsonb_agg(dd.title order by dd.created_at)
               from public.documents dd
              where dd.produced_by_job = j.job_id
                 or dd.produced_by_job in (select c.job_id from public.jobs c
                                            where c.parent_job_id = j.job_id)), '[]'::jsonb)
             as documents
      from public.jobs j
      join public.staff chief on chief.slug = 'chief-of-staff'
      left join public.staff lead on lead.slug = j.recipient_agent
     where j.office_id = ${workspaceOffice(teamId)}
       and j.state in ('complete', 'failed', 'cancelled')
       /*
         EXISTS, not a join. A retry writes a second routing decision for the
         same job, and joining to the table duplicated the row — two identical
         outcome posts queued for one job, saved from reaching Grant only by
         the dedupe key. Found by running the query rather than by reading it.
       */
       and exists (select 1 from public.routing_decisions r where r.job_id = j.job_id)
       /*
         Only once the DECISION has been posted, so the thread it replies to
         exists. A decision that was never narrated has no conversation for
         this to be the end of.
       */
       and exists (select 1 from public.deliveries d
                    where d.dedupe_key = 'narration:' || j.job_id::text)
       and not exists (select 1 from public.deliveries d
                        where d.dedupe_key = 'outcome:' || j.job_id::text)
       /*
         Harness traffic is not the office working — and the flag on the JOB
         cannot see a real-looking job in a fixture PROJECT, which is the shape
         that put 85 rows in front of Grant once already. app.harness_job
         derives both.
       */
       and not app.harness_job(j.job_id)
       -- Old work is not news, the same six hours the decisions use.
       and j.finished_at > now() - interval '6 hours'
     order by j.finished_at asc
     limit ${String(limit)}
  `)

  const said: { jobId: string; outcome: string }[] = []
  for (const raw of rows) {
    const row = raw as unknown as Record<string, unknown>
    /*
      The executor hands a jsonb column back as an OBJECT, and CLAUDE.md
      records `JSON.parse(String(x))` on one producing
      "[object Object]" is not valid JSON — a guessed shape that reads like a
      corrupt payload.
    */
    const list = <T>(v: unknown): T[] =>
      v === null || v === undefined ? [] : ((typeof v === 'string' ? JSON.parse(v) : v) as T[])
    const o: Outcome = {
      job_id: String(row.job_id),
      state: String(row.state),
      state_reason: row.state_reason === null ? null : String(row.state_reason),
      thread_ts:
        row.thread_ts === null || row.thread_ts === undefined ? null : String(row.thread_ts),
      lead_name:
        row.lead_name === null || row.lead_name === undefined ? null : String(row.lead_name),
      lead_body:
        row.lead_body === null || row.lead_body === undefined ? null : String(row.lead_body),
      chief_name: String(row.chief_name),
      chief_title: String(row.chief_title),
      chief_avatar:
        row.chief_avatar === null || row.chief_avatar === undefined
          ? null
          : String(row.chief_avatar),
      contributions: list<{ who: string | null; body: string | null; state: string }>(
        row.contributions,
      ),
      started: list<string>(row.started),
      tasks: list<string>(row.tasks),
      documents: list<string>(row.documents),
    }
    const result = await office.deliver({
      dedupeKey: `outcome:${o.job_id}`,
      // The job, on the delivery, for the same reason as the handoff (#378).
      jobId: o.job_id,
      correlationId: o.job_id,
      teamId,
      channelId: channel.channelId,
      ...(o.thread_ts === null ? {} : { threadTs: o.thread_ts }),
      purpose: 'notice',
      staff: {
        slug: 'chief-of-staff',
        name: o.chief_name,
        title: o.chief_title,
        avatarRef: o.chief_avatar,
      },
      message: {
        staffTitle: o.chief_title,
        body: narrateOutcome(o),
        metadata: null,
        correlationId: o.job_id,
        actions: [],
      },
    })
    said.push({ jobId: o.job_id, outcome: result.outcome })
  }
  return said
}

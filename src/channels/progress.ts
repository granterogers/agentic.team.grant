/**
 * Each person saying, once, that they have picked something up.
 *
 * Grant: *"I want an individual message from each bot on Telegram so I can see
 * they are working."*
 *
 * Worth separating from the repetition he complained about in the same message,
 * because the two pull in opposite directions and the difference is the whole
 * design. That was the SAME message arriving twice on the same surface — the
 * reply channel and the pager both writing to one chat. This is a DIFFERENT
 * message from each person who is actually doing something, which is what makes
 * a team of eight visible rather than a single queue.
 *
 * ## Once per person per instruction, not once per job
 *
 * One instruction becomes a chain: an office job, a plan, a source, a
 * generation, a collector. Announcing each of those would put five "on it"
 * messages in front of him for one request, which is the thing he asked us to
 * stop doing.
 *
 * So the dedupe key is the correlation and the staff member. Emma says "on it"
 * once for the whole chain; if she hands something to Grace, Grace says it once
 * too. Two people working is two messages, and five jobs is still one each.
 *
 * ## From their own bot
 *
 * The point is to see WHO is working. A single pager saying "Emma is on it" is
 * a switchboard reading out a status; @atg_research_bot saying "on it" is a
 * colleague. The staff member's own token, resolved from the registry.
 *
 * ## Never fatal
 *
 * A failed progress note must not fail the work. It is the least important
 * message in the system: the result still arrives through the normal notifier,
 * and a job that died because a courtesy message could not be sent would be
 * absurd.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Job } from '../jobs/worker.ts'
import { TelegramClient } from '../telegram/api.ts'
import { escapeHtml } from '../telegram/message.ts'
import { TelegramTransport } from '../telegram/transport.ts'
import { DeliveryService } from './delivery.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * Kinds that are worth announcing.
 *
 * A poll tick is not someone picking something up; it is the same person still
 * waiting, and 0074 already made those silent for the same reason. Named
 * rather than excluded by pattern so that a new kind has to decide.
 */
const WORTH_SAYING = new Set([
  'office.instruction',
  'office.execute_plan',
  'notebook.add_source',
  'notebook.generate',
  'notebook.ask',
])

interface Speaker {
  name: string
  bot_id: string
  token: string
  chat_id: string
  instruction: string | null
}

/**
 * Who is about to work on this, and where Grant is reachable — or null.
 *
 * Null for anything this cannot resolve: a job with no staff member, a staff
 * member with no bot, a person Grant has never messaged. All three are normal,
 * and none is worth a warning: the work proceeds and the result arrives by the
 * usual route.
 */
async function speakerFor(db: SqlExecutor, job: Job): Promise<Speaker | null> {
  // Up the parent chain, like every other "who is this?" lookup in this
  // codebase. A generation job is the child of the instruction that asked for
  // it, and the routing decision lives on the parent.
  const { rows } = await db.execute(`
    with recursive lineage as (
      select job_id, parent_job_id, pinned_config, 0 as depth
        from public.jobs
       where job_id = ${lit(job.jobId)}::uuid
         and office_id = app.job_office(${lit(job.jobId)}::uuid)
      union all
      select j.job_id, j.parent_job_id, j.pinned_config, l.depth + 1
        from public.jobs j join lineage l on j.job_id = l.parent_job_id
       where l.depth < 8
         and j.office_id = app.job_office(${lit(job.jobId)}::uuid)
    )
    select s.name, s.slug,
           t.bot_id, app.resolve_secret(t.token_ref) as token,
           ch.chat_id,
           (select pinned_config ->> 'instruction' from lineage
             where pinned_config ? 'instruction' order by depth desc limit 1) as instruction
      from lineage l
      join public.routing_decisions r on r.job_id = l.job_id
      join public.staff s on s.slug = r.roster[1]
      join public.telegram_bots t on t.staff_slug = s.slug
      join public.telegram_chats ch
        on ch.bot_id = t.bot_id
       and ch.office_id = app.job_office(${lit(job.jobId)}::uuid)
       and ch.subject = app.office_actor(app.job_office(${lit(job.jobId)}::uuid))
     where t.enabled and t.token_ref is not null and ch.deliverable
     order by l.depth asc, r.decided_at desc
     limit 1
  `)
  const row = rows[0] as Speaker | undefined
  return row?.token === undefined || row.token === null ? null : row
}

/**
 * Say it, once. Returns what happened, for the worker's log line.
 *
 * The delivery table does the deduplication rather than a column of our own:
 * `dedupe_key` is unique, so the second job in a chain collides instead of
 * sending, and there is no "announced_at" to keep in step with the thing it
 * claims to track.
 */
export async function announceStart(db: SqlExecutor, job: Job): Promise<string> {
  if (!WORTH_SAYING.has(job.kind)) return 'not worth saying'

  const speaker = await speakerFor(db, job)
  if (speaker === null) {
    /*
      Since #70 this is the ORDINARY answer, not an exceptional one.

      Grant retired the seven staff bots on 14 September — "we don't need a
      different bot for each role. In fact, we only need the chief of staff" —
      so `speakerFor` finds no enabled bot for the routed person and there is
      nobody to announce a start as. That is the decision working, not a fault.

      Worth distinguishing in the log rather than leaving one sentence to mean
      two things: a line that used to appear when something was misconfigured
      now appears on every routed job, and an answer that is always the same
      hides the day it is the same for a different reason. The work still
      happens, the dashboard still shows it, and Claire still reports.
    */
    const anyStaffBot = await db.execute(
      `select count(*)::int as n from public.telegram_bots
        where enabled and not is_pager and staff_slug is not null`,
    )
    const n = Number((anyStaffBot.rows[0] as { n?: number } | undefined)?.n ?? 0)
    return n === 0
      ? 'staff bots are retired (#70) — only the chief of staff speaks'
      : 'nobody with a bot to say it'
  }

  const asked =
    speaker.instruction === null || speaker.instruction.trim() === ''
      ? null
      : speaker.instruction.trim().replace(/\s+/g, ' ')
  const quoted =
    asked === null
      ? ''
      : `\n\n<i>${escapeHtml(asked.length > 90 ? `${asked.slice(0, 88)}…` : asked)}</i>`

  const service = new DeliveryService(db, new TelegramTransport(new TelegramClient(speaker.token)))
  const result = await service.deliver({
    // Correlation AND person: one instruction, one message each from whoever
    // touches it. A chain of five jobs is still one message.
    dedupeKey: `start:${job.correlationId}:${speaker.bot_id}`,
    accountRef: speaker.bot_id,
    targetRef: speaker.chat_id,
    purpose: 'progress',
    correlationId: job.correlationId,
    jobId: job.jobId,
    staffId: null,
    body: { text: `On it.${quoted}`, silent: true },
  })
  return `${speaker.name}: ${result.outcome}`
}

/**
 * STILL GOING — the message that makes five minutes of silence impossible (#282).
 *
 * ## Measured before it was built
 *
 * 335 real `office.instruction` jobs over fourteen days:
 *
 *     median 21s · p90 259s · 30 of them over five minutes · worst 15 hours
 *
 * So the ordinary turn is instant and about one in eleven is not, and those are
 * exactly the ones where Grant is left watching nothing. `announceStart` does
 * not cover it either: it speaks only when the roster NAMES somebody with a
 * bot, and since #70 retired the staff bots that is almost never — two "on it"
 * messages have been sent in the system's history, five days apart.
 *
 * ## What it is allowed to say
 *
 * Only what a column says. There is no model here and there must not be: a
 * generated reassurance is the most comfortable possible way to tell him work
 * is happening when it is not, and §12 spends its length on exactly that.
 *
 * Elapsed time comes from `started_at`. What it is doing comes from the state,
 * `waiting_on`, and the CHILDREN — a fan-out to three specialists is three
 * rows, so "two have come back, one still going" is a fact rather than a guess.
 *
 * ## Never after it has finished
 *
 * The state is re-read immediately before the send, not when the note was
 * composed. A job that completed while this was assembling its sentence would
 * otherwise tell Grant it was still working AFTER he had the answer, which is
 * worse than silence — and #197's rule is the general form: anything you need
 * to know about "now" has to be read now.
 *
 * ## Non-spammy by construction
 *
 * The dedupe key carries a ten-minute bucket, so a job running for an hour
 * produces at most six notes and `deliveries` refuses the rest without this
 * file needing a timer or a column of its own. The first lands at four
 * minutes, before the five the brief names.
 */

/** Long enough that silence is a problem; short of the five minutes named. */
const QUIET_FOR_MINUTES = 4

/** A note at most this often after the first. */
const AGAIN_EVERY_MINUTES = 10

interface Waiting {
  job_id: string
  office_id: string
  correlation_id: string
  state: string
  waiting_on: string | null
  minutes: number
  instruction: string | null
  bot_id: string
  token: string
  chat_id: string
  children_done: number
  children_total: number
}

/**
 * The sentence, from the row. Exported because every branch is something Grant
 * will read at a moment when he is already wondering, and the shapes that
 * matter — paused, waiting on a colleague, simply slow — are the ones a live
 * run produces least often.
 */
export function stillWorkingSays(w: {
  readonly state: string
  readonly waiting_on: string | null
  readonly minutes: number
  readonly children_done: number
  readonly children_total: number
}): string {
  const how = `${String(Math.floor(w.minutes))} minutes in`

  /*
    A PAUSE IS NOT PROGRESS, and saying so is the point of this message.

    `waiting_on` holds the sentence a person reads — 0457 exists because it
    once held the reason code instead. If the office is stopped waiting for
    something, that is the single most useful thing Grant can be told, and a
    cheerful "still working on it" would be false.
  */
  if (w.state === 'paused') {
    return w.waiting_on === null || w.waiting_on.trim() === ''
      ? `Still on this — ${how}, but it is paused and I have no reason recorded. Worth a look.`
      : `Paused ${how}: ${w.waiting_on.trim()}`
  }

  if (w.state === 'retrying') {
    return `Still on this — ${how}. The first go did not come back cleanly, so it is running again.`
  }

  if (w.children_total > 0) {
    /*
      A fan-out is the commonest reason a turn is slow, and it is countable:
      #233 gives every convened specialist a child job. "Two of three back" is
      a row count, not an impression.
    */
    return w.children_done >= w.children_total
      ? `Still on this — ${how}. Everyone I asked has come back; I am putting it together.`
      : `Still on this — ${how}. ${String(w.children_done)} of ${String(w.children_total)} ` +
          'of the people I asked have come back.'
  }

  return `Still on this — ${how}. Nothing to report yet; I will come back when there is.`
}

/**
 * Tell him about anything that has been quiet too long. Never fatal.
 *
 * Returns what it said, so a caller that finds it silent for a week can tell
 * "nothing was slow" from "this is broken" — the distinction `deliveries`
 * exists to keep.
 */
export async function sayStillWorking(
  db: SqlExecutor,
  limit = 5,
  /*
    THE SEAM, so the invariant that matters can be proved rather than asserted.

    "Never after it has finished" is the one rule here whose failure Grant sees
    — a note telling him work is under way after he already has the answer —
    and it cannot be tested against a real subject without a real message
    leaving the building. #45's rule sends a suite testing a fixture-filtering
    feature to real subjects, and `app.harness_job` filters fixtures here, so
    the two pull against each other.

    A transport seam settles it: the suite drives the real query, the real
    freshness re-read and the real dedupe against a real job, and records what
    WOULD have been sent. `verify:slack` already uses the same shape, and the
    default is the real client so nothing about production changes.
  */
  transportFor: (token: string) => TelegramTransport = (token) =>
    new TelegramTransport(new TelegramClient(token)),
): Promise<readonly { jobId: string; outcome: string }[]> {
  const { rows } = await db
    .execute(`
    select j.job_id::text as job_id,
           j.office_id::text as office_id,
           j.correlation_id::text as correlation_id,
           j.state::text as state,
           j.waiting_on,
           floor(extract(epoch from (now() - coalesce(j.started_at, j.created_at))) / 60)::int
             as minutes,
           j.pinned_config ->> 'instruction' as instruction,
           t.bot_id, app.resolve_secret(t.token_ref) as token, ch.chat_id,
           (select count(*) from public.jobs c
             where c.parent_job_id = j.job_id and c.office_id = j.office_id
               and c.state in ('complete', 'failed', 'cancelled'))::int as children_done,
           (select count(*) from public.jobs c
             where c.parent_job_id = j.job_id and c.office_id = j.office_id)::int as children_total
      from public.jobs j
      -- Only the chief speaks to him. #70 retired the staff bots and
      -- telegram.only_chief_speaks has been true throughout; a progress note
      -- from seven bots is the repetition he asked us to stop.
      join public.telegram_bots t on t.staff_slug = 'chief-of-staff' and t.enabled
      -- The chat is the JOB'S OWN office's, and the person is that office's own person (no literal).
      join public.telegram_chats ch
        on ch.bot_id = t.bot_id and ch.office_id = j.office_id
       and ch.subject = app.office_actor(j.office_id)
     where j.state in ('running', 'retrying', 'paused')
       and j.kind = 'office.instruction'
       -- His request, not a duty. A scheduled sweep running long is not
       -- somebody waiting for an answer.
       and j.parent_job_id is null
       and coalesce(j.started_at, j.created_at) < now()
             - interval '${String(QUIET_FOR_MINUTES)} minutes'
       and ch.deliverable
       and t.token_ref is not null
       /*
         Harness traffic never reaches him. The flag on the job cannot see a
         real-looking job in a fixture project, which is the shape that put 85
         rows in front of him once already, so the derived answer is asked for.
       */
       and not app.harness_job(j.job_id)
     order by j.started_at asc nulls last
     limit ${String(limit)}
  `)
    .catch(() => ({ rows: [] as Record<string, unknown>[] }))

  const said: { jobId: string; outcome: string }[] = []
  for (const raw of rows) {
    const w = raw as unknown as Waiting
    if (w.token === null || String(w.token) === '') continue

    /*
      READ THE STATE AGAIN, NOW.

      Between the query above and this line the worker may have finished the
      job — the drain and this pass run in the same minute. Telling Grant it is
      still working AFTER he has the answer is worse than telling him nothing,
      and the check belongs here rather than in the query because the query is
      the thing that went stale.
    */
    const fresh = await db
      .execute(`
        select state::text as s from public.jobs
         where job_id = '${w.job_id.replace(/'/g, "''")}'::uuid
           and office_id = '${w.office_id.replace(/'/g, "''")}'::uuid`)
      .then((r) => String((r.rows[0] as { s?: string } | undefined)?.s ?? ''))
      .catch(() => '')
    if (!['running', 'retrying', 'paused'].includes(fresh)) {
      said.push({ jobId: w.job_id, outcome: `settled as ${fresh} before the note went` })
      continue
    }

    const asked =
      w.instruction === null || w.instruction.trim() === ''
        ? ''
        : `\n\n<i>${escapeHtml(
            w.instruction.trim().replace(/\s+/g, ' ').length > 90
              ? `${w.instruction.trim().replace(/\s+/g, ' ').slice(0, 88)}…`
              : w.instruction.trim().replace(/\s+/g, ' '),
          )}</i>`

    const service = new DeliveryService(db, transportFor(w.token))
    const result = await service.deliver({
      /*
        A ten-minute bucket in the key, so an hour of work is at most six notes
        and `deliveries` refuses the rest. No timer, and no column of our own
        to keep in step with the thing it claims to track.
      */
      dedupeKey: `still:${w.correlation_id}:${String(Math.floor(w.minutes / AGAIN_EVERY_MINUTES))}`,
      accountRef: w.bot_id,
      targetRef: w.chat_id,
      purpose: 'progress',
      correlationId: w.correlation_id,
      jobId: w.job_id,
      staffId: null,
      body: { text: `${stillWorkingSays(w)}${asked}`, silent: true },
    })
    said.push({ jobId: w.job_id, outcome: result.outcome })
  }
  return said
}

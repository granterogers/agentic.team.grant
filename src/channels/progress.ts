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
        from public.jobs where job_id = ${lit(job.jobId)}::uuid
      union all
      select j.job_id, j.parent_job_id, j.pinned_config, l.depth + 1
        from public.jobs j join lineage l on j.job_id = l.parent_job_id
       where l.depth < 8
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
      join public.telegram_chats ch on ch.bot_id = t.bot_id and ch.subject = 'grant'
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

/**
 * The worker's `notifying` state, made real for Slack.
 *
 * This is the piece that connects two halves that had never met: the worker
 * produces a reviewed output and moves through a state called `notifying`, and
 * the office can post a message exactly once. Until this existed the state was
 * a name and the office had no caller outside its own test suite — the shape of
 * defect this project has now met five times, and the reason the worker's
 * header rule is what it is.
 *
 * Three decisions are made here, and all three are the conservative direction:
 *
 * 1. **Where the result goes is read from where the instruction came from.**
 *    `inbound_commands_slack` recorded the channel and the thread at receipt
 *    (0014), so a result answers the question in the place it was asked. When
 *    there is no such record — a scheduled job, a job created by another job —
 *    it falls back to the project's channel, and when there is no project
 *    channel either it delivers nothing and says so. It never guesses at a
 *    channel: a result in the wrong room is worse than a result nowhere,
 *    because nobody is looking for it in the wrong room.
 *
 * 2. **Preferences are consulted, and a suppression is recorded.** §12's
 *    preferences decide whether Grant is told; `app.notification_allowed` is
 *    the one implementation of that rule and this calls it rather than
 *    re-deriving it. A suppressed notification writes a `notification_events`
 *    row with outcome `suppressed`, because "we decided not to tell you" is
 *    exactly the fact that makes "why was I not told?" answerable.
 *
 * 3. **An unreviewed output is labelled, not withheld.** §16 says unreviewed
 *    output must not be relied on. The composer prints that on the message
 *    (`reviewed: false`), which is what lets a reader discount it.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { HandlerOutput, Job, Notifier, NotifyOutcome } from '../jobs/worker.ts'
import { ACTIONS, type ActionId } from './blocks.ts'
import type { StaffPresentation } from './identity.ts'
import type { SlackOffice } from './office.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Where a result should go, and why we think so. */
export interface Target {
  readonly channelId: string
  readonly threadTs: string | null
  /** `thread` (the question's own thread), `channel`, or `project`. */
  readonly via: 'thread' | 'channel' | 'project'
}

export interface NotifierOptions {
  readonly teamId: string
  /** Severity for the preference check. Results are routine unless told. */
  readonly severity?: 'trivial' | 'routine' | 'important' | 'urgent' | 'blocker'
  readonly subject?: string
  readonly projectUrlBase?: string | null
}

/**
 * Find where this job's result belongs.
 *
 * Prefers the thread of the instruction that caused it. The join reaches the
 * command through `jobs.correlation_id` rather than through the job id:
 * `inbound_commands` points at the ONE job the router created for it, so a
 * follow-up job spawned later under the same correlation has no command row of
 * its own and would find nowhere to reply. The correlation is what ties the
 * whole conversation together, which is what it is for.
 */
export async function resolveTarget(db: SqlExecutor, job: Job): Promise<Target | null> {
  const { rows } = await db.execute(`
    select s.channel_id, s.thread_ts
    from public.inbound_commands c
    join public.inbound_commands_slack s on s.command_id = c.command_id
    join public.jobs j on j.job_id = c.job_id
    where j.correlation_id = ${lit(job.correlationId)}::uuid
      and s.channel_id is not null
    order by c.received_at desc
    limit 1
  `)
  const row = rows[0] as { channel_id?: string; thread_ts?: string | null } | undefined
  if (row?.channel_id !== undefined) {
    return {
      channelId: row.channel_id,
      threadTs: row.thread_ts ?? null,
      via: row.thread_ts === null || row.thread_ts === undefined ? 'channel' : 'thread',
    }
  }

  if (job.projectId === null) return null

  const project = await db.execute(`
    select channel_id from public.slack_channel_map
    where project_id = ${lit(job.projectId)}::uuid and active and bot_present
    order by purpose, created_at
    limit 1
  `)
  const channelId = (project.rows[0] as { channel_id?: string } | undefined)?.channel_id
  return channelId === undefined ? null : { channelId, threadTs: null, via: 'project' }
}

/**
 * Which buttons make sense for this result.
 *
 * Undo is offered only when there is something to undo — an offer that does
 * nothing is worse than no offer, because it teaches that Undo does nothing.
 */
export async function offeredActions(
  db: SqlExecutor,
  job: Job,
  hasProjectUrl: boolean,
): Promise<readonly ActionId[]> {
  const { rows } = await db.execute(`
    select count(*)::int as n from public.undo_offers
    where correlation_id = ${lit(job.correlationId)}::uuid
  `)
  const undoable = Number((rows[0] as { n?: number } | undefined)?.n ?? 0) > 0
  return ACTIONS.filter(
    (action) => (action !== 'undo' || undoable) && (action !== 'open_project' || hasProjectUrl),
  )
}

/** Build the worker's notifier. */
export function slackNotifier(
  db: SqlExecutor,
  office: SlackOffice,
  options: NotifierOptions,
): Notifier {
  const severity = options.severity ?? 'routine'
  const subject = options.subject ?? 'grant'

  return async (job: Job, output: HandlerOutput, outputId: string): Promise<NotifyOutcome> => {
    const target = await resolveTarget(db, job)
    if (target === null) {
      return { delivered: false, note: 'no slack destination for this job; nothing delivered' }
    }

    const allowed = await db.execute(`
      select app.notification_allowed(${lit(subject)}, 'slack', ${lit(severity)}::public.notify_severity,
        ${job.projectId === null ? 'null' : `${lit(job.projectId)}::uuid`}) as allowed
    `)
    if ((allowed.rows[0] as { allowed?: boolean } | undefined)?.allowed !== true) {
      await db.execute(`
        insert into public.notification_events
          (channel, severity, project_id, subject_kind, subject_ref, outcome)
        values ('slack', ${lit(severity)}::public.notify_severity,
                ${job.projectId === null ? 'null' : `${lit(job.projectId)}::uuid`},
                'output', ${lit(outputId)}::uuid, 'suppressed')
      `)
      return { delivered: false, note: 'suppressed by notification preferences' }
    }

    // Who to present as. There is no assignment table and deliberately so —
    // §9's roster IS the record of who was convened, and `routing_decisions`
    // holds it as slugs. An empty roster is a real answer ("trivial work spawns
    // no subagents"), and the message then comes from no one in particular
    // rather than from an invented author.
    const staffRow = await db.execute(`
      select st.slug, st.name, st.title, st.avatar_ref
      from public.routing_decisions r
      join public.staff st on st.slug = r.roster[1]
      where r.job_id = ${lit(job.jobId)}::uuid
      order by r.decided_at desc
      limit 1
    `)
    const raw = staffRow.rows[0] as
      | { slug: string; name: string; title: string; avatar_ref: string | null }
      | undefined
    const staff: StaffPresentation | null =
      raw === undefined
        ? null
        : { slug: raw.slug, name: raw.name, title: raw.title, avatarRef: raw.avatar_ref }

    const reviewRow = await db.execute(`
      select reviewer_status::text as status, deterministic
      from public.outputs where output_id = ${lit(outputId)}::uuid
    `)
    const review = reviewRow.rows[0] as
      | { status: string | null; deterministic: boolean }
      | undefined
    const reviewed =
      review?.deterministic === true ||
      review?.status === 'approved' ||
      review?.status === 'approved_with_reservations'

    const projectUrl =
      options.projectUrlBase === null ||
      options.projectUrlBase === undefined ||
      job.projectId === null
        ? null
        : `${options.projectUrlBase.replace(/\/+$/, '')}/projects/${job.projectId}`

    const result = await office.deliver({
      dedupeKey: `job:${job.jobId}:result`,
      teamId: options.teamId,
      channelId: target.channelId,
      threadTs: target.threadTs,
      purpose: 'result',
      staff,
      staffId: null,
      correlationId: job.correlationId,
      jobId: job.jobId,
      message: {
        staffTitle: staff?.title ?? null,
        body: output.body,
        metadata: {
          confidence: output.confidence,
          evidence: output.evidence,
          sources: output.sources,
          contradictions: output.contradictions,
          // Read from the output row rather than inferred from the path. §16
          // exempts a deterministic output from review, which is not the same
          // as it being unreviewed — saying "not reviewed" about a mechanical
          // retrieval would cry wolf — and an inference output that somehow
          // reached here unreviewed must be labelled. The row knows which.
          reviewed,
        },
        correlationId: job.correlationId,
        actions: await offeredActions(db, job, projectUrl !== null),
        projectUrl,
      },
    })

    if (result.outcome === 'sent' || result.outcome === 'already_sent') {
      await db.execute(`
        insert into public.notification_events
          (channel, severity, project_id, subject_kind, subject_ref, outcome)
        values ('slack', ${lit(severity)}::public.notify_severity,
                ${job.projectId === null ? 'null' : `${lit(job.projectId)}::uuid`},
                'output', ${lit(outputId)}::uuid, 'delivered')
      `)
      return { delivered: true, note: `delivered to slack via ${target.via}` }
    }

    return {
      delivered: false,
      note: `slack delivery ${result.outcome}${result.errorCode === null ? '' : `: ${result.errorCode}`}`,
    }
  }
}

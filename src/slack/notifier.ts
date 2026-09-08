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

import type { ResultContext } from '../channels/notify.ts'
import { combinedNotifier } from '../channels/notify.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { HandlerOutput, Job, Notifier, NotifyOutcome } from '../jobs/worker.ts'
import type { SlackOffice } from './office.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Where a result should go, and why we think so. */
export interface Target {
  readonly channelId: string
  readonly threadTs: string | null
  /** `thread` (the question's own thread), `channel`, or `project`. */
  /**
   * How the destination was chosen. `discipline` is the staff member's own
   * channel for this project (0070); `project` is its lobby.
   */
  readonly via: 'thread' | 'channel' | 'project' | 'discipline' | 'general'
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
export async function resolveTarget(
  db: SqlExecutor,
  job: Job,
  staffSlug: string | null = null,
  /** Which workspace, for the duty fallback below. Null means any. */
  teamId: string | null = null,
): Promise<Target | null> {
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

  /**
   * The workspace's general channel, for work that has no room of its own.
   *
   * Two kinds of job reach here, and both are cases where delivering nowhere
   * would be silent:
   *
   *   - a recurring DUTY belongs to a role rather than a project (0027), so it
   *     has no project channel at all — which for the daily capacity report
   *     means producing it every morning and showing it to nobody;
   *   - a VOICE instruction has a project but often no channel yet, and the
   *     voice surface promises out loud that the answer will appear in Slack.
   *     A promise the system does not keep is worse than no promise.
   *
   * Both are matched on `requested_by`, which is written by the dispatcher
   * (0099) and by `enqueue_inbound` — never by a client. Deliberately narrow:
   * every other job that lands here is a verification fixture, and a fallback
   * that caught those would post test probes into the room the team introduces
   * itself in.
   */
  const generalChannel = async (): Promise<Target | null> => {
    const home = await db.execute(`
      select m.channel_id from public.jobs j
        join public.slack_channel_map m
          on ${teamId === null ? 'true' : `m.team_id = ${lit(teamId)}`}
         and m.active and m.bot_present
         and m.purpose = 'general'
       where j.job_id = ${lit(job.jobId)}::uuid
         and (j.requested_by like 'duty:%' or j.requested_by like 'voice:%')
       order by m.created_at
       limit 1
    `)
    const row = home.rows[0] as { channel_id?: string } | undefined
    return row?.channel_id === undefined
      ? null
      : { channelId: row.channel_id, threadTs: null, via: 'general' }
  }

  if (job.projectId === null) return await generalChannel()

  // The staff member's own channel for this project, then the project lobby.
  //
  // Grant asked for a channel per project per discipline (0070), and the
  // ordering is the whole of the routing: `discipline is not distinct from
  // <slug>` first, lobby second, so a Research Director's finding lands in
  // `#money-mastery-research` when that channel exists and in
  // `#money-mastery` when it does not.
  //
  // `bot_present` still gates both. A channel the app has been removed from is
  // not a destination, and posting into one is how a delivery fails after
  // reporting success.
  const project = await db.execute(`
    select channel_id, discipline from public.slack_channel_map
    where project_id = ${lit(job.projectId)}::uuid and active and bot_present
      and purpose = 'project'
    order by case
               when discipline is not distinct from ${staffSlug === null ? 'null' : lit(staffSlug)} then 0
               when discipline is null then 1
               else 2
             end,
             created_at
    limit 1
  `)
  const found = project.rows[0] as { channel_id?: string; discipline?: string | null } | undefined
  // A project with no channel yet is not a dead end for a duty or a voice
  // instruction. The first version returned null here and a spoken instruction
  // completed, was reviewed, committed — and delivered nowhere, having told
  // Grant out loud that the answer would appear in Slack.
  if (found?.channel_id === undefined) return await generalChannel()
  return {
    channelId: found.channel_id,
    threadTs: null,
    via: found.discipline === null ? 'project' : 'discipline',
  }
}

/**
 * The Slack half of the worker's notifier.
 *
 * Takes the resolved context rather than resolving it, so the office and the
 * pager cannot disagree about who produced an output — see
 * `src/channels/notify.ts`.
 */
export function slackChannel(
  db: SqlExecutor,
  office: SlackOffice,
  options: NotifierOptions,
): {
  readonly name: string
  readonly notify: (
    job: Job,
    output: HandlerOutput,
    outputId: string,
    context: ResultContext,
  ) => Promise<NotifyOutcome>
} {
  const severity = options.severity ?? 'routine'
  const subject = options.subject ?? 'grant'

  return {
    name: 'slack',
    notify: async (job, output, outputId, context): Promise<NotifyOutcome> => {
      // The staff member decides which channel, so it is passed in rather than
      // re-derived: `context.staff` is who the office is about to present as,
      // and presenting as one person in another's channel would be confusing
      // in exactly the way per-discipline channels exist to prevent.
      const target = await resolveTarget(db, job, context.staff?.slug ?? null, options.teamId)
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

      const result = await office.deliver({
        dedupeKey: `job:${job.jobId}:result`,
        teamId: options.teamId,
        channelId: target.channelId,
        threadTs: target.threadTs,
        purpose: 'result',
        staff: context.staff,
        staffId: context.staffId,
        correlationId: job.correlationId,
        jobId: job.jobId,
        message: {
          staffTitle: context.staff?.title ?? null,
          body: output.body,
          metadata: {
            confidence: output.confidence,
            evidence: output.evidence,
            sources: output.sources,
            contradictions: output.contradictions,
            reviewed: context.reviewed,
          },
          correlationId: job.correlationId,
          actions: context.actions,
          projectUrl: context.projectUrl,
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
    },
  }
}

/**
 * The worker's notifier, Slack only.
 *
 * Kept because most callers want exactly this, and because a caller that has to
 * assemble a one-element array to send to one channel will assemble it wrong.
 */
export function slackNotifier(
  db: SqlExecutor,
  office: SlackOffice,
  options: NotifierOptions,
): Notifier {
  return combinedNotifier([slackChannel(db, office, options)], db, {
    projectUrlBase: options.projectUrlBase ?? null,
  })
}

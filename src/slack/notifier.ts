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
import { signedUrl } from '../files/store.ts'
import { deliveryKey } from '../jobs/delivery-key.ts'
import type { HandlerOutput, Job, Notifier, NotifyOutcome } from '../jobs/worker.ts'
import type { SlackOffice } from './office.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Where a result should go, and why we think so. */
export interface Target {
  readonly channelId: string
  readonly threadTs: string | null
  /**
   * True when this reply is the one that CREATES the thread.
   *
   * Slack shows a threaded reply only inside its thread, so starting a thread
   * on Grant's own question would otherwise take the answer off the channel he
   * was reading. See `SlackMessageBody.broadcast`.
   */
  readonly broadcast: boolean
  /** `thread` (the question's own thread), `channel`, or `project`. */
  /**
   * How the destination was chosen. `discipline` is the staff member's own
   * channel for this project (0070); `project` is its lobby.
   */
  readonly via: 'thread' | 'channel' | 'project' | 'discipline' | 'general'
}

export interface NotifierOptions {
  readonly teamId: string
  /**
   * Enough to mint a signed link for a file the office made (#258).
   *
   * Slack cannot take bytes -- no `files:write`, the same scope wall as #270 --
   * so a PDF is delivered here as a link to the object Storage already holds.
   * Both are optional: without them the message says the file is in the
   * project and that no link could be made, which is the honest degradation
   * rather than silence.
   */
  readonly projectRef?: string
  readonly serviceKey?: string
  /** Severity for the preference check. Results are routine unless told. */
  readonly severity?: 'trivial' | 'routine' | 'important' | 'urgent' | 'blocker'
  readonly subject?: string
  readonly projectUrlBase?: string | null
}

/**
 * The `ts` of the message that asked, out of `inbound_commands.origin_ref`.
 *
 * The ref is `channel:ts` and this returns the ts only when the channel half
 * is the channel we are about to post into. A ref that does not match is not
 * an error worth failing a delivery over — it means the answer goes to the
 * channel unthreaded, which is what happened for every message before this.
 */
export function threadParent(channelId: string, originRef: string | null): string | null {
  if (originRef === null || originRef === '') return null
  const cut = originRef.lastIndexOf(':')
  if (cut <= 0) return null
  if (originRef.slice(0, cut) !== channelId) return null
  const ts = originRef.slice(cut + 1)
  // Slack timestamps are `1789280759.980069`. Anything else is a placeholder —
  // the adapter writes `unknown` when an event arrives without one — and
  // threading under "unknown" is a `chat.postMessage` error, not a thread.
  return /^\d+\.\d+$/.test(ts) ? ts : null
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
    select s.channel_id, s.thread_ts, c.origin_ref
    from public.inbound_commands c
    join public.inbound_commands_slack s on s.command_id = c.command_id
    join public.jobs j on j.job_id = c.job_id and j.office_id = app.job_office(${lit(job.jobId)}::uuid)
    where c.office_id = app.job_office(${lit(job.jobId)}::uuid)
      and j.correlation_id = ${lit(job.correlationId)}::uuid
      and s.channel_id is not null
    order by c.received_at desc
    limit 1
  `)
  const row = rows[0] as
    | { channel_id?: string; thread_ts?: string | null; origin_ref?: string | null }
    | undefined
  if (row?.channel_id !== undefined) {
    /*
      Reply UNDER the message that asked, not beside it.

      Grant, 13 September, looking at three screenshots of his workspace:
      *"you'd really need to work on it looking a lot better, making it obvious
      what things are related to that kind of thing."*

      Nothing was related to anything. He asks a question at the top level of a
      channel; Slack tells us `thread_ts` is null because his message is not in
      a thread; we posted the answer as a fresh top-level message. Thirty-one
      real questions in `ai_team_hq_test` and not one of them has a reply
      attached to it — every answer sits in the flow as though it arrived
      unprompted, which is exactly how a database behaves and exactly not how a
      person does.

      The message's own `ts` is the thread to start. Slack has no separate act
      of "creating a thread": posting with `thread_ts` set to another message's
      `ts` makes that message the parent, and Grant's client then shows his
      question with "1 reply" under it.

      `origin_ref` is `channel:ts`, written by the adapter (`src/slack/events.ts`).
      Split from the right, because a channel id cannot contain a colon and a
      timestamp cannot either, but reading it left-to-right would break the day
      anything is prefixed. Guarded on the channel matching, so a malformed ref
      threads nowhere rather than into another room.
    */
    const parent = threadParent(row.channel_id, row.origin_ref ?? null)
    const threadTs = row.thread_ts ?? parent
    return {
      channelId: row.channel_id,
      threadTs,
      /*
        Broadcast only when WE are starting the thread — that is, when Slack
        said the asking message was not in one and we are making it a parent.
        A reply inside a thread Grant already opened needs no broadcast: he is
        watching it, and putting every reply back in the channel is the noise
        this change is about.
      */
      broadcast: (row.thread_ts ?? null) === null && parent !== null,
      via: threadTs === null ? 'channel' : 'thread',
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
    const inWorkspace = teamId === null ? 'true' : `m.team_id = ${lit(teamId)}`
    const home = await db.execute(`
      select m.channel_id from public.jobs j
        join public.slack_channel_map m
          on ${inWorkspace}
         and m.team_id in (select w.team_id from public.slack_workspaces w where w.office_id = j.office_id)
         and m.active and m.bot_present
         and m.purpose = 'general'
       where j.job_id = ${lit(job.jobId)}::uuid
         and j.office_id = app.job_office(${lit(job.jobId)}::uuid)
         and (j.requested_by like 'duty:%' or j.requested_by like 'voice:%')
       order by m.created_at
       limit 1
    `)
    const row = home.rows[0] as { channel_id?: string } | undefined
    return row?.channel_id === undefined
      ? null
      : { channelId: row.channel_id, threadTs: null, broadcast: false, via: 'general' }
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
    where project_id = ${lit(job.projectId)}::uuid
      and project_id in (select pp.project_id from public.projects pp where pp.office_id = app.job_office(${lit(job.jobId)}::uuid))
      and team_id in (select w.team_id from public.slack_workspaces w where w.office_id = app.job_office(${lit(job.jobId)}::uuid))
      and active and bot_present
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
    broadcast: false,
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

      // The person is the one the caller named, or else the CLAIMED job's own office's person - never a literal.
      const subject =
        options.subject === undefined
          ? `app.office_actor(app.job_office(${lit(job.jobId)}::uuid))`
          : lit(options.subject)
      const allowed = await db.execute(`
        select app.notification_allowed(app.job_office(${lit(job.jobId)}::uuid),
          ${subject}, 'slack', ${lit(severity)}::public.notify_severity,
          ${job.projectId === null ? 'null' : `${lit(job.projectId)}::uuid`}) as allowed
      `)
      if ((allowed.rows[0] as { allowed?: boolean } | undefined)?.allowed !== true) {
        await db.execute(`
          insert into public.notification_events
            (office_id, channel, severity, project_id, subject_kind, subject_ref, outcome)
          values (app.job_office(${lit(job.jobId)}::uuid), 'slack', ${lit(severity)}::public.notify_severity,
                  ${job.projectId === null ? 'null' : `${lit(job.projectId)}::uuid`},
                  'output', ${lit(outputId)}::uuid, 'suppressed')
        `)
        return { delivered: false, note: 'suppressed by notification preferences' }
      }

      /*
        A link, minted here rather than by the handler (#258).

        Ten minutes is the life of these URLs, and an output can be delivered
        to two channels or retried tomorrow -- so a URL minted when the report
        was written would be dead by the time it was sent. The path travels on
        the output and each channel mints its own at the moment it sends.

        A failure to mint is NOT a failure to deliver. The answer is worth
        having without the link, and `resultBlocks` says plainly that the file
        is in the project and could not be linked from here.
      */
      const attach = output.attachFile
      const file =
        attach === undefined
          ? null
          : {
              filename: attach.filename,
              url:
                attach.storagePath === undefined ||
                options.projectRef === undefined ||
                options.serviceKey === undefined ||
                options.serviceKey === ''
                  ? null
                  : await signedUrl(options.projectRef, options.serviceKey, attach.storagePath),
            }

      const result = await office.deliver({
        dedupeKey: deliveryKey(job, output, 'result'),
        teamId: options.teamId,
        channelId: target.channelId,
        threadTs: target.threadTs,
        broadcast: target.broadcast,
        purpose: 'result',
        staff: context.staff,
        staffId: context.staffId,
        correlationId: job.correlationId,
        jobId: job.jobId,
        blockerId: context.blockerId,
        message: {
          staffTitle: context.staff?.title ?? null,
          body: output.body,
          metadata: {
            confidence: output.confidence,
            evidence: output.evidence,
            sources: output.sources,
            contradictions: output.contradictions,
            reviewed: context.reviewed,
            routine: context.routine,
          },
          correlationId: job.correlationId,
          actions: context.actions,
          projectUrl: context.projectUrl,
          file,
        },
      })

      if (result.outcome === 'sent' || result.outcome === 'already_sent') {
        await db.execute(`
          insert into public.notification_events
            (office_id, channel, severity, project_id, subject_kind, subject_ref, outcome)
          values (app.job_office(${lit(job.jobId)}::uuid), 'slack', ${lit(severity)}::public.notify_severity,
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

/**
 * Telling Grant, on every surface that should tell him.
 *
 * The worker has one `notifying` state and there are now two outbound channels,
 * which raises the question this file answers: does a finished job go to Slack,
 * to Telegram, or to both?
 *
 * **Both, on different terms, decided by one rule.** §12 gives the surfaces
 * different jobs — Slack is the office and holds the record, Telegram is the
 * pager and interrupts — so "also send to Telegram" is not a flag, it is the
 * same `app.notification_allowed` question asked for a second channel, plus a
 * severity floor that makes the pager quieter than the office by default.
 *
 * The alternative was a second severity rule for Telegram, and it is the wrong
 * shape for the reason 0013's own comment gives about that function: a filter
 * applied in one of two call paths drifts from the one in the other.
 *
 * ## Why a failed page does not fail the job
 *
 * Neither does a failed post. The work is done and committed — that is what
 * `committed` means and it is already true — and rolling a job back because a
 * message did not send would discard finished work. What the notifier must
 * never do is claim a delivery it did not make, so the state reason carries
 * every channel's actual outcome, including the boring ones.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { HandlerOutput, Job, Notifier, NotifyOutcome } from '../jobs/worker.ts'
import type { ActionId } from '../slack/blocks.ts'
import { ACTIONS } from '../slack/blocks.ts'
import type { StaffPresentation } from '../slack/identity.ts'
import type { PagerSeverity, TelegramPager } from '../telegram/pager.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * What both channels need to know about a finished job.
 *
 * Resolved once. Two resolvers reading the same three tables would eventually
 * disagree about who produced an output, and the disagreement would show up as
 * one channel attributing a finding to the wrong specialist.
 */
export interface ResultContext {
  readonly staff: StaffPresentation | null
  /** False for §10-substantive output that has not been reviewed. */
  readonly reviewed: boolean
  readonly actions: readonly ActionId[]
  readonly projectUrl: string | null
}

export async function resultContext(
  db: SqlExecutor,
  job: Job,
  outputId: string,
  projectUrlBase?: string | null,
): Promise<ResultContext> {
  // Who to present as. There is no assignment table and deliberately so — §9's
  // roster IS the record of who was convened, and `routing_decisions` holds it
  // as slugs. An empty roster is a real answer ("trivial work spawns no
  // subagents"), and the message then comes from no one in particular rather
  // than from an invented author.
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

  // Read from the output row rather than inferred from the production path.
  // §16 exempts a deterministic output from review, which is not the same as it
  // being unreviewed — saying "not reviewed" about a mechanical retrieval would
  // cry wolf — and an inference output that somehow reached here unreviewed
  // must be labelled. The row knows which.
  const reviewRow = await db.execute(`
    select reviewer_status::text as status, deterministic
    from public.outputs where output_id = ${lit(outputId)}::uuid
  `)
  const review = reviewRow.rows[0] as { status: string | null; deterministic: boolean } | undefined
  const reviewed =
    review?.deterministic === true ||
    review?.status === 'approved' ||
    review?.status === 'approved_with_reservations'

  const projectUrl =
    projectUrlBase === null || projectUrlBase === undefined || job.projectId === null
      ? null
      : `${projectUrlBase.replace(/\/+$/, '')}/projects/${job.projectId}`

  // Undo is offered only when there is something to undo — an offer that does
  // nothing is worse than no offer, because it teaches that Undo does nothing.
  const offers = await db.execute(`
    select count(*)::int as n from public.undo_offers
    where correlation_id = ${lit(job.correlationId)}::uuid
  `)
  const undoable = Number((offers.rows[0] as { n?: number } | undefined)?.n ?? 0) > 0
  const actions = ACTIONS.filter(
    (action) =>
      (action !== 'undo' || undoable) && (action !== 'open_project' || projectUrl !== null),
  )

  return { staff, reviewed, actions, projectUrl }
}

export interface CombinedOptions {
  readonly severity?: PagerSeverity
  readonly projectUrlBase?: string | null
}

/**
 * One notifier over several channels.
 *
 * Runs them in order and reports every outcome, including "not paged". A note
 * that says only what succeeded is how a channel stops working unnoticed: the
 * symptom of a pager that never pages is silence, which is also the symptom of
 * a quiet week.
 */
export function combinedNotifier(
  channels: readonly {
    readonly name: string
    readonly notify: (
      job: Job,
      output: HandlerOutput,
      outputId: string,
      context: ResultContext,
    ) => Promise<NotifyOutcome>
  }[],
  db: SqlExecutor,
  options: CombinedOptions = {},
): Notifier {
  return async (job, output, outputId) => {
    const context = await resultContext(db, job, outputId, options.projectUrlBase)
    const notes: string[] = []
    let delivered = false

    for (const channel of channels) {
      try {
        const outcome = await channel.notify(job, output, outputId, context)
        delivered = delivered || outcome.delivered
        notes.push(outcome.note)
      } catch (error) {
        // One channel failing must not stop the next. A Slack outage that also
        // silenced the pager would take out the surface that exists to work
        // when the other does not.
        notes.push(`${channel.name} threw: ${(error as Error).message.slice(0, 80)}`)
      }
    }

    return { delivered, note: notes.join('; ').slice(0, 200) }
  }
}

/** Adapt a `TelegramPager` to the combined notifier's shape. */
export function pagerChannel(
  pager: TelegramPager,
  severity: PagerSeverity = 'routine',
): {
  readonly name: string
  readonly notify: (
    job: Job,
    output: HandlerOutput,
    outputId: string,
    context: ResultContext,
  ) => Promise<NotifyOutcome>
} {
  return {
    name: 'telegram',
    notify: async (job, output, outputId, context) =>
      pager.page({
        job,
        output,
        outputId,
        staffName: context.staff?.name ?? null,
        staffTitle: context.staff?.title ?? null,
        reviewed: context.reviewed,
        severity,
        actions: context.actions,
      }),
  }
}

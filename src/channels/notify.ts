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
  //
  // Up the parent chain when this job has no decision of its own. A follow-up
  // job — the collector that watches an artifact Grant asked the Chief of Staff
  // for — is the same person continuing the same piece of work, and having the
  // link arrive from nobody in particular would undo the whole point of §9's
  // named staff.
  const staffRow = await db.execute(`
    with recursive lineage as (
      select job_id, parent_job_id, 0 as depth
        from public.jobs where job_id = ${lit(job.jobId)}::uuid
      union all
      select j.job_id, j.parent_job_id, l.depth + 1
        from public.jobs j join lineage l on j.job_id = l.parent_job_id
       where l.depth < 8
    )
    select st.slug, st.name, st.title, st.avatar_ref
    from lineage l
    join public.routing_decisions r on r.job_id = l.job_id
    join public.staff st on st.slug = r.roster[1]
    order by l.depth asc, r.decided_at desc
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

  // An approval request gets two buttons and only two (0083). Swapped for the
  // usual six rather than added to them: 👍 on "may I generate this?" answers
  // nothing, and Undo on a thing that has not happened is worse than nothing.
  const asking = await db.execute(`
    select app.open_approval_for_job(${lit(job.jobId)}::uuid) as id
  `)
  if ((asking.rows[0] as { id?: string | null } | undefined)?.id != null) {
    return { staff, reviewed, actions: ['approve', 'decline'], projectUrl }
  }

  // Undo is offered only when there is something to undo — an offer that does
  // nothing is worse than no offer, because it teaches that Undo does nothing.
  const offers = await db.execute(`
    select count(*)::int as n from public.undo_offers
    where correlation_id = ${lit(job.correlationId)}::uuid
  `)
  const undoable = Number((offers.rows[0] as { n?: number } | undefined)?.n ?? 0) > 0
  const actions = ACTIONS.filter(
    (action) =>
      // The approval pair never appears on an ordinary result — there is
      // nothing to approve — and the list is filtered rather than partitioned
      // so that a new action added to ACTIONS has to say where it belongs.
      action !== 'approve' &&
      action !== 'decline' &&
      (action !== 'undo' || undoable) &&
      (action !== 'open_project' || projectUrl !== null),
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
    /**
     * Which surface this channel writes to, when it writes to a shared one.
     *
     * Grant, having watched it for a day: *"there's a lot of repetition going
     * on in the Telegram messages."* There was, and it was structural: the
     * reply channel answers in the chat an instruction arrived in, the pager
     * interrupts with anything important, and for an instruction Grant sent
     * from Telegram those are the same chat. Every job produced two identical
     * messages fifteen seconds apart.
     *
     * Neither channel was wrong. The rule that was missing sits above both of
     * them: **one message per surface per job.** The first channel to reach a
     * surface has said the thing; the second has nothing to add and no way to
     * know that on its own.
     *
     * Undeclared means "no surface of its own", which for Slack is correct —
     * it posts to a project channel, not to a chat Grant is already reading.
     */
    readonly surface?: string
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
    // 0074: a job may declare its own output not worth a message. Interim
    // polls of a still-generating artifact are real outputs — the poll
    // happened, the answer was "not yet" — and saying "not yet" nine times is
    // how a pager stops being read. Checked here rather than per channel so
    // there is one rule, for the reason this file's header already gives about
    // a filter applied in one of two call paths.
    const quiet = await db.execute(
      `select announce from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
    )
    if ((quiet.rows[0] as { announce?: boolean } | undefined)?.announce === false) {
      return { delivered: false, note: 'nothing worth announcing' }
    }

    const context = await resultContext(db, job, outputId, options.projectUrlBase)
    const notes: string[] = []
    let delivered = false

    // Surfaces already spoken to on this job. See `surface` above: the reply
    // and the pager both write to Telegram, and for an instruction Grant sent
    // from Telegram they write to the same chat.
    const spokenTo = new Set<string>()

    for (const channel of channels) {
      if (channel.surface !== undefined && spokenTo.has(channel.surface)) {
        notes.push(`${channel.name}: already said on ${channel.surface}`)
        continue
      }
      try {
        const outcome = await channel.notify(job, output, outputId, context)
        if (outcome.delivered && channel.surface !== undefined) spokenTo.add(channel.surface)
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
  readonly surface: string
  readonly notify: (
    job: Job,
    output: HandlerOutput,
    outputId: string,
    context: ResultContext,
  ) => Promise<NotifyOutcome>
} {
  return {
    name: 'telegram',
    surface: 'telegram',
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

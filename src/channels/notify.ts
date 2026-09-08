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
  /**
   * The author's row id, beside their presentation.
   *
   * Separate from `StaffPresentation` on purpose: that type is about how a
   * person LOOKS in Slack — name, title, face — and is built by scripts that
   * have no job and no row to hand. An id is not presentation.
   *
   * It exists because `deliveries.staff_id` was passed `null` at every call
   * site. The first live Scenario A run found 253 of 269 deliveries with no
   * author, which is §22 A's "correct staff identity" satisfied on screen and
   * nowhere that outlives the message.
   */
  readonly staffId: string | null
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
  //
  // Through `app.staff_behind_job` rather than a copy of its query. This was
  // the copy: 0103 extracted the same lineage walk into SQL for the voice
  // surface, and two hand-written versions of "who does this job belong to" is
  // two things to keep in step. 0106 then added the duty fallback — a recurring
  // duty is routed by nothing, so it had no decision to walk to, and the daily
  // capacity report posted into #the_team as the bare app with no name and no
  // face, beside eight introductions that each had both. Only the function
  // knew about that fallback; the copy here did not.
  const staffRow = await db.execute(`
    select st.staff_id::text as staff_id, st.slug, st.name, st.title, st.avatar_ref
      from public.staff st
     where st.slug = app.staff_behind_job(${lit(job.jobId)}::uuid)
  `)
  const raw = staffRow.rows[0] as
    | { staff_id: string; slug: string; name: string; title: string; avatar_ref: string | null }
    | undefined
  const staff: StaffPresentation | null =
    raw === undefined
      ? null
      : { slug: raw.slug, name: raw.name, title: raw.title, avatarRef: raw.avatar_ref }
  const staffId = raw === undefined ? null : raw.staff_id

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
    return { staff, staffId, reviewed, actions: ['approve', 'decline'], projectUrl }
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

  return { staff, staffId, reviewed, actions, projectUrl }
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
        staffId: context.staffId,
        reviewed: context.reviewed,
        severity,
        actions: context.actions,
      }),
  }
}

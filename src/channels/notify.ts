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

import { refuseToSend } from '../agents/quality.ts'
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
  /**
   * True when this output is a mechanical read rather than a judgement.
   *
   * `outputs.deterministic`, resolved here for the same reason everything else
   * in this type is: two surfaces deciding it separately would eventually
   * disagree, and the disagreement would show as Telegram cautioning about a
   * folder listing that Slack presented as plain fact.
   *
   * See `MessageMetadata.routine` in `src/slack/blocks.ts` for what it costs a
   * message, and why.
   */
  readonly routine: boolean
  readonly actions: readonly ActionId[]
  readonly projectUrl: string | null
  /**
   * The question the approve/decline buttons on this message belong to, or null when it asks none (#396).
   * Decided HERE, once, and carried into the delivery row so a press or a reply is bound by this id and not by
   * which question its job happened to have latest.
   */
  readonly blockerId: string | null
}

export async function resultContext(
  db: SqlExecutor,
  job: Job,
  outputId: string,
  projectUrlBase?: string | null,
  /** The question this output was written to ask, when the writer knows (a paused job's question). */
  asksBlocker?: string | null,
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
    select o.reviewer_status::text as status, o.deterministic
    from public.outputs o
    join public.jobs oj on oj.job_id = o.job_id and oj.office_id = app.job_office(${lit(job.jobId)}::uuid)
    where o.output_id = ${lit(outputId)}::uuid
  `)
  const review = reviewRow.rows[0] as { status: string | null; deterministic: boolean } | undefined
  const reviewed =
    review?.deterministic === true ||
    review?.status === 'approved' ||
    review?.status === 'approved_with_reservations'
  const routine = review?.deterministic === true

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
  const askedId = (asking.rows[0] as { id?: string | null } | undefined)?.id ?? null
  if (askedId !== null) {
    return {
      staff,
      staffId,
      reviewed,
      routine,
      actions: ['approve', 'decline'],
      projectUrl,
      // The writer's own question wins over "the latest open one": a job with two open questions asks about the
      // one it wrote this message for.
      blockerId: asksBlocker ?? askedId,
    }
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
      (action !== 'open_project' || projectUrl !== null) &&
      /*
        A mechanical read is offered nothing to judge.

        👍 and 👎 are #59's feedback loop and they ask "was this the right
        call". "Looked at 1 Drive folder. Nothing new." contains no call, so a
        thumbs-down on it records dissatisfaction with a fact and teaches the
        loop nothing. "More detail" has nothing more to give: the whole of the
        output is the sentence.

        What SURVIVES here is the pair that is not feedback. Undo stays
        because a mechanical write is exactly the thing most worth undoing —
        and CLAUDE.md already records that discouraging undo is the failure
        mode. Open project stays because it is navigation.

        Mute is the one judgement call in this list. It is the honest reply to
        a noisy duty, and it is dropped anyway: it belongs to the whole duty
        rather than to one run of it, muting from a message that arrives 270
        times means finding whichever of the 270 is on screen, and the
        preferences are where a standing decision belongs. Recorded rather
        than assumed — if Grant reaches for it and it is not there, that is a
        one-line change back.
      */
      (!routine ||
        (action !== 'feedback.useful' &&
          action !== 'feedback.not_useful' &&
          action !== 'mute_24h' &&
          action !== 'more_detail')),
  )

  return { staff, staffId, reviewed, routine, actions, projectUrl, blockerId: null }
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
    // raw-sql[2]: keyed by the claimed job; it reads one column of the job the worker holds and touches nothing else.
    const quiet = await db.execute(
      `select announce from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
    )
    if ((quiet.rows[0] as { announce?: boolean } | undefined)?.announce === false) {
      return { delivered: false, note: 'nothing worth announcing' }
    }

    /*
      The last gate before a person (#185).

      On 13 September Claire told Grant, at 03:45, that she had pulled the
      project records and that the database read showed five active projects.
      None of the five existed, and the output row said `evidence: inferred` —
      the office knew nothing had been read, and rendered that knowledge as
      grey caption text UNDER the sentence claiming the read.

      `metadataProblems` now refuses that combination when the output is
      CREATED, which is the right place and not the only one that matters:
      `resumeNotifications` rebuilds an output from its stored row and sends it
      without passing through creation at all. So the rule is asserted again
      here, at the one point every channel goes through, for the same reason
      the `announce` gate above is here rather than in each channel.

      Refused, not fixed. Editing the sentence would put words in an agent's
      mouth, and dropping it silently is what #185 objects to in the first
      place — so it becomes an impediment, which is #49's mechanism for "an
      agent could not do this" and the surface Grant already reads it on.
    */
    const refusal = refuseToSend({
      confidence: output.confidence,
      evidence: output.evidence,
      sources: output.sources,
      contradictions: output.contradictions,
      body: output.body,
    })
    if (refusal !== null) {
      // Never throws. A job that failed to send and then failed to write down
      // why it failed to send is the worst outcome available here, and the
      // note below is the fallback record either way.
      try {
        await db.execute(
          `select app.cannot(${lit(job.jobId)}::uuid, 'missing_data',
             ${lit(refusal.needed)}, 'the sending path',
             ${lit(refusal.reason.slice(0, 500))},
             ${lit(`output ${outputId} was written and not sent`)})`,
        )
      } catch {
        /* Recording a refusal must not become a second failure. */
      }
      return { delivered: false, note: `not sent: ${refusal.reason}`.slice(0, 200) }
    }

    const context = await resultContext(
      db,
      job,
      outputId,
      options.projectUrlBase,
      output.asksBlocker ?? null,
    )
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

/**
 * Adapt a `TelegramPager` to the combined notifier's shape.
 *
 * ## Why the pager is chosen per job rather than once
 *
 * It used to be one `TelegramPager` built on the pager bot, so every result
 * from every member of staff arrived in Grant's private chat from the same
 * account. Once the office group existed that was exactly wrong: he asked for
 * *"only the chief of staff should message me directly"*, and the routing to
 * make that true already exists in `app.telegram_chat_for` (0136) — but it
 * answers PER BOT, and a single pager bot only ever asks it one question.
 *
 * So the bot is looked up from whoever did the work. Marcus's result goes out
 * on Marcus's bot, which routes to the group; Claire's goes out on hers, which
 * routes to Grant. The rule lives in one place and this just stops bypassing
 * it.
 *
 * Falling back to the pager when the job belongs to nobody, which is the case
 * the pager was built for.
 */
export function pagerChannel(
  pagerFor: (staffSlug: string | null) => Promise<TelegramPager | null>,
  /**
   * Used only when the handler did not say.
   *
   * It used to be the ONLY answer, fixed at `important` by the caller, so
   * every job in the building buzzed Grant's phone with the same sentence
   * Slack had just received. The handler knows whether its outcome is worth
   * interrupting somebody over; this is the floor under a handler that has no
   * opinion.
   */
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
    notify: async (job, output, outputId, context) => {
      const pager = await pagerFor(context.staff?.slug ?? null)
      if (pager === null) {
        return { delivered: false, note: 'no telegram bot for this job, and no pager' }
      }
      return await pager.page({
        job,
        output,
        outputId,
        staffName: context.staff?.name ?? null,
        staffTitle: context.staff?.title ?? null,
        staffId: context.staffId,
        reviewed: context.reviewed,
        routine: context.routine,
        severity: output.severity ?? severity,
        actions: context.actions,
        blockerId: context.blockerId,
      })
    },
  }
}

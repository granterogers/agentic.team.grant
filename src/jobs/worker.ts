/**
 * The worker — the thing that actually drives a job through the gates.
 *
 * Until this existed the system was all enforcement and no engine: triggers
 * that refuse the wrong transition, a router that cannot be called without a
 * duplicate scan, a review gate that cannot be bypassed — and nothing moving a
 * job from `queued` to `complete`. Every one of those guarantees was tested in
 * isolation. This is the first thing that meets them all in one pass, which is
 * the only way integration defects surface.
 *
 * ## The rule this file follows
 *
 * **It takes no shortcut that the database would have allowed.**
 *
 * A worker is the natural place for shortcuts, because a worker knows what it
 * is doing: it wrote the output, so why re-read `reviewer_status`; it produced
 * the answer deterministically, so why not set `deterministic = true`. Every
 * such shortcut turns an enforced invariant into an honour-system one, and the
 * enforcement stays green because nothing exercises it any more.
 *
 * So the worker walks the full state path, writes outputs the same way any
 * other caller would, and lets the triggers refuse it when it is wrong. When a
 * transition is refused, that is information, not an obstacle.
 *
 * ## Leases
 *
 * `app.dequeue_job` takes a lease. If this process dies, the lease expires and
 * the recovery sweep reclaims the job — that is the whole crash story, and it
 * is why nothing here needs a shutdown hook. A shutdown hook that a killed
 * process never runs is not a recovery mechanism.
 */

import type { Domain } from '../agents/provenance.ts'
import type { Confidence, Evidence, ProductionPath } from '../agents/quality.ts'
import { metadataProblems, reviewRequired } from '../agents/quality.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { PagerSeverity } from '../telegram/pager.ts'
import { redactDeep } from '../text/secrets.ts'
import type { Plan } from '../tools/plan.ts'
import { plannedWrites, summarise } from '../tools/plan.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * Say what happened, as it happens (#115).
 *
 * Two things this does that a caller must not have to remember.
 *
 * **It redacts.** Every string anywhere in `detail` goes through the shared
 * list in `src/text/secrets.ts`. A handler passing a provider error that
 * carries the URL it was called with is the common case, not the exotic one.
 * The CHECK on `job_traces` is the backstop; this is the thing that stops the
 * backstop from turning an ordinary trace into a job failure.
 *
 * **It never throws.** A trace is a record OF the work and must never be a way
 * for the work to fail — a job that completed and then died writing a note
 * about completing would be the worst possible bug to introduce here. So the
 * write is attempted and a failure is swallowed, which is the one place in this
 * file where swallowing is right: the alternative is that observability can
 * break production.
 */
async function trace(
  db: SqlExecutor,
  jobId: string,
  kind: string,
  detail: Record<string, unknown> = {},
  numbers: { tokensIn?: number; tokensOut?: number; pence?: number; ms?: number } = {},
): Promise<void> {
  const n = (v: number | undefined): string => (v === undefined ? 'null' : String(v))
  try {
    await db.execute(
      `select app.job_trace_add(${lit(jobId)}::uuid, ${lit(kind)},
         ${lit(JSON.stringify(redactDeep(detail)))}::jsonb,
         ${n(numbers.tokensIn)}, ${n(numbers.tokensOut)},
         ${n(numbers.pence)}, ${n(numbers.ms)})`,
    )
  } catch {
    /* A trace is a record of the work, never a way for the work to fail. */
  }
}

/**
 * Ask a handler what it would change, and write it down (#131).
 *
 * Silent when a handler has no `plan` — most only read, and a plan for a read
 * is noise. Silent on failure too, for the reason above `trace`: observability
 * must never be a way for production to break.
 */
async function recordPlan(db: SqlExecutor, job: Job, handler: Handler): Promise<void> {
  if (handler.plan === undefined) return
  try {
    const plan = await handler.plan(job, db)
    const steps = JSON.stringify(plan.steps)
    const reaches =
      plan.reaches.length === 0
        ? `array[]::text[]`
        : `array[${plan.reaches.map((r) => lit(r)).join(', ')}]`
    await db.execute(
      `select app.job_plan_set(${lit(job.jobId)}::uuid, ${lit(plan.tool)}, ${reaches},
         ${lit(steps)}::jsonb, ${lit(summarise(plan))}, ${String(plannedWrites(plan))})`,
    )
    await trace(db, job.jobId, 'plan', {
      tool: plan.tool,
      steps: plan.steps.length,
      writes: plannedWrites(plan),
      summary: summarise(plan),
    })
  } catch {
    /* A plan is a description of the work, never a way for the work to fail. */
  }
}

export interface Job {
  readonly jobId: string
  readonly kind: string
  readonly correlationId: string
  readonly projectId: string | null
  readonly idempotencyKey: string
  readonly attempt: number
}

/** What a handler produces. Deliberately the same shape §16 requires. */
export interface HandlerOutput {
  readonly body: string
  /**
   * Whether this outcome is worth telling anyone about.
   *
   * Undefined leaves the job's own flag alone, which is what every handler
   * meant before this existed. `false` says "nothing happened" and suppresses
   * every channel; `true` says the opposite for a job whose flag is off.
   *
   * It belongs on the OUTPUT because the handler is the only thing that knows.
   * A duty that read the notebooks and found nothing is not news; the same duty
   * finding three new sources is. Deciding that from the job kind — which is
   * what `jobs.announce` alone can do — gets one of those two wrong, and it got
   * the common one wrong: Marcus told Grant "Looked through 2 notebooks.
   * Nothing new." on Telegram AND Slack, hourly, for a day.
   *
   * Before this, `calendar.ts` and `mail.ts` each wrote the same UPDATE by
   * hand. Two copies were tolerable; six would be the version somebody
   * forgets, which is how the hourly repetition happened.
   */
  readonly announce?: boolean
  /**
   * Everything the answer could legitimately have taken a SPECIFIC from — the
   * instruction, the conversation replayed into the prompt, and the documents
   * retrieved for it.
   *
   * Handed to the coherence gate and never stored. The handler is the only
   * thing that knows what it put in front of the model, and `fabricatedWhen`
   * cannot ask "was this in the input" without being told what the input was
   * (#231).
   */
  readonly grounding?: string
  /**
   * Which kinds of record were actually consulted this turn — see
   * `provenance.consulted()`. Handed to the coherence gate and never stored.
   */
  readonly consulted?: {
    readonly consulted: readonly Domain[]
    readonly complete: readonly Domain[]
  }
  /**
   * The office's internal tool identifiers, for #246's answer check. Handed to
   * the coherence gate and never stored.
   */
  readonly toolNames?: readonly string[]
  /**
   * The standing rules put in front of this job, in Grant's own words — #242.
   *
   * Handed to the coherence gate and never stored. Only the handler knows what
   * `guidanceFor` returned, so only the handler can say which rules the answer
   * was actually subject to; absent disables the check rather than inventing
   * a constraint to enforce.
   */
  readonly standingRules?: readonly string[]

  /**
   * The clause somebody else continues with, once this answer exists (#128).
   *
   * On the OUTPUT rather than performed by the handler, because a handoff
   * carries what the first agent produced and only the worker has the
   * `output_id` — the handler returns an output, the worker writes it.
   *
   * Undefined on almost every output. A handoff fires only when a request's
   * clauses are joined by a sequence word and belong to two different people.
   */
  readonly handoff?: {
    /** Who continues. A staff slug. */
    readonly to: string
    /** Who is handing it on. A staff slug — the agent that answered. */
    readonly from: string
    /** What they are asked to do, verbatim from the request. */
    readonly clause: string
    /** Why it is a handoff, in the office's words. */
    readonly because: string
  }
  /**
   * How many things this turn actually did — #248.
   *
   * Absent means not counted and never accuses anybody; an explicit zero is
   * what lets the gate refuse an answer reporting a creation that did not
   * happen. The field on `OutputMetadata` has existed for months with no
   * caller, which is why the check that reads it could never fire.
   */
  readonly acted?: number
  /**
   * Send this output as a playable audio file rather than as text (#66).
   *
   * On the OUTPUT, like `announce`, because the handler is the only thing that
   * knows there is a file — and because it must ride on the same delivery as
   * the sentence. Grant, on a voice note that arrived as two messages: *"try to
   * have everything self contained."* A file and its explanation sent
   * separately is that failure in the other direction.
   *
   * Not stored on the output row: bytes belong in Storage and the row already
   * records where. This is a delivery instruction with the lifetime of one
   * send.
   */
  readonly attachAudio?: {
    readonly bytes: Uint8Array
    readonly filename: string
    readonly title: string
    readonly performer?: string
    readonly durationSeconds?: number
  }
  /**
   * Send this output as a file rather than as text (#258).
   *
   * The same idea as `attachAudio` and deliberately a second field rather than
   * a widened one: Telegram's `sendAudio` and `sendDocument` are different
   * methods producing different things, and a PDF arriving in an audio player
   * is not a smaller mistake for being close. A handler that has both has a
   * bug, and two fields make that sayable.
   *
   * Not stored on the output row: the bytes are in Storage and the document
   * row records where. This is a delivery instruction with the lifetime of one
   * send.
   */
  readonly attachFile?: {
    readonly bytes: Uint8Array
    readonly filename: string
    readonly mime: string
  }
  /**
   * How loudly. `routine` is Slack only; `important` and above buzz a phone.
   *
   * Undefined means routine, which is the important half of this: §12 gives
   * Telegram ONE interrupting voice and Slack the running detail, and until
   * now every notification was sent at a fixed `important` — so the office and
   * the pager received the identical sentence, seconds apart, forever.
   *
   * Grant, looking at the result: *"there's a lot of mindless repetition on
   * Telegram and Slack."* The two surfaces are supposed to carry different
   * things. Making a handler ASK to interrupt is what makes that true.
   */
  readonly severity?: PagerSeverity
  /**
   * The structure beside the prose (#130).
   *
   * `outputs.body` is text for every job kind, so a research summary, a list of
   * extracted tasks and a draft document all arrive as English and every
   * consumer re-parses it to find out what it got. That is why IMPORT TO
   * PROJECT (#28) reads sentences, and why a list of extracted tasks cannot
   * simply become tasks.
   *
   * `body` STAYS. Prose is what Grant reads and it is the right thing to send
   * to Telegram; this sits beside it, never instead of it — an output that is
   * only structured is an output nobody wants to receive.
   *
   * Optional, and absent on most handlers, which is honest: a duty reporting
   * that the diary already matches has no structure worth declaring. Naming a
   * shape that `public.output_shapes` does not declare, or facts that do not
   * match it, FAILS THE JOB at the moment it happens rather than surprising a
   * reader later — the trigger in 0272 does that, so it holds for every writer
   * rather than for this one.
   */
  readonly shape?: string
  readonly facts?: Record<string, unknown>
  readonly confidence: Confidence
  readonly evidence: Evidence
  readonly sources: readonly string[]
  readonly contradictions: string | null
  /**
   * How it was produced. NOT a boolean the handler sets to skip review — 0023
   * refuses a determinism claim from a job with recorded inference usage, so a
   * handler that lies here fails at the insert rather than getting away with
   * it.
   */
  readonly path: ProductionPath
  readonly model: string | null
}

export interface Handler {
  readonly kind: string
  handle(job: Job, db: SqlExecutor): Promise<HandlerOutput>
  /**
   * What this job would change OUTSIDE the office, without changing it (#131).
   *
   * Optional, and absent on every handler that only reads — a plan for a read
   * is noise. Present on every one that writes outward, because an approval
   * that cannot show what it is approving is consent to a category rather than
   * to an action.
   *
   * The contract that makes it worth trusting is in `src/tools/plan.ts`: a
   * handler that implements this performs the work by CARRYING THIS PLAN OUT,
   * so there is no second description to drift. `verify:dryrun` holds the two
   * against each other — it fails a handler whose planning phase touches the
   * network at all, and one whose execution makes more outward calls than its
   * plan accounted for.
   */
  plan?(job: Job, db: SqlExecutor): Promise<Plan>
}

/**
 * What actually happens in the `notifying` state.
 *
 * Added because the worker was moving `committed → notifying → complete` with
 * `state_reason = 'delivered'` while delivering nothing at all. That is the
 * same defect the rest of this file is written against, in its politest form:
 * a state that names an action, a reason that asserts it happened, and no code
 * that does it. Nothing was wrong with the state machine — it was telling the
 * truth about which state it was in and a lie about what that state meant.
 *
 * Kept as a function type rather than a Slack import so the worker still knows
 * nothing about channels (§5). A worker with no notifier now says so in the
 * state reason instead of claiming a delivery.
 */
export interface NotifyOutcome {
  readonly delivered: boolean
  /** Recorded verbatim as the job's final `state_reason`. Keep it short. */
  readonly note: string
}

export type Notifier = (job: Job, output: HandlerOutput, outputId: string) => Promise<NotifyOutcome>

export type Reviewer = (
  output: HandlerOutput,
  job: Job,
) => Promise<{
  status: 'approved' | 'approved_with_reservations' | 'rejected' | 'needs_revision'
  notes: string
}>

export interface WorkerResult {
  readonly jobId: string
  readonly finalState: string
  readonly note: string
}

export class NoHandlerError extends Error {
  constructor(readonly kind: string) {
    super(`no handler registered for job kind ${kind}`)
    this.name = 'NoHandlerError'
  }
}

/**
 * Move a job to a state, letting the database refuse an illegal transition.
 *
 * Deliberately not guarded by a check against `ALLOWED_TRANSITIONS` first. The
 * allow-list in `src/jobs/states.ts` and the trigger are two copies of one
 * rule, and a worker that consults the copy would never discover that they had
 * drifted.
 */
const moveTo = async (
  db: SqlExecutor,
  jobId: string,
  state: string,
  reason?: string,
): Promise<void> => {
  const finished = ['complete', 'cancelled', 'failed'].includes(state)
  await db.execute(`
    update public.jobs
    set state = ${lit(state)}::public.job_state
      ${reason === undefined ? '' : `, state_reason = ${lit(reason)}`}
      ${finished ? ', finished_at = app.now_utc()' : ''}
    where job_id = ${lit(jobId)}::uuid
  `)
}

export interface Recovered {
  readonly jobId: string
  readonly fromState: string
  readonly reason: string
}

/**
 * Reconcile jobs a dead worker left holding a lease.
 *
 * The invariants call for *"a recovery sweep on boot"* and `0006` provides
 * `app.recover_stalled_jobs()`. Until this call existed, **nothing in the
 * system invoked it except a test** - the mechanism that makes crash recovery
 * work had no caller, and the only evidence was three jobs stuck `running`
 * with expired leases, permanently consuming the global capacity of three.
 *
 * That is the worse kind of leak. A leaked row distorts a summary; a leaked
 * lease stops the queue, and it looks like a code fault in whatever tries to
 * dequeue next.
 *
 * On boot, not on a timer: a worker starting is exactly the moment when "some
 * worker died" is most likely to be true and cheapest to fix.
 */
export const recoverStalled = async (db: SqlExecutor): Promise<readonly Recovered[]> => {
  const { rows } = await db.execute(
    `select job_id::text as job_id, from_state::text as from_state, reason
     from app.recover_stalled_jobs()`,
  )

  // Then put them back in the queue. `recover_stalled_jobs` moves a stalled job
  // to `retrying`, and `dequeue_job` only ever looks at `queued` - so recovery
  // alone leaves a job parked forever in a state nothing reads. 0006 shipped
  // `app.requeue_retrying()` for exactly this and, like the sweep itself, had
  // no caller outside a test.
  //
  // Two halves of one mechanism, each individually correct, with no code
  // joining them. The whole crash-recovery story was a sweep to nowhere.
  await db.execute('select app.requeue_retrying()')

  /*
    And the jobs that stopped ON PURPOSE and are now free to go on (#263).

    A pause is not a stall — nothing is holding a lease and recovery would not
    look at it — so it needs its own line, and without one a job that paused
    for a rate limit would wait for ever. `app.resumable_now` is deliberately
    narrow: only a clock, a rate limit or a provider outage, because everything
    else is waiting on a person and retrying those on a timer turns a pause
    into a spin.

    Here rather than in a duty for the same reason recovery is: a worker
    starting is exactly when "something was interrupted" is most likely true,
    and this costs one query.
  */
  /*
    And anything that HAPPENED which nobody has decided about yet (#264).

    A signal is recorded inside whatever transaction noticed it -- a document
    arriving, a connection failing -- and deliberately does nothing there, so a
    misconfigured trigger cannot fail an import. Deciding happens here, a
    moment later, where a failure costs the decision and not the document.
  */
  await db.execute('select app.fire_pending_signals(20)').catch(() => undefined)

  /*
    And CI reservations nothing ever reported against (#17).

    A dispatched workflow reserves its minutes up front so two dispatches
    cannot both be told there is room. A run that was cancelled or died never
    reports, so without this the reservation holds those minutes against the
    month for ever and the ceiling tightens by itself. They settle as SPENT,
    not released: a run that died still cost whatever it had used, and
    over-counting is the cheap direction.
  */
  await db.execute('select app.ci_expire_stale()').catch(() => undefined)

  const ready = (
    await db.execute(
      `select (x ->> 'job_id') as job_id, (x ->> 'reason') as reason
         from jsonb_array_elements(app.resumable_now()) x`,
    )
  ).rows as { job_id: string; reason: string }[]
  for (const paused of ready) {
    await db
      .execute(
        `select app.resume_job('${paused.job_id}'::uuid,
                               'the wait it was recorded against is over')`,
      )
      // One job that refuses to resume must not stop the others, and the
      // refusal is already recorded on the pause row.
      .catch(() => undefined)
  }

  return rows.map((r) => ({
    jobId: String(r.job_id),
    fromState: String(r.from_state),
    reason: String(r.reason),
  }))
}

/**
 * Put a job's outcome on the event ledger.
 *
 * §6 makes the ledger the spine of the system and §22 A requires *"all actions
 * versioned"*. The first live run of the Scenario A harness found 75 events in
 * the table and every single one written by a verification suite — 736
 * outputs, 269 deliveries, and not one action by the working system. The
 * ledger worked perfectly and nothing had ever used it.
 *
 * ## What is recorded, and what deliberately is not
 *
 * One event per job outcome, not one per state transition.
 * `job_state_transitions` already holds every transition and is append-only;
 * duplicating it here would make the ledger a second copy of a table nobody
 * reads rather than a record of what the office DID.
 *
 * `rationale_summary` carries a fixed sentence, never the finding's text and
 * never the model's reasoning. §6 is explicit that there is nowhere for
 * chain-of-thought to go, and a free-form summary is exactly that hole. The
 * body lives in `outputs`, which is where it belongs and where provenance
 * sits beside it.
 *
 * ## Why it cannot fail the job
 *
 * The work is done and delivered by the time this runs. A ledger write that
 * threw would turn a finished piece of work into a failed one and lose it,
 * which is a worse outcome than an unrecorded event — so the failure is
 * returned as a note and the job stands.
 */
const recordOnLedger = async (
  db: SqlExecutor,
  job: Job,
  what: string,
  detail: string,
): Promise<string | null> => {
  try {
    // `from public.jobs` with a predicate, rather than a bare select: it makes
    // the whole thing conditional in one statement, and the condition is that
    // this is work Grant asked for rather than the suite testing itself.
    //
    // The ledger was 75 rows and every one of them was a verification fixture
    // (see the header). Fixing that by writing real events and ALSO writing a
    // fixture event per probe would leave it just as unreadable — the daily
    // capacity report learned the same lesson about `requested_by` and reports
    // 20 finished jobs instead of 101.
    await db.execute(`
      select public.append_event(
        ${lit(job.correlationId)}::uuid,
        -- 'agent': the office did this, not Grant and not a cron. The check
        -- constraint allows user, agent and system, and a research finding is
        -- the middle one by any reading.
        'agent',
        coalesce(app.staff_behind_job(${lit(job.jobId)}::uuid), 'office'),
        ${lit(job.kind)},
        ${lit(what)},
        -- A finding is not reversible: it was produced, and un-producing it is
        -- not a thing. What IS reversible is the message about it, and that is
        -- undo_offers, which has its own deadline and its own record. (No
        -- backticks in a comment inside a template literal: they end the
        -- string, and the error surfaces two hundred lines away.)
        false,
        ${job.projectId === null ? 'null' : `${lit(job.projectId)}::uuid`},
        null, null,
        ${lit(detail)},
        '[]'::jsonb, null, null, null,
        ${lit(job.jobId)}::uuid
      )
      from public.jobs j
       where j.job_id = ${lit(job.jobId)}::uuid
         and coalesce(j.requested_by, '') not ilike '%verif%'
    `)
    return null
  } catch (error) {
    return `ledger not written: ${(error as Error).message.slice(0, 120)}`
  }
}

export const dequeue = async (
  db: SqlExecutor,
  workerId: string,
  /**
   * Whether this worker can turn a voice note into words.
   *
   * False in the Edge Function, which has no subprocesses and no Python and so
   * cannot run faster-whisper. 0125 uses this to leave untranscribed voice
   * notes for a worker that can hear, rather than letting the fast path claim
   * one and burn an attempt failing it — which would make voice notes strictly
   * worse off than before the speed-up.
   */
  canTranscribe = true,
  /**
   * Whether this worker can spawn a local process at all.
   *
   * False in the Edge Function for the same reason `canTranscribe` is, and it
   * is the more general fact: the live notebook adapter shells out to Python
   * for every read, so five notebook kinds and `office.sync` are work the fast
   * worker cannot do. 0137 keeps those queued for a worker that can, instead
   * of letting this one claim, attempt and fail them — which is what it did
   * silently from the moment Actions were switched off.
   */
  canSubprocess = true,
  /**
   * The kinds this worker actually holds a handler for.
   *
   * Undefined means "everything", which is what every caller meant before this
   * existed. Passing it stops the most obvious version of the rule 0125 and
   * 0137 already established for two special cases: three real duty jobs spent
   * hours in `paused` because a verification suite with five handlers was
   * handed work needing a sixth (0147).
   */
  kinds?: readonly string[],
  /**
   * Claim only work asked for by this exact name (#184, migration 0329).
   *
   * Undefined means "anything", which is what every office worker means and
   * what every caller meant before this existed.
   *
   * It exists because dequeue is GLOBAL, and two verification suites therefore
   * refused to start while any job was live anywhere — correctly, since either
   * would otherwise be handed work it holds no handler for. In a full pass
   * whichever ran second failed on the first one's debris, and it failed as
   * "22/26" rather than as "the queue was dirty".
   *
   * The scope also changes which capacity question is asked: one job at a time
   * per scope, rather than three across the office. See 0329's header for why
   * that is bounded rather than a way round the limit.
   */
  requestedBy?: string,
): Promise<Job | null> => {
  const { rows } = await db.execute(
    `select job_id::text as job_id, kind, correlation_id::text as correlation_id,
            project_id::text as project_id, idempotency_key, attempt
     from app.dequeue_job(${lit(workerId)}, ${canTranscribe ? 'true' : 'false'},
                          ${canSubprocess ? 'true' : 'false'},
                          ${
                            kinds === undefined
                              ? 'null'
                              : `array[${kinds.map(lit).join(', ')}]::text[]`
                          },
                          ${requestedBy === undefined ? 'null' : lit(requestedBy)})`,
  )
  const r = rows[0]
  if (r === undefined) return null
  return {
    jobId: String(r.job_id),
    kind: String(r.kind),
    correlationId: String(r.correlation_id),
    projectId: r.project_id === null ? null : String(r.project_id),
    idempotencyKey: String(r.idempotency_key),
    attempt: Number(r.attempt),
  }
}

/**
 * Run one job to a terminal state.
 *
 * The path is `running → output_created → quality_review → committing →
 * committed → notifying → complete`, with review actually consulted rather
 * than assumed. A deterministic output skips the reviewer but NOT the state
 * path: §16 exempts it from review, not from the pipeline, and running the
 * same states for both keeps one code path instead of two.
 */
export const runJob = async (
  db: SqlExecutor,
  job: Job,
  handlers: readonly Handler[],
  review: Reviewer,
  notify?: Notifier,
  /**
   * Called before the handler, so the person doing the work can say so.
   *
   * A function rather than a channel import, for the same reason `notify` is:
   * the worker knows nothing about Slack or Telegram (§5), and a worker that
   * imported a bot registry to send a courtesy message would have acquired a
   * channel dependency for the least important message in the system.
   *
   * Its failure is swallowed on purpose. The work proceeds and the result
   * arrives by the usual route; a job that died because an "on it" could not be
   * sent would be absurd.
   */
  onStart?: (job: Job) => Promise<unknown>,
): Promise<WorkerResult> => {
  const handler = handlers.find((h) => h.kind === job.kind)
  if (handler === undefined) {
    // PAUSED, not failed.
    //
    // The old reasoning was that the next attempt has the same missing handler,
    // so failing at once beats five identical attempts. True of a typo in a
    // kind, and wrong about the case that actually happened: 0107's trigger
    // shipped a `knowledge.read_source` job into a worker running the merged
    // branch, which did not have that handler yet. It failed the job
    // permanently, and the deploy that would have handled it arrived four
    // minutes later to find nothing waiting.
    //
    // A kind this worker cannot handle is a statement about THIS WORKER, not
    // about the job. Paused is the state for work that is real and cannot
    // proceed here — it leaves the queue, so it cannot spin, and a later
    // worker or a human can resume it. `attempt` is untouched, so the count
    // still means what it says.
    await moveTo(
      db,
      job.jobId,
      'paused',
      `no handler for kind ${job.kind} in this worker — paused rather than failed, ` +
        'because a deploy that knows the kind can resume it',
    )
    throw new NoHandlerError(job.kind)
  }

  if (onStart !== undefined) {
    try {
      await onStart(job)
    } catch {
      // Deliberately silent. See the parameter's own comment.
    }
  }

  let output: HandlerOutput
  /*
    The clock starts before the handler and the trace is written whichever way
    it ends. A job that threw is the one worth reading, so its trace has to
    exist -- which is why this is around the try rather than inside the
    success path.
  */
  const startedAt = Date.now()
  await trace(db, job.jobId, 'prompt', { kind: job.kind, attempt: job.attempt })
  /*
    What it would do, before it does it (#131).

    Here rather than in each handler, for the same reason the trace is: one
    chokepoint means a handler that grows a `plan` gets it recorded without
    anybody remembering to wire it, and the next write-capable handler cannot
    ship without a plan by simply forgetting.

    Like `trace`, it never throws. A plan is a description OF the work and must
    never be a way for the work to fail -- and a handler that cannot say what it
    would do is still a handler that must be allowed to do it, or a planning bug
    becomes an outage.
  */
  await recordPlan(db, job, handler)
  try {
    output = await handler.handle(job, db)
  } catch (error) {
    const retryable = job.attempt < 4
    /*
      Recognise it (#132).

      A failure the office has already seen is a different thing from a new one,
      and until now there was no way to tell: the same `notebook.collect_artifact`
      failure would be retried, fail identically, and leave nothing behind but
      another row in a flat log.

      The MESSAGE goes in and never comes out -- `failure_seen` classifies it
      into one of nine words and discards it, and `failure_signatures` has no
      text column to keep it in. Same discipline as the trace above, enforced by
      the schema rather than by remembering.

      Never throws, for the reason every observability call here does not: a job
      that failed and then failed again writing down that it failed is the worst
      bug available in this file.
    */
    let recognised: { note?: string; seen?: number } = {}
    try {
      const said = (
        await db.execute(
          `select app.failure_seen(${lit(job.kind)}, ${lit((error as Error).message.slice(0, 500))},
             ${job.projectId === null ? 'null' : lit(job.projectId)},
             ${lit(job.jobId)}::uuid) as r`,
        )
      ).rows[0] as { r: { note?: string; seen?: number } }
      recognised = said.r
    } catch {
      /* Recognising a failure must never be a second failure. */
    }
    await trace(
      db,
      job.jobId,
      'degradation',
      {
        threw: (error as Error).message.slice(0, 300),
        retryable,
        // "this has failed the same way eleven times" is the thing worth
        // reading, and it is why the count is recorded rather than just the
        // failure.
        seen: recognised.seen ?? null,
        recognised: recognised.note ?? null,
      },
      { ms: Date.now() - startedAt },
    )
    /*
      A job that has run out of attempts owes Grant a sentence (#231).

      #211's rule, at the last place that could still swallow one. The
      coherence gate records an impediment when it refuses and so does the
      insert refusal; a handler that THREW until its attempts ran out recorded
      nothing Grant would ever see — the job says `failed` in a table he does
      not read, and he simply never gets an answer.

      Found by the campaign running into it: OpenRouter's daily free-model
      quota ran out mid-session (429 free-models-per-day), the breaker opened
      for an hour, and eighteen jobs failed in thirty minutes with nothing
      anywhere saying the office could not think. That is precisely the shape
      of outage a normal working day can produce, and silence is the worst
      available response to it.

      Only on the TERMINAL failure. A retryable one is not yet a failure, and
      an impediment per attempt would make the Governance page a log.
    */
    if (!retryable) {
      try {
        await db.execute(
          `select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
             'an answer at all', 'the handler',
             ${lit((error as Error).message.slice(0, 500))},
             ${lit(`${job.kind} ran out of attempts and produced nothing`)})`,
        )
      } catch {
        /* Recording a failure must never be a second failure. */
      }
    }
    await moveTo(
      db,
      job.jobId,
      retryable ? 'retrying' : 'failed',
      `handler threw: ${(error as Error).message.slice(0, 180)}`,
    )
    return {
      jobId: job.jobId,
      finalState: retryable ? 'retrying' : 'failed',
      note: (error as Error).message.slice(0, 200),
    }
  }

  await trace(
    db,
    job.jobId,
    'decision',
    {
      // What the handler concluded, not what it wrote. `body` can be thousands
      // of characters and is already stored on the output.
      chars: output.body.length,
      announce: output.announce,
      confidence: output.confidence,
      sources: output.sources.length,
      evidence: output.evidence,
      // The production path -- deterministic, drafted, reviewed -- which is the
      // field that decides whether a reviewer is spent on this at all.
      path: output.path,
      model: output.model,
    },
    { ms: Date.now() - startedAt },
  )

  // Coherence first, before spending a reviewer on something that cannot be
  // approved anyway. These are the combinations that satisfy every column
  // constraint individually and still describe something impossible.
  /*
    Did this conversation have any earlier turn at all? (#231 Campaign Three)

    Asked once, here, because `metadataProblems` is pure and the attribution
    check below it cannot be sound without the fact. `undefined` on any failure
    — a job with no command id, an unreadable extent — and an undefined value
    never accuses anybody: the check fires only on an explicit `false`.
  */
  const hadHistory = await db
    .execute(`
      select (app.conversation_extent(
                (select (pinned_config ->> 'command_id')::uuid from public.jobs
                  where job_id = ${lit(job.jobId)}::uuid)
              ) ->> 'turns_total')::int > 1 as had`)
    .then((r) => (r.rows[0] as { had?: boolean } | undefined)?.had)
    .catch(() => undefined)

  const problems = metadataProblems({
    confidence: output.confidence,
    evidence: output.evidence,
    sources: output.sources,
    contradictions: output.contradictions,
    ...(hadHistory === undefined ? {} : { hadHistory }),
    ...(output.grounding === undefined ? {} : { grounding: output.grounding }),
    ...(output.consulted === undefined ? {} : { consulted: output.consulted }),
    ...(output.toolNames === undefined ? {} : { toolNames: output.toolNames }),
    ...(output.standingRules === undefined ? {} : { standingRules: output.standingRules }),
    ...(output.acted === undefined ? {} : { acted: output.acted }),
    // The text as well as the labels, so a body claiming a database read from
    // an output whose evidence says nothing was read is caught here rather
    // than on Grant's phone (#185).
    body: output.body,
  })
  if (problems.length > 0) {
    /*
      Say so, rather than failing into silence (#211).

      #185's argument, one step earlier than #185 applied it. The SENDING gate
      records an impediment when it refuses, because "an output that vanishes
      is indistinguishable from a job that had nothing to say". This gate — the
      better one, because it catches the problem before a row is written — was
      a bare `moveTo(failed)`.

      Three jobs in 48 hours went that way, two of them Grant asking from the
      dashboard: the model claimed a read it had not done, the gate correctly
      refused, and he got NOTHING. No answer, no explanation, no row on the
      Governance page. The job says `failed` in a table he does not read.

      Recording it makes the fabrication countable, which is the difference
      between three silent failures and a number he can watch.

      Never throws, for the reason every observability call in this file does
      not: a job that failed and then failed again writing down why is the
      worst bug available here.
    */
    try {
      await db.execute(
        `select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
           'an answer that matches its own evidence', 'the quality gate',
           ${lit(
             problems
               .map((p) => p.problem)
               .join(' | ')
               .slice(0, 500),
           )},
           ${lit(`${job.kind} produced an output the coherence gate refused`)})`,
      )
    } catch {
      /* Recording a refusal must not become a second failure. */
    }

    /*
      Retry once with the refusal in hand, rather than failing into silence.

      #237 measured what the bare `failed` costs. Two of four turns in an
      ordinary correction conversation were refused here — the model wrote *"I
      pulled the pricing notebook"* and *"I pulled the projects list"* on turns
      where nothing was read — and Grant would have received NOTHING for both.
      No answer, no explanation. Across the night's session traffic it was
      6% of turns, which over a working day is a couple of questions that
      simply vanish.

      The gate is right and stays. What was wrong is what happens next: a
      nondeterministic model that fabricated a read once will usually not
      fabricate it again when told, and telling it is free. The problem goes
      into `pinned_config` so the next attempt can put it in the prompt —
      a closed loop rather than a coin flip, which is the difference between
      this and simply raising `max_attempts`.

      Bounded by the same `attempt < 4` every other retry in this file uses,
      and the impediment above is recorded on EVERY refusal including the last,
      so the fabrication stays countable however it ends (#211).
    */
    const learnable = job.attempt < 4
    if (learnable) {
      try {
        await db.execute(`
          update public.jobs
             set pinned_config = coalesce(pinned_config, '{}'::jsonb)
                   || jsonb_build_object('coherence_note', ${lit(
                     problems
                       .map((p) => p.problem)
                       .join(' | ')
                       .slice(0, 600),
                   )})
           where job_id = ${lit(job.jobId)}::uuid`)
      } catch {
        /* A note that could not be written is a retry without the lesson,
           which is still better than no retry. */
      }
    }

    await moveTo(
      db,
      job.jobId,
      learnable ? 'retrying' : 'failed',
      `incoherent output metadata: ${problems.map((p) => p.field).join(', ')}`,
    )
    return {
      jobId: job.jobId,
      finalState: learnable ? 'retrying' : 'failed',
      note: problems
        .map((p) => p.problem)
        .join(' | ')
        .slice(0, 300),
    }
  }

  const gate = reviewRequired({
    path: output.path,
    // The kind is the job's, not a claim by the handler. A handler that could
    // name its own output kind could name the exempt one.
    kind: job.kind.startsWith('status.') ? 'status' : 'research_conclusion',
  })

  /*
    An output the database refuses is a job failure, here.

    Two rules meet at this insert and both are enforced in the schema: 0023
    refuses a determinism claim from a job with recorded inference usage, and
    0272 refuses a declared shape whose facts do not match it (#130). Either
    raises.

    Left alone that exception came out of `runJob` and took the whole drain with
    it -- every other job in the pass punished for one handler's mistake. Caught,
    and turned into a failed job carrying the database's own sentence: "a
    research_summary output is missing sources" is something the person who wrote
    the handler can act on, and it lands in `job_state_transitions` where every
    other failure lands, rather than in a stack trace nobody keeps.

    **This changed the behaviour for the determinism rule too, deliberately.**
    `verify:worker` used to assert that such a handler made `runJob` THROW; it
    now asserts the job is failed with the constraint's words, which is the
    stronger property -- the refusal is what matters and a dead drain never was.

    NOT retried. Both refusals are deterministic: the same handler produces the
    same rejected row four more times, so a retry is four more model calls for
    the same answer.
  */
  let inserted: { rows: readonly Record<string, unknown>[] }
  try {
    inserted = await db.execute(`
    insert into public.outputs
      (job_id, staff_id, body, confidence, evidence, sources, contradictions,
       deterministic, model, shape, facts)
    values
      (${lit(job.jobId)}::uuid,
       -- WHO did this. 736 outputs were written before this line existed, every
       -- one of them attributed to nobody, while §9 makes staff identities and
       -- §22 A requires "correct staff identity". The notifier had always
       -- resolved a name for display and nothing had ever persisted it, so the
       -- author of a finding survived exactly as long as the Slack message did.
       --
       -- app.staff_behind_job rather than a copy of its lineage walk: it
       -- knows about the parent chain and the duty fallback, and 0106 exists
       -- because a second copy did not.
       (select st.staff_id from public.staff st
         where st.slug = app.staff_behind_job(${lit(job.jobId)}::uuid)),
       ${lit(output.body)},
       ${lit(output.confidence)}::public.confidence_level,
       ${lit(output.evidence)}::public.evidence_type,
       ${lit(JSON.stringify(output.sources))}::jsonb,
       ${output.contradictions === null ? 'null' : lit(output.contradictions)},
       ${String(gate.exempt)},
       ${output.model === null ? 'null' : lit(output.model)},
       -- Together or not at all (#130). A shape with no facts is a claim with
       -- nothing behind it; facts with no shape are data nobody can interpret.
       -- The column constraint says the same thing, so a caller that sends one
       -- is refused rather than half-recorded.
       ${output.shape === undefined || output.facts === undefined ? 'null' : lit(output.shape)},
       ${output.shape === undefined || output.facts === undefined ? 'null' : `${lit(JSON.stringify(output.facts))}::jsonb`})
    returning output_id::text as id
  `)
  } catch (error) {
    const said = (error as Error).message.replace(/\s+/g, ' ')
    /*
      Countable, not silent (#231) — #211's rule applied to the LAST gate.

      The coherence gate above records an impediment when it refuses. This one
      — the database refusing the row itself — was a bare `moveTo(failed)`, and
      it swallowed a real turn: Grant taught the office a preference, the
      preference was stored, the confirmation claimed an exemption the record
      could not support, the insert was refused, and he received nothing. The
      only trace was `state_reason` in a table he does not read.

      An answer that vanishes is indistinguishable from a job that had nothing
      to say, whichever layer swallowed it. Never throws, for the same reason
      every observability call in this file does not.
    */
    try {
      await db.execute(
        `select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
           'an answer the database will accept', 'the output constraints',
           ${lit(said.slice(0, 500))},
           ${lit(`${job.kind} produced an output that was refused on insert`)})`,
      )
    } catch {
      /* Recording a refusal must not become a second failure. */
    }
    await moveTo(db, job.jobId, 'failed', `output refused: ${said.slice(0, 180)}`)
    await trace(db, job.jobId, 'degradation', {
      shape: output.shape ?? null,
      said: said.slice(0, 300),
    })
    return { jobId: job.jobId, finalState: 'failed', note: said.slice(0, 200) }
  }
  const outputId = String((inserted.rows[0] as { id?: string } | undefined)?.id)

  // Before the notifier is anywhere near it. `combinedNotifier` reads
  // `jobs.announce` as its first act, so a handler's verdict has to be on the
  // row by then rather than passed alongside it.
  if (output.announce !== undefined) {
    await db.execute(
      `update public.jobs set announce = ${output.announce ? 'true' : 'false'}
        where job_id = ${lit(job.jobId)}::uuid`,
    )
  }

  await moveTo(db, job.jobId, 'output_created')
  await moveTo(db, job.jobId, 'quality_review')

  if (!gate.exempt) {
    const verdict = await review(output, job)
    await db.execute(`
      update public.outputs
      set reviewer_status = ${lit(verdict.status)}::public.reviewer_status,
          reviewed_at = app.now_utc(),
          review_notes = ${lit(verdict.notes)}
      where output_id = ${lit(outputId)}::uuid
    `)

    if (verdict.status === 'rejected' || verdict.status === 'needs_revision') {
      // Back to the queue, not onward. §10's reviewer exists to be able to say
      // no, and a worker that committed anyway would make that a formality.
      const retryable = job.attempt < 4
      await moveTo(
        db,
        job.jobId,
        retryable ? 'retrying' : 'failed',
        `review ${verdict.status}: ${verdict.notes.slice(0, 150)}`,
      )
      return {
        jobId: job.jobId,
        finalState: retryable ? 'retrying' : 'failed',
        note: `review ${verdict.status}`,
      }
    }
  }

  /*
    And hand it on, if this answer was somebody else's starting point (#128).

    HERE rather than in the handler, and here rather than earlier, for three
    reasons that each cost something if ignored:

      * the output has to EXIST, because the whole difference between a handoff
        and a second request is that it carries what the first agent produced;
      * the review has to have PASSED — every rejecting branch above returns,
        so reaching this line means the work was accepted, and handing on a
        rejected answer would propagate it;
      * the handler cannot do it. It returns an output and the worker writes
        it, so the handler has no `output_id` to pass.

    `app.enqueue_child` inherits the correlation id, the project and the
    requester, and `enforce_delegation_depth` caps the chain — so an agent that
    can enqueue an agent still cannot enqueue a loop.

    `p_announce => false`: Grant hears from the Chief of Staff and nobody else.
    The chain is visible in Active Jobs, which is where he asked to see work.

    Never fatal. A handoff that cannot be enqueued must not fail an answer that
    is already written, reviewed and about to be delivered — but it must not be
    silent either, which is what the impediment is for (#211).
  */
  if (output.handoff !== undefined) {
    try {
      await db.execute(`
        select app.enqueue_child(
          ${lit(job.jobId)}::uuid, 'office.instruction',
          jsonb_build_object(
            'instruction', ${lit(output.handoff.clause.slice(0, 4_000))},
            'addressed_to', ${lit(output.handoff.to)},
            'origin_channel', 'teamhq',
            'handed_off_by', ${lit(output.handoff.from)},
            'handed_off_because', ${lit(output.handoff.because.slice(0, 500))},
            'from_output', ${lit(outputId)}
          ),
          interval '0', false
        )
      `)
    } catch (error) {
      const why = (error as Error).message.replace(/\s+/g, ' ').slice(0, 300)
      try {
        await db.execute(
          `select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
             ${lit(`hand the rest to ${output.handoff.to}`)}, 'the worker',
             ${lit(why)}, null)`,
        )
      } catch {
        /* Recording a refusal must not become a second failure. */
      }
    }
  }

  // The commit trigger reads `reviewer_status` here. If anything above skipped
  // review, this is where it is refused — which is the point of not checking
  // ourselves first.
  await moveTo(db, job.jobId, 'committing')
  await moveTo(db, job.jobId, 'committed')
  await moveTo(db, job.jobId, 'notifying')

  // Delivery failing does NOT fail the job. The work is done and committed —
  // that is what `committed` means, and it is already true. A failed delivery
  // is its own fact with its own record (`slack_deliveries`), and rolling the
  // job back would discard finished work because a message did not send.
  //
  // What it must never do is claim delivery anyway. The state reason carries
  // what actually happened.
  let notified: NotifyOutcome
  if (notify === undefined) {
    notified = { delivered: false, note: 'no notifier configured; nothing was delivered' }
  } else {
    try {
      notified = await notify(job, output, outputId)
    } catch (error) {
      notified = {
        delivered: false,
        note: `notifier threw: ${(error as Error).message.slice(0, 120)}`,
      }
    }
  }

  await moveTo(db, job.jobId, 'complete', notified.note.slice(0, 200))

  const ledgerNote = await recordOnLedger(
    db,
    job,
    'finding.committed',
    gate.exempt
      ? 'Committed without review: a deterministic operation, exempt under §16.'
      : 'Committed after quality review.',
  )

  const reviewNote = gate.exempt
    ? 'committed without review (deterministic path)'
    : 'committed after review'
  return {
    jobId: job.jobId,
    finalState: 'complete',
    // The ledger note only appears when the write FAILED. A silent ledger is
    // how this went unnoticed for 736 outputs, and a line that says "ledger
    // written" every time is a line nobody reads.
    note: `${reviewNote}; ${notified.note}${ledgerNote === null ? '' : `; ${ledgerNote}`}`,
  }
}

/**
 * Deliver for a job whose work is committed and whose notification is not.
 *
 * The other half of §18's crash-after-commit case. 0058's recovery moves such a
 * job to `notifying`; this is what reads that state. Without it the fix for the
 * duplication defect would have parked the job forever instead — the same
 * "sweep to nowhere" shape as 0006's requeue, one layer up, and the reason to
 * write both halves in the same change.
 *
 * It never calls a handler. That is the whole point: the work is done, the
 * output row is the evidence, and re-running would produce a second one.
 */
export const deliverPending = async (
  db: SqlExecutor,
  workerId: string,
  notify?: Notifier,
  max = 25,
): Promise<WorkerResult[]> => {
  const done: WorkerResult[] = []

  for (let i = 0; i < max; i++) {
    const { rows } = await db.execute(
      `select job_id::text as job_id, correlation_id::text as correlation_id,
              project_id::text as project_id, kind, output_id::text as output_id
       from app.claim_pending_notification(${lit(workerId)})`,
    )
    const r = rows[0] as
      | {
          job_id: string
          correlation_id: string
          project_id: string | null
          kind: string
          output_id: string | null
        }
      | undefined
    if (r === undefined) break

    const job: Job = {
      jobId: r.job_id,
      kind: r.kind,
      correlationId: r.correlation_id,
      projectId: r.project_id,
      idempotencyKey: '',
      attempt: 0,
    }

    if (r.output_id === null) {
      // A job in `notifying` with no output is a contradiction: recovery only
      // routes here on the evidence of an output row. Recorded as failed rather
      // than silently completed, because "delivered nothing successfully" is
      // the claim this worker exists not to make.
      await moveTo(db, r.job_id, 'failed', 'in notifying with no output to deliver')
      done.push({ jobId: r.job_id, finalState: 'failed', note: 'no output to deliver' })
      continue
    }

    const stored = await db.execute(
      // `sources` is read rather than assumed empty. It used to be
      // reconstructed as `[]`, which was harmless while nothing consulted it
      // and stopped being harmless the moment the sending path did: #185's
      // guard refuses a "verified" output that cites nothing, and an empty
      // list invented here would have refused every recovered verified output
      // for a reason that was this line's doing.
      `select body, confidence::text as confidence, evidence::text as evidence,
              deterministic, model, sources, contradictions
         from public.outputs where output_id = ${lit(r.output_id)}::uuid`,
    )
    // Typed as what the columns actually are, so the reconstruction below is
    // checked rather than asserted. It was `as unknown as HandlerOutput`, and
    // that cast is how `path: 'deterministic'` — a string that is not a
    // ProductionPath at all — survived in six handlers.
    const o = stored.rows[0] as {
      body: string
      confidence: Confidence
      evidence: Evidence
      deterministic: boolean
      model: string | null
      sources: unknown
      contradictions: string | null
    }
    const output = {
      body: o.body,
      confidence: o.confidence,
      evidence: o.evidence,
      sources: Array.isArray(o.sources) ? o.sources.map((s) => String(s)) : [],
      contradictions: o.contradictions,
      path: o.deterministic ? ('deterministic_retrieval' as const) : ('inference' as const),
      model: o.model,
    } satisfies HandlerOutput

    let notified: NotifyOutcome
    if (notify === undefined) {
      notified = { delivered: false, note: 'no notifier configured; nothing was delivered' }
    } else {
      try {
        notified = await notify(job, output, r.output_id)
      } catch (error) {
        notified = {
          delivered: false,
          note: `notifier threw: ${(error as Error).message.slice(0, 120)}`,
        }
      }
    }

    await moveTo(db, r.job_id, 'complete', `resumed delivery; ${notified.note}`.slice(0, 200))
    done.push({
      jobId: r.job_id,
      finalState: 'complete',
      note: `resumed delivery; ${notified.note}`,
    })
  }

  return done
}

/**
 * Drain the queue.
 *
 * Stops when `dequeue_job` returns nothing, which happens both when the queue
 * is empty and when capacity is full — the two are indistinguishable from here
 * and should be: in both cases the right thing is to stop asking.
 */
export const drain = async (
  db: SqlExecutor,
  workerId: string,
  handlers: readonly Handler[],
  review: Reviewer,
  max = 25,
  options: {
    readonly recover?: boolean
    readonly notify?: Notifier
    readonly onStart?: (job: Job) => Promise<unknown>
    /**
     * Asked before each new job is started. Return true to stop taking more.
     *
     * For a caller with a wall-clock limit — an edge function has one, a
     * runner does not. A pass killed mid-job leaves a lease to expire, which
     * recovers but costs whoever was waiting their reply, so it is better to
     * decline the next job than to start one that cannot finish.
     *
     * Deliberately consulted only BEFORE dequeuing. A job already started runs
     * to its end: abandoning work halfway is how a queue acquires a job that
     * has been attempted nine times and never once completed.
     */
    readonly stopStartingAfter?: () => boolean
    /** See `dequeue`. Defaults to true: every caller before the edge worker could hear. */
    readonly canTranscribe?: boolean
    readonly canSubprocess?: boolean
  } = {},
): Promise<WorkerResult[]> => {
  // What this worker can actually do. Passed to the dequeue so it cannot be
  // handed a kind it has no handler for — the fault that left three real duty
  // jobs parked for hours (0147).
  const handlerKinds = handlers.map((h) => h.kind)

  // Sweep first. A job held by a dead worker counts against capacity, so
  // skipping this makes a worker unable to dequeue for reasons that look
  // nothing like the cause.
  if (options.recover !== false) await recoverStalled(db)

  // And put back anything a previous worker parked for want of a handler THIS
  // one holds. Beside the stall sweep because it is the same kind of thing: a
  // job that can proceed now and will not without being told. Never fatal —
  // the queue matters more than the tidying.
  if (options.recover !== false) {
    try {
      await db.execute(
        `select app.resume_paused(array[${handlerKinds.map(lit).join(', ')}]::text[])`,
      )
    } catch {
      // Reported by the next pass if it persists; a failed resume must not
      // stop the drain.
    }
  }

  /*
    And expire the MCP authorisation codes (#72, found by check:callers).

    `app.mcp_expire_codes` deletes a code an hour past its expiry and had NO
    CALLER — not a schedule, not a handler, not even a suite. Twenty codes
    were in the table and all twenty had expired. Nothing could be redeemed
    with them, because the redeem path checks `expires_at`, so this is hygiene
    rather than a hole; it is also the exact defect #72 is about, found by the
    check built for #72, on the day it was built.

    Here rather than on a cron for the same reason the stall sweep is: a
    worker boot is a cheap, frequent moment, and a second schedule is a second
    thing that can silently stop — which is how 1,800 GitHub Actions minutes
    went, and why `CLAUDE.md` says no new clocks without a reason.

    Never fatal. An OAuth code that lives an hour too long must not stop the
    queue draining.
  */
  if (options.recover !== false) {
    try {
      await db.execute('select app.mcp_expire_codes()')
    } catch {
      // Reported by the next pass if it persists. The queue matters more.
    }
    /*
      And every project has a room of its own (#187, and #72 again).

      `app.provision_missing_channels` enqueues one job per active,
      non-fixture project that has no channel, and returns "queued 0" the rest
      of the time — which is every pass after the first. One cheap query, and
      the difference between a capability and a script somebody has to
      remember to run.

      `check:callers` caught this function with no mouth within minutes of it
      being written, which is what that check is for and the reason it is
      answered here rather than added to a baseline.

      Never fatal, for the same reason as the line above it.
    */
    /*
      And two more expiries with nothing behind them (#272, #72 again).

      `app.expire_temporary_staff` switches off a specialist whose window has
      closed; `app.expire_undo_offers` moves a lapsed offer from `available` to
      `expired`. Both were written, both were correct, and neither had a caller
      anywhere outside `scripts/` -- so `undoable_actions` held four rows
      saying `available` about windows that shut days ago.

      Neither is a hole, and the report should not pretend otherwise: the
      `undo_offers` view recomputes the deadline rather than trusting the
      column, and `app.request_undo` refuses a lapsed offer at the press. What
      they leave behind is a status column that disagrees with the truth, which
      is 0303 and 0304's whole lesson about a denormalised fact.

      Beside the two above because it is the same cheap, frequent moment, and
      because CLAUDE.md's rule about new clocks holds: a second schedule is a
      second thing that can silently stop.

      Never fatal.
    */
    try {
      await db.execute('select app.expire_temporary_staff()')
      await db.execute('select app.expire_undo_offers()')
    } catch {
      // A stale flag is a smaller problem than a queue that did not drain.
    }

    try {
      await db.execute('select app.provision_missing_channels()')
    } catch {
      // A project without a channel is a smaller problem than a queue that
      // did not drain.
    }
  }

  // Then finish anything the sweep found already committed. Before new work,
  // because a job whose output exists and whose owner never heard about it is
  // the most overdue thing in the system.
  const done: WorkerResult[] = [...(await deliverPending(db, workerId, options.notify, max))]
  for (let i = 0; i < max; i++) {
    if (options.stopStartingAfter?.() === true) break
    const job = await dequeue(
      db,
      workerId,
      options.canTranscribe ?? true,
      options.canSubprocess ?? true,
      handlerKinds,
    )
    if (job === null) break
    try {
      done.push(await runJob(db, job, handlers, review, options.notify, options.onStart))
    } catch (error) {
      done.push({
        jobId: job.jobId,
        finalState: 'failed',
        note: (error as Error).message.slice(0, 200),
      })
    }
  }
  return done
}

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

import type { Confidence, Evidence, ProductionPath } from '../agents/quality.ts'
import { metadataProblems, reviewRequired } from '../agents/quality.ts'
import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

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

  return rows.map((r) => ({
    jobId: String(r.job_id),
    fromState: String(r.from_state),
    reason: String(r.reason),
  }))
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
): Promise<Job | null> => {
  const { rows } = await db.execute(
    `select job_id::text as job_id, kind, correlation_id::text as correlation_id,
            project_id::text as project_id, idempotency_key, attempt
     from app.dequeue_job(${lit(workerId)}, ${canTranscribe ? 'true' : 'false'},
                          ${canSubprocess ? 'true' : 'false'})`,
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
  try {
    output = await handler.handle(job, db)
  } catch (error) {
    const retryable = job.attempt < 4
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

  // Coherence first, before spending a reviewer on something that cannot be
  // approved anyway. These are the combinations that satisfy every column
  // constraint individually and still describe something impossible.
  const problems = metadataProblems({
    confidence: output.confidence,
    evidence: output.evidence,
    sources: output.sources,
    contradictions: output.contradictions,
  })
  if (problems.length > 0) {
    await moveTo(
      db,
      job.jobId,
      'failed',
      `incoherent output metadata: ${problems.map((p) => p.field).join(', ')}`,
    )
    return {
      jobId: job.jobId,
      finalState: 'failed',
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

  const { rows } = await db.execute(`
    insert into public.outputs
      (job_id, body, confidence, evidence, sources, contradictions, deterministic, model)
    values
      (${lit(job.jobId)}::uuid, ${lit(output.body)},
       ${lit(output.confidence)}::public.confidence_level,
       ${lit(output.evidence)}::public.evidence_type,
       ${lit(JSON.stringify(output.sources))}::jsonb,
       ${output.contradictions === null ? 'null' : lit(output.contradictions)},
       ${String(gate.exempt)},
       ${output.model === null ? 'null' : lit(output.model)})
    returning output_id::text as id
  `)
  const outputId = String(rows[0]?.id)

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

  const reviewNote = gate.exempt
    ? 'committed without review (deterministic path)'
    : 'committed after review'
  return {
    jobId: job.jobId,
    finalState: 'complete',
    note: `${reviewNote}; ${notified.note}`,
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
      `select body, confidence::text as confidence, evidence::text as evidence,
              deterministic, model
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
    }
    const output = {
      body: o.body,
      confidence: o.confidence,
      evidence: o.evidence,
      sources: [],
      contradictions: null,
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
  // Sweep first. A job held by a dead worker counts against capacity, so
  // skipping this makes a worker unable to dequeue for reasons that look
  // nothing like the cause.
  if (options.recover !== false) await recoverStalled(db)

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

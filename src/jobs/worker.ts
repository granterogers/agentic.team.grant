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

export const dequeue = async (db: SqlExecutor, workerId: string): Promise<Job | null> => {
  const { rows } = await db.execute(
    `select job_id::text as job_id, kind, correlation_id::text as correlation_id,
            project_id::text as project_id, idempotency_key, attempt
     from app.dequeue_job(${lit(workerId)})`,
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
): Promise<WorkerResult> => {
  const handler = handlers.find((h) => h.kind === job.kind)
  if (handler === undefined) {
    // Not a retryable condition: the next attempt has the same missing
    // handler. Failing immediately beats five identical attempts and a
    // misleading attempt count.
    await moveTo(db, job.jobId, 'failed', `no handler for kind ${job.kind}`)
    throw new NoHandlerError(job.kind)
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
  options: { readonly recover?: boolean; readonly notify?: Notifier } = {},
): Promise<WorkerResult[]> => {
  // Sweep first. A job held by a dead worker counts against capacity, so
  // skipping this makes a worker unable to dequeue for reasons that look
  // nothing like the cause.
  if (options.recover !== false) await recoverStalled(db)

  const done: WorkerResult[] = []
  for (let i = 0; i < max; i++) {
    const job = await dequeue(db, workerId)
    if (job === null) break
    try {
      done.push(await runJob(db, job, handlers, review, options.notify))
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

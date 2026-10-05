/**
 * Who holds this job? (Run 4, 0620)
 *
 * `dequeue_job` leases a job to one worker for a while and increments its `attempt`, so the pair
 * (leased_by, attempt) already names one claim and no other. What was missing was anything that ASKED: the
 * worker's state writes were an update of the job's state keyed by its id alone, so a worker whose lease had
 * lapsed - a handler slower than 300 seconds, a paused process - could finish a job that a second worker
 * had since claimed, over the top of it.
 *
 * This module is the asking. `dequeue` stamps the claim on the Job it returns (`leasedBy`, with the attempt
 * it already carries); `moveTo` and the outputs insert consult it; a heartbeat renews the lease while the
 * handler works, so a healthy slow job never looks dead. A worker that finds it no longer holds a job throws
 * `StaleWorkerError`, which `runJob` turns into an abandoned result: it writes nothing more, and the job
 * belongs to whoever holds it now.
 *
 * The claim travels ON THE JOB OBJECT, not in module state, so two workers in one process (a test, or a
 * runner with several loops) each hold their own. Deliberately not a token in the database and not a new
 * state: the row already carries the token.
 *
 * Version skew. The predicate is plain SQL over columns that have always existed. `app.job_held` and
 * `app.renew_lease` are 0620's; on a schema without them the check and the heartbeat turn themselves off and
 * the job runs as it always did - no fence weakened, none added.
 */
import type { SqlExecutor } from '../db/executor.ts'

export class StaleWorkerError extends Error {
  constructor(
    readonly jobId: string,
    readonly worker: string,
    readonly attempt: number,
  ) {
    super(`worker ${worker} no longer holds attempt ${String(attempt)} of job ${jobId}`)
    this.name = 'StaleWorkerError'
  }
}

/** A job as far as the fence needs to know it. */
export interface Claimed {
  readonly jobId: string
  readonly attempt: number
  /** The worker id `dequeue` leased it to. Absent for a job this process did not dequeue: then nothing is asked. */
  readonly leasedBy?: string
  /**
   * The claim's own number (0625): bumped by every claim and never lowered, so (leasedBy, claimGen) names one claim
   * ever - which an attempt number cannot promise once a wait refunds it. Absent on a schema from before 0625,
   * where the fence asks the attempt as it always did.
   */
  readonly claimGen?: number
  /** Set by a renewal that found the job gone from us, so the next write refuses without a round trip. */
  lost?: boolean
}

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

/** The predicate a fenced write adds to its WHERE clause, or '' when this job carries no claim. */
export const fenceClause = (job: Claimed | undefined): string =>
  job?.leasedBy === undefined
    ? ''
    : ` and attempt = ${String(job.attempt)}${
        job.claimGen === undefined ? '' : ` and claim_gen = ${String(job.claimGen)}`
      } and (leased_by = ${lit(job.leasedBy)} or (leased_by is null and state = 'paused'))`

/** Throws unless this worker still holds the job. A job this process took no claim for is not asked about. */
export const assertHeld = async (db: SqlExecutor, job: Claimed): Promise<void> => {
  if (job.leasedBy === undefined) return
  if (job.lost === true) throw new StaleWorkerError(job.jobId, job.leasedBy, job.attempt)
  let held: boolean | undefined
  try {
    const { rows } = await db.execute(
      `select app.job_held(${lit(job.jobId)}::uuid, ${lit(job.leasedBy)}, ${String(job.attempt)}${
        job.claimGen === undefined ? '' : `, ${String(job.claimGen)}`
      }) as held`,
    )
    held = (rows[0] as { held?: boolean } | undefined)?.held
  } catch (error) {
    // A schema from before 0620 has no job_held: nothing can be asked, so nothing is refused.
    if (/does not exist|42883/i.test(String((error as Error).message))) return
    throw error
  }
  if (held !== true) {
    job.lost = true
    throw new StaleWorkerError(job.jobId, job.leasedBy, job.attempt)
  }
}

/**
 * Renew the lease every `everyMs` while the handler works. Returns the function that stops it.
 * A renewal that finds the job is no longer held marks the job lost, so the next write refuses at once.
 */
export const startHeartbeat = (db: SqlExecutor, job: Claimed, everyMs = 60_000): (() => void) => {
  const worker = job.leasedBy
  if (worker === undefined) return () => undefined
  let stopped = false
  let busy = false
  const timer = setInterval(() => {
    if (stopped || busy) return
    busy = true
    db.execute(
      `select app.renew_lease(${lit(job.jobId)}::uuid, ${lit(worker)}, ${String(job.attempt)}${
        job.claimGen === undefined ? '' : `, ${String(job.claimGen)}`
      }) as held`,
    )
      .then(({ rows }) => {
        if ((rows[0] as { held?: boolean } | undefined)?.held === false) job.lost = true
      })
      .catch((error: unknown) => {
        // A schema from before 0620 has no renewal: stop trying, and run as it always did.
        if (/does not exist|42883/i.test(String((error as Error).message))) {
          stopped = true
          clearInterval(timer)
        }
      })
      .finally(() => {
        busy = false
      })
  }, everyMs)
  // Never keep a process alive for a heartbeat.
  ;(timer as { unref?: () => void }).unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

/**
 * The caller, as named arguments for `app.enqueue_child` / `app.enqueue_child_once` (0625): who is asking, which
 * worker holds it and under which claim. The database refuses a caller that no longer holds its job, and keys a
 * child's slot on the caller's own claim. Empty for a job this process took no claim for, and for a schema from
 * before 0625 (no `claimGen`): the call is then exactly what it always was.
 */
export const callerArgs = (job: Claimed | undefined): string =>
  job?.leasedBy === undefined || job.claimGen === undefined
    ? ''
    : `, p_caller => ${lit(job.jobId)}::uuid, p_caller_worker => ${lit(job.leasedBy)}, p_caller_gen => ${String(job.claimGen)}`

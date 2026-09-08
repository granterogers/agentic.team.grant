/**
 * Hold the office still while something measures it.
 *
 * ## Why this exists
 *
 * Until 0121 nothing touched the job queue except the thing being tested. A
 * pass now runs every minute, because Grant's messages were waiting on a
 * GitHub cron that fired six times in fourteen hours — and the moment that
 * started, `verify:jobs` began failing at random:
 *
 *     | hard kill | killed in running | swept to queued, expected retrying | ❌ |
 *
 * Recovery was right. `recover_stalled_jobs` moves an in-flight job to
 * `retrying` exactly as the suite expects; `drain()` then calls
 * `app.requeue_retrying()`, so the heartbeat promoted it to `queued` before the
 * suite looked. Two runs minutes apart scored 25/34 and 30/34 on identical
 * code, which is a race rather than a bug.
 *
 * A suite that fails at random is worse than no suite: it teaches everyone to
 * re-run it until it passes, and then it can never fail usefully again.
 *
 * ## Why the pause is bounded and stored
 *
 * Stored, because it has to outlive the process that asked for it — the worker
 * is a different process in a different runtime. Bounded, because a suite that
 * dies halfway must not stop the office permanently; `worker.paused_until`
 * lapses on its own and the front end shows it while it holds.
 */
import type { SqlExecutor } from '../db/executor.ts'

/** Hold the queue for at most `seconds`. Clamped in SQL as well as here. */
export const hold = async (db: SqlExecutor, seconds: number): Promise<void> => {
  await db.execute(`select app.pause_worker(${String(Math.max(1, Math.min(900, seconds)))})`)
}

/** Let it go again. Safe to call when no pause is held. */
export const release = async (db: SqlExecutor): Promise<void> => {
  await db.execute('select app.resume_worker()')
}

/**
 * Run `body` with the queue held.
 *
 * Released in a `finally`, and it also lapses on its own — belt and braces on
 * purpose, because the case that matters is the process dying before the
 * `finally` runs, and only the lapse covers that. Suites that are linear
 * top-level programs call `hold` and `release` directly for the same reason.
 */
export const quietly = async <T>(
  db: SqlExecutor,
  seconds: number,
  body: () => Promise<T>,
): Promise<T> => {
  await hold(db, seconds)
  try {
    return await body()
  } finally {
    await release(db)
  }
}

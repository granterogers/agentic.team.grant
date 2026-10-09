/*
  The lease heartbeat when the database link is the thing failing.

  What the code establishes (and these cases pin):
   - The lease is 300 s (jobs.lease_seconds) and a renewal runs every 60 s. `app.renew_lease` matches on holder, attempt and
     claim, NOT on expiry, so a renewal that finally succeeds after the lease has lapsed still extends it, provided nobody has
     reclaimed the job in between. Failed renewals are therefore not a verdict, and marking the claim lost on them would make a
     healthy job abandon itself the moment the link blinked. Whether the job is still ours is asked of the database where the
     answer is real, at write time (`assertHeld`), and a worker whose lease WAS reclaimed is refused there.
   - What was wrong: a renewal that failed was swallowed with no trace, and a renewal the database never answered left `busy`
     set for ever, so no later renewal was even attempted and the lease lapsed under a handler that was still working.
*/
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { assertHeld, type Claimed, StaleWorkerError, startHeartbeat } from '../../src/jobs/fence.ts'

afterEach(() => {
  vi.useRealTimers()
})

const claim = (): Claimed & { renewFailures?: number } => ({
  jobId: 'j1',
  attempt: 2,
  leasedBy: 'w1',
  claimGen: 7,
})

const executor = (script: (n: number, sql: string) => Promise<{ rows: unknown[] }>) => {
  const calls: string[] = []
  const db = {
    kind: 'fake',
    execute: (sql: string) => {
      calls.push(sql)
      return script(calls.length, sql)
    },
  } as unknown as SqlExecutor
  return { db, calls }
}

describe('a healthy heartbeat is unchanged', () => {
  it('renews every interval under the claim it holds, and never touches the job when the renewals succeed', async () => {
    vi.useFakeTimers()
    const { db, calls } = executor(async () => ({ rows: [{ held: true }] }))
    const job = claim()
    const warn = vi.fn()
    const stop = startHeartbeat(db, job, 60_000, { warn })
    await vi.advanceTimersByTimeAsync(180_000)
    stop()
    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain("app.renew_lease('j1'::uuid, 'w1', 2, 7)")
    expect(job.lost).toBeUndefined()
    expect(job.renewFailures ?? 0).toBe(0)
    expect(warn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(180_000)
    expect(calls).toHaveLength(3) // stopped means stopped
  })

  it('a renewal that finds the job taken marks it lost (existing behaviour), and the next write refuses without a round trip', async () => {
    vi.useFakeTimers()
    const { db } = executor(async () => ({ rows: [{ held: false }] }))
    const job = claim()
    const stop = startHeartbeat(db, job, 60_000, { warn: vi.fn() })
    await vi.advanceTimersByTimeAsync(61_000)
    stop()
    expect(job.lost).toBe(true)
    await expect(assertHeld(db, job)).rejects.toBeInstanceOf(StaleWorkerError)
  })

  it('a job this process took no claim for is not beaten at all', async () => {
    vi.useFakeTimers()
    const { db, calls } = executor(async () => ({ rows: [{ held: true }] }))
    const stop = startHeartbeat(db, { jobId: 'j', attempt: 1 }, 60_000)
    await vi.advanceTimersByTimeAsync(300_000)
    stop()
    expect(calls).toHaveLength(0)
  })
})

describe('a failing link', () => {
  it('failed renewals are counted, said ONCE per run of failures, never thrown, and never mark the claim lost', async () => {
    vi.useFakeTimers()
    const { db, calls } = executor(async () => {
      throw new Error('Failed to run sql query: write CONNECT_TIMEOUT db.host:5432')
    })
    const job = claim()
    const warn = vi.fn()
    const stop = startHeartbeat(db, job, 60_000, { warn })
    await vi.advanceTimersByTimeAsync(300_000)
    stop()
    expect(calls).toHaveLength(5)
    expect(job.renewFailures).toBe(5)
    expect(job.lost).toBeUndefined() // a blink is not a lost lease
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(
      /job j1 attempt 2: lease renewal failing \(.*CONNECT_TIMEOUT/,
    )
  })

  it('a renewal that succeeds again resets the count, and the lease is extended after a gap (so a late renewal rescues the job)', async () => {
    vi.useFakeTimers()
    const { db, calls } = executor(async (n) => {
      if (n <= 3) throw new Error('write CONNECTION_CLOSED')
      return { rows: [{ held: true }] }
    })
    const job = claim()
    const warn = vi.fn()
    const stop = startHeartbeat(db, job, 60_000, { warn })
    await vi.advanceTimersByTimeAsync(240_000)
    stop()
    expect(calls).toHaveLength(4)
    expect(job.renewFailures).toBe(0)
    expect(job.lost).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a warning that itself throws cannot reach the handler', async () => {
    vi.useFakeTimers()
    const { db } = executor(async () => {
      throw new Error('x')
    })
    const stop = startHeartbeat(db, claim(), 60_000, {
      warn: () => {
        throw new Error('the log is down')
      },
    })
    await expect(vi.advanceTimersByTimeAsync(300_000)).resolves.not.toThrow()
    stop()
  })

  it('a renewal the database NEVER answers does not silence the later ones: it counts as failed and the next tick tries again', async () => {
    vi.useFakeTimers()
    let call = 0
    const { db, calls } = executor(() => {
      call += 1
      return call === 1 ? new Promise(() => undefined) : Promise.resolve({ rows: [{ held: true }] })
    })
    const job = claim()
    const stop = startHeartbeat(db, job, 60_000, { warn: vi.fn(), renewTimeoutMs: 20_000 })
    await vi.advanceTimersByTimeAsync(60_000) // tick 1: hangs
    await vi.advanceTimersByTimeAsync(21_000) // abandoned at 20 s
    expect(job.renewFailures).toBe(1)
    await vi.advanceTimersByTimeAsync(60_000) // tick 2 runs
    stop()
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(job.renewFailures).toBe(0)
  })

  it('a schema from before the renewal function stops the heartbeat quietly, as it always did', async () => {
    vi.useFakeTimers()
    const { db, calls } = executor(async () => {
      throw new Error('function app.renew_lease(uuid, text, integer, bigint) does not exist')
    })
    const job = claim()
    const warn = vi.fn()
    startHeartbeat(db, job, 60_000, { warn })
    await vi.advanceTimersByTimeAsync(600_000)
    expect(calls).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    expect(job.renewFailures).toBeUndefined()
  })
})

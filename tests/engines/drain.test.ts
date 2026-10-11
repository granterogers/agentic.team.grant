import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { drainEngineRuns, liveRuns } from '../../src/engines/hermes/drain.ts'

const OFFICE = '11111111-1111-4111-8111-111111111111'
const run = (n: number, enabled: boolean) => ({
  run_id: `2222222${String(n)}-2222-4222-8222-222222222222`,
  job_id: `3333333${String(n)}-3333-4333-8333-333333333333`,
  office_id: OFFICE,
  state: 'open',
  enabled,
})

const fakeDb = (live: ReturnType<typeof run>[], stop: (job: string) => unknown) => {
  const seen: string[] = []
  const db: SqlExecutor & { seen: string[] } = {
    kind: 'fake',
    seen,
    execute: async (sql: string) => {
      seen.push(sql)
      if (/from public\.engine_runs/.test(sql)) return { rows: live }
      const job = /request_stop\([^,]+,\s*'([^']+)'/.exec(sql)?.[1]
      if (job !== undefined) {
        const r = stop(job)
        if (r instanceof Error) throw r
        return { rows: [{ r }] }
      }
      return { rows: [] }
    },
  } as never
  return db
}
const stops = (db: { seen: string[] }): number =>
  db.seen.filter((s) => /request_stop/.test(s)).length

describe('drainEngineRuns', () => {
  it('REFUSES while Hermes is still on for an office that holds a live run, and stops nothing', async () => {
    const db = fakeDb([run(1, true), run(2, false)], () => ({ ok: true }))
    const r = await drainEngineRuns(db, null)
    expect(r.ok).toBe(false)
    expect(r.refused).toMatch(/still switched on for 1 office/)
    expect(r.stopped).toEqual([])
    expect(stops(db)).toBe(0)
  })
  it('stops every live run’s job with the office’s own stop once Hermes is off, and reports each', async () => {
    const db = fakeDb([run(1, false), run(2, false)], () => ({ ok: true }))
    const r = await drainEngineRuns(db, OFFICE)
    expect(r.ok).toBe(true)
    expect(r.stopped.map((s) => s.job_id)).toEqual([run(1, false).job_id, run(2, false).job_id])
    expect(stops(db)).toBe(2)
    // the stop names no person, so it is the office's own and the authority check for a named actor is not asked
    expect(db.seen.filter((s) => /request_stop/.test(s)).every((s) => /,\s*null\)/.test(s))).toBe(
      true,
    )
  })
  it('reports a job it could not stop, and is not ok, so the older worker is not restored over it', async () => {
    const db = fakeDb([run(1, false), run(2, false)], (job) =>
      job === run(1, false).job_id ? { error: 'there is no job by that id' } : { ok: true },
    )
    const r = await drainEngineRuns(db, null)
    expect(r.ok).toBe(false)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]?.why).toMatch(/no job/)
    expect(r.stopped).toHaveLength(1)
  })
  it('turns a thrown error into a reported failure and carries on with the rest', async () => {
    const db = fakeDb([run(1, false), run(2, false)], (job) =>
      job === run(1, false).job_id ? new Error('connection reset') : { ok: true },
    )
    const r = await drainEngineRuns(db, null)
    expect(r.ok).toBe(false)
    expect(r.failed[0]?.why).toMatch(/connection reset/)
    expect(r.stopped).toHaveLength(1)
  })
  it('with nothing live it is ok and stops nothing', async () => {
    const db = fakeDb([], () => ({ ok: true }))
    const r = await drainEngineRuns(db, null)
    expect(r).toMatchObject({ ok: true, live: [], stopped: [], failed: [] })
    expect(stops(db)).toBe(0)
  })
  it('accepts an office only as a uuid, and scopes the list to it', async () => {
    const db = fakeDb([], () => ({ ok: true }))
    await expect(liveRuns(db, "x'; drop table engine_runs; --")).rejects.toThrow(/not an office id/)
    await liveRuns(db, OFFICE)
    expect(db.seen[0]).toContain(`r.office_id = '${OFFICE}'::uuid`)
    await liveRuns(db, null)
    expect(db.seen[1]).not.toContain('r.office_id =')
  })
})

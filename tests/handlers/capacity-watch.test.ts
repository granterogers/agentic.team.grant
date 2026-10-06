import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { capacityWatchHandler, readingsFrom } from '../../src/handlers/capacity-watch.ts'
import type { Job } from '../../src/jobs/worker.ts'

const MB = 1_000_000
const reading = (
  scope: string,
  mb: number,
  limitMb: number,
  level: number,
  days: number | null,
) => ({
  scope,
  bytes: mb * MB,
  limit_bytes: limitMb * MB,
  level,
  days_to_limit: days,
  ...(scope === 'database' ? { largest: [{ table: 'public.jobs', bytes: 108 * MB }] } : {}),
})
const job = { jobId: '00000000-0000-4000-8000-000000000001' } as unknown as Job

/** Run the handler against a database that answers the capacity read with `payload` and has no base URL configured. */
const drive = async (payload: unknown) => {
  const db: SqlExecutor = {
    kind: 'fake',
    execute: async (sql: string) =>
      sql.includes('capacity_watch') ? { rows: [{ r: payload }] } : { rows: [] },
  }
  return capacityWatchHandler(db).handle(job, db)
}
const both = (db: [number, number, number | null], st: [number, number, number | null]) => ({
  readings: [
    reading('database', db[0], 500, db[1], db[2]),
    reading('storage', st[0], 1000, st[1], st[2]),
  ],
})

describe('office.capacity_watch', () => {
  it('says nothing, and says it is saying nothing, when both resources are below the first line', async () => {
    const out = await drive(both([100, 0, null], [100, 0, null]))
    expect(out.announce).toBe(false)
    expect(out.topic).toBeUndefined()
  })

  it('announces a crossing with a topic that names the levels, composed from the figures', async () => {
    const out = await drive(both([372, 1, 4], [100, 0, null]))
    expect(out.announce).toBe(true)
    expect(out.topic).toBe('capacity:database=1:storage=0')
    expect(out.body).toContain('The database is 372 MB of 500 MB (74%)')
    expect(out.body).toContain('about 4 days')
    expect(out.severity).toBe('routine')
  })

  it('a deeper level changes the topic (so the worker lets it through) and the severity', async () => {
    const a = await drive(both([372, 1, 4], [100, 0, null]))
    const b = await drive(both([430, 2, 2], [100, 0, null]))
    const c = await drive(both([430, 2, 2], [990, 3, 0]))
    expect(b.topic).not.toBe(a.topic)
    expect(b.severity).toBe('important')
    expect(c.severity).toBe('urgent')
  })

  it('an unreadable sampler is said, never reported as fine', async () => {
    const out = await drive({ readings: [reading('database', 1, 500, 0, null)] })
    expect(out.announce).toBe(true)
    expect(out.topic).toBe('capacity:unreadable')
    const none = await drive(null)
    expect(none.announce).toBe(true)
  })

  it('refuses a reading with a level outside 0 to 3 or a scope it does not know', () => {
    expect(
      readingsFrom({
        readings: [reading('database', 1, 500, 7, null), reading('cpu', 1, 5, 1, null)],
      }),
    ).toEqual([])
    expect(
      readingsFrom(JSON.stringify({ readings: [reading('storage', 1, 1000, 1, 3)] })),
    ).toHaveLength(1)
  })
})

import { describe, expect, it } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { fireDueDuties } from '../../src/handlers/capacity.ts'

/**
 * The budget step of the heartbeat. 1025 made the budget per office; the TypeScript half is that a failure to apply it
 * is reported in the list the pass logs (it used to vanish), without ever stopping the duties behind it.
 */
const fake = (answer: (sql: string) => SqlResult | Error) => {
  const seen: string[] = []
  const db: SqlExecutor = {
    kind: 'fake',
    execute: async (sql: string) => {
      seen.push(sql)
      const r = answer(sql)
      if (r instanceof Error) throw r
      return r
    },
  }
  return { db, seen }
}
const fired = (slug: string): SqlResult => ({ rows: [{ duty_slug: slug, outcome: 'fired' }] })

describe('fireDueDuties and the daily budget', () => {
  it('applies the budget first, then fires what is due, and a healthy budget adds nothing to the report', async () => {
    const { db, seen } = fake((sql) =>
      sql.includes('defer_over_budget') ? { rows: [] } : fired('office.sync'),
    )
    const out = await fireDueDuties(db)
    expect(out).toEqual(['office.sync'])
    expect(seen[0]).toContain('app.defer_over_budget()')
    expect(seen[1]).toContain('dispatch_due_responsibilities')
  })

  it('reports a budget that could not be applied, and still fires the duties (a budget must not stop the queue)', async () => {
    const { db, seen } = fake((sql) =>
      sql.includes('defer_over_budget')
        ? new Error('42883: function app.over_budget(uuid, text) does not exist')
        : fired('office.sync'),
    )
    const out = await fireDueDuties(db)
    expect(out[0]).toMatch(/^budget could not be applied: .*over_budget/)
    expect(out).toContain('office.sync')
    expect(seen.some((s) => s.includes('dispatch_due_responsibilities'))).toBe(true)
  })

  it('reports both failures when the budget and the dispatcher each fail', async () => {
    const { db } = fake((sql) =>
      sql.includes('defer_over_budget') ? new Error('budget down') : new Error('dispatch down'),
    )
    const out = await fireDueDuties(db)
    expect(out).toHaveLength(2)
    expect(out[0]).toContain('budget could not be applied: budget down')
    expect(out[1]).toContain('duties could not be dispatched: dispatch down')
  })

  it('a long error is clipped rather than flooding the log', async () => {
    const { db } = fake((sql) =>
      sql.includes('defer_over_budget') ? new Error('x'.repeat(5000)) : { rows: [] },
    )
    const out = await fireDueDuties(db)
    expect(out[0]?.length).toBeLessThan(200)
  })
})

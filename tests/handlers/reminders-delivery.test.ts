/**
 * C3 / R3: the tasks.remind duty marks a reminder in flight when it says it, and settles what earlier ticks said BEFORE
 * it reads what is due. Driven with a fake executor so the ORDER and the fallback are asserted as behaviour; the
 * database half (delivered, failed, bounded, series advanced in place) is scripts/isolated/tk-reminders.ts.
 */

import { describe, expect, it } from 'vitest'
import { remindersHandler } from '../../src/handlers/reminders.ts'
import type { Job } from '../../src/jobs/worker.ts'

const JOB = { jobId: '11111111-1111-1111-1111-111111111111', kind: 'tasks.remind' } as Job
const DUE = [
  {
    id: '22222222-2222-2222-2222-222222222222',
    title: 'Review my finances',
    remind_at: '2026-10-12T06:00:00Z',
    due_on: null,
    project: null,
    overdue: false,
  },
]

const fake = (opts: { settle?: 'ok' | 'missing' | Error; due?: unknown[] } = {}) => {
  const calls: string[] = []
  const db = {
    execute: async (sql: string) => {
      calls.push(sql)
      if (sql.includes('app.reminders_settle')) {
        if (opts.settle === 'missing')
          throw new Error('function app.reminders_settle(uuid) does not exist')
        if (opts.settle instanceof Error) throw opts.settle
        return { rows: [{ s: {} }], rowCount: 1 }
      }
      if (sql.includes('app.reminders_due')) return { rows: [{ r: opts.due ?? DUE }], rowCount: 1 }
      return { rows: [{}], rowCount: 1 }
    },
  }
  return { db: db as never, calls }
}
const which = (calls: string[], needle: string) => calls.findIndex((c) => c.includes(needle))

describe('the duty settles first, then reads, then marks the reminder IN FLIGHT', () => {
  it('settle, then due, then announced (with this job), and never marks it sent itself', async () => {
    const { db, calls } = fake()
    const out = await remindersHandler(db).handle(JOB, db)
    expect(out.announce).toBe(true)
    const settle = which(calls, 'app.reminders_settle')
    const due = which(calls, 'app.reminders_due')
    const announced = which(calls, 'app.reminders_announced')
    expect(settle).toBeGreaterThanOrEqual(0)
    expect(settle).toBeLessThan(due)
    expect(due).toBeLessThan(announced)
    expect(calls[announced]).toContain(JOB.jobId)
    expect(calls[announced]).toContain(DUE[0]?.id)
    expect(which(calls, 'app.reminders_sent')).toBe(-1)
  })

  it('nothing due: nothing is marked, nothing announced', async () => {
    const { db, calls } = fake({ due: [] })
    const out = await remindersHandler(db).handle(JOB, db)
    expect(out.announce).toBe(false)
    expect(which(calls, 'app.reminders_announced')).toBe(-1)
    expect(which(calls, 'app.reminders_sent')).toBe(-1)
  })
})

describe('a database that cannot track delivery', () => {
  it('only "that function is not there" falls back to marking once said', async () => {
    const { db, calls } = fake({ settle: 'missing' })
    const out = await remindersHandler(db).handle(JOB, db)
    expect(out.announce).toBe(true)
    expect(which(calls, 'app.reminders_sent')).toBeGreaterThan(-1)
    expect(which(calls, 'app.reminders_announced')).toBe(-1)
  })

  it('any OTHER failure of the settle fails the tick (it retries) instead of quietly marking before delivery', async () => {
    const { db, calls } = fake({
      settle: new Error('canceling statement due to statement timeout'),
    })
    await expect(remindersHandler(db).handle(JOB, db)).rejects.toThrow(/statement timeout/)
    expect(which(calls, 'app.reminders_sent')).toBe(-1)
    expect(which(calls, 'app.reminders_announced')).toBe(-1)
  })
})

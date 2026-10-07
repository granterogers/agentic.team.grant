/**
 * Version 1 acceptance, journey A (neighbour): two reminders with the same WORDS on the same day are two announcements.
 *
 * `app.say_once` fingerprints a duty's body for twenty hours and a reminder's body is only its title, so "take the pills"
 * at 8pm was muted as "already said" after "take the pills" at 4pm, re-opened by the settle step three times and then
 * marked finished having reached nobody. The announcement says what it is ABOUT: each occurrence. Driven with a fake
 * executor; the database half is scripts/isolated/v1-acceptance-a.ts (journey A neighbour), which sabotages this.
 */

import { describe, expect, it } from 'vitest'
import { remindersHandler } from '../../src/handlers/reminders.ts'
import type { Job } from '../../src/jobs/worker.ts'

const JOB = { jobId: '11111111-1111-1111-1111-111111111111', kind: 'tasks.remind' } as Job
const due = (id: string, at: string) => ({
  id,
  title: 'Take the pills',
  remind_at: at,
  due_on: null,
  project: null,
  overdue: false,
})
const run = async (rows: unknown[]) => {
  const db = {
    execute: async (sql: string) => {
      if (sql.includes('app.reminders_due')) return { rows: [{ r: rows }], rowCount: 1 }
      return { rows: [{ s: {} }], rowCount: 1 }
    },
  }
  return remindersHandler(db as never).handle(JOB, db as never)
}

describe('a reminder announcement is about its occurrence, not its words', () => {
  it('two different tasks with the SAME title have different topics', async () => {
    const a = await run([due('22222222-2222-2222-2222-222222222222', '2026-10-09T13:00:00Z')])
    const b = await run([due('33333333-3333-3333-3333-333333333333', '2026-10-09T17:00:00Z')])
    expect(a.body).toBe(b.body)
    expect(a.topic).toBeDefined()
    expect(b.topic).toBeDefined()
    expect(a.topic).not.toBe(b.topic)
  })

  it('a series row announced at two different times has different topics', async () => {
    const id = '44444444-4444-4444-4444-444444444444'
    const a = await run([due(id, '2026-10-12T06:00:00Z')])
    const b = await run([due(id, '2026-10-19T06:00:00Z')])
    expect(a.topic).not.toBe(b.topic)
  })

  it('the SAME occurrence read twice has the SAME topic (a retry after a failure is still one thing)', async () => {
    const rows = [due('55555555-5555-5555-5555-555555555555', '2026-10-09T13:00:00Z')]
    expect((await run(rows)).topic).toBe((await run(rows)).topic)
  })

  it('nothing due: nothing is announced and there is no topic', async () => {
    const out = await run([])
    expect(out.announce).toBe(false)
    expect(out.topic).toBeUndefined()
  })
})

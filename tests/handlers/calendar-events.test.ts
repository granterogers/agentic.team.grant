/**
 * What the project-events sync does with each answer Google can give (0897). The database is a recorder: the point is
 * WHICH function the pass calls for each outcome, so a refusal is never recorded as a success and a success never
 * leaves a row pending. The same pass is driven against a real replica in scripts/isolated/project-calendar.ts.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import {
  calendarEventsHandler,
  syncProjectEvents,
  type WorkRow,
} from '../../src/handlers/calendar-events.ts'
import { REACH } from '../../src/jobs/containment.ts'

const OFFICE = '11111111-1111-4111-8111-111111111111'
const row = (over: Partial<WorkRow>): WorkRow => ({
  event_id: '22222222-2222-4222-8222-222222222222',
  op: 'create',
  title: 'Site walk',
  notes: null,
  location: null,
  starts_at: '2026-10-12T09:00:00+00:00',
  ends_at: '2026-10-12T10:00:00+00:00',
  all_day: false,
  external_calendar_id: null,
  external_event_id: null,
  external_etag: null,
  authority: 'person',
  project_slug: 'alpha',
  project_name: 'Alpha',
  updated_at: '2026-10-04T09:00:00.123456+00:00',
  ...over,
})
const recorder = (): { db: SqlExecutor; sql: string[] } => {
  const sql: string[] = []
  return {
    sql,
    db: {
      kind: 'fake',
      execute: async (q: string) => (sql.push(q), { rows: [] }),
    } as unknown as SqlExecutor,
  }
}
const answers = (
  ...rs: { status: number; body?: unknown }[]
): { f: typeof fetch; methods: string[] } => {
  const q = [...rs]
  const methods: string[] = []
  return {
    methods,
    f: (async (_u: string, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET')
      const r = q.shift() ?? { status: 500 }
      return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), {
        status: r.status,
      })
    }) as unknown as typeof fetch,
  }
}

describe('syncProjectEvents', () => {
  it('records a created event as done with its Google id, etag and updated stamp, keyed to the row it read', async () => {
    const { db, sql } = recorder()
    const g = answers(
      { status: 200, body: { items: [] } },
      { status: 200, body: { id: 'g1', etag: '"e"', updated: '2026-10-04T10:00:00.000Z' } },
    )
    const r = await syncProjectEvents(db, OFFICE, 'tok-0123456789', [row({})], {
      fetchImpl: g.f,
      calendarId: 'primary',
    })
    expect(r).toMatchObject({ pushed: 1, failed: 0 })
    expect(sql).toHaveLength(1)
    expect(sql[0]).toContain('app.project_event_sync_done')
    expect(sql[0]).toContain("'create'")
    expect(sql[0]).toContain("'g1'")
    // The optimistic guard: the updated_at the work list showed, not now().
    expect(sql[0]).toContain("'2026-10-04T09:00:00.123456+00:00'::timestamptz")
  })
  it('an update of a linked event PATCHes it', async () => {
    const { db } = recorder()
    const g = answers({ status: 200, body: { id: 'g1' } })
    await syncProjectEvents(
      db,
      OFFICE,
      'tok-0123456789',
      [row({ op: 'update', external_calendar_id: 'primary', external_event_id: 'g1' })],
      { fetchImpl: g.f, calendarId: 'other' },
    )
    expect(g.methods).toEqual(['PATCH'])
  })
  it('an update Google says is gone is Google deletion winning, not a failure', async () => {
    const { db, sql } = recorder()
    const g = answers({ status: 404, body: { error: { message: 'Not Found' } } })
    const r = await syncProjectEvents(
      db,
      OFFICE,
      'tok-0123456789',
      [row({ op: 'update', external_calendar_id: 'primary', external_event_id: 'g1' })],
      { fetchImpl: g.f, calendarId: 'primary' },
    )
    expect(r.failed).toBe(0)
    expect(sql[0]).toContain('app.project_event_gone')
    expect(r.notes[0]).toContain('deleted in Google')
  })
  it('a delete is paid by DELETE and then purged via sync_done', async () => {
    const { db, sql } = recorder()
    const g = answers(
      {
        status: 200,
        body: {
          extendedProperties: {
            private: { agenticEventId: '22222222-2222-4222-8222-222222222222' },
          },
        },
      },
      { status: 204 },
    )
    const r = await syncProjectEvents(
      db,
      OFFICE,
      'tok-0123456789',
      [row({ op: 'delete', external_calendar_id: 'primary', external_event_id: 'g1' })],
      { fetchImpl: g.f, calendarId: 'primary' },
    )
    expect(g.methods).toEqual(['GET', 'DELETE'])
    expect(r.pushed).toBe(1)
    expect(sql[0]).toContain("'delete'")
  })
  it('a transient failure stays retryable and a permanent one does not; the reason is recorded without the token', async () => {
    const tok = 'tok-ABCDEFGHIJKLMNOP'
    for (const [status, retry] of [
      [503, 'true'],
      [403, 'false'],
    ] as const) {
      const { db, sql } = recorder()
      const g = answers(
        { status: 200, body: { items: [] } },
        { status, body: { error: { message: `nope ${tok}` } } },
      )
      const r = await syncProjectEvents(db, OFFICE, tok, [row({})], {
        fetchImpl: g.f,
        calendarId: 'primary',
      })
      expect(r).toMatchObject({ pushed: 0, failed: 1 })
      expect(sql[0]).toContain('app.project_event_sync_failed')
      expect(sql[0]).toMatch(new RegExp(`, ${retry}\\)$`))
      expect(sql.join('\n')).not.toContain(tok)
      expect(r.notes.join('\n')).not.toContain(tok)
    }
  })
  it('a failure to record a success is a failed row with a retry, not an aborted pass', async () => {
    const calls: string[] = []
    const db = {
      kind: 'fake',
      execute: async (q: string) => {
        calls.push(q)
        if (q.includes('project_event_sync_done')) throw new Error('23505: duplicate key')
        return { rows: [] }
      },
    } as unknown as SqlExecutor
    const g = answers(
      { status: 200, body: { items: [] } },
      { status: 200, body: { id: 'g1' } },
      { status: 200, body: { items: [] } },
      { status: 200, body: { id: 'g2' } },
    )
    const r = await syncProjectEvents(
      db,
      OFFICE,
      'tok-0123456789',
      [row({}), row({ event_id: '33333333-3333-4333-8333-333333333333' })],
      { fetchImpl: g.f, calendarId: 'primary' },
    )
    expect(r.failed).toBe(2)
    expect(calls.filter((c) => c.includes('project_event_sync_failed'))).toHaveLength(2)
  })
})

describe('registration', () => {
  it('the handler serves calendar.sync_events and the containment registry knows it reaches Google', () => {
    const { db } = recorder()
    expect(calendarEventsHandler(db).kind).toBe('calendar.sync_events')
    expect(REACH['calendar.sync_events']).toEqual({ reach: 'external', service: 'Google Calendar' })
  })
})

/**
 * Optimistic concurrency in the project-events sync (0980): the duty sends If-Match with the stored etag, and a 412 is
 * resolved by the documented rule rather than overwritten. Google is a small STATEFUL fake that models etags, `updated`
 * stamps, If-Match and 412 the way the Calendar API does. The database is a recorder, so what is asserted is which
 * function each outcome reached and what Google ended up holding. A live Google is NOT exercised.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { syncProjectEvents, type WorkRow } from '../../src/handlers/calendar-events.ts'
import { EVENT, FakeGoogle } from '../helpers/fake-google-calendar.ts'

const OFFICE = '11111111-1111-4111-8111-111111111111'

const row = (over: Partial<WorkRow>): WorkRow => ({
  event_id: EVENT,
  op: 'update',
  title: 'Site walk (moved)',
  notes: null,
  location: null,
  starts_at: '2026-10-12T11:00:00+00:00',
  ends_at: '2026-10-12T12:00:00+00:00',
  all_day: false,
  external_calendar_id: 'primary',
  external_event_id: 'g1',
  external_etag: null,
  external_updated_at: null,
  authority: 'person',
  project_slug: 'alpha',
  project_name: 'Alpha',
  updated_at: '2026-10-04T12:00:00.000000+00:00',
  ...over,
})

const recorder = (): { db: SqlExecutor; sql: string[]; calls: (name: string) => string[] } => {
  const sql: string[] = []
  return {
    sql,
    calls: (name) => sql.filter((q) => q.includes(name)),
    db: {
      kind: 'fake',
      execute: async (q: string) => (sql.push(q), { rows: [{ r: { ok: true } }] }),
    } as unknown as SqlExecutor,
  }
}
const run = (g: FakeGoogle, db: SqlExecutor, rows: WorkRow[]) =>
  syncProjectEvents(db, OFFICE, 'tok-0123456789', rows, {
    fetchImpl: g.fetch,
    calendarId: 'primary',
  })
const mutations = (g: FakeGoogle): string[] =>
  g.log.filter((l) => l.method === 'PATCH' || l.method === 'DELETE').map((l) => l.method)

describe('a normal edit', () => {
  it('sends If-Match with the stored etag, and records the NEW etag Google returns', async () => {
    const g = new FakeGoogle()
    const seeded = g.seed('g1')
    const { db, calls } = recorder()
    const out = await run(g, db, [
      row({ external_etag: seeded.etag, external_updated_at: seeded.updated }),
    ])
    expect(out).toMatchObject({ pushed: 1, failed: 0, notes: [] })
    expect(g.log[0]).toMatchObject({ method: 'PATCH', ifMatch: seeded.etag })
    expect(g.events.get('g1')?.summary).toBe('Site walk (moved)')
    const done = calls('project_event_sync_done')
    expect(done).toHaveLength(1)
    expect(done[0]).toContain(g.events.get('g1')?.etag ?? 'missing')
    expect(done[0]).not.toContain(seeded.etag)
    expect(calls('project_event_conflict_note')).toHaveLength(0)
  })
  it('control: a row with no recorded etag is sent without If-Match (the old behaviour is the fallback, not a crash)', async () => {
    const g = new FakeGoogle()
    g.seed('g1')
    const { db } = recorder()
    await run(g, db, [row({})])
    expect(g.log[0]?.ifMatch).toBeNull()
  })
})

describe('a concurrent edit in Google (412)', () => {
  it('GOOGLE LATER: Google keeps its change, the local edit is dropped, and it is written down', async () => {
    const g = new FakeGoogle()
    const seeded = g.seed('g1')
    g.remoteEdit('g1', { summary: 'Site walk - bring hard hats', location: 'Gate 2' })
    const { db, calls } = recorder()
    // The local edit was made BEFORE Google's change (updated_at earlier than Google's stamp).
    const out = await run(g, db, [
      row({
        external_etag: seeded.etag,
        external_updated_at: seeded.updated,
        updated_at: '2026-10-04T10:00:30.000000+00:00',
      }),
    ])
    expect(mutations(g)).toEqual(['PATCH']) // the one refused PATCH; nothing was overwritten
    expect(g.events.get('g1')?.summary).toBe('Site walk - bring hard hats')
    expect(g.events.get('g1')?.location).toBe('Gate 2')
    const took = calls('project_event_take_remote')
    expect(took).toHaveLength(1)
    expect(took[0]).toContain('Site walk - bring hard hats')
    expect(took[0]).toContain('overridden by a newer change in Google')
    expect(calls('project_event_sync_done')).toHaveLength(0)
    expect(calls('project_event_sync_failed')).toHaveLength(0)
    expect(out.failed).toBe(0)
    expect(out.notes[0]).toContain('overridden by a newer change in Google')
  })
  it('LOCAL LATER: re-sent ONCE with the fresh etag, Google ends up with the local edit, override recorded', async () => {
    const g = new FakeGoogle()
    const seeded = g.seed('g1')
    g.remoteEdit('g1', { summary: 'Edited in Google' })
    const fresh = g.events.get('g1')?.etag
    const { db, calls } = recorder()
    const out = await run(g, db, [
      row({
        external_etag: seeded.etag,
        external_updated_at: seeded.updated,
        updated_at: '2026-10-04T23:00:00.000000+00:00',
      }),
    ])
    const patches = g.log.filter((l) => l.method === 'PATCH')
    expect(patches.map((p) => p.ifMatch)).toEqual([seeded.etag, fresh])
    expect(g.events.get('g1')?.summary).toBe('Site walk (moved)')
    expect(calls('project_event_sync_done')).toHaveLength(1)
    const note = calls('project_event_conflict_note')
    expect(note).toHaveLength(1)
    expect(note[0]).toContain('overridden by this later edit')
    expect(out).toMatchObject({ pushed: 1, failed: 0 })
    expect(calls('project_event_take_remote')).toHaveLength(0)
  })
  it('a merely STALE etag (Google has nothing newer than what the sides agreed on) is re-sent with no conflict note', async () => {
    const g = new FakeGoogle()
    const seeded = g.seed('g1')
    // The pull absorbed a Google change and moved external_updated_at, but the stored etag is the older one.
    g.remoteEdit('g1', { summary: 'Edited in Google' })
    const { db, calls } = recorder()
    const out = await run(g, db, [
      row({
        external_etag: seeded.etag,
        external_updated_at: g.events.get('g1')?.updated ?? null,
        updated_at: '2026-10-04T09:00:00.000000+00:00', // even an OLDER local edit: the content is not in dispute
      }),
    ])
    expect(g.events.get('g1')?.summary).toBe('Site walk (moved)')
    expect(calls('project_event_conflict_note')).toHaveLength(0)
    expect(out).toMatchObject({ pushed: 1, failed: 0, notes: [] })
  })
  it('a second 412 while resolving leaves the row pending and retryable, with nothing overwritten and no loop', async () => {
    const g = new FakeGoogle()
    const seeded = g.seed('g1')
    g.remoteEdit('g1', { summary: 'Edited in Google' })
    // Google changes AGAIN between the read-back and the re-send.
    const real = g.fetch
    let patches = 0
    const racing: typeof fetch = (async (u: string, i?: RequestInit) => {
      if (i?.method === 'PATCH' && ++patches === 2) g.remoteEdit('g1', { summary: 'And again' })
      return real(u, i)
    }) as unknown as typeof fetch
    const { db, calls } = recorder()
    const out = await syncProjectEvents(
      db,
      OFFICE,
      'tok-0123456789',
      [
        row({
          external_etag: seeded.etag,
          external_updated_at: seeded.updated,
          updated_at: '2026-10-04T23:00:00.000000+00:00',
        }),
      ],
      { fetchImpl: racing, calendarId: 'primary' },
    )
    expect(g.events.get('g1')?.summary).toBe('And again')
    expect(g.log.filter((l) => l.method === 'PATCH')).toHaveLength(2)
    expect(out.failed).toBe(1)
    const failed = calls('project_event_sync_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toContain('true') // retryable
    expect(calls('project_event_sync_done')).toHaveLength(0)
  })
  it('Google deleted it meanwhile: its deletion wins (project_event_gone), not a failure', async () => {
    const g = new FakeGoogle()
    const seeded = g.seed('g1')
    g.remoteEdit('g1', { summary: 'x' })
    const original = g.fetch
    // The PATCH is refused with 412, then the event is deleted before the read-back.
    const gone: typeof fetch = (async (u: string, i?: RequestInit) => {
      const r = await original(u, i)
      if (i?.method === 'PATCH') g.remoteDelete('g1')
      return r
    }) as unknown as typeof fetch
    const { db, calls } = recorder()
    const out = await syncProjectEvents(
      db,
      OFFICE,
      'tok-0123456789',
      [row({ external_etag: seeded.etag, external_updated_at: seeded.updated })],
      { fetchImpl: gone, calendarId: 'primary' },
    )
    expect(calls('project_event_gone')).toHaveLength(1)
    expect(out.failed).toBe(0)
  })
})

describe('a delete with a stale etag', () => {
  it('Google edited the event AFTER the delete: the delete is NOT sent, the event is restored from Google, and it says so', async () => {
    const g = new FakeGoogle()
    const seeded = g.seed('g1')
    g.remoteEdit('g1', { summary: 'Still in use' })
    const { db, calls } = recorder()
    const out = await run(g, db, [
      row({
        op: 'delete',
        external_etag: seeded.etag,
        external_updated_at: seeded.updated,
        updated_at: '2026-10-04T10:00:30.000000+00:00', // deleted here BEFORE Google's edit
      }),
    ])
    expect(g.events.has('g1')).toBe(true) // the one DELETE attempted was refused with 412
    expect(mutations(g)).toEqual(['DELETE'])
    expect(g.events.get('g1')?.summary).toBe('Still in use')
    const took = calls('project_event_take_remote')
    expect(took).toHaveLength(1)
    expect(took[0]).toContain('true') // p_restore
    expect(took[0]).toContain('so it is back')
    expect(out.notes[0]).toContain('so it is back')
    expect(calls("'delete'")).toHaveLength(0)
  })
  it('the delete is later than the last Google change: it is re-sent once with the fresh etag and the event goes', async () => {
    const g = new FakeGoogle()
    const seeded = g.seed('g1')
    g.remoteEdit('g1', { summary: 'Edited long ago' })
    const { db, calls } = recorder()
    const out = await run(g, db, [
      row({
        op: 'delete',
        external_etag: seeded.etag,
        external_updated_at: seeded.updated,
        updated_at: '2026-10-04T23:00:00.000000+00:00',
      }),
    ])
    expect(g.events.has('g1')).toBe(false)
    expect(out).toMatchObject({ pushed: 1, failed: 0 })
    expect(calls("'delete'")).toHaveLength(1)
    expect(out.notes[0]).toContain('delete was sent')
  })
  it('control: a delete with the CURRENT etag just deletes, no conflict machinery', async () => {
    const g = new FakeGoogle()
    const seeded = g.seed('g1')
    const { db, calls } = recorder()
    const out = await run(g, db, [row({ op: 'delete', external_etag: seeded.etag })])
    expect(g.events.has('g1')).toBe(false)
    expect(out.notes).toEqual([])
    expect(calls('project_event_take_remote')).toHaveLength(0)
    expect(g.log.find((l) => l.method === 'DELETE')?.ifMatch).toBe(seeded.etag)
  })
})

describe('idempotent retry', () => {
  it('running the same pass twice neither duplicates a create nor refuses the second edit', async () => {
    const g = new FakeGoogle()
    const { db } = recorder()
    const create = row({ op: 'create', external_calendar_id: null, external_event_id: null })
    await run(g, db, [create])
    await run(g, db, [create]) // the first outcome was never recorded: adopt, do not duplicate
    expect(g.events.size).toBe(1)
    const only = [...g.events.values()][0]
    const again = await run(g, db, [
      row({
        external_event_id: only?.id ?? '',
        external_etag: only?.etag ?? null,
        title: 'Second edit',
      }),
    ])
    expect(again).toMatchObject({ pushed: 1, failed: 0 })
    expect(g.events.get(only?.id ?? '')?.summary).toBe('Second edit')
  })
  it('re-running an update whose etag was already spent (the recorded etag is old) does not overwrite a newer Google change', async () => {
    const g = new FakeGoogle()
    const seeded = g.seed('g1')
    const { db } = recorder()
    const stale = row({
      external_etag: seeded.etag,
      external_updated_at: seeded.updated,
      updated_at: '2026-10-04T10:00:10.000000+00:00',
    })
    await run(g, db, [stale]) // succeeds and moves the etag; suppose recording it failed, so the row is offered again
    g.remoteEdit('g1', { summary: 'Somebody else, afterwards' })
    await run(g, db, [stale])
    expect(g.events.get('g1')?.summary).toBe('Somebody else, afterwards')
  })
})

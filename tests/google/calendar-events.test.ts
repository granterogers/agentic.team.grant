/**
 * Project events to Google Calendar: the exact REST calls, all-day versus timed shaping, idempotence, typed failures,
 * and that no token ever comes back in a string (migration 0906, written as 0897).
 *
 * Google is a function in this file. Every interesting case is a failure or a shape, none of which needs a connection.
 */
import { describe, expect, it } from 'vitest'
import {
  createEvent,
  deleteEvent,
  EVENT_TAG,
  type EventDraft,
  patchEvent,
  toGoogleEvent,
} from '../../src/google/calendar-events.ts'

const TOKEN = 'fake-access-token-0123456789-abcdef'
const timed: EventDraft = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  title: 'Site walk',
  notes: 'bring boots',
  location: 'Lake House',
  startsAt: '2026-10-12T09:00:00.000Z',
  endsAt: '2026-10-12T10:00:00.000Z',
  allDay: false,
}
const allDay: EventDraft = {
  ...timed,
  startsAt: '2026-10-20T00:00:00.000Z',
  endsAt: '2026-10-21T00:00:00.000Z',
  allDay: true,
}

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: Record<string, unknown> | undefined
}
type Reply = { status: number; body?: unknown } | Error
const scripted = (replies: Reply[]): { fetchImpl: typeof fetch; calls: Call[] } => {
  const calls: Call[] = []
  const queue = [...replies]
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    })
    const next = queue.shift()
    if (next === undefined) throw new Error('unexpected extra request')
    if (next instanceof Error) throw next
    return new Response(next.status === 204 ? null : JSON.stringify(next.body ?? {}), {
      status: next.status,
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('toGoogleEvent', () => {
  it('shapes a timed event with dateTime, the title, notes, location and the private tag', () => {
    const b = toGoogleEvent(timed)
    expect(b).toEqual({
      summary: 'Site walk',
      description: 'bring boots',
      location: 'Lake House',
      start: { dateTime: '2026-10-12T09:00:00.000Z' },
      end: { dateTime: '2026-10-12T10:00:00.000Z' },
      extendedProperties: { private: { [EVENT_TAG]: timed.id } },
    })
  })
  it('shapes an all-day event with date only, the end exclusive as stored', () => {
    const b = toGoogleEvent(allDay)
    expect(b.start).toEqual({ date: '2026-10-20' })
    expect(b.end).toEqual({ date: '2026-10-21' })
    expect(JSON.stringify(b)).not.toContain('dateTime')
  })
  it('a patch names the representation it stops using as null, so Google never holds both', () => {
    expect(toGoogleEvent(allDay, true).start).toEqual({ date: '2026-10-20', dateTime: null })
    expect(toGoogleEvent(timed, true).start).toEqual({
      dateTime: '2026-10-12T09:00:00.000Z',
      date: null,
    })
  })
  it('notes never set are not sent (Google description is left alone); notes cleared are sent empty', () => {
    expect('description' in toGoogleEvent({ ...timed, notes: null })).toBe(false)
    expect(toGoogleEvent({ ...timed, notes: '' }).description).toBe('')
  })
  it('an empty location is omitted on create and cleared (null) on patch', () => {
    expect('location' in toGoogleEvent({ ...timed, location: null })).toBe(false)
    expect(toGoogleEvent({ ...timed, location: null }, true).location).toBeNull()
  })
})

describe('createEvent', () => {
  it('asks Google whether it already holds this event, then POSTs once with the bearer token', async () => {
    const { fetchImpl, calls } = scripted([
      { status: 200, body: { items: [] } },
      { status: 200, body: { id: 'g1', etag: '"e1"', updated: '2026-10-04T10:00:00.000Z' } },
    ])
    const out = await createEvent(TOKEN, 'primary', timed, { fetchImpl })
    expect(out).toEqual({
      ok: true,
      kind: 'created',
      externalId: 'g1',
      etag: '"e1"',
      updated: '2026-10-04T10:00:00.000Z',
    })
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST'])
    expect(calls[0]?.url).toBe(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?privateExtendedProperty=${encodeURIComponent(`${EVENT_TAG}=${timed.id}`)}&maxResults=1&showDeleted=false`,
    )
    expect(calls[1]?.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    expect(calls[1]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[1]?.body?.summary).toBe('Site walk')
  })
  it('is idempotent: an event Google already holds is adopted and patched, never created twice', async () => {
    const { fetchImpl, calls } = scripted([
      { status: 200, body: { items: [{ id: 'already' }] } },
      { status: 200, body: { id: 'already', etag: '"e2"', updated: '2026-10-04T10:01:00.000Z' } },
    ])
    const out = await createEvent(TOKEN, 'primary', timed, { fetchImpl })
    expect(out.ok && out.kind).toBe('adopted')
    expect(out.ok && out.externalId).toBe('already')
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH'])
    expect(calls[1]?.url.endsWith('/events/already')).toBe(true)
  })
  it('a failed lookup is not evidence of absence: it reports and creates nothing', async () => {
    const { fetchImpl, calls } = scripted([{ status: 500 }])
    const out = await createEvent(TOKEN, 'primary', timed, { fetchImpl })
    expect(out.ok).toBe(false)
    expect(!out.ok && out.kind).toBe('transient')
    expect(!out.ok && out.retryable).toBe(true)
    expect(calls).toHaveLength(1)
  })
  it('encodes a calendar id that is an email address', async () => {
    const { fetchImpl, calls } = scripted([
      { status: 200, body: { items: [] } },
      { status: 200, body: { id: 'g1' } },
    ])
    await createEvent(TOKEN, 'grant@example.com', timed, { fetchImpl })
    expect(calls[1]?.url).toContain('/calendars/grant%40example.com/events')
  })
  it('refuses an accepted create that returned no id, rather than recording nothing as success', async () => {
    const { fetchImpl } = scripted([
      { status: 200, body: { items: [] } },
      { status: 200, body: {} },
    ])
    const out = await createEvent(TOKEN, 'primary', timed, { fetchImpl })
    expect(!out.ok && out.kind).toBe('rejected')
  })
})

describe('patchEvent', () => {
  it('PATCHes the linked event and sends If-Match when given an etag', async () => {
    const { fetchImpl, calls } = scripted([{ status: 200, body: { id: 'g1', etag: '"e3"' } }])
    const out = await patchEvent(TOKEN, 'primary', 'g1', allDay, { fetchImpl, ifMatch: '"e2"' })
    expect(out.ok && out.etag).toBe('"e3"')
    expect(calls[0]?.method).toBe('PATCH')
    expect(calls[0]?.headers['If-Match']).toBe('"e2"')
    expect(calls[0]?.body?.start).toEqual({ date: '2026-10-20', dateTime: null })
  })
  it('a 412 is a typed conflict, not a throw', async () => {
    const { fetchImpl } = scripted([
      { status: 412, body: { error: { message: 'Precondition Failed' } } },
    ])
    const out = await patchEvent(TOKEN, 'primary', 'g1', timed, { fetchImpl, ifMatch: '"old"' })
    expect(!out.ok && out.kind).toBe('conflict')
  })
  it('a 404 is not_found (deleted in Google) and says which event', async () => {
    const { fetchImpl } = scripted([{ status: 404, body: { error: { message: 'Not Found' } } }])
    const out = await patchEvent(TOKEN, 'primary', 'gone', timed, { fetchImpl })
    expect(!out.ok && out.kind).toBe('not_found')
    expect(!out.ok && out.message).toContain('Site walk')
  })
})

describe('deleteEvent', () => {
  it('reads the event back, checks it is ours, then DELETEs', async () => {
    const { fetchImpl, calls } = scripted([
      {
        status: 200,
        body: { id: 'g1', extendedProperties: { private: { [EVENT_TAG]: timed.id } } },
      },
      { status: 204 },
    ])
    const out = await deleteEvent(TOKEN, 'primary', 'g1', timed.id, { fetchImpl })
    expect(out.ok && out.kind).toBe('deleted')
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE'])
  })
  it('leaves an event that does not carry our id alone', async () => {
    const { fetchImpl, calls } = scripted([
      {
        status: 200,
        body: { id: 'g1', extendedProperties: { private: { [EVENT_TAG]: 'someone-else' } } },
      },
    ])
    const out = await deleteEvent(TOKEN, 'primary', 'g1', timed.id, { fetchImpl })
    expect(!out.ok && out.kind).toBe('not_ours')
    expect(calls).toHaveLength(1)
  })
  it('gone already (404, 410, or cancelled) is the outcome we wanted', async () => {
    for (const first of [
      { status: 404 },
      { status: 410 },
      { status: 200, body: { status: 'cancelled' } },
    ]) {
      const { fetchImpl, calls } = scripted([first])
      const out = await deleteEvent(TOKEN, 'primary', 'g1', timed.id, { fetchImpl })
      expect(out.ok && out.kind).toBe('already_gone')
      expect(calls).toHaveLength(1)
    }
  })
  it('a 410 on the DELETE itself is also fine', async () => {
    const { fetchImpl } = scripted([
      { status: 200, body: { extendedProperties: { private: { [EVENT_TAG]: timed.id } } } },
      { status: 410 },
    ])
    const out = await deleteEvent(TOKEN, 'primary', 'g1', timed.id, { fetchImpl })
    expect(out.ok && out.kind).toBe('already_gone')
  })
})

describe('failures are values, and none of them carries the token', () => {
  const table: [number, string, boolean][] = [
    [401, 'unauthorised', true],
    [403, 'forbidden', false],
    [409, 'conflict', false],
    [429, 'rate_limited', true],
    [503, 'transient', true],
    [400, 'rejected', false],
  ]
  for (const [status, kind, retryable] of table) {
    it(`${String(status)} is ${kind}`, async () => {
      const { fetchImpl } = scripted([
        { status: 200, body: { items: [] } },
        { status, body: { error: { message: `bad token ${TOKEN}` } } },
      ])
      const out = await createEvent(TOKEN, 'primary', timed, { fetchImpl })
      expect(!out.ok && out.kind).toBe(kind)
      expect(!out.ok && out.retryable).toBe(retryable)
      expect(JSON.stringify(out)).not.toContain(TOKEN)
    })
  }
  it('a 403 with a rate-limit reason is retryable rate_limited, not forbidden', async () => {
    const { fetchImpl } = scripted([
      { status: 200, body: { items: [] } },
      {
        status: 403,
        body: { error: { message: 'slow down', errors: [{ reason: 'rateLimitExceeded' }] } },
      },
    ])
    const out = await createEvent(TOKEN, 'primary', timed, { fetchImpl })
    expect(!out.ok && out.kind).toBe('rate_limited')
    expect(!out.ok && out.retryable).toBe(true)
  })
  it('a dropped connection is a retryable network outcome whose message has no token even if the cause echoed it', async () => {
    const { fetchImpl } = scripted([new Error(`socket hang up (Authorization: Bearer ${TOKEN})`)])
    const out = await createEvent(TOKEN, 'primary', timed, { fetchImpl })
    expect(!out.ok && out.kind).toBe('network')
    expect(!out.ok && out.retryable).toBe(true)
    expect(JSON.stringify(out)).not.toContain(TOKEN)
  })
  it('a credential-shaped string in Google error text is redacted even when it is not the token held', async () => {
    const { fetchImpl } = scripted([
      { status: 200, body: { items: [] } },
      { status: 400, body: { error: { message: `key AIza${'x'.repeat(35)} rejected` } } },
    ])
    const out = await createEvent(TOKEN, 'primary', timed, { fetchImpl })
    expect(JSON.stringify(out)).not.toContain('AIzaxxxx')
  })
  it('a one-character token does not turn the message into a find-and-replace (length floor)', async () => {
    const { fetchImpl } = scripted([
      { status: 200, body: { items: [] } },
      { status: 400, body: { error: { message: 'invalid request' } } },
    ])
    const out = await createEvent('a', 'primary', timed, { fetchImpl })
    expect(!out.ok && out.message).toContain('invalid request')
  })
})

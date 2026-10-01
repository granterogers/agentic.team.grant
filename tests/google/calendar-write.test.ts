/*
  The rules that must never be wrong, exercised without a live Google.

  Everything here is about NOT touching something we did not create. The office
  has write access to Grant's real diary, and the failure mode this file exists
  to prevent is not "the sync did not run" — it is "the sync deleted a meeting".
*/

import { describe, expect, it } from 'vitest'
import { syncTasksToCalendar } from '../../src/google/calendar-write.ts'

type Row = Record<string, unknown>

/** A database stand-in that answers the three queries the writer makes. */
function fakeDb(opts: {
  on?: boolean
  target?: string
  plan?: Record<string, unknown>
  calls?: string[]
}) {
  const calls = opts.calls ?? []
  return {
    calls,
    execute: async (sql: string): Promise<{ rows: Row[] }> => {
      calls.push(sql.replace(/\s+/g, ' ').trim().slice(0, 80))
      // The office the health row is recorded under: a single-office deployment's only person office.
      if (sql.includes('sole_person_office')) {
        return { rows: [{ o: '22222222-2222-4222-8222-222222222222' }] }
      }
      if (sql.includes('calendar.sync_tasks')) {
        return { rows: [{ on: opts.on ?? true, target: opts.target ?? 'primary' }] }
      }
      if (sql.includes('calendar_task_plan')) {
        return { rows: [{ p: opts.plan ?? { create: [], update: [], remove: [] } }] }
      }
      // What `googleAccess` reads before it will exchange anything. Present and
      // plausible, because the interesting failures here are Google's answers
      // and the plan's contents, not a missing client id.
      if (sql.includes('google.client_id')) {
        return { rows: [{ client_id: 'cid', client_secret: 'secret', refresh_token: 'refresh' }] }
      }
      return { rows: [] }
    },
  } as unknown as Parameters<typeof syncTasksToCalendar>[0] & { calls: string[] }
}

/** Enough of Google to answer the token exchange and then whatever is asked. */
function fakeGoogle(handlers: {
  scopes?: string
  onGet?: (url: string) => Response
  onWrite?: (url: string, method: string) => Response
  seen?: { url: string; method: string }[]
}): typeof fetch {
  const seen = handlers.seen ?? []
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('oauth2.googleapis.com')) {
      return new Response(
        JSON.stringify({
          access_token: 'tok',
          expires_in: 3600,
          scope: handlers.scopes ?? 'https://www.googleapis.com/auth/calendar.events',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    seen.push({ url, method })
    if (method === 'GET' && handlers.onGet) return handlers.onGet(url)
    if (handlers.onWrite) return handlers.onWrite(url, method)
    return new Response(JSON.stringify({ id: 'ev1' }), { status: 200 })
  }) as unknown as typeof fetch
}

/** Whose diary: the plan is the office's own, so every sync names one. */
const OFFICE = '22222222-2222-4222-8222-222222222222'
const sync = (
  db: Parameters<typeof syncTasksToCalendar>[0],
  options?: Parameters<typeof syncTasksToCalendar>[2],
) => syncTasksToCalendar(db, { officeId: OFFICE }, options)

const TASK = '11111111-1111-1111-1111-111111111111'
const ROW = {
  task_id: TASK,
  title: 'Draft the pricing note',
  detail: 'with the numbers from Daniel',
  due_on: '2026-09-20',
  project: 'Legacy Coaching Course',
  hash: 'abc',
}

describe('syncTasksToCalendar', () => {
  it('asks for the plan of the office it was given and of no other', async () => {
    const queries: string[] = []
    const db = {
      execute: async (sql: string): Promise<{ rows: Row[] }> => {
        queries.push(sql)
        if (sql.includes('calendar.sync_tasks')) return { rows: [{ on: true, target: 'primary' }] }
        if (sql.includes('google.client_id'))
          return { rows: [{ client_id: 'cid', client_secret: 'secret', refresh_token: 'refresh' }] }
        if (sql.includes('calendar_task_plan'))
          return { rows: [{ p: { create: [], update: [], remove: [] } }] }
        return { rows: [] }
      },
    } as unknown as Parameters<typeof syncTasksToCalendar>[0]
    await sync(db, { fetchImpl: fakeGoogle({ seen: [] }) })
    const plan = queries.find((q) => q.includes('calendar_task_plan'))
    // The office is the FIRST argument of the plan query, as a value the caller named.
    expect(plan).toMatch(/calendar_task_plan\(\s*'22222222-2222-4222-8222-222222222222'::uuid\s*\)/)
  })

  it('does nothing at all while the switch is off', async () => {
    const seen: { url: string; method: string }[] = []
    const out = await sync(fakeDb({ on: false }), {
      fetchImpl: fakeGoogle({ seen }),
    })
    expect(out.ok).toBe(true)
    expect(out.note).toContain('switched off')
    // Not one call to Google. Off means off, not "off but let us just check".
    expect(seen).toHaveLength(0)
  })

  it('refuses to write with only the read scope, and says which scope is missing', async () => {
    const out = await sync(fakeDb({ plan: { create: [ROW], update: [], remove: [] } }), {
      fetchImpl: fakeGoogle({ scopes: 'https://www.googleapis.com/auth/calendar.readonly' }),
    })
    expect(out.ok).toBe(false)
    expect(out.note).toContain('no calendar write scope')
    expect(out.created).toBe(0)
  })

  it('creates an all-day event whose end date is the day AFTER the due date', async () => {
    const bodies: string[] = []
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input)
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(
          JSON.stringify({
            access_token: 't',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/calendar.events',
          }),
          { status: 200 },
        )
      }
      // The lookup by tag before a create (an empty diary), then the create itself.
      if ((init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ items: [] }), { status: 200 })
      }
      bodies.push(String(init?.body ?? ''))
      return new Response(JSON.stringify({ id: 'ev-new' }), { status: 200 })
    }) as unknown as typeof fetch

    const out = await sync(fakeDb({ plan: { create: [ROW], update: [], remove: [] } }), {
      fetchImpl,
    })
    expect(out.created).toBe(1)
    const sent = JSON.parse(bodies[0] ?? '{}') as {
      start: { date: string }
      end: { date: string }
      extendedProperties: { private: Record<string, string> }
      transparency: string
    }
    expect(sent.start.date).toBe('2026-09-20')
    // Google's all-day end is EXCLUSIVE. A one-day event that ends on its own
    // start date renders as zero-length and some clients hide it entirely.
    expect(sent.end.date).toBe('2026-09-21')
    // The tag, without which nothing downstream can recognise its own work.
    expect(sent.extendedProperties.private.hqTaskId).toBe(TASK)
    // A task must not make him look busy.
    expect(sent.transparency).toBe('transparent')
  })

  it('reads an event back before deleting it, and deletes it when the tag matches', async () => {
    const seen: { url: string; method: string }[] = []
    const out = await sync(
      fakeDb({
        plan: {
          create: [],
          update: [],
          remove: [{ task_id: TASK, calendar_id: 'primary', event_id: 'ev1' }],
        },
      }),
      {
        fetchImpl: fakeGoogle({
          seen,
          onGet: () =>
            new Response(JSON.stringify({ extendedProperties: { private: { hqTaskId: TASK } } }), {
              status: 200,
            }),
          onWrite: () => new Response(null, { status: 204 }),
        }),
      },
    )
    expect(out.removed).toBe(1)
    expect(seen.map((s) => s.method)).toEqual(['GET', 'DELETE'])
  })

  it('REFUSES to delete an event that does not carry our task id', async () => {
    const seen: { url: string; method: string }[] = []
    const out = await sync(
      fakeDb({
        plan: {
          create: [],
          update: [],
          remove: [{ task_id: TASK, calendar_id: 'primary', event_id: 'ev1' }],
        },
      }),
      {
        fetchImpl: fakeGoogle({
          seen,
          // Somebody else's meeting, sitting on an id our link table believes
          // is ours. This is the scenario the whole design exists for.
          onGet: () => new Response(JSON.stringify({ summary: 'Dentist' }), { status: 200 }),
          onWrite: () => new Response(null, { status: 204 }),
        }),
      },
    )
    expect(out.removed).toBe(0)
    expect(out.ok).toBe(false)
    expect(out.note).toContain('not ours')
    // The only call made was the read. Nothing was deleted.
    expect(seen.map((s) => s.method)).toEqual(['GET'])
  })

  it('keeps the link when a delete fails, so the next pass tries again', async () => {
    const calls: string[] = []
    const out = await sync(
      fakeDb({
        calls,
        plan: {
          create: [],
          update: [],
          remove: [{ task_id: TASK, calendar_id: 'primary', event_id: 'ev1' }],
        },
      }),
      {
        fetchImpl: fakeGoogle({
          onGet: () =>
            new Response(JSON.stringify({ extendedProperties: { private: { hqTaskId: TASK } } }), {
              status: 200,
            }),
          onWrite: () => new Response('nope', { status: 500 }),
        }),
      },
    )
    expect(out.removed).toBe(0)
    // Forgetting the link here would leave the event in his diary for ever
    // with nothing pointing at it.
    expect(calls.some((c) => c.includes('calendar_link_clear'))).toBe(false)
  })

  it('clears the link when the event is already gone at the far end', async () => {
    const calls: string[] = []
    const out = await sync(
      fakeDb({
        calls,
        plan: {
          create: [],
          update: [],
          remove: [{ task_id: TASK, calendar_id: 'primary', event_id: 'ev1' }],
        },
      }),
      { fetchImpl: fakeGoogle({ onGet: () => new Response('', { status: 404 }) }) },
    )
    expect(out.removed).toBe(1)
    expect(calls.some((c) => c.includes('calendar_link_clear'))).toBe(true)
  })

  it('a dry run reports the plan and calls nothing', async () => {
    const seen: { url: string; method: string }[] = []
    const out = await sync(fakeDb({ plan: { create: [ROW], update: [], remove: [] } }), {
      fetchImpl: fakeGoogle({ seen }),
      dryRun: true,
    })
    expect(out.note).toContain('dry run')
    expect(out.created).toBe(1)
    expect(seen).toHaveLength(0)
  })
})

describe('a create after a crash between Google and the link (invariant 27)', () => {
  it('adopts the event the diary already holds for the task, and posts nothing', async () => {
    const seen: { url: string; method: string }[] = []
    const db = fakeDb({ plan: { create: [ROW], update: [], remove: [] } })
    const out = await sync(db, {
      fetchImpl: fakeGoogle({
        seen,
        onGet: () => new Response(JSON.stringify({ items: [{ id: 'orphan-1' }] }), { status: 200 }),
      }),
    })
    expect(seen.filter((c) => c.method === 'POST')).toHaveLength(0)
    expect(seen[0]?.url).toContain(`privateExtendedProperty=hqTaskId%3D${TASK}`)
    expect(db.calls.some((c) => c.includes('calendar_link_set'))).toBe(true)
    expect(out.created).toBe(1)
  })

  it('CONTROL: an empty diary still gets exactly one create', async () => {
    const seen: { url: string; method: string }[] = []
    const out = await sync(fakeDb({ plan: { create: [ROW], update: [], remove: [] } }), {
      fetchImpl: fakeGoogle({
        seen,
        onGet: () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
      }),
    })
    expect(seen.filter((c) => c.method === 'POST')).toHaveLength(1)
    expect(out.created).toBe(1)
  })

  it('a lookup that fails is not proof of an empty diary: nothing is posted, and the pass says so', async () => {
    const seen: { url: string; method: string }[] = []
    const out = await sync(fakeDb({ plan: { create: [ROW], update: [], remove: [] } }), {
      fetchImpl: fakeGoogle({ seen, onGet: () => new Response('', { status: 503 }) }),
    })
    expect(seen.filter((c) => c.method === 'POST')).toHaveLength(0)
    expect(out.created).toBe(0)
    expect(out.note).toMatch(/could not check the diary/)
  })
})

/**
 * The gateway's Microsoft To Do reader (supabase/functions/hq-api/microsoft-todo.ts), against a stubbed network.
 *
 * What is proved here: the list read, the connection test's steps in order, that a task made by the test is always
 * deleted even when reading it back fails, and that a rotated refresh token is stored before it is used.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type MicrosoftContext,
  microsoftLists,
  microsoftTest,
} from '../../supabase/functions/hq-api/microsoft-todo.ts'

const LIST = 'AAMk-list-team-hq'
const TITLE = 'Team HQ connection test (safe to delete)'

interface Hit {
  method: string
  url: string
  body: string | null
}

/** A stub for the network: answers the token endpoint, Graph, and records every call. */
function network(
  routes: Record<string, (h: Hit) => { status: number; json?: unknown }>,
  token?: () => Response,
) {
  const hits: Hit[] = []
  const stub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const hit: Hit = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? init.body : null,
    }
    hits.push(hit)
    if (url.startsWith('https://login.microsoftonline.com/')) {
      return token !== undefined
        ? token()
        : new Response(JSON.stringify({ access_token: 'access-1', refresh_token: 'refresh-2' }), {
            status: 200,
          })
    }
    const path = new URL(url).pathname.replace('/v1.0', '')
    const key = `${hit.method} ${path}`
    const route = routes[key]
    if (route === undefined) return new Response(`no route ${key}`, { status: 599 })
    const r = route(hit)
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status })
  })
  vi.stubGlobal('fetch', stub)
  return hits
}

function ctx(rotated: string[] = []): MicrosoftContext {
  return {
    office: 'office-1',
    held: async (name) =>
      name === 'microsoft.client_secret'
        ? 'secret-value'
        : name === 'microsoft_todo.refresh_token'
          ? 'refresh-1'
          : '',
    rpc: async (fn, args) => {
      if (fn === 'microsoft_oauth_config') return { client_id: 'client-guid' }
      if (fn === 'microsoft_todo_store_rotation') rotated.push(String(args.p_refresh_token))
      return null
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the list read', () => {
  it('lists the account lists and marks Microsoft default one', async () => {
    network({
      'GET /me/todo/lists': () => ({
        status: 200,
        json: {
          value: [
            { id: 'L-default', displayName: 'Tasks', wellknownListName: 'defaultList' },
            { id: LIST, displayName: 'Team HQ', wellknownListName: 'none' },
          ],
        },
      }),
    })
    const got = await microsoftLists(ctx())
    expect(got).toEqual({
      ok: true,
      value: [
        { id: 'L-default', name: 'Tasks', default: true },
        { id: LIST, name: 'Team HQ', default: false },
      ],
    })
  })

  it('says a withdrawn connection plainly, and does not echo any token', async () => {
    network({}, () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
    const got = await microsoftLists(ctx())
    expect(got.ok).toBe(false)
    expect(JSON.stringify(got)).not.toMatch(/secret-value|refresh-1|access-1/)
  })

  it('stores a rotated refresh token before using the new access token', async () => {
    const rotated: string[] = []
    network({ 'GET /me/todo/lists': () => ({ status: 200, json: { value: [] } }) })
    await microsoftLists(ctx(rotated))
    expect(rotated).toEqual(['refresh-2'])
  })
})

describe('the connection test', () => {
  it('passes every step in order and reports each one', async () => {
    let read = 0
    network({
      'GET /me/todo/lists': () => ({
        status: 200,
        json: { value: [{ id: LIST, displayName: 'Team HQ' }] },
      }),
      [`POST /me/todo/lists/${LIST}/tasks`]: () => ({ status: 201, json: { id: 'T-1' } }),
      // The task is there when it is read back, and gone when it is looked for again.
      [`GET /me/todo/lists/${LIST}/tasks/T-1`]: () => {
        read += 1
        return read === 1 ? { status: 200, json: { id: 'T-1', title: TITLE } } : { status: 404 }
      },
      [`DELETE /me/todo/lists/${LIST}/tasks/T-1`]: () => ({ status: 204 }),
    })
    const got = await microsoftTest(ctx(), LIST)
    expect(got.ok).toBe(true)
    expect(got.steps.map((s) => s.step)).toEqual([
      'connection',
      'list',
      'create',
      'read back',
      'delete',
      'gone',
    ])
    expect(got.steps.every((s) => s.ok)).toBe(true)
  })

  it('refuses a list the account does not hold, and makes no task', async () => {
    const hits = network({ 'GET /me/todo/lists': () => ({ status: 200, json: { value: [] } }) })
    const got = await microsoftTest(ctx(), LIST)
    expect(got.ok).toBe(false)
    expect(got.steps.at(-1)?.step).toBe('list')
    expect(hits.some((h) => h.method === 'POST' && h.url.includes('graph.microsoft.com'))).toBe(
      false,
    )
  })

  it('deletes the test task even when reading it back fails', async () => {
    network({
      'GET /me/todo/lists': () => ({
        status: 200,
        json: { value: [{ id: LIST, displayName: 'Team HQ' }] },
      }),
      [`POST /me/todo/lists/${LIST}/tasks`]: () => ({ status: 201, json: { id: 'T-2' } }),
      [`GET /me/todo/lists/${LIST}/tasks/T-2`]: () => ({ status: 500 }),
      [`DELETE /me/todo/lists/${LIST}/tasks/T-2`]: () => ({ status: 204 }),
    })
    const got = await microsoftTest(ctx(), LIST)
    expect(got.ok).toBe(false)
    const read = got.steps.find((s) => s.step === 'read back')
    expect(read?.ok).toBe(false)
    expect(got.steps.find((s) => s.step === 'delete')?.ok).toBe(true)
  })
})

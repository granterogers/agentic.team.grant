/**
 * The Microsoft To Do provider, against a fake Graph (no network).
 *
 * The fake answers the token endpoint and the To Do routes the provider uses, and records every request, so each test
 * can say what the provider sent as well as what it read back.
 */
import { describe, expect, it } from 'vitest'
import {
  dueIn,
  dueOut,
  importanceIn,
  importanceOut,
  MicrosoftTodoProvider,
  markerOf,
  plainText,
  withMark,
} from '../../src/tasks/microsoft-todo.ts'
import { ProviderAuthError, ProviderDownError } from '../../src/tasks/provider.ts'

const ID = '7f0c2d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'
const LIST = 'AAMk-list-1'

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}

/** A fake Graph. `routes` answers by "METHOD path" (the path without the host and without the query). */
function fakeGraph(
  routes: Record<string, (c: Call) => { status: number; json?: unknown }>,
  tokenReply: () => { status: number; json: unknown } = () => ({
    status: 200,
    json: { access_token: 'access-1', refresh_token: 'refresh-2', expires_in: 3600 },
  }),
) {
  const calls: Call[] = []
  const transport = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input)
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    ) as Record<string, string>
    const call: Call = {
      method: init?.method ?? 'GET',
      url,
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    }
    calls.push(call)
    if (url.startsWith('https://login.microsoftonline.com/')) {
      const r = tokenReply()
      return new Response(JSON.stringify(r.json), { status: r.status })
    }
    const path = new URL(url).pathname
    const key = `${call.method} ${path}`
    const route = routes[key]
    if (route === undefined) return new Response(`no route ${key}`, { status: 599 })
    const r = route(call)
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), {
      status: r.status,
    })
  }
  return { calls, fetch: transport as unknown as typeof fetch }
}

const provider = (http: typeof fetch, listId = LIST, rotated: string[] = []) =>
  new MicrosoftTodoProvider({
    clientId: 'client-guid',
    clientSecret: 'secret-value',
    refreshToken: 'refresh-1',
    listId,
    onRefreshTokenRotated: async (t) => {
      rotated.push(t)
    },
    fetch: http,
  })

describe('importance, due date and body mapping', () => {
  it('maps the four canonical levels onto three Microsoft levels, and back to the nearest level', () => {
    expect(importanceOut(10)).toBe('high')
    expect(importanceOut(20)).toBe('high')
    expect(importanceOut(50)).toBe('normal')
    expect(importanceOut(100)).toBe('low')
    expect(importanceOut(null)).toBe('normal')
    expect(importanceIn('high')).toBe(20)
    expect(importanceIn('normal')).toBe(50)
    expect(importanceIn('low')).toBe(100)
    expect(importanceIn(undefined)).toBe(50)
  })

  it('writes midnight UTC and reads back the date part, and treats no date as no date', () => {
    expect(dueOut('2026-10-25')).toEqual({
      dateTime: '2026-10-25T00:00:00.0000000',
      timeZone: 'UTC',
    })
    expect(dueOut(null)).toBeNull()
    expect(dueIn({ dateTime: '2026-10-25T00:00:00.0000000', timeZone: 'UTC' })).toBe('2026-10-25')
    expect(dueIn(null)).toBeNull()
    expect(dueIn({})).toBeNull()
  })

  it('takes the office mark off a body and reads it back, and leaves what a person wrote', () => {
    const marked = withMark('Call the bank', ID.toUpperCase())
    expect(markerOf(marked)).toBe(ID)
    expect(plainText(marked)).toBe('Call the bank')
    expect(plainText('stock < 5 and price > 3')).toBe('stock < 5 and price > 3')
  })
})

describe('the token exchange', () => {
  it('exchanges the refresh token once per round and sends the scope', async () => {
    const g = fakeGraph({
      'GET /v1.0/me/todo/lists/AAMk-list-1/tasks': () => ({ status: 200, json: { value: [] } }),
    })
    await provider(g.fetch).list()
    await provider(g.fetch).list()
    const tokenCalls = g.calls.filter((c) => c.url.startsWith('https://login.microsoftonline.com/'))
    expect(tokenCalls).toHaveLength(2)
    const sent = new URLSearchParams(tokenCalls[0]?.body ?? '')
    expect(sent.get('grant_type')).toBe('refresh_token')
    expect(sent.get('scope')).toBe('Tasks.ReadWrite offline_access')
  })

  it('hands a rotated refresh token to the caller, so it can be stored', async () => {
    const rotated: string[] = []
    const g = fakeGraph({
      'GET /v1.0/me/todo/lists/AAMk-list-1/tasks': () => ({ status: 200, json: { value: [] } }),
    })
    await provider(g.fetch, LIST, rotated).list()
    expect(rotated).toEqual(['refresh-2'])
  })

  it('reads a refused grant as a refused connection, not an outage', async () => {
    const g = fakeGraph({}, () => ({ status: 400, json: { error: 'invalid_grant' } }))
    await expect(provider(g.fetch).list()).rejects.toBeInstanceOf(ProviderAuthError)
  })

  it('reads a server problem at the token endpoint as an outage', async () => {
    const g = fakeGraph({}, () => ({ status: 503, json: {} }))
    await expect(provider(g.fetch).list()).rejects.toBeInstanceOf(ProviderDownError)
  })
})

describe('the To Do routes', () => {
  it('lists every task of the list, following the next link, with plain-text bodies requested', async () => {
    let page = 0
    const g = fakeGraph({
      'GET /v1.0/me/todo/lists/AAMk-list-1/tasks': () => {
        page += 1
        if (page === 1) {
          return {
            status: 200,
            json: {
              value: [{ id: 'a', title: 'One', status: 'notStarted', importance: 'high' }],
              '@odata.nextLink':
                'https://graph.microsoft.com/v1.0/me/todo/lists/AAMk-list-1/tasks?$skip=1',
            },
          }
        }
        return {
          status: 200,
          json: {
            value: [
              {
                id: 'b',
                title: 'Two',
                status: 'completed',
                importance: 'low',
                body: { content: `done\n\n[agentic:${ID}]` },
                dueDateTime: { dateTime: '2026-10-25T00:00:00.0000000', timeZone: 'UTC' },
                lastModifiedDateTime: '2026-10-22T09:00:00Z',
              },
            ],
          },
        }
      },
    })
    const out = await provider(g.fetch).list()
    expect(out.map((t) => t.externalId)).toEqual(['a', 'b'])
    expect(out[1]).toMatchObject({
      title: 'Two',
      detail: 'done',
      done: true,
      priority: 100,
      dueOn: '2026-10-25',
      canonicalId: ID,
      externalRevision: '2026-10-22T09:00:00Z',
    })
    const taskCall = g.calls.find((c) => c.url.includes('/tasks'))
    expect(taskCall?.headers.Prefer).toBe('outlook.body-content-type="text"')
    expect(taskCall?.headers.Authorization).toBe('Bearer access-1')
  })

  it('creates a task with its mark, status and importance, when nothing is linked', async () => {
    const g = fakeGraph({
      'GET /v1.0/me/todo/lists/AAMk-list-1/tasks': () => ({ status: 200, json: { value: [] } }),
      'POST /v1.0/me/todo/lists/AAMk-list-1/tasks': () => ({
        status: 201,
        json: { id: 'new-1', lastModifiedDateTime: '2026-10-22T10:00:00Z' },
      }),
    })
    const got = await provider(g.fetch).upsert({
      id: ID,
      revision: 1,
      title: 'Pay the invoice',
      detail: 'Net 30',
      done: false,
      priority: 10,
      dueOn: '2026-10-30',
      externalId: null,
      externalProjectId: null,
    })
    expect(got).toEqual({
      externalId: 'new-1',
      externalRevision: '2026-10-22T10:00:00Z',
      externalProjectId: LIST,
    })
    const post = g.calls.find((c) => c.method === 'POST' && c.url.includes('/me/todo/'))
    const sent = JSON.parse(post?.body ?? '{}') as Record<string, unknown>
    expect(sent).toMatchObject({
      title: 'Pay the invoice',
      status: 'notStarted',
      importance: 'high',
      dueDateTime: { dateTime: '2026-10-30T00:00:00.0000000', timeZone: 'UTC' },
      body: { contentType: 'text', content: `Net 30\n\n[agentic:${ID}]` },
    })
  })

  it('adopts a task that already carries its mark instead of creating a second one', async () => {
    const g = fakeGraph({
      'GET /v1.0/me/todo/lists/AAMk-list-1/tasks': () => ({
        status: 200,
        json: { value: [{ id: 'found-1', body: { content: `x\n\n[agentic:${ID}]` } }] },
      }),
      'PATCH /v1.0/me/todo/lists/AAMk-list-1/tasks/found-1': () => ({
        status: 200,
        json: { id: 'found-1', lastModifiedDateTime: '2026-10-22T11:00:00Z' },
      }),
    })
    const got = await provider(g.fetch).upsert({
      id: ID,
      revision: 2,
      title: 'Again',
      detail: '',
      done: true,
      priority: 50,
      dueOn: null,
      externalId: null,
      externalProjectId: null,
    })
    expect(got.externalId).toBe('found-1')
    expect(g.calls.some((c) => c.method === 'POST' && c.url.includes('/me/todo/'))).toBe(false)
    expect(g.calls.some((c) => c.method === 'PATCH' && c.url.includes('/me/todo/'))).toBe(true)
  })

  it('treats a task already gone as removed, and an outage as an outage', async () => {
    const gone = fakeGraph({
      'DELETE /v1.0/me/todo/lists/AAMk-list-1/tasks/x': () => ({ status: 404 }),
    })
    await expect(provider(gone.fetch).remove('x')).resolves.toBeUndefined()

    const down = fakeGraph({
      'DELETE /v1.0/me/todo/lists/AAMk-list-1/tasks/x': () => ({ status: 503 }),
    })
    await expect(provider(down.fetch).remove('x')).rejects.toBeInstanceOf(ProviderDownError)
  })

  it('refuses a token Graph will not accept as an auth error, never as an outage', async () => {
    const g = fakeGraph({
      'GET /v1.0/me/todo/lists/AAMk-list-1/tasks': () => ({ status: 401 }),
    })
    await expect(provider(g.fetch).list()).rejects.toBeInstanceOf(ProviderAuthError)
  })

  it('never puts the client secret or the refresh token in an error message', async () => {
    const g = fakeGraph({
      'GET /v1.0/me/todo/lists/AAMk-list-1/tasks': () => ({ status: 400 }),
    })
    const error = await provider(g.fetch)
      .list()
      .catch((e: Error) => e)
    expect(String((error as Error).message)).not.toMatch(/secret-value|refresh-1|access-1/)
  })

  it('finds the default list by its well-known name and remembers its id', async () => {
    const g = fakeGraph({
      'GET /v1.0/me/todo/lists': () => ({
        status: 200,
        json: {
          value: [
            { id: 'L-other', displayName: 'Shopping', wellknownListName: 'none' },
            { id: 'L-default', displayName: 'Tasks', wellknownListName: 'defaultList' },
          ],
        },
      }),
    })
    const p = provider(g.fetch, '')
    expect(await p.defaultList()).toEqual({ id: 'L-default', name: 'Tasks' })
  })
})

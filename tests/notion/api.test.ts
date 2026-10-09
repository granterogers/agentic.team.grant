import { describe, expect, it, vi } from 'vitest'
import { classify, NOTION_VERSION, NotionApiError, NotionClient } from '../../src/notion/api.ts'

const respond = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers })

describe('classify', () => {
  it.each([
    [401, 'unauthorized', 'auth'],
    [429, 'rate_limited', 'transient'],
    [500, 'internal_server_error', 'transient'],
    [502, 'bad_gateway', 'transient'],
    [400, 'validation_error', 'terminal'],
    // Both of these mean "not shared with this integration". Terminal, because
    // the fix is a human sharing a page and no amount of retrying is one.
    [404, 'object_not_found', 'terminal'],
    [403, 'restricted_resource', 'terminal'],
  ])('%s %s is %s', (status, code, kind) => {
    expect(classify(status, code)).toBe(kind)
  })
})

describe('NotionClient', () => {
  it('refuses to be built without a token', () => {
    expect(() => new NotionClient('')).toThrow('a Notion integration token is required')
  })

  it('pins the API version on every request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(200, { ok: true }))
    await new NotionClient('ntn_x', { fetchImpl }).call('/users/me')
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['Notion-Version']).toBe(NOTION_VERSION)
    expect(headers.Authorization).toBe('Bearer ntn_x')
  })

  it('waits out a 429 for as long as Notion asks, then succeeds', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(429, { code: 'rate_limited' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(respond(200, { results: [] }))
    await new NotionClient('ntn_x', { fetchImpl, sleep }).call('/search', {
      method: 'POST',
      body: {},
    })
    expect(sleep).toHaveBeenCalledWith(2_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('clamps a hostile Retry-After rather than parking the process', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(429, { code: 'rate_limited' }, { 'retry-after': '86400' }))
      .mockResolvedValueOnce(respond(200, {}))
    await new NotionClient('ntn_x', {
      fetchImpl,
      sleep,
      maxRetryAfterSeconds: 30,
      callDeadlineMs: 120_000,
    }).call('/x')
    expect(sleep).toHaveBeenCalledWith(30_000)
  })

  it('gives up after the retry budget instead of waiting forever', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    // A fresh Response per call: a Response body can only be read once, and
    // reusing one makes the third attempt fail with a TypeError that looks
    // like a client bug.
    const fetchImpl = vi.fn().mockImplementation(() => respond(429, { code: 'rate_limited' }))
    await expect(
      new NotionClient('ntn_x', { fetchImpl, sleep, maxRateLimitRetries: 2 }).call('/x'),
    ).rejects.toBeInstanceOf(NotionApiError)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('does not retry a terminal failure', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi.fn().mockResolvedValue(respond(404, { code: 'object_not_found' }))
    await expect(new NotionClient('ntn_x', { fetchImpl, sleep }).call('/x')).rejects.toMatchObject({
      code: 'object_not_found',
      kind: 'terminal',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('follows every page of a cursor, not just the first', async () => {
    // The failure this pins: a client that reads one page returns a plausible,
    // wrong answer — the commonest way an integration silently syncs a subset.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        respond(200, { results: [{ id: 'a' }], has_more: true, next_cursor: 'c1' }),
      )
      .mockResolvedValueOnce(
        respond(200, { results: [{ id: 'b' }], has_more: false, next_cursor: null }),
      )
    const seen: string[] = []
    for await (const row of new NotionClient('ntn_x', { fetchImpl }).paginate('/search')) {
      seen.push(String(row.id))
    }
    expect(seen).toEqual(['a', 'b'])
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).start_cursor).toBe('c1')
  })

  it('stops when has_more is true but no cursor came back', async () => {
    // Notion should never do this. If it does, the alternative to stopping is
    // an infinite loop re-requesting page one.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        respond(200, { results: [{ id: 'a' }], has_more: true, next_cursor: null }),
      )
    const seen: string[] = []
    for await (const row of new NotionClient('ntn_x', { fetchImpl }).paginate('/search')) {
      seen.push(String(row.id))
    }
    expect(seen).toEqual(['a'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('never puts the token anywhere but the Authorization header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(400, { code: 'validation_error' }))
    const error = await new NotionClient('ntn_supersecret', { fetchImpl })
      .call('/x')
      .catch((e: unknown) => e as Error)
    expect(error.message).not.toContain('ntn_supersecret')
    expect(JSON.stringify(error)).not.toContain('ntn_supersecret')
  })
})

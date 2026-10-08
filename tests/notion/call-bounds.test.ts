/*
  The most time ONE Notion call can take, proved against the numbers the host imposes.

  The edge worker stops starting jobs 60 s into its pass and is killed at 150 s, so a sync that starts at the last moment has
  90 s, and what it spends on a single request is part of that. Before this the worst case of one call was
  (retries + 1) x request timeout + retries x Retry-After clamp = 4 x 20 + 3 x 30 = 170 s, which is longer than the host
  lets any one request live. Each case below states the bound and goes red if the guard that gives it is removed.
*/
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CALL_DEADLINE_MS,
  MAX_PAGES_PER_LIST,
  NotionApiError,
  NotionClient,
} from '../../src/notion/api.ts'

const respond = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers })

afterEach(() => {
  vi.useRealTimers()
})

const settle = async <T>(p: Promise<T>): Promise<{ done: boolean; value?: T; error?: unknown }> => {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false }
  p.then(
    (v) => {
      state.value = v
      state.done = true
    },
    (e: unknown) => {
      state.error = e
      state.done = true
    },
  )
  return state
}

describe('one call is bounded as a whole', () => {
  it('the documented numbers: 4 x 20 s + 3 x 30 s was the old worst case, and the ceiling is far below it', () => {
    const OLD_WORST_CASE_MS = 4 * 20_000 + 3 * 30_000
    expect(OLD_WORST_CASE_MS).toBe(170_000)
    expect(DEFAULT_CALL_DEADLINE_MS).toBeLessThanOrEqual(20_000)
    // 90 s is what a job started at the 60 s deadline has before the 150 s wall clock.
    expect(DEFAULT_CALL_DEADLINE_MS).toBeLessThan(90_000 / 4)
  })

  it('a Notion that never answers costs exactly the call deadline, not requests x timeout', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined))
    const client = new NotionClient('ntn_x', { fetchImpl: fetchImpl as never })
    const state = await settle(client.call('/x'))
    await vi.advanceTimersByTimeAsync(DEFAULT_CALL_DEADLINE_MS - 1_000)
    expect(state.done, 'still waiting just before the deadline').toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(state.done, 'HUNG past the call deadline').toBe(true)
    expect((state.error as NotionApiError).code).toBe('timeout')
    expect((state.error as NotionApiError).kind).toBe('transient')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a 429 followed by a hang cannot stretch the call: the attempt gets only what the wait left', async () => {
    vi.useFakeTimers()
    let calls = 0
    const fetchImpl = vi.fn(() => {
      calls += 1
      return calls === 1
        ? Promise.resolve(respond(429, { code: 'rate_limited' }, { 'retry-after': '8' }))
        : new Promise<Response>(() => undefined)
    })
    const client = new NotionClient('ntn_x', { fetchImpl: fetchImpl as never })
    const state = await settle(client.call('/x'))
    await vi.advanceTimersByTimeAsync(DEFAULT_CALL_DEADLINE_MS - 500)
    expect(state.done).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(
      state.done,
      'the second attempt was given a full request timeout on top of the wait',
    ).toBe(true)
    expect((state.error as NotionApiError).code).toBe('timeout')
    expect(calls).toBe(2)
  })

  it.each([
    ['1', 1],
    ['5', 5],
    ['10', 10],
    ['30', 30],
    ['86400', 86400],
    ['not a number', 1],
  ])(
    'repeated 429 with Retry-After %s finishes inside the deadline plus one attempt',
    async (header) => {
      // The clock is moved by the fake transport and the fake sleep, so the arithmetic is exact and nothing waits.
      let now = 0
      const ATTEMPT_MS = 3_000
      const fetchImpl = vi.fn(async () => {
        now += ATTEMPT_MS
        return respond(429, { code: 'rate_limited' }, { 'retry-after': header })
      })
      const sleep = vi.fn(async (ms: number) => {
        now += ms
      })
      const client = new NotionClient('ntn_x', {
        fetchImpl: fetchImpl as never,
        sleep,
        clock: () => now,
        maxRateLimitRetries: 50,
      })
      const error = await client.call('/x').then(
        () => null,
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(NotionApiError)
      expect((error as NotionApiError).status).toBe(429)
      expect((error as NotionApiError).kind).toBe('transient')
      // Waits plus attempts never exceed the ceiling by more than the last attempt's own time (which a real timer caps).
      expect(now).toBeLessThanOrEqual(DEFAULT_CALL_DEADLINE_MS + ATTEMPT_MS)
      // Every wait obeyed the clamp, so a hostile header never controlled the process.
      for (const [ms] of sleep.mock.calls) expect(ms).toBeLessThanOrEqual(10_000)
    },
  )

  it('a Retry-After that cannot fit before the deadline is not waited out at all', async () => {
    let now = 0
    const sleep = vi.fn(async (ms: number) => {
      now += ms
    })
    const fetchImpl = vi.fn(async () =>
      respond(429, { code: 'rate_limited' }, { 'retry-after': '25' }),
    )
    const client = new NotionClient('ntn_x', {
      fetchImpl: fetchImpl as never,
      sleep,
      clock: () => now,
      maxRetryAfterSeconds: 25,
    })
    await expect(client.call('/x')).rejects.toMatchObject({ status: 429, retryAfter: 25 })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('a socket-level failure is a transient Notion error, not a bare TypeError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const error = await new NotionClient('ntn_x', { fetchImpl: fetchImpl as never })
      .call('/x')
      .then(
        () => null,
        (e: unknown) => e,
      )
    expect(error).toBeInstanceOf(NotionApiError)
    expect((error as NotionApiError).kind).toBe('transient')
    expect((error as NotionApiError).code).toBe('network_error')
  })
})

describe('a listing cannot run for ever', () => {
  it('a cursor handed back unchanged is a loop and is refused', async () => {
    const fetchImpl = vi.fn(async () =>
      respond(200, { results: [{ id: 'a' }], has_more: true, next_cursor: 'same' }),
    )
    const client = new NotionClient('ntn_x', { fetchImpl: fetchImpl as never })
    const seen: unknown[] = []
    await expect(
      (async () => {
        for await (const r of client.paginate('/search', {})) seen.push(r)
      })(),
    ).rejects.toMatchObject({ code: 'malformed_response', kind: 'transient' })
    // first page, then the page that repeated the cursor: two requests, not thousands
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('a cursor that keeps changing stops at the page ceiling', async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => {
      n += 1
      return respond(200, { results: [], has_more: true, next_cursor: `c${String(n)}` })
    })
    const client = new NotionClient('ntn_x', { fetchImpl: fetchImpl as never })
    await expect(
      (async () => {
        for await (const _ of client.paginate('/search', {})) void _
      })(),
    ).rejects.toMatchObject({ code: 'malformed_response' })
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PAGES_PER_LIST)
  })

  it('the guard runs before EVERY request and ending the listing from it stops the requests', async () => {
    let n = 0
    const fetchImpl = vi.fn(async () => {
      n += 1
      return respond(200, {
        results: [{ id: String(n) }],
        has_more: true,
        next_cursor: `c${String(n)}`,
      })
    })
    const client = new NotionClient('ntn_x', { fetchImpl: fetchImpl as never })
    let asked = 0
    const got: unknown[] = []
    await expect(
      (async () => {
        for await (const r of client.paginate('/search', {}, 'POST', () => {
          asked += 1
          if (asked > 3) throw new Error('budget')
        }))
          got.push(r)
      })(),
    ).rejects.toThrow('budget')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(got).toHaveLength(3)
  })

  it('a GET cursor is URL-encoded, so a cursor with reserved characters is followed intact', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input))
      return urls.length === 1
        ? respond(200, { results: [], has_more: true, next_cursor: 'a+b/c=d&e' })
        : respond(200, { results: [], has_more: false })
    })
    const client = new NotionClient('ntn_x', { fetchImpl: fetchImpl as never })
    for await (const _ of client.paginate('/blocks/b/children', {}, 'GET')) void _
    expect(urls[1]).toContain('start_cursor=a%2Bb%2Fc%3Dd%26e')
  })
})

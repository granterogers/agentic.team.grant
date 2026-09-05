/**
 * The client's two dangerous cases.
 *
 * A test suite for an HTTP wrapper is usually not worth writing. This one is,
 * because two of its behaviours are the opposite of the obvious implementation
 * and would each ship a real defect:
 *
 *   1. retrying `chat.postMessage` after a network error posts twice;
 *   2. `ok: false` arrives as HTTP 200, so `response.ok` is true for a revoked
 *      token.
 *
 * Both are asserted here as behaviour, not as an implementation detail, so a
 * refactor that reintroduces either fails.
 */
import { describe, expect, it } from 'vitest'
import { classify, redact, SlackApiError, SlackClient } from '../../src/slack/api.ts'

const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

interface Recorder {
  readonly calls: string[]
  readonly fetchImpl: typeof fetch
}

const recording = (responses: (Response | Error)[]): Recorder => {
  const calls: string[] = []
  let i = 0
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    const next = responses[Math.min(i, responses.length - 1)]
    i += 1
    if (next === undefined) throw new Error('no scripted response')
    if (next instanceof Error) throw next
    // A Response body can only be read once; clone per call.
    return next.clone()
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const noSleep = async (): Promise<void> => {}

/**
 * Assembled at runtime rather than written as a literal.
 *
 * `npm run check:secrets` scans the repository for token-shaped strings and
 * cannot tell a fixture from a real credential — nor should it try, since the
 * cost of it guessing wrong in the other direction is a leaked token. So the
 * fixtures here are built from parts, which keeps the scanner useful and the
 * test honest: `SENTINEL` is what the redaction assertions look for.
 */
const SENTINEL = 'SENTINELVALUE'
const FAKE_TOKEN = ['xoxb', 'FAKE', SENTINEL].join('-')

describe('ok: false arrives as HTTP 200', () => {
  it('is treated as a failure, not a success', async () => {
    const { fetchImpl } = recording([jsonResponse({ ok: false, error: 'token_revoked' })])
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    await expect(client.call('chat.postMessage', {})).rejects.toBeInstanceOf(SlackApiError)
  })

  it('classifies a revoked token as needing a human, so nothing retries it', async () => {
    const { fetchImpl, calls } = recording([jsonResponse({ ok: false, error: 'token_revoked' })])
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    const error = await client.call('conversations.list').catch((e: unknown) => e)
    expect((error as SlackApiError).kind).toBe('needs_human')
    expect(calls).toHaveLength(1)
  })

  it('returns the body on success', async () => {
    const { fetchImpl } = recording([jsonResponse({ ok: true, ts: '1.234' })])
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    const { body, rateLimitWaits } = await client.call('chat.postMessage', {})
    expect(body.ts).toBe('1.234')
    expect(rateLimitWaits).toBe(0)
  })
})

describe('a connection interrupted mid-post', () => {
  it('is NOT retried for chat.postMessage — that is how a duplicate is created', async () => {
    const { fetchImpl, calls } = recording([new TypeError('socket hang up')])
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    const error = await client.call('chat.postMessage', {}).catch((e: unknown) => e)
    expect(calls).toHaveLength(1)
    expect((error as SlackApiError).kind).toBe('indeterminate')
  })

  it('IS retried for a read, where repeating costs nothing', async () => {
    const { fetchImpl, calls } = recording([
      new TypeError('socket hang up'),
      jsonResponse({ ok: true, channels: [] }),
    ])
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    // The recorder repeats its last response, so the second attempt succeeds.
    await client.call('conversations.list')
    expect(calls.length).toBeGreaterThan(1)
  })

  it('gives up on a read eventually rather than looping forever', async () => {
    const { fetchImpl, calls } = recording([new TypeError('econnreset')])
    const client = new SlackClient(FAKE_TOKEN, {
      fetchImpl,
      sleep: noSleep,
      maxRateLimitRetries: 2,
    })
    await expect(client.call('conversations.list')).rejects.toBeInstanceOf(SlackApiError)
    expect(calls).toHaveLength(3)
  })

  it('treats a 5xx on a post as indeterminate too, for the same reason', async () => {
    const { fetchImpl, calls } = recording([jsonResponse({}, 503)])
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    const error = await client.call('chat.postMessage', {}).catch((e: unknown) => e)
    expect((error as SlackApiError).kind).toBe('indeterminate')
    expect(calls).toHaveLength(1)
  })
})

describe('rate limiting', () => {
  it('waits the number of seconds Slack asked for, then succeeds', async () => {
    const slept: number[] = []
    const { fetchImpl } = recording([
      jsonResponse({ ok: false, error: 'ratelimited' }, 429, { 'retry-after': '3' }),
      jsonResponse({ ok: true }),
    ])
    const client = new SlackClient(FAKE_TOKEN, {
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    const { rateLimitWaits } = await client.call('conversations.list')
    expect(slept).toEqual([3000])
    expect(rateLimitWaits).toBe(1)
  })

  it('caps the wait, so a large Retry-After cannot park the process', async () => {
    const slept: number[] = []
    const { fetchImpl } = recording([
      jsonResponse({ ok: false, error: 'ratelimited' }, 429, { 'retry-after': '86400' }),
      jsonResponse({ ok: true }),
    ])
    const client = new SlackClient(FAKE_TOKEN, {
      fetchImpl,
      maxRetryAfterSeconds: 30,
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    await client.call('conversations.list')
    expect(slept).toEqual([30000])
  })

  it('defaults to one second when Slack sends no Retry-After', async () => {
    const slept: number[] = []
    const { fetchImpl } = recording([
      jsonResponse({ ok: false, error: 'ratelimited' }, 429),
      jsonResponse({ ok: true }),
    ])
    const client = new SlackClient(FAKE_TOKEN, {
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    await client.call('conversations.list')
    expect(slept).toEqual([1000])
  })

  it('gives up after the configured number of waits and reports it as retryable', async () => {
    const { fetchImpl } = recording([
      jsonResponse({ ok: false, error: 'ratelimited' }, 429, { 'retry-after': '2' }),
    ])
    const client = new SlackClient(FAKE_TOKEN, {
      fetchImpl,
      sleep: noSleep,
      maxRateLimitRetries: 2,
    })
    const error = await client.call('conversations.list').catch((e: unknown) => e)
    expect((error as SlackApiError).kind).toBe('retryable')
    expect((error as SlackApiError).retryAfter).toBe(2)
  })

  it('rate-limits a post too — a 429 means Slack did not process it, so waiting is safe', async () => {
    const { fetchImpl, calls } = recording([
      jsonResponse({ ok: false, error: 'ratelimited' }, 429, { 'retry-after': '1' }),
      jsonResponse({ ok: true, ts: '9.9' }),
    ])
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    const { body } = await client.call('chat.postMessage', {})
    expect(body.ts).toBe('9.9')
    expect(calls.length).toBe(2)
  })
})

describe('classification', () => {
  it('names the app limit explicitly, since §13 reserves app slots', () => {
    expect(classify('app_limit_reached')).toBe('needs_human')
  })

  it('defaults an unknown error to terminal, not to retryable', () => {
    // The conservative direction: an unknown failure retried in a loop is how a
    // rate limit becomes a ban.
    expect(classify('something_new_slack_invented')).toBe('terminal')
  })

  it('treats being out of the channel as terminal for the CALL, since the remedy is to join', () => {
    expect(classify('not_in_channel')).toBe('terminal')
  })
})

describe('redaction', () => {
  it('strips anything token-shaped', () => {
    expect(redact(`failed with ${FAKE_TOKEN}`)).toBe('failed with xox…-[redacted]')
    expect(
      redact(`${['xoxp', '1', SENTINEL].join('-')} and ${['xoxa', '2', SENTINEL].join('-')}`),
    ).toBe('xox…-[redacted] and xox…-[redacted]')
  })

  it('leaves ordinary text alone', () => {
    expect(redact('channel_not_found')).toBe('channel_not_found')
  })

  it('keeps the token out of a thrown network error', async () => {
    const { fetchImpl } = recording([new TypeError(`connect failed for ${FAKE_TOKEN}`)])
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    const error = await client.call('chat.postMessage', {}).catch((e: unknown) => e)
    expect((error as SlackApiError).code).toContain('indeterminate')
    expect((error as SlackApiError).code).not.toContain(SENTINEL)
  })
})

describe('how the request is shaped', () => {
  // Found against the live workspace, not by reasoning: `conversations.history`
  // accepts a JSON body and `conversations.replies` rejects the same body with
  // `invalid_arguments`. One method working is not evidence about the next.
  it('sends reads as a GET with a query string', async () => {
    const urls: string[] = []
    const inits: (RequestInit | undefined)[] = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url))
      inits.push(init)
      return new Response(JSON.stringify({ ok: true, messages: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    await client.call('conversations.replies', { channel: 'C1', ts: '1.2', limit: 10 })
    expect(urls[0]).toContain('conversations.replies?')
    expect(urls[0]).toContain('channel=C1')
    expect(inits[0]?.method).toBe('GET')
    expect(inits[0]?.body).toBeUndefined()
  })

  it('still sends writes as a JSON POST', async () => {
    const inits: (RequestInit | undefined)[] = []
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      inits.push(init)
      return new Response(JSON.stringify({ ok: true, ts: '1.1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    await client.call('chat.postMessage', { channel: 'C1', text: 'hi' })
    expect(inits[0]?.method).toBe('POST')
    expect(JSON.parse(String(inits[0]?.body))).toMatchObject({ channel: 'C1' })
  })

  it('serialises a nested object rather than dropping it from a read', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url))
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const client = new SlackClient(FAKE_TOKEN, { fetchImpl, sleep: noSleep })
    await client.call('conversations.info', { channel: 'C1', extra: { a: 1 } })
    expect(urls[0]).toContain('extra=')
  })
})

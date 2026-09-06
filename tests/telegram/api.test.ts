/**
 * The Telegram client's four traps.
 *
 * Each is a place where the habit learned from other APIs produces a bug:
 * `retry_after` is in the body rather than a header, failures come back as
 * English prose rather than codes, `ok: false` arrives as an HTTP 200, and a
 * write must never be retried after a network error.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyDescription,
  redact,
  TelegramApiError,
  TelegramClient,
} from '../../src/telegram/api.ts'

const TOKEN = ['8967954396', 'FAKE', 'SENTINELVALUE'].join(':')

const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const recording = (
  responses: (Response | Error)[],
): { calls: string[]; fetchImpl: typeof fetch } => {
  const calls: string[] = []
  let i = 0
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    const next = responses[Math.min(i, responses.length - 1)]
    i += 1
    if (next === undefined) throw new Error('no scripted response')
    if (next instanceof Error) throw next
    return next.clone()
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const noSleep = async (): Promise<void> => {}

describe('retry_after lives in the body, not a header', () => {
  it('is read from parameters.retry_after and waited out', async () => {
    const slept: number[] = []
    const { fetchImpl } = recording([
      reply({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 7 },
      }),
      reply({ ok: true, result: { message_id: 5 } }),
    ])
    const client = new TelegramClient(TOKEN, {
      fetchImpl,
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    await client.call('sendMessage', {})
    expect(slept).toEqual([7000])
  })

  it('caps the wait, so a large retry_after cannot park the process', async () => {
    const slept: number[] = []
    const { fetchImpl } = recording([
      reply({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 86400 },
      }),
      reply({ ok: true, result: { message_id: 5 } }),
    ])
    const client = new TelegramClient(TOKEN, {
      fetchImpl,
      maxRetryAfterSeconds: 30,
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    await client.call('sendMessage', {})
    expect(slept).toEqual([30000])
  })

  it('reports the wait when it gives up, so a caller can schedule', async () => {
    const { fetchImpl } = recording([
      reply({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 12 },
      }),
    ])
    const client = new TelegramClient(TOKEN, { fetchImpl, sleep: noSleep, maxRateLimitRetries: 1 })
    const error = await client.call('sendMessage', {}).catch((e: unknown) => e)
    expect((error as TelegramApiError).retryAfter).toBe(12)
    expect((error as TelegramApiError).kind).toBe('retryable')
  })
})

describe('errors are prose', () => {
  it('tells a blocked bot from a kicked one — different humans, different remedies', () => {
    expect(classifyDescription('Forbidden: bot was blocked by the user').code).toBe(
      'blocked_by_user',
    )
    expect(classifyDescription('Forbidden: bot was kicked from the group chat').code).toBe(
      'kicked_from_chat',
    )
  })

  it('recognises the ones that mean "there is nowhere to send this"', () => {
    expect(classifyDescription('Bad Request: chat not found')).toEqual({
      code: 'chat_not_found',
      kind: 'terminal',
    })
  })

  it('recognises a rejected parse mode, which is what an escaping bug looks like', () => {
    expect(
      classifyDescription("Bad Request: can't parse entities: unexpected end of tag").code,
    ).toBe('bad_markup')
  })

  it('defaults an unrecognised description to terminal, not retryable', () => {
    expect(classifyDescription('Bad Request: something new').kind).toBe('terminal')
  })

  it('falls back to the numeric code when there is no description it knows', () => {
    expect(classifyDescription('whatever', 502).kind).toBe('retryable')
    expect(classifyDescription(undefined, 429).code).toBe('rate_limited')
  })
})

describe('ok: false is an HTTP 200', () => {
  it('is treated as a failure', async () => {
    const { fetchImpl } = recording([
      reply({ ok: false, description: 'Bad Request: chat not found' }),
    ])
    const client = new TelegramClient(TOKEN, { fetchImpl, sleep: noSleep })
    await expect(client.call('sendMessage', {})).rejects.toBeInstanceOf(TelegramApiError)
  })

  it('and a success is returned whole, because the result carries the message id', async () => {
    const { fetchImpl } = recording([reply({ ok: true, result: { message_id: 42 } })])
    const client = new TelegramClient(TOKEN, { fetchImpl, sleep: noSleep })
    const response = await client.call('sendMessage', {})
    expect((response.result as { message_id: number }).message_id).toBe(42)
  })
})

describe('a write is never retried after a network error', () => {
  it('reports sendMessage as indeterminate on the first failure', async () => {
    const { fetchImpl, calls } = recording([new TypeError('socket hang up')])
    const client = new TelegramClient(TOKEN, { fetchImpl, sleep: noSleep })
    const error = await client.call('sendMessage', {}).catch((e: unknown) => e)
    expect(calls).toHaveLength(1)
    expect((error as TelegramApiError).kind).toBe('indeterminate')
  })

  it('but does retry a read, where repeating costs nothing', async () => {
    const { fetchImpl, calls } = recording([new TypeError('econnreset'), reply({ ok: true })])
    const client = new TelegramClient(TOKEN, { fetchImpl, sleep: noSleep })
    await client.call('getMe')
    expect(calls.length).toBeGreaterThan(1)
  })

  it('treats a non-JSON body on a write as indeterminate too', async () => {
    const { fetchImpl } = recording([new Response('<html>gateway</html>', { status: 502 })])
    const client = new TelegramClient(TOKEN, { fetchImpl, sleep: noSleep })
    const error = await client.call('sendMessage', {}).catch((e: unknown) => e)
    expect((error as TelegramApiError).kind).toBe('indeterminate')
  })
})

describe('redaction', () => {
  it('strips the token, which Telegram puts in the URL path', () => {
    expect(redact(`failed POST https://api.telegram.org/bot${TOKEN}/sendMessage`)).toBe(
      'failed POST https://api.telegram.org/bot[redacted]/sendMessage',
    )
  })

  it('keeps it out of a thrown network error', async () => {
    const { fetchImpl } = recording([
      new TypeError(`connect failed https://api.telegram.org/bot${TOKEN}/sendMessage`),
    ])
    const client = new TelegramClient(TOKEN, { fetchImpl, sleep: noSleep })
    const error = await client.call('sendMessage', {}).catch((e: unknown) => e)
    expect((error as TelegramApiError).code).not.toContain('SENTINELVALUE')
  })
})

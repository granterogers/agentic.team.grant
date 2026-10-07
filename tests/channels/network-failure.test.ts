/**
 * A write that failed before any request bytes left the process is definitely not sent and is retryable; a write that
 * may have been transmitted stays indeterminate. Driven through the real clients and transports with a scripted fetch.
 */
import { describe, expect, it } from 'vitest'
import { TransportError } from '../../src/channels/delivery.ts'
import { failedBeforeSending } from '../../src/channels/network-failure.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { SlackTransport } from '../../src/slack/transport.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { TelegramTransport } from '../../src/telegram/transport.ts'

/** undici's shape: a TypeError('fetch failed') whose cause carries the socket error code. */
const fetchFailed = (code: string): Error => {
  const cause = Object.assign(new Error(`socket ${code}`), { code })
  return Object.assign(new TypeError('fetch failed'), { cause })
}

const NOT_SENT = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
]
// Codes that can occur after the request was written, or that tell us nothing.
const MAYBE_SENT = [
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ABORT_ERR',
  'SOMETHING_NEW',
]

describe('failedBeforeSending', () => {
  it.each(NOT_SENT)('%s is provably before the request was sent', (code) => {
    expect(failedBeforeSending(fetchFailed(code))).toBe(true)
  })
  it.each(MAYBE_SENT)('%s is NOT provable, so it stays conservative', (code) => {
    expect(failedBeforeSending(fetchFailed(code))).toBe(false)
  })
  it('an error with no code at all is not provable', () => {
    expect(failedBeforeSending(new Error('boom'))).toBe(false)
    expect(failedBeforeSending(new TypeError('fetch failed'))).toBe(false)
    expect(failedBeforeSending(undefined)).toBe(false)
    expect(failedBeforeSending('ECONNREFUSED')).toBe(false)
  })
  it('an AbortError (timeout signal) is not provable even though it is a failure', () => {
    expect(failedBeforeSending(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(
      false,
    )
  })
  it('a multi-address connect failure counts only when EVERY address failed before connecting', () => {
    const agg = (...codes: string[]) =>
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new AggregateError(codes.map((c) => Object.assign(new Error(c), { code: c })))),
      })
    expect(failedBeforeSending(agg('ECONNREFUSED', 'ENETUNREACH'))).toBe(true)
    expect(failedBeforeSending(agg('ECONNREFUSED', 'ECONNRESET'))).toBe(false)
  })
})

const throwing = (error: Error) => {
  const calls: string[] = []
  const fetchImpl = (async (url: string) => {
    calls.push(String(url))
    throw error
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}
const tgSend = (fetchImpl: typeof fetch) =>
  new TelegramTransport(new TelegramClient('1:FAKE', { fetchImpl, sleep: async () => undefined }))
    .send({
      targetRef: '1',
      threadRef: null,
      dedupeKey: 'k',
      correlationId: null,
      purpose: 'result',
      body: { text: 'x' },
    })
    .catch((e: unknown) => e as TransportError)
const slackSend = (fetchImpl: typeof fetch) =>
  new SlackTransport(
    new SlackClient(['xoxb', 'FAKE', 'T'].join('-'), { fetchImpl, sleep: async () => undefined }),
  )
    .send({
      targetRef: 'C0123456789',
      threadRef: null,
      dedupeKey: 'k',
      correlationId: null,
      purpose: 'result',
      body: { text: 'x', blocks: [] },
    })
    .catch((e: unknown) => e as TransportError)

describe('the transports classify a failed WRITE', () => {
  it.each(NOT_SENT)('Telegram: %s before sending is retryable, and the write is attempted once', async (code) => {
    const { fetchImpl, calls } = throwing(fetchFailed(code))
    const error = (await tgSend(fetchImpl)) as TransportError
    expect(error).toBeInstanceOf(TransportError)
    expect(error.kind).toBe('retryable')
    expect(error.code.startsWith('network_before_send:')).toBe(true)
    expect(calls).toHaveLength(1) // the client does not loop a write by itself
  })
  it.each(MAYBE_SENT)('Telegram: %s may have been transmitted, so it is indeterminate', async (code) => {
    const { fetchImpl, calls } = throwing(fetchFailed(code))
    const error = (await tgSend(fetchImpl)) as TransportError
    expect(error.kind).toBe('indeterminate')
    expect(error.code.startsWith('indeterminate:')).toBe(true)
    expect(calls).toHaveLength(1)
  })
  it.each(NOT_SENT)('Slack: %s before sending is retryable', async (code) => {
    const { fetchImpl, calls } = throwing(fetchFailed(code))
    const error = (await slackSend(fetchImpl)) as TransportError
    expect(error.kind).toBe('retryable')
    expect(error.code.startsWith('network_before_send:')).toBe(true)
    expect(calls).toHaveLength(1)
  })
  it.each(MAYBE_SENT)('Slack: %s may have been transmitted, so it is indeterminate', async (code) => {
    const { fetchImpl } = throwing(fetchFailed(code))
    expect(((await slackSend(fetchImpl)) as TransportError).kind).toBe('indeterminate')
  })
  it('a Telegram upload (callForm) classifies the same way', async () => {
    const mk = (code: string) =>
      new TelegramClient('1:FAKE', { fetchImpl: throwing(fetchFailed(code)).fetchImpl }).callForm(
        'sendDocument',
        new FormData(),
      )
    await expect(mk('ECONNREFUSED')).rejects.toMatchObject({ kind: 'retryable' })
    await expect(mk('ECONNRESET')).rejects.toMatchObject({ kind: 'indeterminate' })
  })
})

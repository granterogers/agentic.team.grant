/**
 * Sending a file as a file.
 *
 * Issue #66. Grant: *"just directly have the audio file sent to me on Telegram
 * that I can play it directly rather than necessarily having to open
 * notebook."* `TelegramTransport` only knew `sendMessage`, so the best it could
 * do was a link — the trip to NotebookLM he was avoiding, one click further
 * away.
 *
 * These test the transport rather than the handler, because the handler's
 * interesting parts are network calls and the transport's interesting parts are
 * decisions.
 */

import { describe, expect, it, vi } from 'vitest'
import type { TelegramClient } from '../../src/telegram/api.ts'
import { TelegramTransport } from '../../src/telegram/transport.ts'

const CORRELATION = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607'

const spy = () => {
  const calls: { method: string; body: unknown; form?: FormData }[] = []
  const client = {
    call: vi.fn(async (method: string, body: Record<string, unknown>) => {
      calls.push({ method, body })
      return { result: { message_id: 7 } }
    }),
    callForm: vi.fn(async (method: string, form: FormData) => {
      calls.push({ method, body: null, form })
      return { result: { message_id: 8 } }
    }),
  } as unknown as TelegramClient
  return { client, calls }
}

const send = async (client: TelegramClient, body: unknown) =>
  await new TelegramTransport(client).send({
    targetRef: '1386648496',
    threadRef: null,
    dedupeKey: 'test',
    correlationId: CORRELATION,
    purpose: 'result',
    body,
  } as never)

describe('an output with an audio file', () => {
  const bytes = new Uint8Array([1, 2, 3, 4])

  it('is uploaded, not described', async () => {
    const { client, calls } = spy()
    await send(client, {
      text: 'Here it is to play.',
      attachAudioIgnored: true,
      audio: { bytes, filename: 'overview.mp3', title: 'Coaching for Success' },
    })
    expect(calls[0]?.method).toBe('sendAudio')
  })

  it('carries the words as the caption, so nothing is lost by sending a file', async () => {
    const { client, calls } = spy()
    await send(client, {
      text: 'Here it is to play.',
      audio: { bytes, filename: 'overview.mp3', title: 'Coaching for Success' },
    })
    expect(calls[0]?.form?.get('caption')).toBe('Here it is to play.')
    expect(calls[0]?.form?.get('title')).toBe('Coaching for Success')
  })

  it('lets Telegram fetch a public URL rather than uploading it', async () => {
    // One JSON request instead of a multipart upload. Only possible for a
    // publicly reachable URL, which our private bucket is not — hence both
    // paths existing.
    const { client, calls } = spy()
    await send(client, {
      text: 'Here it is.',
      audio: { url: 'https://example.test/a.mp3', filename: 'a.mp3', title: 'A' },
    })
    expect(calls[0]?.method).toBe('sendAudio')
    expect((calls[0]?.body as { audio?: string })?.audio).toBe('https://example.test/a.mp3')
  })

  it('passes the duration, because it decides whether he presses play', async () => {
    const { client, calls } = spy()
    await send(client, {
      text: 'x',
      audio: { bytes, filename: 'a.mp3', title: 'A', durationSeconds: 1440 },
    })
    expect(calls[0]?.form?.get('duration')).toBe('1440')
  })

  it('still sends an ordinary message when there is no file', async () => {
    const { client, calls } = spy()
    await send(client, { text: 'Just words.' })
    expect(calls[0]?.method).toBe('sendMessage')
  })
})

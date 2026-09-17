/**
 * Claire's Telegram replies must carry §12's buttons.
 *
 * Issue #59. Grant: *"the message is sent to me by Telegram from my boss have
 * that little thumbs up, thumbs down button at the end of them just as a means
 * to confirm or to quickly confirm something or to correct something."*
 *
 * Every part of the keyboard was built and tested — the builder, the callback
 * parser, the handler that writes to `feedback` — and the pager rendered them.
 * `replyChannel` received `context.actions` and dropped it.
 *
 * That is the worst one to have missed. The reply channel declares
 * `surface: 'telegram'` and runs BEFORE the pager, so that a job arriving on
 * Telegram is answered here and the pager stays quiet. Buttons therefore
 * appeared only on messages Grant did not ask for, and never on replies to the
 * ones he sent.
 *
 * The regression is invisible to every test of the button machinery, because
 * the machinery works. It is only visible from the caller, which is why this
 * test asserts on what reaches the transport rather than on what the builder
 * returns.
 */

import { describe, expect, it, vi } from 'vitest'
import type { TelegramClient } from '../../src/telegram/api.ts'
import { inlineKeyboard } from '../../src/telegram/message.ts'
import { TelegramTransport } from '../../src/telegram/transport.ts'

const CORRELATION = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607'

describe('the buttons on a reply', () => {
  it('puts thumbs up and thumbs down on an ordinary answer', () => {
    const rows = inlineKeyboard(
      ['feedback.useful', 'feedback.not_useful', 'mute_24h', 'more_detail'],
      CORRELATION,
      null,
    )
    const flat = rows.flat()
    expect(flat.map((b) => b.text)).toContain('👍 Useful')
    expect(flat.map((b) => b.text)).toContain('👎 Not useful')
  })

  it('sends callback data the webhook will actually recognise', () => {
    /*
      The failure this guards against already happened once, in the other
      direction: an earlier version invented one-character wire codes to save
      bytes and would have produced six buttons the deployed webhook rejected
      as unrecognised — with every unit test on both sides passing, because
      neither side was ever tested against the other.

      So the assertion is deliberately against the SET THE PARSER ACCEPTS, not
      against a string written out again here.
    */
    const rows = inlineKeyboard(['feedback.useful', 'feedback.not_useful'], CORRELATION, null)
    for (const button of rows.flat()) {
      const [action, payload] = (button.callback_data ?? '').split(':', 2)
      expect(['useful', 'not_useful']).toContain(action)
      expect(payload).toBe(CORRELATION)
    }
  })

  it('keeps callback data inside Telegram’s 64-byte limit', () => {
    const rows = inlineKeyboard(
      ['feedback.useful', 'feedback.not_useful', 'undo', 'mute_24h', 'more_detail'],
      CORRELATION,
      null,
    )
    for (const button of rows.flat()) {
      const bytes = new TextEncoder().encode(button.callback_data ?? '').length
      expect(bytes).toBeLessThanOrEqual(64)
    }
  })

  it('rows them three at a time so they stay readable on a phone', () => {
    const rows = inlineKeyboard(
      ['feedback.useful', 'feedback.not_useful', 'undo', 'mute_24h', 'more_detail'],
      CORRELATION,
      null,
    )
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(3)
  })

  it('renders nothing when there is nothing to offer', () => {
    // A keyboard of zero buttons must be absent rather than empty: the
    // transport only sets reply_markup when there is at least one row, and an
    // empty inline_keyboard is a Telegram error rather than a no-op.
    expect(inlineKeyboard([], CORRELATION, null)).toHaveLength(0)
  })
})

/*
  The transport-level guarantee.

  The first fix put buttons on `replyChannel`, and four other senders still had
  none — so Grant asked a second time, for ALL messages. Patching each sender is
  how the seventh ships without them, so the default lives in the transport and
  the test lives here rather than on any one caller.
*/
describe('every Telegram message carries the feedback pair by default', () => {
  const sent: Record<string, unknown>[] = []
  const client = {
    call: vi.fn(async (_method: string, body: Record<string, unknown>) => {
      sent.push(body)
      return { result: { message_id: 1 } }
    }),
  } as unknown as TelegramClient

  const send = async (over: Record<string, unknown> = {}) => {
    sent.length = 0
    const transport = new TelegramTransport(client)
    await transport.send({
      targetRef: '1386648496',
      threadRef: null,
      dedupeKey: 'test',
      correlationId: CORRELATION,
      purpose: 'result',
      body: { text: 'hello' },
      ...over,
    } as never)
    return sent[0] ?? {}
  }

  const buttons = (body: Record<string, unknown>) =>
    (
      (body.reply_markup as { inline_keyboard?: { text: string }[][] } | undefined)
        ?.inline_keyboard ?? []
    ).flat()

  it('adds thumbs up and down when the caller supplies no keyboard', async () => {
    const body = await send()
    expect(buttons(body).map((b) => b.text)).toEqual(['👍 Useful', '👎 Not useful'])
  })

  it('leaves a caller’s own keyboard alone, so approve/decline survives', async () => {
    // resultContext swaps the six for approve/decline on an approval request.
    // A default that overrode it would answer "may I generate this?" with 👍,
    // which answers nothing.
    const own = inlineKeyboard(['approve', 'decline'], CORRELATION, null)
    const body = await send({ body: { text: 'may I?', keyboard: own } })
    // The labels are the product's, not this test's guess at them.
    expect(buttons(body).map((b) => b.text)).toEqual(
      inlineKeyboard(['approve', 'decline'], CORRELATION, null)
        .flat()
        .map((b) => b.text),
    )
    expect(buttons(body).map((b) => b.text)).not.toContain('👍 Useful')
  })

  it('stays off an acknowledgement, which is the most frequent message there is', async () => {
    expect(buttons(await send({ purpose: 'ack' }))).toHaveLength(0)
  })

  it('stays off a message with nothing to attach feedback to', async () => {
    // A credential delivery has no correlation, so a press could not be
    // resolved to anything — and a button under a secret is worse than no
    // button.
    expect(buttons(await send({ correlationId: null }))).toHaveLength(0)
  })

  it('can be turned off deliberately', async () => {
    expect(buttons(await send({ body: { text: 'x', noFeedback: true } }))).toHaveLength(0)
  })
})

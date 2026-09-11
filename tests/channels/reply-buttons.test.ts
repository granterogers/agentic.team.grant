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

import { describe, expect, it } from 'vitest'
import { inlineKeyboard } from '../../src/telegram/message.ts'

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

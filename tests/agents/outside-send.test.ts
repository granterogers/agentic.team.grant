/**
 * A request to send something to somebody outside the office gets the line that makes the team ask before it sends (0.113.0).
 */
import { describe, expect, it } from 'vitest'
import { asksToSendOutside, OUTSIDE_SEND_LINE } from '../../src/agents/outside-send.ts'

describe('a send to somebody outside the office is said as a draft that waits', () => {
  it.each([
    'Email the client that the launch is delayed by a week.',
    'Send Kevin the revised invoice',
    'Text the caterer that we are moving the tasting to Friday',
  ])('asks for the line: %s', (said) => {
    expect(asksToSendOutside(said)).toBe(true)
  })

  it.each([
    'What should I focus on today?',
    'What did the team decide last time about the budget?',
    'Draft a note for the file about the venue booking, do not send it',
  ])('does not add it to an ordinary question: %s', (said) => {
    expect(asksToSendOutside(said)).toBe(false)
  })

  it('says the draft has not been sent and asks before sending', () => {
    expect(OUTSIDE_SEND_LINE).toMatch(/nothing has been sent/)
    expect(OUTSIDE_SEND_LINE).toMatch(/ask/)
  })
})

describe('the reply to a send ends by asking', () => {
  it('adds the question when the reply has none', async () => {
    const { endsByAskingBeforeSending } = await import('../../src/agents/outside-send.ts')
    expect(endsByAskingBeforeSending('Here is the draft: Dear Sam.')).toBe(
      'Here is the draft: Dear Sam.\n\nShall I send it?',
    )
  })
  it('leaves a reply that already asks', async () => {
    const { endsByAskingBeforeSending } = await import('../../src/agents/outside-send.ts')
    expect(endsByAskingBeforeSending('Here is the draft. Shall I send it?')).toBe(
      'Here is the draft. Shall I send it?',
    )
  })
})

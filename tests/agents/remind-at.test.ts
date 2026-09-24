/**
 * Ledger R24 — a reminder at a TIME is a reminder at that time.
 *
 * "remind me at 3pm to call Sarah back" filed "At 3pm to call Sarah back"
 * with no date and no remind_at, so the reminders duty had nothing to send.
 * Times are Europe/Athens (UTC+3 in September).
 */
import { describe, expect, it } from 'vitest'
import { personalTaskRequest } from '../../src/agents/mine.ts'
import { remindAtFor } from '../../src/agents/remind-at.ts'

const now = new Date('2026-09-24T10:00:00Z') // Thursday, 13:00 in Athens

describe('the time he said becomes remind_at', () => {
  it.each([
    [
      'remind me at 3pm to call Sarah back',
      'Call Sarah back',
      '2026-09-24',
      '2026-09-24T12:00:00.000Z',
    ],
    [
      'remind me tomorrow at 9 to send the invoice',
      'Send the invoice',
      '2026-09-25',
      '2026-09-25T06:00:00.000Z',
    ],
    [
      'remind me in 20 minutes to check the oven',
      'Check the oven',
      '2026-09-24',
      '2026-09-24T10:20:00.000Z',
    ],
    ['remind me at 15:30 to ring Kevin', 'Ring Kevin', '2026-09-24', '2026-09-24T12:30:00.000Z'],
    [
      'nudge me on Friday morning about the insurance',
      'The insurance',
      '2026-09-25',
      '2026-09-25T06:00:00.000Z',
    ],
    // a time already gone today, with no day said, is tomorrow
    [
      'remind me at 11am to ring the bank',
      'Ring the bank',
      '2026-09-25',
      '2026-09-25T08:00:00.000Z',
    ],
  ])('%s', (said, title, due, at) => {
    expect(personalTaskRequest(said, now)).toMatchObject({ title, due, remindAt: at })
  })

  it.each([
    'remind me to chase the printers',
    'remind me to book 3 tables for 40 people',
    'remind me on Friday to ring the venue',
    'remind me to ask what the margin at 35 percent would be',
  ])('NEGATIVE CONTROL: no time said, no time set: %s', (said) => {
    expect(personalTaskRequest(said, now)?.remindAt ?? null).toBeNull()
  })

  it('an amount after "at" is not a clock', () => {
    expect(remindAtFor('price it at 20 quid', null, now)).toBeNull()
    expect(remindAtFor('at 12 people it breaks even', null, now)).toBeNull()
  })
})

describe('spoken clock times', () => {
  it.each([
    ['remind me at three to call sarah', 'Call sarah', '2026-09-24T12:00:00.000Z'],
    [
      'remind me at half past four to pick up the kids',
      'Pick up the kids',
      '2026-09-24T13:30:00.000Z',
    ],
    [
      'remind me tomorrow at quarter to nine to send the deck',
      'Send the deck',
      '2026-09-25T05:45:00.000Z',
    ],
    ["remind me at ten o'clock to ring the bank", 'Ring the bank', '2026-09-25T07:00:00.000Z'],
  ])('%s', (said, title, at) => {
    expect(personalTaskRequest(said, now)).toMatchObject({ title, remindAt: at })
  })
  it('NEGATIVE CONTROL: a number word that is not a time stays in the title', () => {
    expect(personalTaskRequest('remind me to buy three books', now)).toMatchObject({
      title: 'Buy three books',
      remindAt: null,
    })
  })
  it('a leading zero is a 24-hour clock, not the afternoon', () => {
    expect(personalTaskRequest('remind me at 04:30 to catch the flight', now)?.remindAt).toBe(
      '2026-09-25T01:30:00.000Z',
    )
  })
})

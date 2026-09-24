import { describe, expect, it } from 'vitest'
import { datesIn, isoForMention } from '../../src/agents/derivable.ts'
import { fabricatedWhen } from '../../src/agents/quality.ts'

// Thursday 24 September 2026, the day the defect was measured.
const now = new Date('2026-09-24T10:00:00Z')

describe('a date that follows from what he said is not invented', () => {
  const asked =
    'Couple of things. Add a task to renew the public liability insurance by the 30th, another to send the Brightwell invoice next week, and tell me roughly how long insurance renewals usually take.'

  it('the measured case: "by the 30th" answered as "30 Sept"', () => {
    expect(fabricatedWhen('Renewal is due 30 Sept, so start now.', asked, now)).toBeNull()
  })

  it('in every spelling a model writes a date', () => {
    for (const body of [
      'due Sept 30',
      'due 30th September',
      'due 2026-09-30',
      'by September 30th',
    ]) {
      expect(fabricatedWhen(body, asked, now), body).toBeNull()
    }
  })

  it('a weekday resolves to its date', () => {
    expect(fabricatedWhen('I have put it down for 25 Sept.', 'review it on Friday', now)).toBeNull()
    expect(fabricatedWhen('Moved to 28 September.', 'actually make that Monday', now)).toBeNull()
    expect(fabricatedWhen('due Oct 1', 'send the invoice next week', now)).toBeNull()
  })

  it('NEGATIVE CONTROL: a date nothing resolves to is still refused', () => {
    expect(fabricatedWhen('due Fri Oct 18', asked, now)).not.toBeNull()
    expect(
      fabricatedWhen('I have put it down for 26 Sept.', 'review it on Friday', now),
    ).not.toBeNull()
    expect(
      fabricatedWhen('Renewal is due 30 Sept.', 'renew the insurance soon', now),
    ).not.toBeNull()
  })

  it('NEGATIVE CONTROL: a clock time is never excused by a date expression', () => {
    expect(
      fabricatedWhen('Booked for 3.19 PM on Friday.', 'review it on Friday', now),
    ).not.toBeNull()
  })

  it('the resolver itself', () => {
    expect([...datesIn('by the 30th and next Tuesday', now)].sort()).toEqual([
      '2026-09-30',
      '2026-10-06',
    ])
    expect(isoForMention('5 Jan', new Date('2026-12-20T00:00:00Z'))).toBe('2027-01-05')
    expect(isoForMention('31 Feb', now)).toBeNull()
  })
})

import { personalTaskRequest } from '../../src/agents/mine.ts'

describe('"by the 30th" is a due date, not part of the title', () => {
  it('files the date and strips it from the name', () => {
    expect(
      personalTaskRequest('Add a task to renew the public liability insurance by the 30th', now),
    ).toMatchObject({ title: 'Renew the public liability insurance', due: '2026-09-30' })
  })
  it('NEGATIVE CONTROL: "the 30th" with no preposition is not a deadline', () => {
    expect(
      personalTaskRequest('Add a task to read the 30th anniversary brief', now)?.due ?? null,
    ).toBeNull()
  })
})

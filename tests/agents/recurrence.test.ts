/**
 * R3: "every Monday", "every day at 9am", "weekly" are repeats the office keeps; ones it cannot keep are SAID.
 *
 * Before: "Remind me to ring the venue every Monday" became a one-off titled "Ring the venue every" and the recurrence
 * was dropped in silence. The reader is `recurrenceOf`; `personalTaskRequest` turns it into a first occurrence on the
 * office's wall clock, and `reminderSentence` says whether the repeat stuck. The SQL half (the next occurrence after a
 * completion, across a change of clocks) is proved on a replica by scripts/isolated/tk-reminders.ts.
 */

import { describe, expect, it } from 'vitest'
import { personalTaskRequest } from '../../src/agents/mine.ts'
import { recurrenceOf } from '../../src/agents/recurrence.ts'
import { reminderSentence } from '../../src/agents/reminder-say.ts'

const ATHENS = 'Europe/Athens'
// Wednesday 7 October 2026, 11:00 in Athens (EEST).
const WED = new Date('2026-10-07T08:00:00.000Z')

describe('recurrenceOf reads the repeats that are a whole number of days', () => {
  it.each([
    ['Remind me every Monday to review my finances.', '7 days', 1, 'every Monday'],
    ['Remind me every day at 9am to stretch.', '1 day', null, 'every day'],
    ['Remind me every Friday at 4pm to send the report.', '7 days', 5, 'every Friday'],
    ['Remind me weekly to review this.', '7 days', null, 'every week'],
    ['Remind me daily to take the tablets.', '1 day', null, 'every day'],
    ['Remind me each morning to stretch.', '1 day', null, 'every morning'],
    ['Remind me every other Tuesday to water the plants.', '14 days', 2, 'every other Tuesday'],
    ['Remind me every 3 days to rotate the stock.', '3 days', null, 'every 3 days'],
    ['Remind me every two weeks to back up.', '14 days', null, 'every 2 weeks'],
    ['Remind me fortnightly to invoice.', '14 days', null, 'every fortnight'],
    ['Remind me weekly on Fridays to tidy up.', '7 days', 5, 'every Friday'],
    ['Remind me every thurs to bin the paper.', '7 days', 4, 'every Thursday'],
  ])('%s', (said, every, weekday, label) => {
    const got = recurrenceOf(said)
    expect(got).not.toBeNull()
    expect(got).toMatchObject({ every, weekday, label })
  })
})

describe('recurrenceOf refuses, by name, the repeats it cannot keep', () => {
  it.each([
    ['Remind me every month to pay rent.', 'every month'],
    ['Remind me monthly to pay rent.', 'monthly'],
    ['Remind me every weekday to stand up.', 'every weekday'],
    ['Remind me every first Monday to run the report.', 'every first Monday'],
    ['Remind me every hour to drink water.', 'every hour'],
    ['Remind me yearly to renew the domain.', 'yearly'],
    ['Remind me every 3 months to service the van.', 'every 3 months'],
    ['Remind me every 2 Mondays to call.', 'every 2 Mondays'],
    ['Remind me biweekly to check in.', 'biweekly'],
  ])('%s', (said, phrase) => {
    expect(recurrenceOf(said)).toEqual({ unsupported: phrase })
  })
})

describe('NEGATIVE: an "every" that is not a repeat is not read as one', () => {
  it.each([
    'Remind me to check every receipt.',
    'Remind me to thank everyone on Friday.',
    'Remind me to read every page of the contract.',
    'Remind me to call mum.',
    'Remind me on Friday to ring the venue.',
    // An adjective is not a repeat: "monthly" and "weekly" here describe the report and the update.
    'Remind me to send the monthly report on Friday.',
    'Remind me on Friday to send the weekly update to the board.',
    'Remind me to read the daily digest.',
  ])('%s', (said) => {
    expect(recurrenceOf(said)).toBeNull()
  })
})

describe('personalTaskRequest: the first occurrence is on the office wall clock', () => {
  it('"every Monday" with no time: next Monday at nine, a clean title, a due date to repeat from', () => {
    const got = personalTaskRequest('Remind me every Monday to review my finances.', WED, ATHENS)
    expect(got?.title).toBe('Review my finances')
    expect(got?.due).toBe('2026-10-12')
    expect(got?.remindAt).toBe('2026-10-12T06:00:00.000Z')
    expect(got?.remindDefaulted).toBe(true)
    expect(got?.repeat).toMatchObject({ every: '7 days', label: 'every Monday' })
    expect(got?.repeatUnsupported).toBeNull()
    expect(got?.title.toLowerCase()).not.toContain('every')
  })

  it('"every day at 9am": today if nine is still ahead, tomorrow if it has passed', () => {
    const early = personalTaskRequest(
      'Remind me every day at 9am to stretch.',
      new Date('2026-10-07T04:00:00.000Z'),
      ATHENS,
    )
    expect(early?.due).toBe('2026-10-07')
    expect(early?.remindAt).toBe('2026-10-07T06:00:00.000Z')
    expect(early?.remindDefaulted).toBe(false)
    expect(early?.title).toBe('Stretch')
    const late = personalTaskRequest('Remind me every day at 9am to stretch.', WED, ATHENS)
    expect(late?.due).toBe('2026-10-08')
    expect(late?.remindAt).toBe('2026-10-08T06:00:00.000Z')
  })

  it('"every Friday at 4pm": this Friday at 16:00 local', () => {
    const got = personalTaskRequest(
      'Remind me every Friday at 4pm to send the report.',
      WED,
      ATHENS,
    )
    expect(got?.due).toBe('2026-10-09')
    expect(got?.remindAt).toBe('2026-10-09T13:00:00.000Z')
    expect(got?.title).toBe('Send the report')
    expect(got?.repeat?.every).toBe('7 days')
  })

  it('"every Wednesday" said on Wednesday after the time is next week; before it, today', () => {
    expect(
      personalTaskRequest('Remind me every Wednesday to file the log.', WED, ATHENS)?.due,
    ).toBe('2026-10-14')
    expect(
      personalTaskRequest(
        'Remind me every Wednesday to file the log.',
        new Date('2026-10-07T04:00:00.000Z'),
        ATHENS,
      )?.due,
    ).toBe('2026-10-07')
  })

  it('"weekly" with no day starts one week from today; "every other Tuesday" starts on the next Tuesday', () => {
    const weekly = personalTaskRequest('Remind me weekly to review this.', WED, ATHENS)
    expect(weekly?.due).toBe('2026-10-14')
    expect(weekly?.remindAt).toBe('2026-10-14T06:00:00.000Z')
    expect(weekly?.title).toBe('Review this')
    const other = personalTaskRequest(
      'Remind me every other Tuesday to water the plants.',
      WED,
      ATHENS,
    )
    expect(other?.due).toBe('2026-10-13')
    expect(other?.repeat?.every).toBe('14 days')
  })

  it('a repeat that spans the clocks changing keeps the wall time on its FIRST occurrence', () => {
    // Said on Tuesday 20 October (EEST); the next Sunday is the 25th, the day the clocks go back.
    const got = personalTaskRequest(
      'Remind me every Sunday at 9am to call Dad.',
      new Date('2026-10-20T08:00:00.000Z'),
      ATHENS,
    )
    expect(got?.due).toBe('2026-10-25')
    expect(got?.remindAt).toBe('2026-10-25T07:00:00.000Z') // 09:00 EET
  })

  it('a repeating COMMITMENT is a dated repeating to-do: no reminder unless a time was said', () => {
    const got = personalTaskRequest('I need to review the books every Monday.', WED, ATHENS)
    expect(got?.repeat?.every).toBe('7 days')
    expect(got?.due).toBe('2026-10-12')
    expect(got?.remindAt ?? null).toBeNull()
    const timed = personalTaskRequest(
      'I need to review the books every Monday at 5pm.',
      WED,
      ATHENS,
    )
    expect(timed?.remindAt).toBe('2026-10-12T14:00:00.000Z')
  })

  it('an unsupported repeat is reported, stays on the title, and the task is a one-off', () => {
    const got = personalTaskRequest('Remind me every month to pay rent.', WED, ATHENS)
    expect(got?.repeat ?? null).toBeNull()
    expect(got?.repeatUnsupported).toBe('every month')
    expect(got?.title).toBe('Pay rent (every month)')
  })

  it('the weekday inside an unsupported repeat is NOT a due date, and the title is not mangled', () => {
    const got = personalTaskRequest('Remind me every first Monday to run the report.', WED, ATHENS)
    expect(got?.repeatUnsupported).toBe('every first Monday')
    expect(got?.title).toBe('Run the report (every first Monday)')
    expect(got?.due ?? null).toBeNull()
    expect(got?.remindAt ?? null).toBeNull()
    // ...but a day he named OUTSIDE the unsupported phrase still counts.
    const dated = personalTaskRequest('Remind me on Friday to pay rent every month.', WED, ATHENS)
    expect(dated?.due).toBe('2026-10-09')
    expect(dated?.repeatUnsupported).toBe('every month')
    expect(dated?.title).toBe('Pay rent (every month)')
  })

  it('a message without any repeat reads exactly as before', () => {
    const got = personalTaskRequest('Remind me on Friday to ring the venue.', WED, ATHENS)
    expect(got?.repeat ?? null).toBeNull()
    expect(got?.repeatUnsupported ?? null).toBeNull()
    expect(got?.title).toBe('Ring the venue')
  })
})

describe('the sentence says whether the repeat stuck', () => {
  const facts = {
    title: 'Review my finances',
    due: '2026-10-12',
    remindAt: '2026-10-12T06:00:00.000Z',
    defaulted: true,
    immediate: false,
    repeatLabel: 'every Monday',
    repeatStored: true as boolean | null,
    repeatUnsupported: null,
    timeZone: ATHENS,
  }
  it('stored: says it repeats and how the next one is made', () => {
    const s = reminderSentence(facts)
    expect(s).toContain('repeats every Monday')
    expect(s).toContain('tick')
  })
  it('NOT stored: says it is a one-off and never claims a repeat', () => {
    const s = reminderSentence({ ...facts, repeatStored: false })
    expect(s).toContain('could not record')
    expect(s).toContain('one-off')
    expect(s).not.toContain('It repeats')
  })
  it('unsupported: quotes the words and says it did not record them', () => {
    const s = reminderSentence({
      ...facts,
      repeatLabel: null,
      repeatStored: null,
      repeatUnsupported: 'every month',
    })
    expect(s).toContain('did not record')
    expect(s).toContain('every month')
    expect(s).toContain('one-off')
  })
})

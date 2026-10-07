/**
 * R1 / Z1: a reminder asked for on a day gets a time; a due date does not; and "today" is the OFFICE's day.
 *
 * `personalTaskRequest("Remind me Friday to X")` produced a due date and no `remind_at`, so the reminders duty (which
 * reads `remind_at` alone) never sent it. The default is nine in the morning in the office's own zone, only when he
 * asked to be reminded, and every parser takes the zone as an argument, so each case below can be put on either side of
 * midnight in any zone and across a change of clocks.
 */

import { describe, expect, it } from 'vitest'
import { calendarDateIn } from '../../src/agents/due.ts'
import { whenFor, personalTaskRequest, personalTaskChange } from '../../src/agents/mine.ts'
import { officeTimezone, OPERATOR_TIMEZONE } from '../../src/agents/office-time.ts'
import { defaultReminderAt } from '../../src/agents/remind-at.ts'
import { reminderSentence } from '../../src/agents/reminder-say.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

const ATHENS = 'Europe/Athens'
const NEW_YORK = 'America/New_York'
const AUCKLAND = 'Pacific/Auckland'

// Wednesday 7 October 2026, 11:00 in Athens (EEST, UTC+3).
const WED_11_ATHENS = new Date('2026-10-07T08:00:00.000Z')

const ask = (said: string, now: Date, zone: string) => personalTaskRequest(said, now, zone)

describe('R1: asked to be reminded on a day, no time said -> nine, office time', () => {
  it.each([
    ['Remind me Friday to call Mum.', 'Call Mum.', '2026-10-09', '2026-10-09T06:00:00.000Z'],
    ['Remind me tomorrow to pay the bill.', 'Pay the bill.', '2026-10-08', '2026-10-08T06:00:00.000Z'],
    ['Remind me on 15 October to renew X.', 'Renew X.', '2026-10-15', '2026-10-15T06:00:00.000Z'],
    ['Nudge me next week to chase the invoice.', 'Chase the invoice.', '2026-10-14', '2026-10-14T06:00:00.000Z'],
    ['Remind me in 3 days to water the plants.', 'Water the plants.', '2026-10-10', '2026-10-10T06:00:00.000Z'],
  ])('%s', (said, title, due, remindAt) => {
    const got = ask(said, WED_11_ATHENS, ATHENS)
    expect(got).not.toBeNull()
    expect(got?.title.replace(/\.$/, '')).toBe(title.replace(/\.$/, ''))
    expect(got?.due).toBe(due)
    expect(got?.remindAt).toBe(remindAt)
    expect(got?.remindDefaulted).toBe(true)
    expect(got?.repeat).toBeNull()
  })

  it('a time he said is his, not the default', () => {
    const got = ask('Remind me Friday at 3pm to call Mum.', WED_11_ATHENS, ATHENS)
    expect(got?.remindAt).toBe('2026-10-09T12:00:00.000Z') // 15:00 EEST
    expect(got?.remindDefaulted).toBe(false)
    expect(ask('Remind me Friday morning to call Mum.', WED_11_ATHENS, ATHENS)?.remindAt).toBe(
      '2026-10-09T06:00:00.000Z',
    )
  })

  it('NEGATIVE: a task that merely has a due date gets no reminder time', () => {
    for (const said of [
      'Task: renew X by Friday.',
      'I need to renew X by Friday.',
      'Add a task to renew X by Friday.',
      'Put renewing X on my list for 15 October.',
    ]) {
      const got = ask(said, WED_11_ATHENS, ATHENS)
      expect(got, said).not.toBeNull()
      expect(got?.due, said).not.toBeNull()
      expect(got?.remindAt ?? null, said).toBeNull()
      expect(got?.remindDefaulted, said).not.toBe(true)
    }
    expect(ask('Task: renew X by Friday.', WED_11_ATHENS, ATHENS)?.due).toBe('2026-10-09')
  })

  it('NEGATIVE: "remind me" with no day and no time stays undated and unreminded', () => {
    const got = ask('Remind me to call Mum.', WED_11_ATHENS, ATHENS)
    expect(got?.due).toBeNull()
    expect(got?.remindAt ?? null).toBeNull()
  })

  it('today, before nine: nine today. Today, after nine: now, and it says so', () => {
    const early = ask('Remind me today to call Mum.', new Date('2026-10-07T04:00:00.000Z'), ATHENS)
    expect(early?.remindAt).toBe('2026-10-07T06:00:00.000Z')
    expect(early?.remindImmediate).toBe(false)
    const late = ask('Remind me today to call Mum.', WED_11_ATHENS, ATHENS)
    expect(late?.remindAt).toBe(WED_11_ATHENS.toISOString())
    expect(late?.remindImmediate).toBe(true)
    expect(late?.due).toBe('2026-10-07')
  })
})

describe('Z1: "today" and "tomorrow" are the office\'s calendar day', () => {
  // 22:30 UTC on Wednesday 7 October: already Thursday 8th, 01:30 in Athens; still Wednesday 18:30 in New York;
  // already Thursday 8th, 11:30 in Auckland.
  const NIGHT = new Date('2026-10-07T22:30:00.000Z')

  it.each([
    [ATHENS, '2026-10-09', '2026-10-09T06:00:00.000Z'],
    [NEW_YORK, '2026-10-08', '2026-10-08T13:00:00.000Z'],
    [AUCKLAND, '2026-10-09', '2026-10-08T20:00:00.000Z'],
  ])('"remind me tomorrow" at 22:30 UTC in %s', (zone, due, remindAt) => {
    const got = ask('Remind me tomorrow to pay the bill.', NIGHT, zone)
    expect(got?.due).toBe(due)
    expect(got?.remindAt).toBe(remindAt)
  })

  it('whenFor reads the zone, not the UTC date', () => {
    expect(whenFor('tomorrow', NIGHT, ATHENS)).toBe('2026-10-09')
    expect(whenFor('tomorrow', NIGHT, NEW_YORK)).toBe('2026-10-08')
    expect(whenFor('tomorrow', NIGHT, 'UTC')).toBe('2026-10-08')
    // 23:30 UTC on Thursday is already Friday in Athens, so "Friday" means the NEXT one there and tomorrow in New York.
    const thursdayLate = new Date('2026-10-08T23:30:00.000Z')
    expect(whenFor('on Friday', thursdayLate, ATHENS)).toBe('2026-10-16')
    expect(whenFor('on Friday', thursdayLate, NEW_YORK)).toBe('2026-10-09')
  })

  it('a written date with no year is the next one in the office zone, and a missing day is refused', () => {
    expect(whenFor('on 15 October', new Date('2026-10-20T10:00:00Z'), ATHENS)).toBe('2027-10-15')
    expect(whenFor('on 15 October', WED_11_ATHENS, ATHENS)).toBe('2026-10-15')
    expect(whenFor('on 31 February', WED_11_ATHENS, ATHENS)).toBeNull()
    expect(calendarDateIn('nothing dated here', WED_11_ATHENS, ATHENS)).toBeUndefined()
    expect(calendarDateIn('on 31 February', WED_11_ATHENS, ATHENS)).toBeNull()
  })

  it('personalTaskChange moves a task on the office day too', () => {
    const NIGHT_ATHENS = new Date('2026-10-07T22:30:00.000Z')
    expect(personalTaskChange('make that tomorrow', NIGHT_ATHENS, ATHENS)?.due).toBe('2026-10-09')
    expect(personalTaskChange('make that tomorrow', NIGHT_ATHENS, NEW_YORK)?.due).toBe('2026-10-08')
  })
})

describe('the default time across a change of clocks', () => {
  it.each([
    // Athens falls back at 04:00 EEST on Sunday 25 October 2026.
    [ATHENS, '2026-10-24', '2026-10-24T06:00:00.000Z'],
    [ATHENS, '2026-10-25', '2026-10-25T07:00:00.000Z'],
    [ATHENS, '2026-10-26', '2026-10-26T07:00:00.000Z'],
    // New York falls back on Sunday 1 November 2026.
    [NEW_YORK, '2026-10-31', '2026-10-31T13:00:00.000Z'],
    [NEW_YORK, '2026-11-01', '2026-11-01T14:00:00.000Z'],
    // Auckland springs forward at 02:00 on Sunday 27 September 2026.
    [AUCKLAND, '2026-09-26', '2026-09-25T21:00:00.000Z'],
    [AUCKLAND, '2026-09-27', '2026-09-26T20:00:00.000Z'],
  ])('nine in %s on %s', (zone, day, expected) => {
    const early = new Date('2026-09-01T00:00:00.000Z')
    expect(defaultReminderAt(day, early, zone)).toEqual({ at: expected, immediate: false })
  })

  it('a written date on the day of the change reads end to end', () => {
    const got = ask('Remind me on 25 October to put the clocks back.', new Date('2026-10-20T08:00:00Z'), ATHENS)
    expect(got?.due).toBe('2026-10-25')
    expect(got?.remindAt).toBe('2026-10-25T07:00:00.000Z')
  })
})

describe('the sentence says what is stored, in the zone it used', () => {
  const base = {
    title: 'Call Mum',
    due: '2026-10-09',
    remindAt: '2026-10-09T13:00:00.000Z',
    defaulted: true,
    immediate: false,
    repeatLabel: null,
    repeatStored: null,
    repeatUnsupported: null,
  }
  it('names the zone and the default', () => {
    const ny = reminderSentence({ ...base, timeZone: NEW_YORK })
    expect(ny).toContain('09:00 (America/New_York)')
    expect(ny).toContain('did not say a time')
    expect(ny).not.toContain('Athens')
    const athens = reminderSentence({ ...base, remindAt: '2026-10-09T06:00:00.000Z', timeZone: ATHENS })
    expect(athens).toContain('09:00 (Europe/Athens)')
  })
  it('a time he said is not described as a default', () => {
    expect(reminderSentence({ ...base, defaulted: false, timeZone: NEW_YORK })).not.toContain('did not say')
  })
  it('an immediate reminder does not promise nine o clock', () => {
    const s = reminderSentence({ ...base, immediate: true, timeZone: ATHENS })
    expect(s).not.toContain('09:00')
    expect(s).toContain('next check')
  })
  it('the older three shapes are unchanged', () => {
    const plain = {
      ...base,
      remindAt: null,
      defaulted: false,
      timeZone: ATHENS,
    }
    expect(reminderSentence({ ...plain, due: null, title: 'Book the venue' })).toBe(
      'That is on your list — "Book the venue", no date on it yet.',
    )
    expect(reminderSentence({ ...plain, due: '2026-09-22', title: 'Ring the venue' })).toBe(
      'That is on your list for 2026-09-22 — "Ring the venue".',
    )
  })
})

describe('Z1: ONE zone source', () => {
  const fake = (rows: unknown[] | Error): SqlExecutor & { seen: string[] } => {
    const seen: string[] = []
    return {
      seen,
      execute: async (sql: string) => {
        seen.push(sql)
        if (rows instanceof Error) throw rows
        return { rows, rowCount: rows.length }
      },
    } as never
  }
  it('asks the database for the zone of the JOB\'s office', async () => {
    const db = fake([{ tz: NEW_YORK }])
    expect(await officeTimezone(db, 'job-1')).toBe(NEW_YORK)
    expect(db.seen[0]).toContain('app.office_timezone(app.job_office(')
    expect(db.seen[0]).toContain('job-1')
  })
  it('an office the database reads as UTC is UTC, never the operator\'s zone', async () => {
    expect(await officeTimezone(fake([{ tz: 'UTC' }]), 'j')).toBe('UTC')
  })
  it('an UNREADABLE zone (no function yet, no row, not a zone) is the documented operator default', async () => {
    expect(await officeTimezone(fake(new Error('function app.office_timezone does not exist')), 'j')).toBe(OPERATOR_TIMEZONE)
    expect(await officeTimezone(fake([]), 'j')).toBe(OPERATOR_TIMEZONE)
    expect(await officeTimezone(fake([{ tz: 'Not/AZone' }]), 'j')).toBe(OPERATOR_TIMEZONE)
  })
})

/**
 * #253's resolver, and the cases where it must refuse.
 *
 * Every test sits on a known instant so "which Friday" has one answer.
 * 2026-09-16T09:00:00Z is a WEDNESDAY in Europe/Athens.
 */
import { describe, expect, it } from 'vitest'
import { assignedTo, dueOn } from '../../src/agents/due.ts'

const WED = new Date('2026-09-16T09:00:00Z')
const on = (s: string, now: Date = WED): string | null => dueOn(s, now)?.on ?? null

describe('a deadline that is a date', () => {
  it('takes the next occurrence of a weekday, today included', () => {
    expect(on('chase the roofing quote by Friday')).toBe('2026-09-18')
    // Said ON the day it names, "by Wednesday" is today rather than a week away.
    expect(on('get it done by Wednesday')).toBe('2026-09-16')
  })

  it('adds a week for "next"', () => {
    expect(on('next Friday')).toBe('2026-09-25')
  })

  it('reads today, tomorrow and the day after', () => {
    expect(on('do it today')).toBe('2026-09-16')
    expect(on('tomorrow please')).toBe('2026-09-17')
    expect(on('the day after tomorrow')).toBe('2026-09-18')
  })

  it('counts days and weeks forward', () => {
    expect(on('in 3 days')).toBe('2026-09-19')
    expect(on('in two weeks')).toBe('2026-09-30')
  })

  it('reads a named month either way round', () => {
    expect(on('by 3 October')).toBe('2026-10-03')
    expect(on('October 3rd')).toBe('2026-10-03')
    expect(on('on the 3rd of October')).toBe('2026-10-03')
  })

  it('rolls a month already past into next year rather than dating the past', () => {
    expect(on('by 3 March')).toBe('2027-03-03')
  })

  it('takes an explicit ISO date', () => {
    expect(on('due 2026-11-05')).toBe('2026-11-05')
  })

  it('ends the week on Friday and the month on its real last day', () => {
    expect(on('by end of the week')).toBe('2026-09-18')
    expect(on('by the end of the month')).toBe('2026-09-30')
    // February in a non-leap year, from inside it.
    expect(on('end of the month', new Date('2027-02-10T09:00:00Z'))).toBe('2027-02-28')
  })

  it('quotes the words it read, so a confirmation is his phrase and not a paraphrase', () => {
    expect(dueOn('chase it by Friday', WED)?.from).toMatch(/Friday/i)
  })
})

describe('and a deadline that is not one', () => {
  /*
    The refusals are the feature. #249's invariant: the semantic layer may
    infer and may not invent a consequential parameter. A task dated the wrong
    Friday is worse than a task with no date, because the wrong date looks
    correct.
  */
  it.each([
    'chase the roofing quote soon',
    'do it when you can',
    'sometime next week',
    'next week sometime would be fine',
    'ASAP please',
    'by the end of the month-ish',
    'later today', // "later" is refused even beside a word that would resolve
    'eventually',
  ])('refuses %j', (said) => {
    expect(on(said)).toBeNull()
  })

  it('has nothing to say about a sentence with no time in it', () => {
    expect(on('chase the roofing quote')).toBeNull()
    expect(on('')).toBeNull()
  })

  it('refuses a date that does not exist rather than rolling it into March', () => {
    // Date.parse('2026-02-31') is a perfectly good number; this must not be.
    expect(on('due 2026-02-31')).toBeNull()
    expect(on('by 31 February')).toBeNull()
  })
})

describe('the timezone decides which day it is', () => {
  it('uses Grant’s day, not the server’s', () => {
    // 22:30 UTC on Wednesday is already Thursday in Athens (UTC+3 in September).
    const lateUtc = new Date('2026-09-16T22:30:00Z')
    expect(dueOn('today', lateUtc, 'Europe/Athens')?.on).toBe('2026-09-17')
    expect(dueOn('today', lateUtc, 'UTC')?.on).toBe('2026-09-16')
  })

  it('and which weekday it is, which is the same error one level down', () => {
    const lateUtc = new Date('2026-09-16T22:30:00Z')
    // Thursday in Athens, so "by Thursday" is today there and tomorrow in UTC.
    expect(dueOn('by Thursday', lateUtc, 'Europe/Athens')?.on).toBe('2026-09-17')
    expect(dueOn('by Thursday', lateUtc, 'UTC')?.on).toBe('2026-09-17')
  })
})

describe('who it was handed to', () => {
  it('reads the handing-over shapes', () => {
    expect(assignedTo('get Emma to chase the roofing quote')).toBe('research-director')
    expect(assignedTo('ask Marcus to look at the backup')).toBe('operations-director')
    expect(assignedTo('have Tom draft the reply')).toBe('strategy-director')
    expect(assignedTo('add a task for Grace to review the policy')).toBe('quality-director')
    expect(assignedTo('Oliver to write the announcement')).toBe('communications-director')
    expect(assignedTo('assign it to Ruby')).toBe('growth-director')
  })

  it('and declines a name that is only mentioned', () => {
    /*
      The negative cases are the whole test. A name in a sentence is not an
      assignment, and reading it as one would put work on somebody because
      they were talked about.
    */
    expect(assignedTo('summarise what Emma said about the quote')).toBeNull()
    expect(assignedTo('a task about the report Emma wrote')).toBeNull()
    expect(assignedTo('chase the roofing quote')).toBeNull()
    expect(assignedTo('')).toBeNull()
  })

  it('and declines somebody who does not work here', () => {
    expect(assignedTo('get Priya to chase the quote')).toBeNull()
    expect(assignedTo('ask the supplier to confirm')).toBeNull()
  })
})

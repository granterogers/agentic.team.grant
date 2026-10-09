/**
 * Stopping a RECURRING REMINDER is its own, explicit act (owner decision, 7 October 2026; migration 1034).
 *
 * Ticking a recurring reminder off completes that time only, so ending the series has to be SAID, in his own words, and
 * the words have to be read without ever taking the sentence away from the readers that already handle it ("cancel the
 * roofer reminder" still cancels a one-off), without stopping a series on a prohibition or a question, and without
 * guessing which series when the name fits none or two. The database half (the trigger, the duty, the clock changes) is
 * REPLICA-PROVEN by scripts/isolated/rm-series.ts; this is the part that needs no database.
 */

import { describe, expect, it } from 'vitest'
import {
  personalTaskRequest,
  pickSeries,
  seriesStopRequest,
  taskStateChange,
} from '../../src/agents/mine.ts'
import {
  seriesDoneSentence,
  seriesNotStoppedSentence,
  seriesStoppedSentence,
} from '../../src/agents/reminder-say.ts'

describe('the stop is read from his words', () => {
  it.each([
    ['stop recurring reminder', null],
    ['Cancel recurring reminder', null],
    ['end recurring reminder', null],
    ['end that recurring reminder', null],
    ['turn off the recurring reminder', null],
    ['Stop the Monday finance reminder', 'monday finance'],
    ['Stop the Monday finance reminder.', 'monday finance'],
    ['Can you stop the Monday finance reminder?', 'monday finance'],
    ['Please stop the weekly finance reminder.', 'finance'],
    ['cancel the recurring reminder to review my finances', 'review finances'],
    ['end the standing reminder to review my finances', 'review finances'],
    ['delete the repeating reminder about the roofer', 'roofer'],
    ['stop reminding me about the finances every Monday', 'finances monday'],
    ['stop reminding me every Monday to review my finances', 'monday review finances'],
    ['Please stop reminding me about the plumber.', 'plumber'],
  ])('%s -> a stop (%s)', (said, name) => {
    expect(seriesStopRequest(said)).toEqual({ name })
  })

  it.each([
    // not a stop at all
    'stop the car',
    'end the meeting',
    'delete the email',
    'I will stop by the reminders page',
    // a one-off cancel keeps going to the reader that handles it; this reader does not take it
    'cancel the roofer reminder',
    'bin the minibus reminder',
    // a prohibition, a question, a retraction
    "Don't stop the Monday reminder",
    'Do not stop the recurring reminder',
    'Why did you stop the reminder?',
    'Stop the Monday reminder, actually no',
    // a NEW reminder or task whose words mention a stop
    'Remind me every Monday to stop the printers',
    'Add a task to stop the recurring reminder emails',
    // a finish, not an end
    'mark the Monday finance reminder done',
    'tick off the recurring reminder',
    // no name and not about a reminder: a conduct sentence is not a series
    'stop reminding me',
    '',
  ])('%s -> nothing', (said) => {
    expect(seriesStopRequest(said)).toBeNull()
  })

  it('a one-off cancel is still read by taskStateChange, which this does not displace', () => {
    expect(taskStateChange('cancel the roofer reminder')).toEqual({
      state: 'cancelled',
      name: 'roofer',
    })
    expect(seriesStopRequest('cancel the roofer reminder')).toBeNull()
  })

  it('a sentence that is a request for a new reminder is read as one, not as a stop', () => {
    const said = 'Remind me every Monday to stop the printers.'
    expect(personalTaskRequest(said)).not.toBeNull()
    expect(seriesStopRequest(said)).toBeNull()
  })
})

describe('which series: exactly one, and never a guess', () => {
  const list = [
    { id: 'a', title: 'Review my finances', weekday: 'Monday' },
    { id: 'b', title: 'Review payroll', weekday: 'Friday' },
    { id: 'c', title: 'Water the plants', weekday: 'Monday' },
  ]
  it('a name that fits one picks it; the weekday is part of what names it', () => {
    expect(pickSeries('finances', list).one?.id).toBe('a')
    expect(pickSeries('monday finance', list).one?.id).toBe('a')
    expect(pickSeries('friday', list).one?.id).toBe('b')
  })
  it('a name that fits two picks neither and names both', () => {
    const got = pickSeries('review', list)
    expect(got.one).toBeNull()
    expect(got.many.map((s) => s.id)).toEqual(['a', 'b'])
    expect(pickSeries('monday', list).one).toBeNull()
  })
  it('a name that fits none picks none', () => {
    const got = pickSeries('pottery', list)
    expect(got.one).toBeNull()
    expect(got.many).toEqual([])
  })
  it('no name picks the only series, and with several picks none', () => {
    expect(pickSeries(null, [list[0] as (typeof list)[number]]).one?.id).toBe('a')
    expect(pickSeries(null, list).one).toBeNull()
  })
})

describe('what the office says, composed only from what happened', () => {
  const tz = 'Europe/Athens'
  it('a delivered occurrence completed: recorded, still repeating, and how to stop', () => {
    const s = seriesDoneSentence({
      title: 'Review my finances',
      occurrence: 'recorded',
      nextAt: '2026-10-19T06:00:00.000Z',
      skippedAt: null,
      timeZone: tz,
    })
    expect(s).toContain('Done for this time')
    expect(s).toContain('Monday 2026-10-19 at 09:00 (Europe/Athens)')
    expect(s).toContain('still repeating')
    expect(s).toContain('say “stop the Review my finances reminder”')
    expect(s).not.toContain('skipped')
  })
  it('an occurrence that had not fired is said to be skipped, with its time', () => {
    const s = seriesDoneSentence({
      title: 'Review my finances',
      occurrence: 'skipped',
      nextAt: '2026-10-19T06:00:00.000Z',
      skippedAt: '2026-10-12T06:00:00.000Z',
      timeZone: tz,
    })
    expect(s).toContain('had not come round yet')
    expect(s).toContain('Monday 2026-10-12 at 09:00')
    expect(s).toContain('skipped it')
  })
  it('a stop says so, and mentions the undo only when one was offered', () => {
    expect(seriesStoppedSentence({ title: 'X', undoOffered: true })).toContain('undo')
    expect(seriesStoppedSentence({ title: 'X', undoOffered: false })).not.toContain('undo')
    expect(seriesStoppedSentence({ title: 'X', undoOffered: false })).toMatch(/^Stopped/)
  })
  it('not stopping names why and never claims a stop', () => {
    const none = seriesNotStoppedSentence({ reason: 'nothing_recurring', name: null, titles: [] })
    const many = seriesNotStoppedSentence({ reason: 'many', name: null, titles: ['A', 'B'] })
    const nope = seriesNotStoppedSentence({ reason: 'none', name: 'pottery', titles: ['A'] })
    for (const s of [none, many, nope]) {
      expect(s).toContain('I have not stopped anything')
      expect(s).not.toMatch(/^Stopped/)
    }
    expect(many).toContain('“A”')
    expect(many).toContain('“B”')
    expect(nope).toContain('pottery')
  })
})

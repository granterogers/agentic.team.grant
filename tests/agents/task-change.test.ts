/**
 * "Actually make that Monday" (#259, migration 0516).
 *
 * The office could create a personal task by conversation and could never
 * change one — every follow-up in Grant's brief for this run ("changing due
 * date, priority, project or wording") did nothing at all.
 *
 * ## Both halves are required, and that is the safety
 *
 * A REFERENT and a CHANGE. Either alone is dangerous in a different direction:
 * a change with no referent would move a task nobody mentioned ("Friday is
 * going to be busy"), and a referent with no change would rewrite something to
 * nothing ("that is fine"). The controls below are the more important half of
 * this file, because this rule edits a row that already exists.
 *
 * ## Read the change, THEN look at the residue
 *
 * The first version asked for a bare referent up front and missed "make that
 * Monday" and "make that urgent" — a lookahead cannot tell a date from a
 * subject without knowing what a change looks like. So each recognised change
 * is stripped and what is LEFT decides, which is why "make that pricing
 * document urgent" is still refused: with `urgent` gone, `that` is followed by
 * a subject.
 */
import { describe, expect, it } from 'vitest'
import { personalTaskChange } from '../../src/agents/mine.ts'

/** A Wednesday. */
const WED = new Date('2026-09-16T10:00:00Z')

describe('a follow-up that changes the task just made', () => {
  it.each([
    ['Actually make that Monday', { due: '2026-09-21' }],
    ['Move it to Friday instead', { due: '2026-09-18' }],
    ['Push that to next week', { due: '2026-09-23' }],
    ['Bump that to tomorrow', { due: '2026-09-17' }],
  ])('%s moves the date', (said, want) => {
    expect(personalTaskChange(said, WED)?.due).toBe(want.due)
  })

  it('makes it urgent', () => {
    expect(personalTaskChange('Actually, make that urgent', WED)?.priority).toBe(10)
  })

  it('and takes the urgency back off', () => {
    /*
      This came back as 20 — IMPORTANT — on the first run, the opposite of what
      was asked, because the "important" pattern included a bare `priority` and
      matched inside "low priority". A list of patterns where an earlier one
      can swallow a later one's phrase is a list whose order is load-bearing.
    */
    expect(personalTaskChange('Change it to low priority', WED)?.priority).toBe(100)
  })

  it('renames it', () => {
    const got = personalTaskChange('Actually call it Ring the caterers', WED)
    expect(got?.title).toBe('Ring the caterers')
  })

  it('and says which of them it heard, so the office can say so too', () => {
    expect(personalTaskChange('Actually make that Monday', WED)?.matched).toEqual(['a new date'])
    expect(personalTaskChange('Make that urgent', WED)?.matched).toEqual(['how important it is'])
  })
})

describe('and every sentence it must leave alone', () => {
  it.each([
    ['Remind me Monday to ring the venue', 'a NEW task, not a change to the last one'],
    ['Right, set aside a task to renew the insurance', 'likewise'],
    ['That is fine', 'a referent with nothing to change'],
    ['Thanks, that is helpful', 'a pleasantry'],
    ['Friday is going to be busy', 'a date with nothing to point at'],
    ['Make that pricing document urgent', 'the referent names a subject — office work'],
    ['Change the pricing page to say Monday', 'likewise, with a date in it'],
    ['I need to move the venue booking to Monday', 'a new commitment of his own'],
  ])('%s — %s', (said) => {
    expect(personalTaskChange(said, WED)).toBeNull()
  })

  it('CONTROL: a change with no referent at all is refused however clear it is', () => {
    expect(personalTaskChange('Make it urgent', WED)).not.toBeNull()
    // …but with the referent removed there is nothing to act on.
    expect(personalTaskChange('Make urgent', WED)).toBeNull()
    expect(personalTaskChange('Monday instead', WED)).toBeNull()
  })

  it('CONTROL: empty and whitespace are not follow-ups', () => {
    expect(personalTaskChange('', WED)).toBeNull()
    expect(personalTaskChange('   ', WED)).toBeNull()
  })
})

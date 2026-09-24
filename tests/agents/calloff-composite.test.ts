/**
 * Ledger R26 — withdrawals as people say them, and replacements they contain.
 */
import { describe, expect, it } from 'vitest'
import { callsItOff } from '../../src/agents/calloff.ts'
import { readCorrection } from '../../src/agents/correction.ts'

describe('a composite withdrawal is a call-off', () => {
  it.each([
    "Actually forget it, don't bother with that.",
    'never mind, leave it',
    "Stop that, I've sorted the coach myself.",
    "Stop that one, we've booked a minibus instead",
    "don't bother",
    'no, leave it',
  ])('%s', (said) => {
    expect(callsItOff(said)).not.toBeNull()
    // and it is never offered back as a standing rule
    expect(readCorrection(said, true)).toBeNull()
  })
})

describe('a replacement is not swallowed by the call-off in front of it', () => {
  it.each([
    'forget it and draft the email instead',
    'scrap that and book the barn instead',
    'never mind the minibus, just do the caterers',
  ])('%s', (said) => {
    expect(callsItOff(said)).toBeNull()
  })
})

describe('NEGATIVE CONTROL: rules are still rules, names are still names', () => {
  it('stop + gerund is a rule, not a call-off', () => {
    expect(callsItOff('stop sending me updates')).toBeNull()
    expect(readCorrection('Stop sending me updates every hour', true)?.rule).toBe(
      'From now on, stop sending me updates every hour.',
    )
  })
  it('a named target is still named', () => {
    expect(callsItOff('forget the coach hire')).toEqual({ target: 'coach hire', pivot: 'forget' })
  })
})

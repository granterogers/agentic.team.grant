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

import { classifyIntent } from '../../src/agents/intent.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

describe('an elliptical "one" is a task when a task was just mentioned (R7/R26)', () => {
  const whole =
    'Add a task to ring the printers. Actually scrap that and add one to ring the venue instead.'
  it.each([
    'add one to ring the venue instead',
    'Actually scrap that and add one to ring the venue instead.',
  ])('%s', (clause) => {
    expect(taskRequest(clause, classifyIntent(clause), whole)?.title).toBe('ring the venue')
  })
  it('NEGATIVE CONTROL: with no task mentioned, "one" is not a task', () => {
    expect(
      taskRequest(
        'add one to ring the venue',
        classifyIntent('add one to ring the venue'),
        'ring the venue',
      ),
    ).toBeNull()
  })
  it('NEGATIVE CONTROL: "one of them" is not a request', () => {
    expect(
      taskRequest('one of them is late', classifyIntent('one of them is late'), whole),
    ).toBeNull()
  })
})

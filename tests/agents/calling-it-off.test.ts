/**
 * #315 — a turn that is nothing but a withdrawal.
 *
 * Measured on v733, in fresh material written for this:
 *
 *     Grant : have someone pull together everything we know about the two
 *             suppliers and what switching would involve   -> 2 children
 *     Grant : stop that, I do not need it any more         -> 0 stopped
 *     Grant : is anyone still working on the suppliers thing?
 *     office: …there's no record of anyone having started work on it.
 *
 * One child was paused and still in flight; the other had already produced an
 * output. `retraction.ts` reads a withdrawal inside ONE message and correctly
 * declines this shape, so it had no reader at all.
 *
 * ## The asymmetry is the opposite of the usual one
 *
 * `mine.ts` argues that a miss costs a to-do Grant adds himself and a false
 * positive costs the WORK. Here a false positive is worse again: it cancels
 * work in flight AND tells him that was deliberate. So the bar is higher, and
 * the negative controls carry the weight of this file.
 */

import { describe, expect, it } from 'vitest'
import { callsItOff } from '../../src/agents/calloff.ts'

describe('a whole turn that calls work off', () => {
  const POINTS_AT_IT = [
    'stop that, I do not need it any more',
    'stop that',
    'cancel that',
    'drop it',
    'okay, forget about that',
    'leave that, thanks',
    'call it off',
    'abandon that',
    'do not bother with that',
    "don't bother with that",
    'scrap that please',
    'hold off on it',
  ]

  it.each(POINTS_AT_IT)('is recognised, and names nothing: %s', (text) => {
    const got = callsItOff(text)
    expect(got).not.toBeNull()
    /*
      Null target is the whole point: "that" is grounded by the conversation,
      exactly as a follow-up rename is (#313). A caller given the string
      "that" would try to match it against work in flight and find nothing.
    */
    expect(got?.target).toBeNull()
  })

  const NAMES_IT: readonly (readonly [string, string])[] = [
    ['forget the suppliers thing', 'suppliers thing'],
    ['hold off on the pricing review', 'pricing review'],
    ['never mind the venue', 'venue'],
    ['scrap the competitor work', 'competitor work'],
  ]

  it.each(NAMES_IT)('%s names %s', (text, target) => {
    expect(callsItOff(text)?.target).toBe(target)
  })
})

describe('and what it must never claim', () => {
  /*
    Each of these would cancel live work if it were read as a call-off, and
    each was a real failure of an earlier draft of the recogniser or is one
    verb away from being one.
  */
  const NOT_A_CALL_OFF = [
    // A standing instruction about BEHAVIOUR. Reading it as a cancellation
    // would miss the rule AND destroy something.
    'stop sending me updates',
    'stop copying Ruby in',
    'stop bringing me the weekly report',
    // An instruction to act in the WORLD. This one was a live false positive:
    // "cancel" takes a real-world object far more often than an office one,
    // which is why a named target needs a verb that cannot mean anything else.
    'cancel the meeting with the caterers',
    'drop the middle tier',
    'skip the intro slide',
    // A replacement, which `retraction.ts` already reads correctly and would
    // be destroyed by a whole-turn rule.
    'forget about the budget for now, do the pricing instead',
    // Not a withdrawal at all.
    'stop',
    'what should we drop',
    'I want to drop the middle tier',
    'can you stop that from happening again',
    '',
  ]

  it.each(NOT_A_CALL_OFF)('declines: %s', (text) => {
    expect(callsItOff(text)).toBeNull()
  })
})

describe('the patterns are raw strings', () => {
  /*
    Written as plain template literals, every `\s+` is an unknown escape and
    collapses to a literal `s+`, so the patterns silently required the letter
    s and matched nothing. Twelve of thirteen probe sentences missed; the one
    that passed did so because its only `\s` was optional. The same family as
    the non-raw Python heredoc that turned `\b` into a backspace.

    Asserted behaviourally — a sentence with two spaces in it — rather than by
    reading the source, because the source can be rewritten and the property
    cannot.
  */
  it('so a multi-word sentence still matches', () => {
    expect(callsItOff('okay, forget about that')).not.toBeNull()
    expect(callsItOff('hold off on the pricing review')).not.toBeNull()
  })
})

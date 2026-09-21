/**
 * #290 — a preference recognised only with an explicit persistence marker.
 *
 * `understand.ts` classifies each surviving clause with a `kind`, and
 * `preference` is one of them. The handler filtered on that and then handed
 * the clause to `readTeaching`, where `STANDING` — a list of lexical
 * markers — demanded the same evidence a second time. The marker is how a
 * preference is spotted when nothing can read meaning; it is the WEAKER
 * evidence and it was gating the stronger.
 */

import { describe, expect, it } from 'vitest'
import { readTeaching } from '../../src/agents/teaching.ts'

describe('a preference the meaning-reader already recognised', () => {
  /*
    None of these carries "always", "from now on" or any other marker, and
    every one is a statement about how the office should work.
  */
  const preferences = [
    'so lead with the conclusion, I will read the why underneath',
    'keep your answers to a couple of short paragraphs, I have not got time for essays',
    'put the numbers in a table rather than writing them out in a sentence',
    'when something is uncertain, say so at the top instead of burying it',
    'I would rather you asked than guessed at which project I mean',
  ]

  for (const said of preferences) {
    it(`is stored once the meaning is known: ${said.slice(0, 40)}`, () => {
      expect(readTeaching(said, true)?.kind).toBe('lesson')
    })

    it(`is NOT stored on the lexical route alone: ${said.slice(0, 40)}`, () => {
      expect(readTeaching(said, false)).toBeNull()
    })
  }

  /*
    The guard that keeps `preference.one-off-override` working. Widening
    recognition without this would turn "keep it short on this one" into a
    rule that shortens every answer afterwards - a worse defect than the
    one being fixed, because the person cannot see it happen.
  */
  const onceOnly = [
    'lead with the conclusion on this one, I will read the why underneath',
    'keep it to a couple of lines just this once, I am on my phone',
    'put it in a table for this one, it is a lot of numbers',
    'skip the caveats this time, I only need the figure',
  ]

  for (const said of onceOnly) {
    it(`stays a one-off: ${said.slice(0, 40)}`, () => {
      expect(readTeaching(said, true)).toBeNull()
    })
  }

  it('believes an explicit marker over a one-off phrase, because that is a contradiction', () => {
    expect(readTeaching('from now on keep it short, just this once', true)?.kind).toBe('lesson')
  })

  it('leaves the lexical route exactly as it was', () => {
    expect(readTeaching('always ask me before anything goes out')?.kind).toBe('lesson')
    expect(readTeaching('send me the quarterly report by friday please')).toBeNull()
    expect(readTeaching('can you look at the pricing and tell me what you think')).toBeNull()
  })
})

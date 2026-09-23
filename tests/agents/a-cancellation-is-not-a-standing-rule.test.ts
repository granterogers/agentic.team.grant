/**
 * "Okay, never mind about that." is not a standing instruction.
 *
 * `STANDING` in `teaching.ts` contains the bare word `never`, so that
 * sentence matched it. `dimensionOf` returns null for it, so `withdrawsARule`
 * returns null too, so neither the retraction branch nor the
 * nothing-to-drop branch in `remember()` could fire — and it was stored as a
 * standing rule at 0.95 confidence, `learned_by grant`, live in every Chief
 * of Staff prompt from 15 September.
 *
 * `remember()` names that exact sentence in its own comment as the thing a
 * fix prevented. The fix was elsewhere; the sentence would have been stored
 * again today. A comment claiming a property is worth nothing without a
 * check behind it, which is the most-repeated line in CLAUDE.md.
 *
 * The same shape as a destructive-tool matcher that could not see inside
 * `delete_everything`: a marker matching inside a fixed phrase whose meaning
 * is the opposite of the marker's.
 */

import { describe, expect, it } from 'vitest'
import { opensByDroppingIt } from '../../src/agents/clarify.ts'
import { readTeaching } from '../../src/agents/teaching.ts'

describe('a sentence that opens by dropping something teaches nothing', () => {
  it.each([
    'Okay, never mind about that.',
    'never mind about that, it does not matter now',
    'Actually, forget it — leave that one alone for now',
    'No need to bother with that, drop it',
    'Right, scrap it, I will do that one myself',
  ])('%j is not stored as a rule', (said) => {
    expect(opensByDroppingIt(said)).toBe(true)
    expect(readTeaching(said)).toBeNull()
  })
})

describe('and a real standing rule still is one', () => {
  /*
    The expensive direction. "no need" and "leave it" are ordinary English
    inside a preference, so a blanket exclusion would have cost real rules —
    which is why this is anchored to the opening rather than tested anywhere
    in the sentence. The last two are the rules the office actually holds.
  */
  it.each([
    'From now on there is no need to cc me on the supplier emails',
    'Never send me a summary without the numbers underneath it',
    'Always give your information in the form of clear bullet points',
    'From now on, always paste the image URLs into the reply as well',
  ])('%j is still a rule', (said) => {
    expect(opensByDroppingIt(said)).toBe(false)
    expect(readTeaching(said)).not.toBeNull()
  })
})

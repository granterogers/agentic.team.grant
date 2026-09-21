/**
 * A courtesy word may not swallow a retraction.
 *
 * #291's lookbehind exists so that an operator being ASKED FOR is not read
 * as one being PERFORMED: "please do not forget to send it" is an
 * instruction to remember, and reading it as a pivot would withdraw the very
 * thing it insists on. Its own comment states the rule - *"a negative or a
 * modal immediately in front turns the operator into its own opposite"* -
 * and the list held one word that is neither: `please`.
 *
 * So every retraction a person asked for politely was invisible:
 *
 *     "send the note please forget that"                  -> nothing seen
 *     "send that to the funding officer please leave it"  -> nothing seen
 *     "give me full detail please actually no ..."        -> nothing seen
 *
 * The middle one is almost verbatim one of the three live cases #291 was
 * written for, with the courtesy word added. Found by the Shadow Grant
 * 29-arc sweep, which produced *"full detail on this one please actually no
 * we still owe the funding officer the paperwork"* - an intact pivot that
 * the office could not see.
 *
 * ## Why removing it is not a hole
 *
 * The two cases `please` appeared to be protecting are both already covered,
 * by guards written for them:
 *
 *   - "please cancel the Thursday booking" - the operator opens the message,
 *     so nothing precedes it, and `readRetraction` refuses a pivot with
 *     fewer than eight characters of content in front of it. There is
 *     nothing to take back.
 *   - "please remember to cancel the room" - `remember to` is in the
 *     lookbehind and is doing the work; `please` is decoration in front of
 *     it.
 *
 * Both are controls below. A fix that turns a safety detector on is only
 * acceptable beside the proof that it has not turned the refusals off - and
 * the asymmetry here is the dangerous way round, because a false pivot drops
 * something the person asked for.
 */

import { describe, expect, it } from 'vitest'
import { readRetraction } from '../../src/agents/retraction.ts'

/*
  Semantic neighbours, not the sentence that failed. CLAUDE.md: convert a
  finding into a permanent regression made of neighbours of it, never the
  one string, because the one string is a wording lock.
*/
const politeRetractions: [string, string][] = [
  ['forget, after an ask', 'send the note to the funding officer please forget that'],
  [
    'leave it, the live #291 shape',
    'send that to the funding officer please leave it I will do it',
  ],
  ['a bare pivot', 'give me the full detail on this one please actually no redo the budget page'],
  ['scrap, mid-message', 'redo the budget page please scrap that chase the letter instead'],
  [
    'drop, with a named target',
    'chase the letter and redo the budget page please drop the budget page',
  ],
  [
    'courtesy at the end of the withdrawn clause',
    'push the deadline to the tenth please no wait leave it where it was',
  ],
  ['capitalised', 'Book the venue for Thursday. Please scrap that, book it for Friday.'],
]

describe('a retraction asked for politely is still a retraction', () => {
  for (const [what, said] of politeRetractions) {
    it(`sees it: ${what}`, () => {
      expect(readRetraction(said)).not.toBeNull()
    })
  }
})

/*
  The other half, and the half that matters more. A detector shown only its
  successes cannot be distinguished from one that always says yes - which
  this repository records about the judge that marked everything poor and
  scored perfectly on a corpus of poor answers.
*/
const notRetractions: [string, string][] = [
  ['the operator IS the task', 'please cancel the Thursday booking and tell the venue'],
  ['a polite reminder', 'please remember to cancel the room if nobody signs up'],
  ['nothing precedes it', 'please scrap that'],
  ['a negated operator', 'please do not forget to send it'],
  ['a verb with a complement', 'please leave it where it is'],
  ['a schedule, not a pivot', 'please hold off until Friday'],
  ['an answer containing no', 'please check whether there is no entry for the tenth'],
  ['cancelling as the work itself', 'please cancel the room booking and let the venue know'],
]

describe('and a courtesy word does not invent one', () => {
  for (const [what, said] of notRetractions) {
    it(`refuses it: ${what}`, () => {
      expect(readRetraction(said)).toBeNull()
    })
  }
})

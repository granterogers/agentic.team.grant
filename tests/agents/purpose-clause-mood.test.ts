/**
 * The mood of a sentence is set by its MAIN clause.
 *
 * `readClause` refuses to treat a message as a request when it finds a
 * prohibition in it, and deliberately scans the whole clause: *"make me a
 * task but don't send anything"* needs the second half to stop the second
 * half only. It already followed CONTRASTIVE subordinators for exactly that
 * reason - the prohibition lives on the far side of the "but", so the head
 * clause is still an instruction.
 *
 * Purpose subordinators were never covered, and they are the same shape:
 *
 *     "stick something down so I do not forget to ring Kevin"
 *     "book the venue so we do not lose the slot"
 *     "put a note down so that I do not forget the tenth"
 *
 * Every one read as a remark, because "do not" was sitting in a subordinate
 * clause explaining WHY. So the commonest reason a person asks for a
 * reminder at all - so that they do not forget - was the one phrasing that
 * guaranteed nothing would be filed.
 *
 * Found by the Shadow Grant multi-turn sweep: *"stick something down so i do
 * not forget to ring kevin about the quote"* was not recognised as a request
 * at all, while the identical sentence ending *"so I remember to ring
 * Kevin"* classified as an assignment.
 *
 * CLAUDE.md records this correction twice already - once for a delegation's
 * span, once for `teaching.ts` and complement clauses. This is the third
 * instance, and it is why purpose subordinators join the contrastive ones in
 * the existing rule rather than getting a rule of their own.
 */

import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import { readClause } from '../../src/agents/request.ts'

/*
  Neighbours of the finding, not the finding. Different imperative verbs,
  different purpose connectives, different persons - because a corpus of one
  sentence is a wording lock, which this repository records six times.
*/
/*
  Every one of these carries a real prohibition, so every one enters the
  branch under test. The first draft had two that did not - "to avoid
  missing the deadline" and "in order not to clash" contain no FORBIDS term
  at all - so they passed with the fix sabotaged. A test that cannot fail is
  not a test, and the sabotage run is what said so.
*/
const instructions: [string, string][] = [
  ['so I do not forget', 'stick something down so I do not forget to ring Kevin about the quote'],
  ['so we do not lose', 'book the venue so we do not lose the slot'],
  ['so that, spelled out', 'put a note down so that I do not forget the tenth'],
  ['to avoid', 'send the reminder to avoid them saying they never heard from us'],
  ['in order that', 'book the room in order that we do not lose the slot'],
  ['to make sure', 'redo the budget page to make sure we do not submit the old one'],
  ['a contrast, which already worked', 'make a note of it but do not send anything'],
  ['contracted', "add a task for the welcome pack so I don't forget it"],
]

describe('a prohibition in a purpose clause does not silence the instruction', () => {
  for (const [what, said] of instructions) {
    it(`reads as an ask: ${what}`, () => {
      expect(readClause(said).mood).toBe('ask')
    })
  }

  /*
    And the same sentence through the classifier, because the mood is only
    half the path: the complaint that found this was `recognised === false`,
    which is what the office acts on.
  */
  it('and the classifier recognises it as work', () => {
    const c = classifyIntent(
      'stick something down so I do not forget to ring Kevin about the quote',
    )
    expect(c.recognised).toBe(true)
  })

  it('reads the same with and without the purpose clause', () => {
    const withIt = readClause('book the venue so we do not lose the slot')
    const without = readClause('book the venue')
    expect(withIt.mood).toBe(without.mood)
  })
})

/*
  The controls, and they matter more than the cases above.

  This change makes a safety detector FIRE LESS, which is the dangerous
  direction: a prohibition wrongly discarded is the office doing something
  it was told not to. Every one of these must still be refused.
*/
const stillProhibitions: [string, string][] = [
  ['the head is itself forbidden', 'do not book the venue so we do not lose the slot'],
  ['a hold in the head', 'hold off on the venue so we do not commit'],
  ['a bare prohibition', 'do not contact anyone'],
  ['no need to, with a purpose clause', 'no need to chase it so we do not annoy them'],
  ['a standing prohibition', 'never contact anybody without checking with me first'],
  ['a discourse marker, not a subordinator', 'ok so never contact anybody about this'],
  ['the head is not an instruction', 'the deadline moved so we do not need the venue yet'],
  ['leave it alone', 'leave the budget page alone so we do not confuse the reviewer'],
]

describe('and a real prohibition is still a prohibition', () => {
  for (const [what, said] of stillProhibitions) {
    it(`refuses it: ${what}`, () => {
      expect(readClause(said).mood).toBe('remark')
    })
  }
})

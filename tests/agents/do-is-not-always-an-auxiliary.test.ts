/**
 * "do" is an auxiliary only when a SUBJECT follows it.
 *
 *     "do what you think is best and let me know"
 *     "do whatever makes sense to move the other one along"
 *
 * Both are Grant handing the office the decision. Both read as `unsure` and
 * classified as an unrecognised `thought` - not seen as a request at all -
 * because `do` sat in the function-word list unconditionally.
 *
 * Four of the 123 genuinely delivered real messages in sixty days are this
 * shape. That is the highest real-traffic count of any reading defect the
 * Shadow Grant sweep turned up, and the only one above one: the ampersand
 * defect beside it occurs zero times in real traffic and is filed rather
 * than fixed.
 *
 * ## The question form was already handled
 *
 * `INVERTED` reads "do the trains run", "do we need", "do you think" as
 * questions one branch above this one. So `do` needed no entry in the
 * function-word set at all - it needed a subject test, and there already was
 * one. Two rules deciding the same thing is how they come to disagree.
 *
 * (`INVERTED` was missing "you", so "do you think" reached the later branch
 * and was called unsure rather than a question. Found by the same run.)
 */

import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import { readClause } from '../../src/agents/request.ts'

const delegations: [string, string][] = [
  ['the real one, from his own traffic', 'do what you think is best and let me know'],
  ['whatever', 'do whatever makes sense to move the other one along'],
  [
    'with a prohibition beside it',
    'do whatever makes sense to move it along but do not contact anyone',
  ],
  ['as you see fit', 'do as you see fit with the budget page'],
  ['what needs doing', 'do what needs doing on the bid before Thursday'],
]

describe('an imperative "do" is a request', () => {
  for (const [what, said] of delegations) {
    it(`reads as an ask: ${what}`, () => {
      expect(readClause(said).mood).toBe('ask')
    })
    it(`and is recognised as work: ${what}`, () => {
      expect(classifyIntent(said).recognised).toBe(true)
    })
  }
})

/*
  The controls. This makes the office read MORE messages as instructions,
  which is the direction that acts on something it was not asked to - so
  every question must still be a question.
*/
const questions: [string, string][] = [
  ['do you', 'do you think the budget page is ready'],
  ['do we', 'do we need the letter of support'],
  ['do the', 'do the trains run on Sunday'],
  ['do they', 'do they know about the tenth'],
  ['does', 'does the venue need confirming'],
  ['did', 'did the funding officer reply'],
  ['do I', 'do I have anything on Thursday'],
]

describe('and a question beginning with "do" is still a question', () => {
  for (const [what, said] of questions) {
    it(`refuses to call it an ask: ${what}`, () => {
      expect(readClause(said).mood).not.toBe('ask')
    })
  }

  it('and a prohibition is untouched', () => {
    expect(readClause('do not contact anyone').mood).toBe('remark')
  })
})

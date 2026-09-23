/**
 * Asking who is on something must not set more people on it (#327).
 *
 * ## What a twelve-turn session measured
 *
 *   Grant : right so the thing I need this morning is somebody to work out
 *           what the venue change does to the budget, and separately I want a
 *           view on whether the sponsors will wear it
 *   office: (convenes — three children, one paused for approval)
 *   Grant : who have you got on that
 *   office: "Nothing has changed yet — I have handed this on in 2 pieces"
 *
 * It handed it on AGAIN. `asksWhoIsOnIt` did not recognise the sentence, so
 * the turn fell through to the ordinary instruction path, which convened the
 * quality director a second time and spawned a second synthesis — two more
 * children and two more model calls to answer a question the rows already
 * held. #317 built `app.conversation_work` precisely so that question is
 * answered from child-job state.
 *
 * The cost is not a worse sentence. It is invisible duplicated work, on the
 * commonest follow-up there is.
 *
 * ## The class, not the sentence
 *
 * `who is on that` was recognised and `who have you got on that` was not,
 * because the pattern went straight from `who` to a working verb. Dictated
 * English puts the office's own verb in between, and drops the apostrophe in
 * `who's`. What is bounded now is what that span may CONTAIN — an auxiliary
 * with the office as its subject — rather than a list of verb forms, which is
 * the enumeration that was wrong in the first place.
 *
 * The negatives carry the weight: `who SHOULD WE PUT on that` asks for an
 * assignment and must still reach the path that makes one.
 */

import { describe, expect, it } from 'vitest'
import { asksWhoIsOnIt } from '../../src/agents/whoison.ts'

describe('the ways a person asks who is on something', () => {
  it('are recognised however the verb falls', () => {
    for (const said of [
      'who have you got on that',
      'who have you got on that?',
      'who have you put on it',
      'whos working on that',
      "who's working on that",
      'who is on that',
      'who is on this',
      'how many people are on it',
      'is anyone looking at that',
      'who have you got on the pricing review',
    ]) {
      expect(asksWhoIsOnIt(said), said).not.toBeNull()
    }
  })
})

describe('and asking for an assignment is not asking for a status', () => {
  it('declines anything that wants somebody PUT on it', () => {
    for (const said of [
      'who should we put on that',
      'who can look at the pricing review',
      'who do you think should own this',
      'who is the best person to write the sponsor note',
      'get somebody good on that',
      'put Emma on the pricing review',
    ]) {
      expect(asksWhoIsOnIt(said), said).toBeNull()
    }
  })

  it('declines a status question that also carries its own request', () => {
    expect(asksWhoIsOnIt('who have you got on that, and also draft the note')).toBeNull()
  })

  it('declines a question about something else entirely', () => {
    expect(asksWhoIsOnIt('I want to know what the venue change does to the budget')).toBeNull()
    expect(asksWhoIsOnIt('what is the state of that?')).toBeNull()
  })
})

/*
  The hand-off guard's own assertion lives in
  `tests/agents/one-live-attempt.test.ts`, beside the rest of the convening
  contract, rather than being stated a second time here. One assembly, one
  caller — two copies of a source assertion is how they come to disagree.
*/

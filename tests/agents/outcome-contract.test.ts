/**
 * The outcome contract — #302.
 *
 * Six classes, each proved from canonical counts alone, and the rule they all
 * exist for: **a commitment to the future is permitted only where a canonical
 * pending action exists.**
 *
 * Every case below is a set of COUNTS. Nothing here contains a sentence the
 * office might say, which is the property that makes this survive the next way
 * somebody finds to phrase "I did it" — the failure mode that took
 * `claimsToHaveMade` six revisions and still missed the future tense.
 */

import { describe, expect, it } from 'vitest'
import type { CanonicalOutcome, OutcomeClass } from '../../src/agents/outcome.ts'
import {
  classifyOutcome,
  contractFor,
  OWES_A_SENTENCE,
  sayWhatHappened,
} from '../../src/agents/outcome.ts'

const at = (over: Partial<CanonicalOutcome> = {}): CanonicalOutcome => ({
  wanted: 0,
  landed: 0,
  pendingActions: 0,
  awaitingApproval: false,
  missing: [],
  capabilityRefused: false,
  attempt: 1,
  maxAttempts: 4,
  asked: true,
  settled: true,
  ...over,
})

describe('every class is reachable from counts', () => {
  const cases: [OutcomeClass, CanonicalOutcome][] = [
    ['completed', at({ wanted: 1, landed: 1 })],
    ['partially_completed', at({ wanted: 3, landed: 2 })],
    ['blocked_needs_user', at({ wanted: 1, landed: 0, missing: ['which project'] })],
    ['blocked_capability', at({ wanted: 1, landed: 0, capabilityRefused: true })],
    ['pending_approval', at({ wanted: 1, awaitingApproval: true })],
    ['failed_after_retries', at({ wanted: 1, landed: 0, attempt: 4, maxAttempts: 4 })],
  ]

  for (const [expected, c] of cases) {
    it(`reaches ${expected}`, () => {
      expect(classifyOutcome(c)).toBe(expected)
    })
  }

  /*
    Every class, not a sample of them.

    A test file that happens to cover five of six looks identical to one that
    covers all six, and the sixth is where the defect lives. Asserting the
    SET rather than counting the cases, so adding a class to the union breaks
    this rather than quietly leaving it untested.
  */
  it('covers the whole union, so none is untested by omission', () => {
    const reached = new Set(cases.map(([k]) => k))
    const declared: OutcomeClass[] = [
      'completed',
      'partially_completed',
      'blocked_needs_user',
      'blocked_capability',
      'pending_approval',
      'failed_after_retries',
    ]
    expect([...reached].sort()).toEqual([...declared].sort())
  })
})

describe('the rule #302 turns on: a promise needs something to keep it', () => {
  it('REFUSES a commitment when nothing is pending — the retry escape hatch', () => {
    const c = at({ wanted: 1, landed: 0, missing: ['which project'] })
    expect(contractFor(c).mayCommitToFuture).toBe(false)
  })

  it('PERMITS one when a child job exists', () => {
    expect(contractFor(at({ wanted: 1, landed: 0, pendingActions: 1 })).mayCommitToFuture).toBe(
      true,
    )
  })

  it('PERMITS one when the job is paused on his word', () => {
    expect(contractFor(at({ wanted: 1, awaitingApproval: true })).mayCommitToFuture).toBe(true)
  })

  /*
    The two halves of the #302 reproduction, side by side.

    "I'll draft the outline" is the SAME SENTENCE in both, and the contract
    differs — which is exactly what a phrase list cannot do, and the reason
    this is not one.
  */
  it('the same wording is permitted or not according to the rows alone', () => {
    const withWork = at({ wanted: 1, landed: 0, pendingActions: 1 })
    const without = at({ wanted: 1, landed: 0, missing: ['which project'] })
    expect(contractFor(withWork).mayCommitToFuture).toBe(true)
    expect(contractFor(without).mayCommitToFuture).toBe(false)
  })

  it('never lets anything but completion claim completion', () => {
    for (const c of [
      at({ wanted: 3, landed: 2 }),
      at({ wanted: 1, landed: 0, missing: ['a title'] }),
      at({ wanted: 1, landed: 0, capabilityRefused: true }),
      at({ wanted: 1, awaitingApproval: true }),
      at({ wanted: 1, landed: 0, attempt: 4, maxAttempts: 4 }),
    ]) {
      expect(contractFor(c).mayClaimCompletion).toBe(false)
    }
  })
})

describe('a turn that wanted nothing is complete, not blocked', () => {
  /*
    The control that stops this becoming a gate that fires on everything.

    A question, an acknowledgement and a stated preference all end with zero
    effects and all three are CORRECT. The first draft classified them as
    blocked, which would have put "I have not done this" on the end of every
    "thanks" — a check that fires on good behaviour is one somebody switches
    off, which this repository records twice.
  */
  for (const [what, c] of [
    ['a bare question', at()],
    ['a question with something missing named', at({ missing: ['which project'] })],
    ['an acknowledgement on the last attempt', at({ attempt: 4, maxAttempts: 4 })],
  ] as [string, CanonicalOutcome][]) {
    it(`is completed: ${what}`, () => {
      expect(classifyOutcome(c)).toBe('completed')
      expect(sayWhatHappened(c)).toBeNull()
      expect(contractFor(c).mustAsk).toBe(false)
    })
  }
})

describe('the sentence is composed from the rows, and only where it is owed', () => {
  it('says nothing on a completed turn', () => {
    expect(sayWhatHappened(at({ wanted: 1, landed: 1 }))).toBeNull()
  })

  it('names the gap rather than the mechanism', () => {
    const said = sayWhatHappened(
      at({ wanted: 1, landed: 0, missing: ['which project to put it on'] }),
    )
    expect(said).toContain('which project to put it on')
    expect(said).toContain('not done')
  })

  it('distinguishes what happened from what did not', () => {
    const said = sayWhatHappened(at({ wanted: 3, landed: 2, missing: ['a due date'] }))
    expect(said).toContain('2 of 3')
    expect(said).toContain('a due date')
  })

  it('lists several gaps readably', () => {
    const said = sayWhatHappened(
      at({ wanted: 1, landed: 0, missing: ['which project', 'a title', 'a date'] }),
    )
    expect(said).toContain('which project, a title and a date')
  })

  /*
    No internal reference reaches a sentence he reads.

    Seven outputs in thirty days opened "Setting aside constraint #242." — an
    issue number from a gate's own refusal, in an announcement email. A
    comment is for a person and a message is for a model; this asserts the
    property over every class rather than over the one that was wrong.
  */
  it('never leaks an issue number or a section mark', () => {
    for (const c of [
      at({ wanted: 3, landed: 2 }),
      at({ wanted: 1, landed: 0, missing: ['which project'] }),
      at({ wanted: 1, landed: 0, capabilityRefused: true }),
      at({ wanted: 1, awaitingApproval: true }),
      at({ wanted: 1, landed: 0, attempt: 4, maxAttempts: 4 }),
    ]) {
      expect(sayWhatHappened(c) ?? '').not.toMatch(/#\d{2,4}\b|§\d+/)
    }
  })

  it('owes a sentence in exactly the classes that are not completed', () => {
    const owed = OWES_A_SENTENCE
    expect(owed).not.toContain('completed')
    for (const cls of owed) expect(cls).not.toBe('completed')
    expect(owed).toHaveLength(5)
  })
})

describe('the order of the rules is the argued one', () => {
  it('spent attempts outrank a nameable gap', () => {
    const c = at({ wanted: 1, landed: 0, missing: ['which project'], attempt: 4, maxAttempts: 4 })
    expect(classifyOutcome(c)).toBe('failed_after_retries')
  })

  it('but NOT when something is already pending — that work is still coming', () => {
    const c = at({ wanted: 1, landed: 0, pendingActions: 1, attempt: 4, maxAttempts: 4 })
    expect(classifyOutcome(c)).toBe('pending_approval')
  })

  it('approval outranks a capability refusal', () => {
    const c = at({ wanted: 1, awaitingApproval: true, capabilityRefused: true })
    expect(classifyOutcome(c)).toBe('pending_approval')
  })

  it('a capability refusal outranks a nameable gap, so his time is not wasted', () => {
    const c = at({ wanted: 1, landed: 0, missing: ['which project'], capabilityRefused: true })
    expect(classifyOutcome(c)).toBe('blocked_capability')
  })

  it('partial success is not failure, even with attempts spent', () => {
    const c = at({ wanted: 3, landed: 2, attempt: 4, maxAttempts: 4 })
    expect(classifyOutcome(c)).toBe('partially_completed')
  })
})

describe('an unexplained miss does not invent an incapability', () => {
  /*
    The flaw found by wiring this up rather than by reading it.

    The first classifier fell back to `blocked_capability` whenever nothing
    was named, so "it is not something I can do" would have been asserted
    about work the office simply failed to parse. That is a fresh fabrication
    in the sentence written to stop fabrications — and only an explicit
    `capabilityRefused`, which a caller has to establish, licenses the claim.
  */
  it('is blocked_needs_user, not blocked_capability', () => {
    expect(classifyOutcome(at({ wanted: 1, landed: 0 }))).toBe('blocked_needs_user')
  })

  it('and says so without claiming to know what is missing', () => {
    const said = sayWhatHappened(at({ wanted: 1, landed: 0 })) ?? ''
    expect(said).toContain('have not done this')
    expect(said).not.toContain('not something I can do')
  })

  it('only an established refusal claims incapability', () => {
    const said = sayWhatHappened(at({ wanted: 1, landed: 0, capabilityRefused: true })) ?? ''
    expect(said).toContain('not something I can do')
  })
})

describe('an unfinished turn cannot have failed after retries', () => {
  /*
    Found live, and it is a classification defect rather than a narration one.

    A job in state `complete` on attempt 4 opened with *"I could not get this
    done after 4 attempts, and nothing was created"* and then answered the
    question in the next sentence. The attempt count was right; the
    conclusion drawn from it was not.

    The handler asks this WHILE composing an answer, so its attempt count can
    equal the maximum on a turn that is about to succeed - which is exactly
    when the office answers best, because it has the previous refusals in
    front of it. `failed_after_retries` is a fact about a settled job, and
    only a reader of settled state may reach it.
  */
  it('does NOT classify as failed while the turn is still being answered', () => {
    const stillGoing = at({ wanted: 1, landed: 0, attempt: 4, maxAttempts: 4, settled: false })
    expect(classifyOutcome(stillGoing)).not.toBe('failed_after_retries')
  })

  it('and says nothing about attempts to him', () => {
    const said =
      sayWhatHappened(at({ wanted: 1, landed: 0, attempt: 4, maxAttempts: 4, settled: false })) ??
      ''
    expect(said).not.toContain('attempts')
  })

  it('but a SETTLED job with nothing to show still reaches it', () => {
    const done = at({ wanted: 1, landed: 0, attempt: 4, maxAttempts: 4, settled: true })
    expect(classifyOutcome(done)).toBe('failed_after_retries')
  })

  it('and a settled turn on an early attempt does not', () => {
    const early = at({ wanted: 1, landed: 0, attempt: 1, maxAttempts: 4, settled: true })
    expect(classifyOutcome(early)).not.toBe('failed_after_retries')
  })
})

describe('work handed on is never silent', () => {
  /*
    The under-claiming half of #302, found on v717 by the coherence oracle.

    A dictated message carrying four intentions fanned out to FOUR child jobs,
    and because its readings did not count as `wanted` the class came out
    `completed`, no sentence was owed, and Grant was told:

        "I have nothing from earlier in this conversation — this is the first
         thing you have said to me here…"

    Four specialists were working and he was told nothing was happening. The
    contract governed over-claiming in every direction and had no rule for
    under-claiming, which is the same defect with the sign reversed: an office
    that starts work and does not say so is one he cannot plan around.

    Found in FOUR turns of the recorded corpus, so it is a pattern rather than
    one answer.
  */
  it('is pending even when nothing was read as wanted', () => {
    expect(classifyOutcome(at({ wanted: 0, pendingActions: 4 }))).toBe('pending_approval')
    expect(sayWhatHappened(at({ wanted: 0, pendingActions: 4 }))).toContain('handed this on')
  })

  it('counts what was handed on, when there is more than one piece', () => {
    expect(sayWhatHappened(at({ wanted: 0, pendingActions: 4 }))).toContain('4 pieces')
    expect(sayWhatHappened(at({ wanted: 0, pendingActions: 1 }))).not.toContain('pieces')
  })

  it('does not tell him a colleague is waiting on HIM', () => {
    /*
      `awaitingApproval` is a blocker with his name on it; `pendingActions` is
      work already handed to somebody. Saying four specialists are "waiting on
      your word" would make him wait for a decision nobody needs while the
      office waits for him — false in the expensive direction.
    */
    expect(sayWhatHappened(at({ pendingActions: 3 }))).not.toContain('your word')
    expect(sayWhatHappened(at({ awaitingApproval: true }))).toContain('your word')
  })

  it('and a turn that did the work itself still says nothing extra', () => {
    expect(sayWhatHappened(at({ wanted: 1, landed: 1 }))).toBeNull()
  })
})

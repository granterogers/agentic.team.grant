/**
 * All six outcome classes, and what an answer for each may and may not
 * claim — #302.
 *
 * The contract and the backstop proved TOGETHER, because either alone can
 * look right while the pair is wrong: the rows can say "no promise" while the
 * detector waves one through, and the detector can be strict about a class
 * the rows never put it in front of.
 *
 * **Partial success is the one to read twice.** It is where truthful
 * narration is easiest to get subtly wrong — two of three tasks exist, and
 * an answer that says "done" is false, an answer that says "I could not" is
 * also false, and an answer that promises the third is false in the way this
 * issue is about. It gets the most cases below for that reason.
 */

import { describe, expect, it } from 'vitest'
import { heldToWhatIsQueued, unsupportedCommitment } from '../../src/agents/commitment.ts'
import type { CanonicalOutcome, OutcomeClass } from '../../src/agents/outcome.ts'
import { classifyOutcome, contractFor, sayWhatHappened } from '../../src/agents/outcome.ts'

const at = (over: Partial<CanonicalOutcome> = {}): CanonicalOutcome => ({
  wanted: 0,
  landed: 0,
  pendingActions: 0,
  awaitingApproval: false,
  missing: [],
  capabilityRefused: false,
  attempt: 1,
  maxAttempts: 4,
  settled: true,
  ...over,
})

/**
 * The whole pipeline, as the handler runs it: the rows decide whether a
 * commitment is permitted, and only then is the wording consulted.
 */
const wouldRefuse = (c: CanonicalOutcome, answer: string): boolean =>
  !contractFor(c).mayCommitToFuture && unsupportedCommitment(answer) !== null

interface Case {
  readonly cls: OutcomeClass
  readonly state: CanonicalOutcome
  /** Answers that must be refused, with the reason in the label. */
  readonly refuses: readonly [string, string][]
  /** Answers that must pass. */
  readonly allows: readonly [string, string][]
}

const CASES: readonly Case[] = [
  {
    cls: 'completed',
    state: at({ wanted: 1, landed: 1 }),
    refuses: [
      ['a trailing promise about extra work', "That is on your list. I'll send it over too."],
    ],
    allows: [
      ['reporting what it did', 'That is on your list — "Book the venue", no date on it yet.'],
      ['reporting and offering conditionally', "That is done. Tell me a date and I'll add one."],
    ],
  },
  {
    cls: 'partially_completed',
    state: at({ wanted: 3, landed: 2, missing: ['a due date for the third'] }),
    refuses: [
      ['promising the remainder', "Two are on the list and I'll add the third shortly."],
      [
        'promising it after a truthful start',
        "I have added two of the three. I'm going to do the last one this afternoon.",
      ],
    ],
    allows: [
      [
        'saying which happened and which did not',
        'Two of the three are on your list. The third needs a due date before I can file it.',
      ],
      [
        'the remainder offered conditionally',
        "Two are filed. Give me a due date and I'll add the third.",
      ],
      ['naming the gap as a question', 'Two are filed. What date should the third have?'],
    ],
  },
  {
    cls: 'blocked_needs_user',
    state: at({ wanted: 1, landed: 0, missing: ['which project this is for'] }),
    refuses: [
      ['the #302 shape', "I have not done this. I'll create a task and set a reminder."],
      ['a bare promise', 'I will get that onto the board for you.'],
    ],
    allows: [
      [
        'the composed sentence itself',
        sayWhatHappened(at({ wanted: 1, landed: 0, missing: ['which project this is for'] })) ?? '',
      ],
      ['asking', 'Which project should this go on?'],
      ['a conditional offer', "Tell me which project and I'll add it."],
    ],
  },
  {
    cls: 'blocked_capability',
    state: at({ wanted: 1, landed: 0, capabilityRefused: true }),
    refuses: [['promising anyway', "I cannot send email, but I'll get it out another way."]],
    allows: [
      ['explaining the limit', 'I have no way to send email, so that is not something I can do.'],
      ['explaining and offering what it can do', 'I cannot send it, but I can draft it here.'],
    ],
  },
  {
    cls: 'pending_approval',
    state: at({ wanted: 1, landed: 0, pendingActions: 1 }),
    refuses: [],
    allows: [
      /*
        The case that proves the rows are the authority. This is the SAME
        sentence refused under blocked_needs_user above, and it passes here
        because a child job exists to keep it. A phrase list cannot do this.
      */
      ['a promise backed by a child job', "I'll draft the outline and come back with it."],
      ['describing the pending work', 'Emma is pulling the figures and will report back.'],
    ],
  },
  {
    cls: 'failed_after_retries',
    state: at({ wanted: 1, landed: 0, attempt: 4, maxAttempts: 4 }),
    refuses: [
      [
        'promising a retry nothing will perform',
        "That did not go through, but I'll try again shortly.",
      ],
    ],
    allows: [
      ['saying it failed', 'I could not get this done, and nothing was created.'],
      [
        'saying it failed and offering a retry he triggers',
        'Nothing was created. Ask me again and I will retry it.',
      ],
    ],
  },
]

describe('each class is what it says it is', () => {
  for (const c of CASES) {
    it(`${c.cls} classifies`, () => {
      expect(classifyOutcome(c.state)).toBe(c.cls)
    })
  }

  it('all six are covered, so none is untested by omission', () => {
    expect(new Set(CASES.map((c) => c.cls)).size).toBe(6)
  })
})

describe('what each class may not claim', () => {
  for (const c of CASES) {
    for (const [what, answer] of c.refuses) {
      it(`${c.cls} refuses: ${what}`, () => {
        expect(wouldRefuse(c.state, answer)).toBe(true)
      })
    }
  }
})

describe('and what each class may say', () => {
  for (const c of CASES) {
    for (const [what, answer] of c.allows) {
      it(`${c.cls} allows: ${what}`, () => {
        expect(wouldRefuse(c.state, answer)).toBe(false)
      })
    }
  }
})

describe('the refused answers end at the truth, not at another promise', () => {
  for (const c of CASES) {
    for (const [what, answer] of c.refuses) {
      it(`${c.cls}: ${what}`, async () => {
        const truth = sayWhatHappened(c.state)
        const held = await heldToWhatIsQueued(
          answer,
          truth,
          async () => "And I'll do something else.",
        )
        expect(unsupportedCommitment(held.answer)).toBeNull()
        expect(held.answer.trim()).not.toBe('')
        if (truth !== null) expect(held.answer).toBe(truth)
      })
    }
  }
})

/**
 * A question about state is not a request the office failed.
 *
 * ## What was measured
 *
 * Over 34 live turns recorded against v689, **22 of them — 65% — opened with
 * the same twenty-word clause**:
 *
 *     "I have not done this. I understood what you want and could not carry
 *      it out — say it again in a sentence and I will."
 *
 * Eight of those were questions. *"did you do it?"*, *"so what is where
 * now?"*, *"did anything get created just now?"* — where "say it again in a
 * sentence" is not merely the wrong register, it is nonsense: he did not ask
 * for anything to be done.
 *
 * ## Why it happened, which is a shape this repository has recorded before
 *
 * `ReadingKind` has `other` for *"understood as a request, none of the
 * above"*, and `understand()` ALSO returns `other` for the whole utterance on
 * every path where nothing was interpreted — no provider, a fan-out branch,
 * and the short-single-clause shortcut that "did you do it?" takes. So the
 * label could not distinguish *"we read this as a request"* from *"we did not
 * read this"*, and `wanted` counted both.
 *
 * CLAUDE.md: a fallback class and a real class sharing one name makes both
 * unreachable, and nothing downstream can tell "we decided this" from "we did
 * not know". The remedy there was `Classification.recognised`; `asked` is the
 * same remedy one layer out.
 *
 * ## The two directions, and the one that matters more
 *
 * Suppressing the sentence must not loosen the contract. That is what the
 * second block below is for: on a turn where nothing landed, the class is
 * unchanged and `mayClaimCompletion` is still false, so the backstop still
 * runs and the office still may not say it did something. It simply stops
 * ANNOUNCING that it did not, on a turn where nobody asked.
 */

import { describe, expect, it } from 'vitest'
import { clauses } from '../../src/agents/clauses.ts'
import type { CanonicalOutcome } from '../../src/agents/outcome.ts'
import { classifyOutcome, contractFor, sayWhatHappened } from '../../src/agents/outcome.ts'
import { readRequest } from '../../src/agents/request.ts'

const at = (over: Partial<CanonicalOutcome> = {}): CanonicalOutcome => ({
  wanted: 1,
  landed: 0,
  pendingActions: 0,
  awaitingApproval: false,
  missing: [],
  capabilityRefused: false,
  attempt: 1,
  maxAttempts: 4,
  asked: true,
  settled: false,
  ...over,
})

/** What the handler computes: any clause of the request in the `ask` mood. */
const askedForWork = (said: string): boolean =>
  readRequest(said, clauses).some((c) => c.mood === 'ask')

describe('the grammar separates a question from a request', () => {
  /*
    The eight live turns that got the clause wrongly, plus the shapes beside
    them. Every one of these reaches the handler as ONE reading of kind
    `other`, so the reading label cannot help and the mood is the only thing
    that can.
  */
  for (const said of [
    'did you do it?',
    'so what is where now?',
    'did anything get created just now?',
    'which of those is actually done?',
    'what happened with those two?',
    'anything back yet?',
    'where has that got to?',
    'so which of those two did you actually manage?',
  ]) {
    it(`does not read "${said}" as work asked for`, () => {
      expect(askedForWork(said)).toBe(false)
    })
  }

  /*
    And the other direction, which is the one that must not regress. The
    first of these is the live escape that made `wanted` permissive in the
    first place: it lands as `other`, nothing files it, and the office
    promised to create a task titled "Insurance renewal - follow-up".
  */
  for (const said of [
    'get someone onto the insurance renewal before it slips',
    'put a task on the bid to confirm the printer quote by Tuesday',
    'stick something down so I do not forget to ring Kevin about the quote',
    'draft the note to the funding officer',
    'can you chase the letter of support',
  ]) {
    it(`still reads "${said}" as work asked for`, () => {
      expect(askedForWork(said)).toBe(true)
    })
  }
})

describe('the sentence is volunteered only where he asked', () => {
  it('says nothing extra on a question that landed nothing', () => {
    expect(sayWhatHappened(at({ asked: false }))).toBeNull()
  })

  it('still says it on a request that landed nothing', () => {
    expect(sayWhatHappened(at({ asked: true }))).toContain('I have not done this')
  })

  it('names a known gap whether or not the grammar recognised the ask', () => {
    /*
      A named gap is useful on its own terms — "I need which project this is
      for" is actionable however the turn was phrased — so `asked` does not
      gate it.
    */
    const line = sayWhatHappened(at({ asked: false, missing: ['which project this is for'] }))
    expect(line).toContain('which project this is for')
  })
})

describe('silence is not permission', () => {
  /*
    THE CONTROL for the change. If suppressing the sentence had been done by
    dropping `wanted` to zero, the class would have become `completed` and
    `mayClaimCompletion` would have gone true — the office would have been
    free to say it had filed something against zero rows, which is the older
    half of #302 reopened to quieten the newer half.
  */
  it('leaves the class and the claim permission exactly where they were', () => {
    const quiet = at({ asked: false })
    const loud = at({ asked: true })
    expect(classifyOutcome(quiet)).toBe(classifyOutcome(loud))
    expect(classifyOutcome(quiet)).toBe('blocked_needs_user')
    expect(contractFor(quiet).mayClaimCompletion).toBe(false)
    expect(contractFor(quiet).mayCommitToFuture).toBe(false)
  })

  it('still permits a real pending action to be described', () => {
    expect(contractFor(at({ asked: false, pendingActions: 1 })).mayCommitToFuture).toBe(true)
  })
})

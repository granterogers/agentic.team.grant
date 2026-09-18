/**
 * The judge gate's own decision, broken on purpose.
 *
 * `npm run verify:judge` costs twenty model calls and six minutes, so its
 * pass/fail rule cannot be exercised inside itself often enough to be trusted.
 * These are the four shapes that matter, including the one that produced a
 * false failure in the gate run of 2026-09-18.
 */
import { describe, expect, it } from 'vitest'
import { judgeAnswered, judgeIsUsable } from '../../src/eval/usable.ts'

describe('whether a comparative judge is usable', () => {
  it('a judge that answers everything and gets it right is usable', () => {
    expect(judgeIsUsable({ pairs: 5, correct: 5, unreadable: 0, floor: 4 })).toBe(true)
  })

  it('a judge that answers everything and gets two wrong is NOT', () => {
    expect(judgeIsUsable({ pairs: 5, correct: 3, unreadable: 0, floor: 4 })).toBe(false)
  })

  /*
    The false failure this rule was written for. One pair truncated mid-thought
    and the old arithmetic scored 4 out of 5 ASKED rather than 4 out of 4
    ANSWERED, so a judge that was right about everything it read was reported
    as unable to discriminate.
  */
  it('abstaining on one pair does not make a perfect judge a failure', () => {
    expect(judgeIsUsable({ pairs: 5, correct: 4, unreadable: 1, floor: 4 })).toBe(true)
    expect(judgeAnswered({ pairs: 5, correct: 4, unreadable: 1, floor: 4 })).toBe(4)
  })

  /*
    And the door that loosening it could have opened. A model that answers two
    pairs and gets both right must NOT pass: two out of two is not evidence,
    and `minimax/minimax-m3:free` returned nothing at all on all five in the
    survey of the same day.
  */
  it('a judge that abstains on most of them fails, however well it does on the rest', () => {
    expect(judgeIsUsable({ pairs: 5, correct: 2, unreadable: 3, floor: 4 })).toBe(false)
    expect(judgeIsUsable({ pairs: 5, correct: 0, unreadable: 5, floor: 4 })).toBe(false)
  })
})

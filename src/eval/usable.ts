/**
 * Is a comparative judge usable, given how it scored on the calibration pairs?
 *
 * Extracted from `verify:judge` so it can be BROKEN ON PURPOSE in a unit test.
 * The suite that uses it costs six minutes and twenty model calls, so a control
 * that lives inside it is a control nobody runs — and this repository's rule is
 * that a detector is evidence only when deliberately breaking the protected
 * invariant makes it red.
 *
 * Two ways to be unusable, and they are different failures with different
 * remedies:
 *
 * - **It answered and got them wrong.** The model is a bad judge. Survey the
 *   free models and pin a different one.
 * - **It did not answer.** A reasoning model can spend its whole budget
 *   thinking and return no content — the gate run of 2026-09-18 recorded
 *   `finish_reason=length, 19375 tokens spent` on one pair while the same model
 *   scored 5/5 on the same corpus twenty minutes later. That is the instrument
 *   abstaining, not judging badly, and counting it as a wrong answer turned a
 *   working judge into a gate failure announcing it "CANNOT discriminate".
 *
 * So the score is taken over the pairs that came BACK, and abstaining on most
 * of them fails on its own terms: a model that answers two pairs out of five is
 * not a judge whatever it scores on the two.
 */
export interface JudgeScore {
  /** How many calibration pairs were put to it. */
  readonly pairs: number
  /** How many it got right, both ways round. */
  readonly correct: number
  /** How many came back with no readable verdict at all. */
  readonly unreadable: number
  /** How many of the answered pairs it must get right. */
  readonly floor: number
}

export const judgeAnswered = (s: JudgeScore): number => s.pairs - s.unreadable

export const judgeIsUsable = (s: JudgeScore): boolean => {
  const answered = judgeAnswered(s)
  // Abstained on too many to have been scored at all.
  if (answered < s.floor) return false
  // And got enough of the ones it did answer right. `Math.min` matters only
  // when the floor equals the number answered, which is the boundary case the
  // unit test pins.
  return s.correct >= Math.min(s.floor, answered)
}

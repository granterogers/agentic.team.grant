/**
 * The one clause that says which constraint was set aside (#231, #277).
 *
 * Extracted from `handlers/instruction.ts` so it can be MEASURED rather than
 * reasoned about. It was inline, which meant a change to it could only be
 * argued for — and this repository has already recorded what that costs: a
 * comparable negative-imperative prompt edit made two of three evaluated
 * answers worse, and the only reason anybody knew was that somebody measured
 * afterwards.
 *
 * `npm run verify:form-rules` runs both variants below against the same
 * corpus, at temperature 0, on a pinned model, and counts two things that
 * pull in opposite directions:
 *
 *   - **spurious**  the office apologises for a rule it KEPT (#277)
 *   - **silent**    the office drops a rule and says nothing (#231)
 *
 * Either alone is trivially optimisable. Deleting the clause takes `spurious`
 * to zero and brings back the defect the clause exists for; making it shout
 * takes `silent` to zero and gives Grant an apology on every turn. A candidate
 * is kept only when it improves one without materially worsening the other.
 */

/**
 * What has shipped since #231, verbatim.
 *
 * Grant's complaint in #277 is against THIS text. Kept as the baseline rather
 * than edited in place, so a candidate that turns out worse has something
 * exact to be restored to — the freeze is a string, not an intention.
 */
export const SET_ASIDE_BASELINE =
  'If you cannot satisfy everything he has asked for at once — his own ' +
  'standing instructions included — do the most useful thing and say in ' +
  'one clause which constraint you set aside and why. Never drop one ' +
  'silently.'

/**
 * The candidate, and the single thing it changes.
 *
 * The baseline says what to do when a conflict exists and is SILENT about the
 * ordinary case, so a model reading a standing rule plus a request has no
 * instruction covering "both are satisfiable" and narrates the trade-off it
 * was primed to look for. #277's sentence — *"I'm setting aside the
 * bullet-point rule so I can keep this answer as a single short paragraph as
 * required"* — is that priming answering a question nobody asked: it names a
 * rule it did not break, to explain following another one.
 *
 * So the candidate states the ordinary case explicitly and puts it FIRST,
 * rather than strengthening the conflict clause. That is deliberate:
 *
 *   - It adds a positive instruction rather than a negative imperative. The
 *     edit this repository measured going wrong was a "do not" and this file's
 *     header says why that matters.
 *   - It does not weaken the #231 half at all. The second sentence is the
 *     baseline's, word for word, so a regression in `silent` cannot be blamed
 *     on rewording the thing that works.
 *
 * One variable changed. If it does not measure better it is discarded.
 */
export const SET_ASIDE_CANDIDATE =
  'When you can satisfy everything he has asked for, including his standing ' +
  'instructions, just answer — do not mention the instructions or narrate ' +
  'having followed them. ' +
  'If you cannot satisfy everything he has asked for at once — his own ' +
  'standing instructions included — do the most useful thing and say in ' +
  'one clause which constraint you set aside and why. Never drop one ' +
  'silently.'

/**
 * Which one the office actually uses.
 *
 * A single named export so the swap is one line and a reader can see at a
 * glance which text is live — rather than a feature flag nobody can evaluate
 * or a diff that silently replaced the baseline.
 */
export const SET_ASIDE_LINE = SET_ASIDE_BASELINE

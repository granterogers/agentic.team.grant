/**
 * The person changed their mind in the middle of the message.
 *
 * ## The defect this exists for
 *
 * #291, and its escalation found by the live Shadow Grant corpus on 21
 * September. Three confirmed cases of the office **carrying out a clause the
 * person had withdrawn in the same breath**:
 *
 *   "ok so how is the coaching thing looking no forget that push it forward
 *    however you like just nobody gets contacted"
 *   "send that to the funding officer, no leave it, I will do it"
 *   "redo the budget page" ... "actually scrap that"
 *
 * The office created a task, and in one case a blocker, from the withdrawn
 * half. That is the failure mode that costs most, because unlike a wrong
 * answer it leaves something behind in the world.
 *
 * ## Why none of the three existing readers covers it
 *
 * Checked before inventing a noun, which CLAUDE.md requires:
 *
 *   - `correction.ts` reads a correction of a PREVIOUS answer. It requires
 *     `hadAnswer` and anchors at the start of the message, deliberately,
 *     because "no" mid-sentence is usually content.
 *   - `negation.ts` reads an EXCLUDED SUBJECT ("the onboarding, not the
 *     pricing") and a contentless rejection. Neither is a mid-message pivot.
 *   - `clauses.ts` splits a message for SUBJECT LOOKUP. Its boundary set is
 *     coordinators, and its twelve-character floor silently discarded
 *     "no leave it" — eleven characters — so the pivot was thrown away by a
 *     rule written for a different purpose.
 *
 * Intra-message retraction is a fourth thing and had no reader at all.
 *
 * ## The pivot is the boundary, not the punctuation
 *
 * The clause splitter needs a comma or a full stop. A dictated message has
 * neither: *"...looking no forget that push it forward..."* is one run of
 * words, and every punctuation-based split returns it whole — which is
 * exactly what the failing runs showed.
 *
 * So the cancellation operator ITSELF is the boundary. What precedes the last
 * one is withdrawn; what follows it stands. That is one rule, it needs no
 * punctuation, and it is why this improves unpunctuated voice input rather
 * than the sentences it was written against.
 *
 * ## Erring towards withdrawal is the safe direction, and only because we say so
 *
 * A missed retraction leaves a real task, a real message or a real blocker
 * behind. A false retraction drops something the person wanted. Those are not
 * symmetric, and the second is only acceptable because the office SAYS what
 * it set aside — `say-what-you-dropped.ts` already exists for precisely this,
 * so a wrong call is visible in the reply and the person can simply repeat
 * themselves. Without that clause this bias would be indefensible.
 */

/**
 * The operators that cancel something already said.
 *
 * A closed function class in English, the same way negation is, and written
 * from the language rather than from the corpus that exposed the defect: the
 * three failing messages between them use four of these, and the rest are
 * here because they are how English cancels, not because a test needed them.
 *
 * `no` alone is deliberately NOT one. "there is no entry for that" is an
 * answer, not a retraction, and a bare negative is the single commonest word
 * in a sentence that means the opposite of a pivot. Where "no" really does
 * open a retraction it is followed by one of these ("no wait", "no leave
 * it"), so nothing is lost by requiring the operator to carry itself.
 */
import { straighten } from './quality.ts'

const CANCELS = [
  'forget (?:that|it|the|about)',
  'forget',
  'scrap (?:that|it|the)',
  'scratch (?:that|it)',
  'strike that',
  'ignore (?:that|it|the)',
  'disregard (?:that|it|the)?',
  'never ?mind',
  'nevermind',
  'leave (?:that|it)',
  'hold off(?: on (?:that|it|the))?',
  'cancel (?:that|it|the)',
  'skip (?:that|it|the)',
  'drop (?:that|it|the)',
  'undo (?:that|it|the)',
  "don'?t bother(?: with (?:that|it|the))?",
  'no need(?: for (?:that|it|the))?',
  'on second thoughts?',
  'as you were',
  'belay that',
]

/**
 * A cancellation that is being ASKED FOR rather than performed.
 *
 * "do not forget to send it" is an instruction to remember, and reading it as
 * a pivot would withdraw the very thing it is insisting on. A negative or a
 * modal immediately in front turns the operator into its own opposite, so the
 * lookbehind is part of the definition rather than a patch on it.
 */
/**
 * A cancellation operator that is really a verb with a complement.
 *
 * "leave it where it is" and "leave it with me" are instructions to do
 * nothing to a thing, not retractions of an earlier clause; "hold off until
 * Friday" is a schedule. The operators that double as ordinary verbs need
 * their object to be the END of the phrase, and a complement introducer
 * immediately after one says it is not.
 *
 * Found by a generalisation test, not by the corpus: "move the deadline to
 * friday, undo that, leave it where it is" chose the wrong pivot.
 */
const HAS_A_COMPLEMENT =
  /^\s+(?:where|with|alone|as|until|till|for|in|on|to|up|at|by|near|inside|running|open|be)\b/i

const NOT_A_PIVOT =
  /(?:\b(?:do ?n[o']?t|don't|never|please|remember to|must|should|will|would|can|could|to)\s+)$/i

const PIVOT = new RegExp(`\\b(?:${CANCELS.join('|')})\\b`, 'gi')

export interface Retraction {
  /** The instruction with the withdrawn part removed, in his own words. */
  readonly kept: string
  /** What he took back, in his own words, so the office can say so. */
  readonly withdrawn: string
  /** The operator that did it, for a report that names its evidence. */
  readonly pivot: string
}

/**
 * Read a mid-message retraction, or null when there is none.
 *
 * Null rather than an empty Retraction, so a caller cannot accidentally treat
 * "nothing was withdrawn" as "everything was withdrawn" — 0304's asymmetry
 * lesson, in a return type.
 */
export const readRetraction = (text: string): Retraction | null => {
  /*
    Straightened first, with the PRODUCT's own helper.

    A curly apostrophe is what a phone keyboard and most dictation produce,
    and the first version of this file matched "don't bother" with a
    straight quote only - so the commonest way the sentence is actually
    typed slipped past. Reusing `straighten` rather than writing a second
    normaliser, because two of them would drift.
  */
  const said = straighten(String(text ?? '')).trim()
  if (said === '') return null

  /*
    The LAST operator, not the first.

    A person who changes their mind twice means the last one. Scanning
    forwards and keeping the final match costs one pass and makes
    "do A, no scrap that, do B, actually forget it, do C" resolve to C,
    which is what they said.
  */
  let chosen: { index: number; length: number; text: string } | null = null
  PIVOT.lastIndex = 0
  for (let m = PIVOT.exec(said); m !== null; m = PIVOT.exec(said)) {
    if (NOT_A_PIVOT.test(said.slice(0, m.index))) continue
    if (HAS_A_COMPLEMENT.test(said.slice(m.index + m[0].length))) continue
    chosen = { index: m.index, length: m[0].length, text: m[0] }
  }
  if (chosen === null) return null

  /*
    Something has to precede it, or there is nothing to take back.

    An operator at the very start is a correction of the PREVIOUS turn, which
    `correction.ts` owns and reads with the thread in hand. Asserting on the
    presence of a preceding ask rather than on a character offset, because a
    message can legitimately open with filler.
  */
  const before = said.slice(0, chosen.index).trim()
  const strippedBefore = before
    .replace(/\b(?:ok|okay|so|um|erm|right|well|and|but|no|hmm|yeah)\b/gi, '')
    .trim()
  if (strippedBefore.replace(/[^a-z0-9]/gi, '').length < 8) return null

  const after = said
    .slice(chosen.index + chosen.length)
    .replace(/^[\s,.;:—–-]+/, '')
    .trim()

  return {
    kept: after,
    /*
      The words that introduced the pivot belong to the pivot, not to the
      thing being withdrawn. "redo the budget page, actually" reads as an
      unfinished sentence when the office repeats it back.
    */
    withdrawn: before
      .replace(/[\s,;:—–-]*\b(?:no|actually|wait|erm|um)\b[\s,;:—–-]*$/gi, '')
      .trim(),
    pivot: chosen.text.toLowerCase(),
  }
}

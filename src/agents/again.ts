/**
 * "ask them again", "get somebody else to look at it" — the two ways Grant
 * DELIBERATELY asks for another attempt (#316).
 *
 * #316's invariant is that repeating or rephrasing a request must not
 * duplicate work already in flight **unless he clearly asks for another
 * independent attempt**. This is that clause, and it has to be deterministic:
 * it is the thing that AUTHORISES duplication, so it must be cheap to verify
 * and impossible to reach by accident.
 *
 * The asymmetry runs the other way from most recognisers here. A miss costs
 * him one more sentence — "no, get somebody else on it" — and the office is
 * honest in the meantime, because it says what is already running. A false
 * positive duplicates work, spends the model twice, and produces two answers
 * to one question, which is the provenance defect this repository keeps
 * paying for: two sources for one obligation.
 *
 * So: narrow, and never inferred from enthusiasm.
 */

import { straighten } from './quality.ts'

export type AnotherGo =
  /** Re-engage the people already on it. */
  | 'retry'
  /** Deliberately add somebody independent. */
  | 'another_person'

/*
  `String.raw` throughout — a plain template literal collapses `\s+` to a
  literal `s+`, which `calloff.ts` records costing twelve of thirteen probe
  sentences.
*/
const IT = String.raw`(?:it|that|this|them|the\s+[a-z0-9][a-z0-9'’\- ]{0,40})`

const RETRY = new RegExp(
  String.raw`^\s*(?:ok(?:ay)?[,\s]+|right[,\s]+|please[,\s]+)*(?:can you\s+|could you\s+|would you\s+)?` +
    String.raw`(?:ask|chase|nudge|push|poke|prod|go back to)\s+(?:them|him|her|${IT})\s+again` +
    String.raw`[,.!\s]*(?:please)?\s*[.!?]?\s*$`,
  'i',
)

const TRY_AGAIN = new RegExp(
  String.raw`^\s*(?:ok(?:ay)?[,\s]+|right[,\s]+|please[,\s]+)*(?:can you\s+|could you\s+)?` +
    String.raw`(?:try|run|do)\s+${IT}\s+again[,.!\s]*(?:please)?\s*[.!?]?\s*$`,
  'i',
)

/*
  ANOTHER GO, ANOTHER CRACK, ANOTHER LOOK.

  The same authorisation said without the word "again", which is how most
  people ask for it out loud. `ANOTHER_PERSON` below already carries "have a
  go at" -- but only where somebody ELSE is named, so "give it another go"
  fell between the two and was read as no authorisation at all. Measured
  against 428 real commands: neither form has occurred yet, so this is the
  semantic class being covered rather than a sentence being patched.

  Anchored to the whole message, exactly as strictly as `RETRY`, because a
  false positive duplicates work.
*/
const ANOTHER_GO = new RegExp(
  String.raw`^\s*(?:ok(?:ay)?[,\s]+|right[,\s]+|please[,\s]+)*(?:can you\s+|could you\s+|would you\s+)?` +
    String.raw`(?:give|have)\s+(?:${IT}\s+)?another\s+(?:go|crack|attempt|pass|bash|stab)` +
    String.raw`(?:\s+at\s+${IT})?[,.!\s]*(?:please)?\s*[.!?]?\s*$`,
  'i',
)

const ANOTHER_PERSON = new RegExp(
  String.raw`\b(?:get|have|ask|put)\s+(?:somebody|someone|another(?: person| one)?|a second(?: person| pair of eyes)?)\s+` +
    String.raw`(?:else\s+)?(?:to\s+)?(?:look(?: at)?|take a look(?: at)?|go over|review|check|work on|have a go(?: at)?|on)\b`,
  'i',
)

/*
  A SECOND, INDEPENDENT one — said plainly. "a fresh pair of eyes", "a
  separate look". These are the phrasings that mean "as well as", never
  "instead of", which is why they authorise rather than replace.
*/
const INDEPENDENT =
  /\b(?:a (?:fresh|second|separate|independent)\s+(?:pair of eyes|look|opinion|view|take)|independently)\b/i

/*
  What must NEVER read as authorisation. Each is a question or a hypothetical,
  and reading one as "start it again" spends the office twice on a sentence
  that asked for nothing.
*/
const NOT_AN_INSTRUCTION =
  /^\s*(?:should|shall|do you think|would it (?:be )?(?:worth|help)|is it worth|what if|maybe|perhaps|could we)\b/i

/** How he asked for another go, or null when he did not. */
export function wantsAnotherGo(text: string): AnotherGo | null {
  const said = straighten(String(text ?? '')).trim()
  if (said === '') return null
  if (NOT_AN_INSTRUCTION.test(said)) return null
  if (ANOTHER_PERSON.test(said) || INDEPENDENT.test(said)) return 'another_person'
  if (RETRY.test(said) || TRY_AGAIN.test(said) || ANOTHER_GO.test(said)) return 'retry'
  return null
}

/**
 * "how many people are on that?" — a question about the OFFICE, not about a
 * document (#316).
 *
 * Measured on v733, with two children of that very conversation in flight:
 *
 *     Grant : how many people are on that?
 *     office: If you want me to create a task for the three-year renewal
 *             cost, just confirm and point me at the contract and I'll add
 *             the appropriate owners.
 *
 * The true answer was "two" and it is one query away. The question reached
 * document retrieval, which cannot answer it, and the model filled the gap.
 *
 * ## Deliberately narrow
 *
 * Only the WHO and HOW MANY class is answered deterministically. "what is
 * happening with that?" is a broader question that may legitimately want the
 * project's state or a document, so it keeps going down the ordinary path and
 * gets the in-flight rows as grounding instead of a short-circuit.
 *
 * The cost of being narrow is a question this misses, which is answered the
 * way it is today. The cost of being wide is a question about a document
 * answered with a head count.
 */

import { straighten } from './quality.ts'

/*
  `String.raw` throughout. Written as plain template literals, `\s+` is an
  unknown escape and collapses to a literal `s+` — `calloff.ts` records
  twelve of thirteen probe sentences missing exactly that way.
*/
const SUBJECT = String.raw`(?:people|persons?|staff|of (?:you|the team)|anyone|anybody|someone|somebody|agents?|specialists?)`
const ON_IT = String.raw`(?:on|working on|looking at|dealing with|handling|doing)`
const IT = String.raw`(?:it|that|this|these|those|the\s+[a-z0-9][a-z0-9'’\- ]{0,40})`

const HOW_MANY = new RegExp(
  String.raw`^\s*(?:and\s+)?(?:so\s+)?how many\s+${SUBJECT}\s+(?:are|is|have you got|do we have)\s+${ON_IT}\s+${IT}\s*\??\s*$`,
  'i',
)

/*
  How the OFFICE holds the work, which is where a dictated question puts its
  verb (#327).

  The first version went straight from `who` to a working verb, so "who is on
  that" was recognised and "who have you got on that" was not — and the cost of
  the miss is not a worse sentence, it is WORK. A status question nothing
  recognises falls through to the ordinary instruction path, which convenes
  specialists: measured on a twelve-turn session, "who have you got on that"
  spawned two children and re-convened the quality director to answer a
  question the rows already held. Invisible duplicated work, triggered by the
  commonest follow-up there is.

  Not a longer list of sentences. The enumeration that was wrong is of ENGLISH
  VERB FORMS, which is unbounded, so the span is bounded by WHAT IT MAY
  CONTAIN — an auxiliary and the office as its subject — rather than by length.
  That is what keeps "who SHOULD WE PUT on that" out: it asks for an
  assignment, and `should` is not something the office already has.
*/
const OFFICE_HAS = String.raw`(?:have|has|did|do)\s+(?:you|we|they|the team)\s+(?:got|put|working)?`

const WHO = new RegExp(
  // `whos` without the apostrophe as well: dictation drops it, and
  // `straighten` normalises a curly quote rather than supplying a missing one.
  String.raw`^\s*(?:and\s+)?(?:so\s+)?who(?:'s|s| is| are)?\s+(?:actually\s+)?` +
    String.raw`(?:${OFFICE_HAS}\s+)?${ON_IT}\s+${IT}\s*\??\s*$`,
  'i',
)

const IS_ANYONE = new RegExp(
  String.raw`^\s*(?:and\s+)?(?:so\s+)?is\s+(?:anyone|anybody|someone|somebody)\s+(?:still\s+)?${ON_IT}\s+${IT}\s*\??\s*$`,
  'i',
)

/*
  "how many people are on the team" is a question about the ROSTER, which is a
  different reader entirely and one that already works. Excluded by name
  rather than by hoping the patterns above miss it.
*/
const ABOUT_THE_ROSTER = /\b(?:on|in)\s+the\s+(?:team|office|roster|payroll)\s*\??\s*$/i

export type WhoIsOnIt = 'how_many' | 'who' | 'is_anyone'

/** The kind of head-count question this is, or null when it is not one. */
export function asksWhoIsOnIt(text: string): WhoIsOnIt | null {
  const said = straighten(String(text ?? '')).trim()
  if (said === '') return null
  if (ABOUT_THE_ROSTER.test(said)) return null
  if (HOW_MANY.test(said)) return 'how_many'
  if (WHO.test(said)) return 'who'
  if (IS_ANYONE.test(said)) return 'is_anyone'
  return null
}

/*
  AND WHAT DID THEY FIND? (#317)

  Measured on v733, with one specialist blocked and one refusing:

      Grant : where exactly do they differ?
      office: I don't have any record of the team's actual comments, so I
              can't point to exact phrasing where they diverge. Generally,
              the "numbers" view flags the revenue hit (X % lost ARR, churn
              risk) and the upgrade upside, while the "customer impact" view
              flags perception…

  The first clause is true and the second supplies exactly what the first
  said was unavailable, down to a literal `X %` placeholder. Every coherence
  gate passes it: there is no claim verb, and the hedge reads as care.

  This is not a gate. A gate would make the office quieter, and CLAUDE.md
  records what that costs — the coherence gate refusing two turns of an
  ordinary conversation and Grant receiving nothing. The answer is to ANSWER
  the question from the rows, because the rows have it: what each colleague
  came back with, what is still running, and what is waiting on his word.
*/
const COLLEAGUES = String.raw`(?:they|them|the team|everyone|both(?: of them)?|he|she)`

const CAME_BACK = new RegExp(
  String.raw`^\s*(?:and\s+|so\s+|ok(?:ay)?[,\s]+)*` +
    String.raw`(?:what|anything)\s+(?:did|have|has)\s+${COLLEAGUES}\s+` +
    String.raw`(?:come back with|say|find|report|conclude|think|make of (?:it|that))` +
    String.raw`[^?]{0,40}\??\s*$`,
  'i',
)

const DID_THEY = new RegExp(
  String.raw`^\s*(?:and\s+|so\s+|ok(?:ay)?[,\s]+)*` +
    String.raw`(?:did|do|have|has)\s+${COLLEAGUES}\s+` +
    String.raw`(?:agree|disagree|get back to (?:you|me)|come back|finish|manage it)` +
    String.raw`[^?]{0,40}\??\s*$`,
  'i',
)

const WHERE_DIFFER = new RegExp(
  String.raw`^\s*(?:and\s+|so\s+|ok(?:ay)?[,\s]+)*` +
    String.raw`(?:where|how|in what way)\s+(?:exactly\s+)?(?:do|did)\s+${COLLEAGUES}\s+` +
    String.raw`(?:differ|disagree|diverge|split)` +
    String.raw`[^?]{0,40}\??\s*$`,
  'i',
)

const ANY_WORD = new RegExp(
  String.raw`^\s*(?:and\s+|so\s+)?any(?:thing)?\s+(?:(?:word|news|update)\s+)?(?:from|on)\s+` +
    String.raw`(?:${COLLEAGUES}|that|it)\s*\??\s*$`,
  'i',
)

/*
  "did anything come back on the suppliers?" — the subject is the WORK rather
  than the people, so none of the patterns above can see it: they all key on a
  colleague pronoun. Observed live on v757, where it fell through to the model
  and was answered from general knowledge, which is the exact shape #317 is
  about even when the answer happens to come out honest.
*/
const ANYTHING_BACK = new RegExp(
  String.raw`^\s*(?:and\s+|so\s+)?(?:did|has|have)\s+(?:anything|anyone|they|we)\s+` +
    String.raw`(?:come|got|heard)\s+(?:back|anything)(?:\s+(?:on|from|about)\s+[a-z0-9][a-z0-9'’\- ]{0,40})?` +
    String.raw`\s*\??\s*$`,
  'i',
)

/** Whether this asks what the colleagues came back with. */
export function asksWhatTheyFound(text: string): boolean {
  const said = straighten(String(text ?? '')).trim()
  if (said === '') return false
  return (
    CAME_BACK.test(said) ||
    DID_THEY.test(said) ||
    WHERE_DIFFER.test(said) ||
    ANY_WORD.test(said) ||
    ANYTHING_BACK.test(said)
  )
}

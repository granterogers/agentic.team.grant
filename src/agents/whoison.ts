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

const WHO = new RegExp(
  String.raw`^\s*(?:and\s+)?(?:so\s+)?who(?:'s| is| are)?\s+(?:actually\s+)?${ON_IT}\s+${IT}\s*\??\s*$`,
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

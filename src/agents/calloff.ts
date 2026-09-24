/**
 * Calling off work already handed on — a whole TURN, not a clause (#315).
 *
 * `retraction.ts` reads a withdrawal INSIDE one message: "chase the letter,
 * redo the budget — actually no, leave the budget". It correctly returns null
 * for a turn that is nothing but a withdrawal, because there is nothing
 * earlier in the message to take back.
 *
 * And a turn that is nothing but a withdrawal is how Grant actually changes
 * his mind. Measured on v733:
 *
 *     Grant : have someone pull together everything we know about the two
 *             suppliers and what switching would involve   -> 2 children
 *     Grant : stop that, I do not need it any more         -> 0 stopped
 *     Grant : is anyone still working on the suppliers thing?
 *     office: …there's no record of anyone having started work on it.
 *
 * ## Why this is deliberately narrow
 *
 * A false positive here CANCELS WORK IN FLIGHT. That is the expensive
 * direction twice over — the work is lost and he is told it was stopped on
 * purpose. `mine.ts` argues the usual asymmetry (a miss costs a to-do he adds
 * himself); here a miss costs one more sentence from him and a false positive
 * costs the work, so the bar is higher, not lower.
 *
 * So this fires only on a turn that is ENTIRELY a withdrawal:
 *
 *   - it opens with a calling-off verb, from `CANCELS` — one list, not a
 *     second copy, which is the mistake that file records twice
 *   - what it names is a pro-form or a short noun phrase
 *   - nothing else is asked for in the same turn
 *
 * What it must never claim:
 *
 *   - "stop sending me updates" — a standing instruction about BEHAVIOUR, not
 *     a request to cancel work. `stop` followed by a gerund is a rule.
 *   - "forget about the budget for now, do the pricing instead" — a
 *     replacement, which `retraction.ts` already reads correctly.
 *   - "cancel the meeting" — an instruction to DO something, in the world,
 *     rather than to stop the office doing something.
 */

import { straighten } from './quality.ts'
import { CANCELS } from './retraction.ts'

export interface CalledOff {
  /** What he named, or null when he said "that". */
  readonly target: string | null
  /** The words that did it, so the office can report its own evidence. */
  readonly pivot: string
}

/*
  TWO VERB SETS, AND THE DIFFERENCE IS THE SAFETY PROPERTY.

  With a PRO-FORM the referent is the conversation by construction — "that"
  can only mean what we were just talking about — so any calling-off verb is
  safe there.

  With a NAME it is not. "cancel the meeting with the caterers" is an
  instruction to act in the WORLD, and the first version of this file read it
  as "stop what the office is doing" — which would have cancelled live work
  AND swallowed the request. `cancel`, `drop`, `skip` and `undo` all have
  strong real-world senses when they take an object; `forget`, `scrap`,
  `disregard`, `never mind` and `hold off on` do not. So a named target may
  only be called off by a verb that cannot mean anything else.

  `stop` is not in `CANCELS` because that list is for mid-message pivots,
  where "stop" is vanishingly rare and "scrap" is not. As the whole turn it is
  the commonest word there is.
*/
const ANY_VERB = [...CANCELS, 'stop', 'abandon', 'call off']
const WORK_ONLY = [
  'forget(?: about)?',
  'scrap',
  'scratch',
  'disregard',
  'never ?mind',
  'nevermind',
  'hold off(?: on)?',
  'no need(?: for)?',
  "do(?:n'?t| not) bother(?: with)?",
  'stop(?: work(?:ing)? on)?',
  'leave',
  'ignore',
]

/*
  A pro-form, or a short noun phrase. Bounded at four words: past that he is
  describing something rather than pointing at it, and the referent is better
  found from the conversation than parsed out of the sentence.
*/
/*
  A named target may not span a coordinator (ledger R26). "scrap that and
  book the barn instead" read as calling off something called "that and book
  the barn instead", so the REPLACEMENT - the thing he actually asked for -
  was swallowed by the call-off. What follows "and", "then", "but" or
  "instead" is another request, and the match must end before it.
*/
const NAMED = String.raw`(?:the\s+)?([a-z0-9](?:(?!\s(?:and|then|but|instead|so|or)\b)[a-z0-9'’\- ]){0,40}?)`
const PRO = String.raw`(?:that one|this one|that|it|this|those|these|the lot|all (?:of )?(?:that|it))`

/*
  The tail he is allowed to add. "I do not need it any more", "please",
  "for now" — a reason or a courtesy, never another request. Anything with a
  verb of its own that is not a negation ends the match, which is what keeps
  a replacement out.
*/
/*
  And two more kinds of tail (behavioural remediation, 24 September 2026,
  ledger R26): a SECOND withdrawal - "forget it, don't bother with that",
  "never mind, leave it" - and a report of what HE did instead - "stop that,
  I've sorted the coach myself", "we've booked a minibus instead". Neither is
  a replacement request: one repeats the call-off, the other has a subject
  of its own and a past tense, and asks the office for nothing. Both were
  missed, so the turn was answered by prose that asked again for the data he
  had just said he did not want, and the correction reader offered his
  withdrawal back to him as a standing rule.
*/
const AGAIN = String.raw`(?:forget (?:it|that|about it)|(?:do(?:n'?t| not) bother)(?: with (?:it|that|this))?|leave it|never ?mind|scrap (?:it|that)|no need)`
const DID_IT_MYSELF = String.raw`(?:i|we)(?:'ve|'ll| have| will)? (?:already |just )?(?:sorted|done|handled|fixed|booked|found|got|dealt with|arranged|organised|organized|decided|do)\b[^.!?]{0,60}`
const TAIL = String.raw`(?:[,.!;\s\u2014-]+(?:please|now|for now|i (?:do not|don't|dont) need (?:it|that|them)(?: any ?more)?|i (?:no longer|don't|do not) need (?:it|that|them)|no longer needed|it(?:'s| is) not needed(?: any ?more)?|never ?mind|thanks?(?: you)?|${AGAIN}|${DID_IT_MYSELF}))*`

/*
  `String.raw` on every one of these, and the reason is a live scar: written
  as a plain template literal, `\s+` is an unknown escape and collapses to a
  literal `s+`, so every pattern silently required the letter s and matched
  nothing. Twelve of thirteen probe sentences missed, and the one that passed
  did so because its only `\s` was optional.
*/
const OPENER = String.raw`^\s*(?:ok(?:ay)?[,\s]+|right[,\s]+|actually[,\s]+|please[,\s]+)*`

/*
  "call it off" and "call that off" put the object inside the verb, so they
  are their own shape rather than an entry in a list that expects the object
  to follow.
*/
const PARTICLE = new RegExp(
  String.raw`${OPENER}(call (?:it|that|the whole thing) off)${TAIL}\s*[.!]?\s*$`,
  'i',
)

const POINTING = new RegExp(
  String.raw`${OPENER}(${ANY_VERB.join('|')})\s+(?:${PRO})${TAIL}\s*[.!]?\s*$`,
  'i',
)

/*
  A withdrawal with no object at all: "don't bother", "never mind", "leave
  it", "no, forget it". The referent is the conversation's work, as for
  "stop that".
*/
const BARE = new RegExp(String.raw`${OPENER}(?:no[,\s]+)?(${AGAIN})${TAIL}\s*[.!]?\s*$`, 'i')
const BY_NAME = new RegExp(
  String.raw`${OPENER}(${WORK_ONLY.join('|')})\s+${NAMED}${TAIL}\s*[.!]?\s*$`,
  'i',
)

/*
  `stop` plus a gerund is a rule about how the office behaves, and reading it
  as "cancel the work in flight" would both miss the instruction AND destroy
  something. "stop sending me updates", "stop copying Ruby in".
*/
const A_RULE = /^\s*(?:please\s+)?stop\s+\w+ing\b/i

/*
  A stem that ends in -ing and is not a gerund, so the rule above cannot
  swallow it. Same shape as `A_STEM_THAT_LOOKS_INFLECTED` in `request.ts`,
  which exists because "bring" cost the finance director every case naming it.
*/
const NOT_REALLY_A_GERUND =
  /^\s*(?:please\s+)?stop\s+(?:bring|cling|fling|ring|sing|sling|spring|sting|string|swing|wring|ping|ding|thing|everything|anything)\b/i

export function callsItOff(text: string): CalledOff | null {
  const said = straighten(String(text ?? '')).trim()
  if (said === '') return null
  if (A_RULE.test(said) && !NOT_REALLY_A_GERUND.test(said)) return null

  /*
    Pointing first. "stop that" names nothing and the referent comes from the
    conversation, exactly as a follow-up rename does (#313) — which is both
    the commonest shape and the safest one.
  */
  const particle = PARTICLE.exec(said)
  if (particle !== null) return { target: null, pivot: (particle[1] ?? '').toLowerCase() }

  const pointing = POINTING.exec(said)
  if (pointing !== null) return { target: null, pivot: (pointing[1] ?? '').toLowerCase() }

  const bare = BARE.exec(said)
  if (bare !== null) return { target: null, pivot: (bare[1] ?? '').toLowerCase() }

  const byName = BY_NAME.exec(said)
  if (byName === null) return null
  const named = (byName[2] ?? '').trim()
  /*
    A verb in WORK_ONLY that took a pro-form anyway — "do not bother with
    that" reaches here rather than POINTING, because `with` is inside the
    verb. The referent still comes from the conversation, so it must not be
    reported as a name: a caller matching "that" against work in flight would
    find nothing and correctly conclude there was nothing to stop.
  */
  if (new RegExp(String.raw`^${PRO}$`, 'i').test(named)) {
    return { target: null, pivot: (byName[1] ?? '').toLowerCase() }
  }
  /*
    A name with nothing in it is a pro-form that got here by accident, and
    acting on it would be acting on an empty referent.
  */
  return named === '' ? null : { target: named, pivot: (byName[1] ?? '').toLowerCase() }
}

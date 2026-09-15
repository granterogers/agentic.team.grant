/**
 * What the request is NOT about, removed before anybody looks up the subject.
 *
 * Issue #237. Found by a voice note:
 *
 *     "sorry ignore that last bit i meant the onboarding not the pricing"
 *
 * `app.who_knows_about` is a trigram match. It saw "pricing", ranked the
 * finance director first, and the office went to **exactly the specialist
 * Grant had just excluded** — which is worse than missing him, because a miss
 * lands on the Chief of Staff and this lands on somebody confidently answering
 * the wrong question.
 *
 * It also hid #232's semantic layer. That only runs when the literal matcher
 * finds NOBODY, so a misleading literal hit is precisely the case where the
 * meaning-reader is not consulted.
 *
 * ## What this does, and what it deliberately does not
 *
 * It removes negated noun phrases from the text used for SUBJECT LOOKUP only.
 * The instruction itself is untouched — the model still sees every word,
 * including the negation, because "not the pricing" is information the answer
 * needs. This is about who gets asked, not about what they are told.
 *
 * ## Bounded so that doing nothing is the common case
 *
 * A negation must be followed by something that looks like a NOUN PHRASE. "I
 * do not think the pricing matters" keeps every word, because "think" is a
 * verb and stripping there would delete the actual subject. When nothing
 * matches, the text comes back identical and the lookup is exactly what it was
 * — so the worst case of this file is that it changes nothing.
 */

/*
  Words that mean the negation is about a VERB, not about a subject.

  "not sure", "not going to", "not worth" — in all of these the thing after
  `not` is how Grant feels about the request, and the noun that follows is
  usually the real subject. Stripping there would delete what he is asking
  about, which is the one way this file could make routing worse.
*/
const VERBAL_AFTER_NOT =
  /^(?:think|sure|certain|clear|convinced|know|knowing|want|wanting|need|needing|going|gonna|able|keen|happy|worth|yet|just|only|really|very|too|entirely|quite|necessarily|always|often|usually|currently|been|be|being|have|having|had|do|doing|did|get|getting|say|saying|see|seeing|ask|asking|look|looking)\b/i

/*
  The shapes a person uses to exclude a subject.

  Each captures the phrase to drop. Bounded to a handful of words and stopped
  by punctuation or a conjunction, because "not the pricing but the onboarding"
  must lose the first and keep the second.
*/
const EXCLUSIONS: readonly RegExp[] = [
  /\bnot\s+(?:the|a|an|our|your|its|his|her|their|this|that|these|those)\s+([a-z][a-z' -]{1,40}?)(?=$|[.,;:!?]|\s+\b(?:but|and|or|just|it|i|we|you)\b)/gi,
  /\b(?:rather|other)\s+than\s+(?:the|a|an|our|your|its|this|that)?\s*([a-z][a-z' -]{1,40}?)(?=$|[.,;:!?]|\s+\b(?:but|and|or|just|it|i|we|you)\b)/gi,
  /\binstead\s+of\s+(?:the|a|an|our|your|its|this|that)?\s*([a-z][a-z' -]{1,40}?)(?=$|[.,;:!?]|\s+\b(?:but|and|or|just|it|i|we|you)\b)/gi,
  /\bforget\s+(?:about\s+)?(?:the|a|an|our|your|its|this|that)\s+([a-z][a-z' -]{1,40}?)(?=$|[.,;:!?]|\s+\b(?:but|and|or|just|it|i|we|you)\b)/gi,
  /\bnot\s+([a-z][a-z' -]{1,30}?)(?=$|[.,;:!?]|\s+\b(?:but|and|or)\b)/gi,
]

/**
 * The text with excluded subjects removed, for a subject lookup.
 *
 * Returns the input unchanged when it excludes nothing, which is almost
 * always. Never returns empty: if the negation was the whole sentence the
 * original comes back, because a lookup against nothing is worse than a lookup
 * against something misleading.
 */
export const withoutNegated = (text: string): string => {
  let out = text
  for (const shape of EXCLUSIONS) {
    out = out.replace(shape, (whole, phrase: string) => {
      // A negated VERB is not a negated subject. Leave it alone entirely.
      if (VERBAL_AFTER_NOT.test(phrase.trim())) return whole
      return ' '
    })
  }
  const tidied = out.replace(/\s{2,}/g, ' ').trim()
  return tidied === '' ? text : tidied
}

/** True when the text excluded something, for the routing reason and for tests. */
export const excludesASubject = (text: string): boolean => withoutNegated(text) !== text

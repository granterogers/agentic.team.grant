/**
 * Sentences that MENTION making a task without asking for one (ledger R34).
 *
 * Found by running an adversarial battery through every deterministic door:
 *
 *   "Don't add a task to chase the roofer."            -> filed "Don't chase the roofer"
 *   "Kevin said 'add a task to chase the roofer' but
 *    I think that's daft"                               -> filed, by both readers
 *   "Should I add a task to chase the roofer?"          -> filed "Should I chase the roofer?"
 *
 * Three structural shapes, each checkable without reading meaning:
 *
 *   - a NEGATION governing the making verb ("don't add", "no need to put",
 *     "never set up") — the prohibition is about the very act;
 *   - a FIRST-PERSON question about whether to ("should I add…?", "shall we
 *     make…?") — asking for advice, not for the act. "Could YOU add…?" is a
 *     request and is untouched;
 *   - the making verb inside QUOTATION or REPORTED speech ("Kevin said 'add a
 *     task…'", "Emma suggested we add…") — somebody else's words, relayed.
 *
 * The expensive direction is the false positive, as `mine.ts` argues: a missed
 * task costs him one sentence, a task nobody asked for sits on the list he is
 * supposed to trust.
 */

const MAKING = String.raw`(?:add|put|make|create|set\s+up|raise|log|stick|file|remind)`

const NEGATED = new RegExp(
  String.raw`\b(?:don'?t|do\s+not|never|no\s+need\s+to|(?:there'?s\s+)?no\s+point\s+(?:in\s+)?|not)\s+(?:\w+\s+){0,2}?${MAKING}\b`,
  'i',
)
const ADVICE = new RegExp(
  String.raw`^\s*(?:should|shall|do|would|must)\s+(?:i|we)\b[^?]*\b${MAKING}\b[^?]*\?`,
  'i',
)
const QUOTED = new RegExp(String.raw`["'‘“][^"'’”]{0,40}\b${MAKING}\b[^"'’”]*["'’”]`, 'i')
const REPORTED = new RegExp(
  String.raw`\b(?:said|says|told\s+(?:me|us|him|her)|asked|suggested|wrote|mentioned|reckons?)\b[^.!?]{0,30}?\b${MAKING}\b`,
  'i',
)

export function mentionsWithoutAsking(text: string): boolean {
  const said = String(text ?? '')
  return NEGATED.test(said) || ADVICE.test(said) || QUOTED.test(said) || REPORTED.test(said)
}

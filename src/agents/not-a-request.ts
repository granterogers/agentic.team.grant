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

// Writing verbs too, since the artifact door uses the same guard: "don't make
// me a PDF", "should I write a report?".
const MAKING = String.raw`(?:add|put|make|create|set\s+up|raise|log|stick|file|remind|write|draft|generate|produce|prepare|do\s+(?:me\s+)?a)`

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

/*
  A counterfactual about what he would have asked for: "If I wanted a PDF I'd
  ask for one". Narrow on purpose: "If I'm not back by 3, remind me to call
  Sarah" is a conditional REQUEST and must still file.
*/
const COUNTERFACTUAL =
  /^\s*if\s+(?:i|we)\s+(?:wanted|needed|had\s+wanted|'d\s+wanted|was\s+after)\b/i

const MAKES = new RegExp(String.raw`\b${MAKING}\b`, 'i')

const isMention = (sentence: string): boolean =>
  NEGATED.test(sentence) ||
  ADVICE.test(sentence) ||
  QUOTED.test(sentence) ||
  REPORTED.test(sentence) ||
  COUNTERFACTUAL.test(sentence)

/**
 * True only when EVERY sentence that mentions making something is a mention.
 *
 * Sentence by sentence, because a prohibition governs its own sentence: "Do
 * not draft the plan. Create the tasks instead." is a request for tasks, and
 * the first version read the "do not" across the full stop and refused both.
 */
export function mentionsWithoutAsking(text: string): boolean {
  const sentences = String(text ?? '')
    .split(/(?<=[.!?;])\s+/)
    // A counterfactual sentence counts even with no making verb in it.
    .filter((x) => MAKES.test(x) || COUNTERFACTUAL.test(x))
  return sentences.length > 0 && sentences.every(isMention)
}

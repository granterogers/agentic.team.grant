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

/*
  A question about what was said EARLIER in this conversation.

  #231, Campaign Three. Asked "What price did I tell you the middle tier was?"
  in a chat with no earlier turn, the office answered "The middle tier is £42 a
  month - measured", and a second time "You asked what price you told me... I
  checked our notes; the middle tier is £42 a month." Both invented. Forty-two
  is the archetypal number a model produces from nothing, which is how this was
  found at all.

  The provenance guards catch the CLAIMS around such an answer one phrasing at a
  time — "you told me", "I checked our notes" — and that is whack-a-mole,
  because no check can tell an invented number from a real one.

  What CAN be decided, without a model, is the shape of the question. A request
  for the content of an earlier turn, in a conversation the office can prove has
  no earlier turn, has exactly one honest answer. The office gives it itself.
*/
const ASKS_WHAT_WAS_SAID =
  /\b(?:what|which|who|when|how\s+much|how\s+many)\b[^.?!]{0,60}\b(?:did\s+(?:i|we|you)\s+(?:say|tell|mention|ask|decide|agree|call|name|give)|(?:i|we)\s+(?:said|told|mentioned|asked|decided|agreed)|you\s+(?:said|told|mentioned))\b/i

/** True when the sentence asks the office to report an earlier turn. */
export const asksWhatWasSaid = (text: string): boolean => ASKS_WHAT_WAS_SAID.test(text)

/*
  A rejection that carries nothing to go on.

    Grant: "That is not what I meant at all."

  #231, and it reproduced twice on the same build, so it is not a coin flip.
  The office replied *"Routed to Ruby. You asked for Ruby's input on the margin
  impact, so I'm passing this to them."* — which is the previous turn happening
  again, at the moment he said it was wrong.

  The mechanism is `resolveAgainstThread` doing its job. A contentless message
  resolved against the conversation becomes the last instruction in it, and the
  last instruction is exactly the thing being rejected. So the better the
  resolver is, the more confidently it reconstructs the misunderstanding.

  What makes this decidable without a model is the SHAPE. A rejection with no
  replacement in it has one honest answer whatever the history says, and the
  office can give it itself rather than asking a model to guess what he meant.

  Deliberately narrow, in three ways at once, because the cost of firing on a
  rejection that DOES carry content is refusing to act on a correction Grant
  spelled out:

    - it must reject, by one of a small set of phrasings;
    - it must be short, because a long message has content in it somewhere;
    - it must not carry a replacement — "I meant X", "do Y instead", "it is Z"
      are corrections with content and belong on the ordinary path.
*/
const REJECTS =
  /^(?:no[,.\s]|nope\b|nah\b|wrong\b|that(?:'s| is| was)?\s+(?:not|wrong)|not\s+(?:what|that|quite|right)|you(?:'ve| have)?\s+(?:got|misunderstood))|(?:not\s+what\s+i\s+(?:meant|asked|wanted)|that(?:'s| is)\s+not\s+it)\b/i

/*
  What is left once the rejection itself is taken away.

  The first draft enumerated the SHAPES a replacement can take — "I meant X",
  "instead", "should be", a digit — and it was wrong in both directions on its
  first run. *"That is not what I meant at all"* matched `i meant` and was
  read as carrying content; *"No, the middle tier is forty pounds"* matched
  none of them and was read as carrying none. An enumeration of the ways a
  person can supply a fact is a list that will always be missing one, which is
  the correction CLAUDE.md makes about whitelists five times over.

  So the question is asked the other way round: strip the rejection and the
  words that only ever point backwards, and count what is left. A rejection
  with a replacement in it has words left; a bare "no, that's wrong" does not.
*/
const NOTHING_LEFT: ReadonlySet<string> = new Set([
  'no',
  'nope',
  'nah',
  'not',
  'wrong',
  'that',
  'this',
  'it',
  'its',
  'what',
  'quite',
  'right',
  'all',
  'at',
  'the',
  'a',
  'an',
  'is',
  'was',
  'i',
  'you',
  'we',
  'meant',
  'mean',
  'asked',
  'wanted',
  'said',
  'got',
  'have',
  'has',
  'misunderstood',
  'sorry',
  'really',
  'just',
  'sure',
  'and',
  'but',
  'to',
  'me',
  'my',
  'your',
  'of',
  'for',
  'about',
  'am',
  'are',
  'be',
  'been',
  'think',
  'thats',
  'nothing',
  'else',
])

/**
 * The longest a rejection can be and still be carrying nothing.
 *
 * The cheap second opinion rather than the discrimination — the word count
 * below is what decides. A message this long that rejects and explains has
 * content words in it by construction.
 */
const BRIEF = 120

/** True when the message rejects the last answer and says nothing about what was wanted. */
export const rejectsWithoutSaying = (text: string): boolean => {
  const t = text.trim()
  if (t.length === 0 || t.length > BRIEF) return false
  if (!REJECTS.test(t)) return false
  const left = t
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/'/g, ''))
    .filter((w) => w.length > 1 && !NOTHING_LEFT.has(w))
  /*
    Zero, not one.

    A single word left over is a subject: *"That is wrong. I meant the
    onboarding"* leaves exactly "onboarding", and that is the whole
    correction. Firing on it would refuse to act on a fact Grant spelled out,
    which is the expensive direction — the cheap one is a bare "no, rubbish"
    falling through to the ordinary path, where it behaves as it does today.
  */
  return left.length === 0
}

/*
  A CLOSE THAT ASKS FOR NOTHING (ledger R43).

  "And yeah that's it, thanks." is the same shape as a contentless rejection:
  a message with no work of its own. Resolved against the thread it BECOMES
  the previous request, so the office answered it with an invented intake form
  about the two things it had just done ("Please confirm the exact date…,
  Emma's preferred method of contact…"). Answered in code, before the
  resolver, when nothing is left once the closing words are taken out — the
  word count decides, exactly as for a rejection. The caller must not use it
  while a question of the office's is waiting on him: "yeah, that's it" is
  then an answer, and the spoken-answer path owns it.
*/
const CLOSES =
  /\b(?:thanks|thank\s+you|cheers|ta|that'?s\s+(?:it|all|everything)|nothing\s+else|that\s+will\s+do|bye|speak\s+(?:soon|later)|all\s+good)\b/i
const CLOSING_WORDS = new Set([
  'and',
  'yeah',
  'yes',
  'yep',
  'ok',
  'okay',
  'right',
  'so',
  'great',
  'perfect',
  'lovely',
  'brilliant',
  'nice',
  'good',
  'fine',
  'cool',
  'thanks',
  'thank',
  'you',
  'cheers',
  'ta',
  'thats',
  'that',
  'it',
  'is',
  'all',
  'everything',
  'for',
  'now',
  'nothing',
  'else',
  'will',
  'do',
  'bye',
  'speak',
  'soon',
  'later',
  'very',
  'much',
  'lot',
  'the',
  'moment',
  'then',
  'mate',
  'again',
  'oh',
  'um',
  'uh',
  'er',
  'just',
  'think',
  'i',
  'reckon',
  'sorted',
])
export const closesWithoutAsking = (text: string): boolean => {
  const t = text.trim()
  if (t.length === 0 || t.length > BRIEF || !CLOSES.test(t) || t.includes('?')) return false
  return (
    t
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .map((w) => w.replace(/'/g, ''))
      .filter((w) => w.length > 0 && !CLOSING_WORDS.has(w)).length === 0
  )
}

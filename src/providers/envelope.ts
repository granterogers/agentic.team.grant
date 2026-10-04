/**
 * An answer envelope: the final reply is the text between two tags, and nothing else is the reply (#412).
 *
 * `deliberationLeak` (src/agents/quality.ts) RECOGNISES working-out in an answer, which is open-ended: it refuses on strong
 * evidence only, so ordinary prose survives, and a leak it does not know the shape of gets through. This is the other
 * option the issue names. It separates the channels instead of recognising bad text: the model is told that only what is
 * inside the tags is shown, and the router returns ONLY what is inside them. Whatever a model wrote outside - a plan, a tool
 * call it imagined, a reasoning preamble - is dropped here, and a reply with no usable envelope is not an answer at all, so the
 * router's own failover tries the next model. "Find the answer" is closed; "recognise reasoning" was not.
 *
 * Opt-in per call (`CompletionRequest.answerEnvelope`), and off everywhere until a measured canary says it should be on
 * (docs/testing/answer-envelope-canary.md). Pure: no I/O, so the corpus of legitimate answers that must round-trip is a unit test.
 *
 * Rules, each pinned by a test:
 *  - the answer runs from the FIRST opening tag to the LAST closing tag, so an answer that itself talks about the tags
 *    (code, an explanation of this very format) survives whole;
 *  - an opening tag with no closing one after it is a reply cut short, and is NOT an answer (a truncated reply must not pass
 *    for a complete one);
 *  - nothing but whitespace inside is no answer;
 *  - text before and after the tags is discarded, never repaired or appended.
 */

export const ANSWER_OPEN = '<answer>'
export const ANSWER_CLOSE = '</answer>'

/** What the model is told. Plain words: this lands in a prompt a person will never read, so it carries no issue numbers. */
export const ENVELOPE_INSTRUCTION =
  `Put your finished reply to the person between ${ANSWER_OPEN} and ${ANSWER_CLOSE}, once, at the end. ` +
  'Only what is inside those tags is shown to them; everything outside is thrown away. Inside the tags write the reply ' +
  'itself: no notes to yourself, no plan for how you will answer, no tool calls.'

export interface ChatMessage {
  readonly role: string
  readonly content: string
}

/** The same messages with the envelope instruction added to the system message (or as a new first one). */
export function withEnvelope(messages: readonly ChatMessage[]): ChatMessage[] {
  const at = messages.findIndex((m) => m.role === 'system')
  if (at < 0) return [{ role: 'system', content: ENVELOPE_INSTRUCTION }, ...messages]
  return messages.map((m, i) =>
    i === at ? { ...m, content: `${m.content}\n\n${ENVELOPE_INSTRUCTION}` } : m,
  )
}

export type Extracted =
  | { readonly ok: true; readonly answer: string }
  | { readonly ok: false; readonly reason: 'no_tags' | 'unclosed' | 'empty' }

export function extractAnswer(content: string): Extracted {
  const open = content.indexOf(ANSWER_OPEN)
  if (open < 0) return { ok: false, reason: 'no_tags' }
  const close = content.lastIndexOf(ANSWER_CLOSE)
  if (close < open + ANSWER_OPEN.length) return { ok: false, reason: 'unclosed' }
  const answer = content.slice(open + ANSWER_OPEN.length, close).trim()
  return answer === '' ? { ok: false, reason: 'empty' } : { ok: true, answer }
}

/** The reply had no usable envelope. Not a provider failure, so it does not trip the breaker, but it is not an answer. */
export class NoAnswerEnvelopeError extends Error {
  constructor(
    readonly model: string,
    readonly reason: 'no_tags' | 'unclosed' | 'empty',
  ) {
    super(`${model} replied without a usable answer envelope (${reason})`)
    this.name = 'NoAnswerEnvelopeError'
  }
}

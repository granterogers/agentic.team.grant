/**
 * Which gate owns a short utterance, stated once.
 *
 * `instructionHandler` decides what a message IS by the order of a run of early
 * returns, and until this file the order was only ever written in the order of
 * the lines. That is how a bare "No." to a question the office had just asked
 * came to be answered "What did I get wrong?" (audit B3): the gate that reads a
 * rejection sat above the gate that reads an answer, and nothing said which
 * outranks which.
 *
 * The precedence is a property of the product, not of the code's layout:
 *
 *   1. ANSWERING A QUESTION THE OFFICE ASKED. If a question is waiting on him
 *      and what he said is a yes or a no to it, that is an answer. Every gate
 *      below reads generic conversation, and an answer is the more specific
 *      thing - the same rule `links.ts` applies to a link against a caption.
 *   2. A REJECTION THAT NAMES NOTHING ("that is not what I meant"). Before the
 *      resolver, so the contentless message is not rebuilt into the request it
 *      rejects.
 *   3. A CLOSE THAT ASKS FOR NOTHING ("thanks, that's all") - and never while a
 *      question of ours is waiting, because then it is an answer or an
 *      acknowledgement and the spoken-answer path owns it.
 *
 * What is decided here is only WHICH gate speaks. What each one does when it
 * does is the handler's, and stays there.
 */
import type { Turn } from './turn.ts'

export type EarlyGate = 'answer' | 'reject' | 'close' | null

/** Everything the choice depends on, as facts rather than as readers to call. */
export interface EarlyFacts {
  /** A yes or a no (or an acknowledgement) found in his words, when a question was waiting. */
  readonly answer: 'yes' | 'no' | 'unclear' | null
  /** `rejectsWithoutSaying` on his cleaned words. */
  readonly rejects: boolean
  /** `closesWithoutAsking` on his cleaned words. */
  readonly closes: boolean
  /** A blocker or an open question of ours was waiting on him. */
  readonly questionWaiting: boolean
  /** The last thing the office said ended in a question. */
  readonly weAsked: boolean
}

/**
 * The gate that owns this utterance, or null when none does and the ordinary
 * reading carries on.
 */
export const decideEarlyGate = (f: EarlyFacts): EarlyGate => {
  if (f.answer === 'yes' || f.answer === 'no') return 'answer'
  if (f.rejects) return 'reject'
  if (f.closes && !f.questionWaiting && !f.weAsked) return 'close'
  return null
}

/**
 * Gates further down that read what an answer would also read as, and which an
 * answer to a waiting question outranks when the WHOLE message is that answer.
 *
 * "No, leave it" is `callsItOff`'s pattern and it is also the answer to "Shall
 * I send this?". Both fired: the conversation's running work was stopped AND
 * the question was declined, on one sentence. When a question is waiting the
 * answer is what he meant.
 */
export type OutrankedGate = 'call_off' | 'reject' | 'close'

export const answerOutranks = (turn: Turn, _gate: OutrankedGate): boolean =>
  turn.answer !== null &&
  turn.answer.reading !== 'unclear' &&
  // A peeled answer leaves a remainder that is a request in its own right, and
  // the gates read THAT. Only a message that is nothing but the answer is
  // outranked here.
  turn.answer.remainder === ''

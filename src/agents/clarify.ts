/**
 * What the next turn is, when the office has asked a question.
 *
 * ## The defect this exists for
 *
 * The third examination, 2026-09-15:
 *
 *     Grant  Line up a task on alpha to take up references for the two we keep.
 *     Office Happy to add that. What should it be called?
 *     Grant  Walk me through whether two is actually enough to choose from.
 *
 * and `public.tasks` gained a row called **"Walk me through whether two is
 * actually enough to choose from"**. An ordinary question became the name of a
 * task Grant never confirmed, because the code that read the reply asked only
 * "is this short and free of question marks".
 *
 * ## The invariant
 *
 * A PENDING CLARIFICATION IS NOT PERMISSION TO REINTERPRET THE NEXT ARBITRARY
 * USER TURN AS MISSING ACTION DATA.
 *
 * The general shape, which holds for every action and not only this one:
 *
 *   missing argument -> clarification -> a SEMANTICALLY VALID answer ->
 *   governance -> execution -> canonical verification -> truthful confirmation
 *
 * and never
 *
 *   missing argument -> the next string -> execution.
 *
 * ## How long a pending question lasts, decided rather than inherited
 *
 * **One turn, for an implicit answer. For ever, for an explicit one.**
 *
 * An implicit answer — a bare phrase that is only a name because of what was
 * asked a moment ago — is read from the immediately preceding turn and nothing
 * further back. If that turn is not an answer, the pending action LAPSES and
 * the office must ask again. Nothing can fire five turns later off a question
 * Grant has forgotten he was asked.
 *
 * An explicit answer — "call it X", "name it X" — needs no pending state at
 * all and is honoured whenever it arrives, which is what makes the delayed
 * reply work without keeping a loaded gun pointed at every later message.
 *
 * This is a policy choice and is written down because the alternative was
 * arriving at one by accident, which is how the defect above happened.
 */
import { clauses } from './clauses.ts'
import { readClause } from './request.ts'

/** What the office should conclude the next turn is. */
export type FollowUp =
  /** An answer to the field that was asked about. The only value that proceeds. */
  | 'answered'
  /** A new request or question. The pending action lapses, unacted. */
  | 'changed_subject'
  /** Explicitly dropped. The pending action lapses, unacted. */
  | 'cancelled'
  /** Not an answer yet — "I'm not sure". The question stands, nothing happens. */
  | 'unsure'
  /** A correction to the original request rather than an answer to the question. */
  | 'corrected'
  /** Cannot tell. Nothing happens, which is the point of having the value. */
  | 'ambiguous'

export interface FollowUpReading {
  readonly kind: FollowUp
  /** The field value, only ever present when `kind` is `answered`. */
  readonly value: string | null
  readonly why: string
}

/** "Call it X." Unmistakable on its own, so it needs no pending question. */
const NAMING =
  /^\s*(?:call it|name it|title it|let'?s call it|it'?s called|call the task|name the task|title)\s*[:,-]?\s*(?<value>.+?)\s*[.!]?\s*$/i

/** Dropping it. Checked after uncertainty, because "I don't know" contains a negation. */
const CANCELS =
  /\b(?:forget\s+it|never\s+mind|nevermind|leave\s+it|drop\s+it|cancel\s+(?:it|that)|don'?t\s+bother|no\s+need|scrap\s+it|actually\s+no)\b/i

/**
 * The same vocabulary, anchored: the sentence OPENS by dropping something.
 *
 * Exported because `teaching.ts` needs exactly this question and inventing a
 * second list of the ways English cancels is how two words for one thing get
 * into a codebase. Anchored, because the force of a sentence is set by its
 * main clause: *"Okay, never mind about that."* is a cancellation, while
 * *"From now on there is no need to cc me"* is a standing rule that happens
 * to contain one of these phrases further in.
 *
 * It exists because `STANDING` in `teaching.ts` contains the bare word
 * `never`, so *"Okay, never mind about that."* was stored as a standing
 * instruction and sat in every Chief of Staff prompt for eight days. The same
 * shape as a destructive-tool matcher that could not see inside
 * `delete_everything`: a marker matching inside a fixed phrase whose meaning
 * is the opposite of the marker's.
 */
export const opensByDroppingIt = (text: string): boolean =>
  new RegExp(
    `^\\s*(?:ok(?:ay)?|right|well|actually|sorry|no)?[,\\s]*(?:${CANCELS.source})`,
    'i',
  ).test(String(text ?? '').trim())

/** Not an answer yet. */
const UNSURE =
  /\b(?:not\s+sure|no\s+idea|don'?t\s+know|do\s+not\s+know|let\s+me\s+think|haven'?t\s+decided|undecided|good\s+question|dunno)\b/i

/** Changing the original request rather than answering the question. */
const CORRECTS = /^\s*(?:actually|on\s+second\s+thoughts?|scratch\s+that|instead|rather)\b/i

/**
 * A complementiser or a second-person address, either of which means the turn
 * is talking TO the office rather than naming something for it.
 *
 * "Walk me through whether two is enough" has both. A title has neither.
 */
const ADDRESSED = /\b(?:me|my|you|your|us)\b/i
const COMPLEMENTISER = /\b(?:whether|what|why|when|where|which|how|if)\b/i

/** A referent points at something else; it is not a name. */
const REFERENT = /^(?:that|it|this|those|them|the\s+(?:above|same|other|one))\b/i

/** How many words a bare phrase may be and still read as a name. */
const NAME_WORDS = 8

/**
 * Read the turn that followed a question from the office.
 *
 * `pending` is whether the office's previous answer actually asked for this
 * field. With no pending question only an explicit naming form counts, which
 * is what stops an ordinary sentence becoming a title out of nowhere.
 *
 * `resolvesAnotherAction` is supplied by the caller rather than computed here,
 * because only the caller knows which recognisers exist. A turn that is itself
 * a request for something is never an answer to a question about something
 * else.
 */
export const readFollowUp = (
  instruction: string,
  pending: boolean,
  resolvesAnotherAction = false,
): FollowUpReading => {
  const text = instruction.trim()
  if (text === '') return { kind: 'ambiguous', value: null, why: 'nothing was said' }

  const named = NAMING.exec(text)
  if (named !== null) {
    const value = (named.groups?.value ?? '').trim().replace(/[.!]+$/, '')
    return value === '' || REFERENT.test(value)
      ? { kind: 'ambiguous', value: null, why: 'an explicit naming form pointing at a referent' }
      : { kind: 'answered', value, why: 'an explicit naming form, which needs no pending question' }
  }

  if (!pending) {
    return {
      kind: 'changed_subject',
      value: null,
      why: 'nothing was pending, and this does not name anything',
    }
  }

  // Uncertainty before cancellation: "I don't know" carries a negation and is
  // not a withdrawal.
  if (UNSURE.test(text)) return { kind: 'unsure', value: null, why: 'not an answer yet' }
  if (CANCELS.test(text)) return { kind: 'cancelled', value: null, why: 'the request was dropped' }
  if (CORRECTS.test(text)) {
    return {
      kind: 'corrected',
      value: null,
      why: 'a change to the original request, not an answer',
    }
  }

  if (resolvesAnotherAction) {
    return { kind: 'changed_subject', value: null, why: 'this turn asks for something of its own' }
  }

  const first = readClause(clauses(text)[0] ?? text)
  if (first.mood === 'question') {
    return { kind: 'changed_subject', value: null, why: 'a question, not a name' }
  }

  /*
    The turn that caused all of this. It is an imperative, which makes it an
    ask — and an ask can still be a title ("Chase the supplier" is a perfectly
    good name). What separates them is who the sentence is about: a title names
    a piece of work, and "walk ME through WHETHER two is enough" is addressed to
    the office and embeds a question. Either mark is enough to refuse it.
  */
  if (ADDRESSED.test(text) || COMPLEMENTISER.test(text)) {
    return {
      kind: 'changed_subject',
      value: null,
      why: 'addressed to the office or embedding a question, so it is a request rather than a name',
    }
  }

  if (REFERENT.test(text)) {
    return { kind: 'ambiguous', value: null, why: 'a referent, which is not a name' }
  }

  const words = text.split(/\s+/).filter((w) => w !== '')
  if (words.length > NAME_WORDS) {
    return {
      kind: 'ambiguous',
      value: null,
      why: `${String(words.length)} words is a sentence, not a name`,
    }
  }

  return {
    kind: 'answered',
    value: text.replace(/[.!]+$/, ''),
    why: 'a short phrase, with a question outstanding',
  }
}

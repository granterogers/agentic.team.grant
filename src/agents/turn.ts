/**
 * The turn: what Grant said, and what the office made of it, kept apart.
 *
 * `instructionHandler` used to hold four different texts under one variable
 * name and two more beside it: what he typed (after transcription), the same
 * with fillers and pairing cleaned, the same with a withdrawn half taken out,
 * and a MODEL'S REWRITE of that which stood in for all of them downstream. Every
 * reader picked one by which variable it happened to be handed, and the same
 * mistake was made and repaired once per reader (#313, #322, #327, #328, #329):
 * a reader that PERMITS something reading a paraphrase manufactured the request
 * it then honoured.
 *
 * A `Turn` is built once, at the point the handler has finished hearing him, and
 * never mutated. It says what each text IS, and the type system says who may
 * read which:
 *
 *   said      what he supplied (a voice note: its transcript). Nothing removed.
 *   cleaned   `said` with mechanical repairs only (dictation noise, a link
 *             paired with its caption). Same words, same entitlements.
 *   kept      `cleaned` minus what he took back in the same message, and minus
 *             a leading yes or no that answers a question the office had open.
 *             This is what the OFFICE may act on as his request.
 *   resolved  a model's rewrite of `kept` so it stands alone. USEFUL for routing
 *             and for what a model reads; it is not his evidence of anything.
 *
 * `said`, `cleaned` and `kept` are `HumanWords`; `resolved` is a `Paraphrase`.
 * The two are different types and neither is assignable to the other, so a
 * reader that permits, causes or cancels something takes `HumanWords` and
 * `turn.resolved` does not compile in its argument list. `entitled.ts` is the
 * set of readers held to that.
 *
 * This is a value, not a stage: nothing here decides anything, calls a model or
 * touches the database. What was said and what it means are computed elsewhere
 * (`understand`, the recognisers) and the handler keeps that separate.
 */
import { withoutQuotedMaterial } from './quoted-material.ts'
import { type Retraction, readRetraction } from './retraction.ts'
import { spokenAnswer } from './spoken-answer.ts'

declare const humanWords: unique symbol
declare const paraphrase: unique symbol

/** Words Grant himself supplied, with at most mechanical repair. May authorise. */
export type HumanWords = string & { readonly [humanWords]: true }
/** Words a model produced to stand in for his. Routes and informs; never authorises. */
export type Paraphrase = string & { readonly [paraphrase]: true }

/**
 * Mark a string as his words. Only for a boundary that KNOWS it is his - the
 * handler taking the text off the inbound command, a test building a fixture.
 * Passing a model's output through this is the defect the types exist to stop.
 */
export const asHumanWords = (text: string): HumanWords => text as HumanWords
/** Mark a string as a model's rewrite. */
export const asParaphrase = (text: string): Paraphrase => text as Paraphrase

/** A yes or a no to a question the office had open, found in his words. */
export interface AnswerClause {
  readonly reading: 'yes' | 'no' | 'unclear'
  /** The words that were the answer. */
  readonly words: HumanWords
  /** What was left after them: empty when the whole message was the answer. */
  readonly remainder: HumanWords
}

/*
  What may follow a yes without QUALIFYING it. "Yes, but only the first" and
  "Yes, unless they have already replied" are not bare answers, and treating
  them as one would approve something he did not approve. A leading
  connective is stripped ("Yes - and remind me tomorrow"); a qualifier stops
  the peel and the whole message goes through the ordinary reading, which
  leaves the question open.
*/
const QUALIFIER =
  /^(?:but|except|unless|only|though|although|however|just|provided|as long as|if|apart|other than|not|no|nope|wait|actually|hold on|sorry|although)\b/i
const CONNECTIVE = /^(?:and also|and then|oh and|and|also|then|plus)\b[\s,:;-]*/i
/*
  Where an answer can end and the rest begin: sentence punctuation or a dash,
  or a comma followed by a connective. A bare comma is NOT a boundary:
  "Yes, send the invoice" is one instruction and answering a question with it
  would be approving on the strength of a verb.
*/
const CUT =
  /(?:[.!?;]+\s+)|(?:\s*[—–]+\s*)|(?:\s+-+\s+)|(?:,\s*(?=(?:and|also|then|plus|oh and)\b))/gi

/**
 * Read a yes or a no from the front of what he said.
 *
 * Pure. It says nothing about whether a question was actually waiting - the
 * caller asks the database that and only then lets an answer be an answer. The
 * reading is the deterministic one (`spokenAnswer`), on his words, so a model
 * cannot make a yes out of a sentence he did not say.
 */
export const answerClause = (text: HumanWords): AnswerClause | null => {
  const whole = spokenAnswer(text)
  if (whole !== null) {
    return { reading: whole, words: text, remainder: asHumanWords('') }
  }
  const cuts = [...text.matchAll(CUT)]
  // The LONGEST bare answer at the front wins: "Yes, do that" is one answer.
  for (const cut of cuts.reverse()) {
    const at = cut.index ?? 0
    const prefix = text.slice(0, at).trim()
    const rest = text.slice(at + cut[0].length).trim()
    if (prefix === '' || rest === '') continue
    const reading = spokenAnswer(prefix)
    if (reading !== 'yes' && reading !== 'no') continue
    const tail = rest.replace(CONNECTIVE, '').trim()
    if (tail === '' || QUALIFIER.test(rest) || QUALIFIER.test(tail)) continue
    return { reading, words: asHumanWords(prefix), remainder: asHumanWords(tail) }
  }
  return null
}

export interface TurnInput {
  readonly said: string
  readonly cleaned: string
  /** From `readRetraction(cleaned)`. */
  readonly retraction: Retraction | null
  /** From `answerClause(kept-before-peel)`, and only when a question was waiting. */
  readonly answer: AnswerClause | null
  /** The resolver's verdict on `kept`. */
  readonly resolved: {
    readonly instruction: string
    readonly changed: boolean
    readonly from: string | null
  }
  readonly addressedTo: string | null
  readonly isBranch: boolean
}

export interface Turn {
  readonly said: HumanWords
  readonly cleaned: HumanWords
  readonly kept: HumanWords
  /** What he took back in the same message, kept so the office can SAY it set it aside. */
  readonly withdrawn: { readonly words: HumanWords; readonly pivot: string } | null
  /** A yes or no he gave to a question that was waiting, if he gave one. */
  readonly answer: AnswerClause | null
  readonly resolved: Paraphrase
  /** Whether the model rewrote `kept` at all. */
  readonly rewritten: boolean
  /** Handed on by a colleague rather than said by him: its words are the office's, not his. */
  readonly isBranch: boolean
  readonly addressedTo: string | null
}

/**
 * The kept words of a message, given the retraction and a peeled answer. One
 * function so the handler and the tests cannot compute it two ways.
 */
export const keptOf = (
  cleaned: string,
  retraction: Retraction | null,
  answer: AnswerClause | null,
): HumanWords => {
  const afterRetraction = retraction === null ? cleaned : retraction.kept
  // What he pasted is his CONTENT, never his request: the doers read the turn with it taken out (quoted-material.ts).
  if (answer !== null && answer.remainder !== '')
    return asHumanWords(withoutQuotedMaterial(answer.remainder))
  return asHumanWords(withoutQuotedMaterial(afterRetraction))
}

export const buildTurn = (input: TurnInput): Turn => {
  const kept = keptOf(input.cleaned, input.retraction, input.answer)
  return Object.freeze({
    said: asHumanWords(input.said),
    cleaned: asHumanWords(input.cleaned),
    kept,
    withdrawn:
      input.retraction === null
        ? null
        : Object.freeze({
            words: asHumanWords(input.retraction.withdrawn),
            pivot: input.retraction.pivot,
          }),
    answer: input.answer,
    resolved: asParaphrase(input.resolved.instruction),
    rewritten: input.resolved.changed,
    isBranch: input.isBranch,
    addressedTo: input.addressedTo,
  })
}

/** Convenience for the handler: the retraction of a cleaned message, as a pure read. */
export const retractionOf = (cleaned: string): Retraction | null => readRetraction(cleaned)

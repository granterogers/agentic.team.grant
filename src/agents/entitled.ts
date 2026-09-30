/**
 * The readers that may PERMIT, CAUSE or CANCEL something, held to his words.
 *
 * Each one decides whether Grant asked for a plan, a filing, a page to be
 * opened, a stop, a standing rule, another attempt, or answered a question the
 * office put to him. Each of those has a consequence. So each takes
 * `HumanWords` - what he said, minus mechanical repair and what he took back -
 * and NOT the model's rewrite, which is a `Paraphrase` and does not compile in
 * their argument lists (`tests/agents/entitled.test.ts` proves that with
 * `@ts-expect-error`, which fails the typecheck the day it stops being an
 * error).
 *
 * `instructionHandler` reaches these readers ONLY through this object. The
 * readers themselves are unchanged and keep taking `string`, so every existing
 * unit test still speaks to them directly; what changes is that the handler,
 * which is where a paraphrase used to be handed to the wrong one, can no longer
 * do it by accident. A second test asserts the handler imports none of them
 * from its own module.
 *
 * A paraphrase may still PROPOSE: `proposedByRewrite` is the one door through
 * which a rewritten sentence is read, and what comes back is a thing to ASK
 * about, never to do.
 */

import { pageRequest } from './actions.ts'
import { wantsAnotherGo } from './again.ts'
import { callsItOff } from './calloff.ts'
import { connectRequest, populateRequest } from './connect.ts'
import { readCorrection } from './correction.ts'
import { linkRequest } from './links.ts'
import { readPlan } from './plan.ts'
import { spokenAnswer } from './spoken-answer.ts'
import { readTeaching } from './teaching.ts'
import type { HumanWords, Turn } from './turn.ts'

export const entitled = {
  /** He asked for a plan (notebook, sources, generation). */
  plan: (words: HumanWords) => readPlan(words),
  /** He asked for a notebook to be filled from the project. */
  populate: (words: HumanWords) => populateRequest(words),
  /** He asked for one thing to be wired to another. */
  connect: (words: HumanWords) => connectRequest(words),
  /** He sent a link to be filed. */
  link: (words: HumanWords) => linkRequest(words),
  /** He asked for a page to be opened and read. */
  page: (words: HumanWords) => pageRequest(words),
  /** He called work off. */
  callsItOff: (words: HumanWords) => callsItOff(words),
  /** He taught a standing rule. */
  teaching: (words: HumanWords, alreadyAPreference = false) =>
    readTeaching(words, alreadyAPreference),
  /** He corrected the last answer. */
  correction: (words: HumanWords, hadAnswer: boolean) => readCorrection(words, hadAnswer),
  /** He asked for another attempt. */
  anotherGo: (words: HumanWords) => wantsAnotherGo(words),
  /** He answered a question the office asked. */
  answer: (words: HumanWords) => spokenAnswer(words),
} as const

/**
 * FORWARDED WORDS ARE CONTENT, NOT INTENT (0624, and the class behind #392/#397).
 *
 * A message he forwards carries somebody else's words under his name. The first fix guarded three writers one by one
 * (links, rules, tasks) and left every other reader reading it as an instruction - the instance-versus-class mistake
 * #249/#254 record. The handler reaches every consequence-bearing reader through `entitled`, so the class is closed
 * here: for a forwarded turn it is handed THIS object, in which nobody asked for anything. The turn is still
 * answered (prose, from the model); only the deterministic readers that cause, permit or cancel something are silent.
 */
export const noneEntitled: typeof entitled = {
  plan: () => null,
  populate: () => false,
  connect: () => null,
  link: () => null,
  page: () => null,
  callsItOff: () => null,
  teaching: () => null,
  correction: () => null,
  anotherGo: () => null,
  answer: () => null,
}

/**
 * What a rewrite would have made of it, when his own words made nothing.
 *
 * Non-null means: the resolver's paraphrase reads as this act and Grant's words
 * do not. That is a thing to ASK ("did you mean...?"), not a thing to do - the
 * only difference between the two is whether the words that make it a request
 * are his.
 */
export const proposedByRewrite = <T>(turn: Turn, reader: (text: string) => T | null): T | null =>
  turn.rewritten && reader(turn.kept) === null ? reader(turn.resolved) : null

/**
 * The wall between what the simulator knows and what the office is told.
 *
 * §5 of the mission: the office under test *"never receives hidden intent,
 * expected result, rubric, future turns or judge notes"*, and §10 lists
 * `hidden intent leaked` among the HARD FAILURES that must stay individually
 * visible. §14 requires it to be sabotage-proved rather than asserted.
 *
 * ## Why two checks and not one
 *
 * A leak can arrive two ways and each is invisible to the other's detector.
 *
 * **Structurally** — a field is added to `ScenarioTurn`, somebody writes
 * `{ ...turn }` into the office's context, and the new field rides along. No
 * string matches anything suspicious because the field is called
 * `expectedEffect` and holds `'task'`. `fieldsCrossing` catches this: the
 * object that crosses must have EXACTLY the permitted keys, deny by default.
 *
 * **By content** — somebody builds a perfectly well-shaped `Utterance` whose
 * `text` was assembled by concatenating the goal description onto the
 * sentence. Every key is permitted and the office has been handed the
 * answer. `textCrossing` catches this: no out-of-band string may appear in
 * anything the office reads.
 *
 * An allow-list is the right instrument here, against CLAUDE.md's general
 * advice to prefer a property over an enumeration. That advice is about
 * enumerating things a future change will legitimately ADD — source schemes,
 * absence phrasings — where the enumeration goes stale by refusing something
 * valid. This enumeration is a security boundary, where going stale means
 * refusing to carry a new field until somebody has decided it is safe. That
 * is the cheap direction, and it is the direction a firewall should fail in.
 *
 * ## What is NOT a leak, and why the distinction matters
 *
 * A withdrawn clause and a negative constraint are IN the person's message by
 * design — *"book the thing, actually forget that"* contains its own
 * cancellation, and *"don't contact anyone"* is the person speaking. A
 * detector that flagged those would fire on every correct scenario in the
 * cancellation and negative-constraint families, and CLAUDE.md is explicit
 * about what a check that fires on correct behaviour costs: it is one
 * somebody switches off.
 *
 * What may never cross is the OUT-OF-BAND material — the analyst's
 * description of the goal (`want`), the note on what the turn is testing
 * (`why`), the two clarification lists, and the machine-readable effect
 * class. None of those is anything a person would ever type.
 */

import type { HiddenIntent, Scenario, ScenarioTurn, Utterance } from './scenario.ts'

/**
 * Every key an object crossing to the office is allowed to have.
 *
 * Kept as a runtime value rather than only a type, because a type is erased
 * before the object exists and this must be checkable at the moment of
 * crossing.
 */
export const CROSSING_KEYS: readonly string[] = ['text', 'channel', 'inProject']

export interface Leak {
  /** `shape` — a field that may not cross. `content` — hidden words in the text. */
  readonly kind: 'shape' | 'content'
  /** What leaked, named. Never the secret itself where the name will do. */
  readonly what: string
  readonly detail: string
}

/**
 * The strings from a scenario that must never appear in what the office reads.
 *
 * Note what is deliberately absent: `withdrawn` and `forbids`. See the header.
 */
export const outOfBand = (scenario: Scenario, turn: ScenarioTurn): readonly string[] => {
  const i: HiddenIntent = turn.intent
  return [
    i.want,
    turn.why,
    i.effect,
    ...(i.mayAskAbout ?? []),
    ...(i.alreadyKnows ?? []),
    scenario.family,
    scenario.id,
  ].filter((s) => s.trim() !== '')
}

/**
 * Normalised for comparison, so a leak cannot hide behind punctuation or case.
 *
 * CLAUDE.md records a wording lock defeating an assertion five separate
 * times. The mirror of that mistake in a firewall is a leak escaping because
 * somebody title-cased it.
 */
const flat = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'"]+/g, ' ')
    .trim()

/**
 * A hidden string is short enough that its appearance proves nothing.
 *
 * `effect` is `'task'`, and the word "task" is one a person says constantly.
 * Flagging it would make the negative-constraint and task families
 * permanently red for the right reason and the wrong cause. So a short
 * out-of-band string is only a leak when it stands alone as a field, which is
 * `fieldsCrossing`'s job, not this one.
 *
 * Eight characters is above every `EffectClass` value but far below any
 * `want` sentence the generator produces.
 */
const TOO_SHORT_TO_PROVE = 8

export const textCrossing = (
  scenario: Scenario,
  turn: ScenarioTurn,
  reaching: string,
): readonly Leak[] => {
  const haystack = flat(reaching)
  const found: Leak[] = []
  for (const secret of outOfBand(scenario, turn)) {
    const needle = flat(secret)
    if (needle.length < TOO_SHORT_TO_PROVE) continue
    if (haystack.includes(needle)) {
      found.push({
        kind: 'content',
        what: 'an out-of-band string reached the office verbatim',
        detail: secret.slice(0, 120),
      })
    }
  }
  return found
}

export const fieldsCrossing = (crossing: object): readonly Leak[] =>
  Object.keys(crossing)
    .filter((k) => !CROSSING_KEYS.includes(k))
    .map((k) => ({
      kind: 'shape' as const,
      what: 'a field the office may not see was on the object that crossed',
      detail: k,
    }))

/**
 * The gate. Everything reaching the office goes through here or the harness
 * is not measuring what it claims to.
 *
 * It THROWS rather than returning a verdict. A leak is not a low score on a
 * dimension — it invalidates the run it happened in, and a return value is a
 * thing a caller can ignore. §10 puts `hidden intent leaked` among the hard
 * failures for the same reason.
 */
export class HiddenIntentLeak extends Error {
  constructor(readonly leaks: readonly Leak[]) {
    super(
      `hidden intent reached the office under test: ${leaks
        .map((l) => `${l.kind}: ${l.what} (${l.detail})`)
        .join('; ')}`,
    )
    this.name = 'HiddenIntentLeak'
  }
}

/**
 * Check an utterance, and anything else the office will read alongside it,
 * before any of it crosses.
 *
 * `alongside` exists because the utterance is rarely the only thing handed
 * over: a conversation history, a project name, a standing preference and a
 * persona's stored context all reach the model too, and a leak through any of
 * them counts exactly the same. CLAUDE.md's rule about auditing what the PAGE
 * requests rather than what the section is called, applied to a firewall.
 */
export const sealed = (
  scenario: Scenario,
  turn: ScenarioTurn,
  utterance: Utterance,
  alongside: readonly string[] = [],
): Utterance => {
  const leaks = [
    ...fieldsCrossing(utterance),
    ...textCrossing(
      scenario,
      turn,
      [utterance.text, utterance.inProject ?? '', ...alongside].join('\n'),
    ),
  ]
  if (leaks.length > 0) throw new HiddenIntentLeak(leaks)
  return utterance
}

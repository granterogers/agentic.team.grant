/**
 * Versioned behavioural profiles — §6, *"model humans, not prompt strings"*.
 *
 * A persona is not a prompt and not a list of sentences. It is a set of
 * DISPOSITIONS: how often this person leaves punctuation off, how readily
 * they say "that one" instead of naming the thing, whether they change their
 * mind mid-message, how much of their request they leave implied. The
 * generator draws sentences; the persona decides how they come out.
 *
 * ## Why more than one person
 *
 * §6 asks for Grant-like *and others*, "to avoid overfitting". The risk is
 * concrete and this repository has already paid it once: CLAUDE.md records a
 * grading rubric that agreed with Grant 7/7 on seven historical cases and
 * 15/20 once the corpus was widened with paired controls. A harness tuned
 * against one person's habits measures that person's habits. A crisp,
 * fully-punctuated persona is not decoration — it is the control that says
 * whether a failure is about messiness at all.
 *
 * ## Versioned, and why the version is in the record
 *
 * `version` goes into every scenario's provenance. Two runs on different
 * persona versions are two different instruments, exactly as `JUDGE_VERSION`
 * makes two judge wordings incomparable. Widen `disorder` by a tenth and
 * yesterday's pass rate stops meaning anything; without the version nobody
 * can tell that happened.
 */

/**
 * How strongly a disposition applies. 0 never, 1 always.
 *
 * A number rather than a flag because §6 ends with a warning worth obeying:
 * *"Do not make every message maximally messy."* A boolean gives two
 * personas — immaculate and unreadable — and neither is anybody. Real
 * messiness is occasional, which is what makes it hard: an office that
 * handles every message being a fragment would handle these, and an office
 * tuned on clean text falls over on the one in five that is not.
 */
export type Tendency = number

export interface Persona {
  readonly slug: string
  readonly version: string
  /** One sentence a person would recognise. For the report, not the model. */
  readonly about: string

  // --- how the words come out ---------------------------------------------

  /** Leaves sentences unpunctuated and uncapitalised. */
  readonly unpunctuated: Tendency
  /** Types a word wrong and does not go back. */
  readonly typos: Tendency
  /** Opens with filler — "so", "right", "yeah ok so". */
  readonly filler: Tendency
  /** Starts a sentence, abandons it, starts again. */
  readonly falseStart: Tendency
  /** Shortens — "pls", "w/", "asap", "&". */
  readonly shorthand: Tendency
  /** Drops the apostrophe: "dont", "wont", "thats". */
  readonly looseApostrophes: Tendency
  /** Sends a fragment rather than a sentence. */
  readonly fragments: Tendency

  // --- how the meaning comes out ------------------------------------------

  /** Says "that one" / "the other one" where a name would be clearer. */
  readonly vagueReference: Tendency
  /** Puts more than one request in a single message. */
  readonly multiRequest: Tendency
  /** Appends an afterthought — "oh and", "actually also". */
  readonly afterthought: Tendency
  /** Changes their mind inside the message — "no, forget that". */
  readonly selfCorrection: Tendency
  /** Implies the action rather than naming it: "we should probably chase Kevin". */
  readonly impliedAction: Tendency
  /** Refers to something from an earlier turn without restating it. */
  readonly refersBack: Tendency

  // --- how they answer the office -----------------------------------------

  /** Replies in one or two words: "yes", "that one", "wednesday instead". */
  readonly terseReplies: Tendency
  /**
   * Approves when asked for approval, rather than declining or modifying.
   *
   * §8 wants all three. Expressed as the probability of approval, with the
   * remainder split between declining and modifying by the runner, so a
   * persona can be cautious without needing three numbers that must sum to
   * one — which is a constraint nobody maintains.
   */
  readonly approves: Tendency
}

/**
 * The person this office is actually for.
 *
 * Every number here is drawn from CLAUDE.md's own record of how Grant writes
 * — his quoted instructions, the messages that produced Issues, and the
 * failure families this repository has already paid for. `impliedAction` is
 * high because *"Make me a note to call Kevin"* and *"we should probably
 * chase this"* are the shape that produced #130's whole family.
 * `selfCorrection` is high because *"Do not draft the plan. Create the tasks
 * instead."* is a documented defect in this repository's own comprehension
 * layer. `vagueReference` is high because CLAUDE.md has an entire trap
 * entitled *"no, the other project"*.
 *
 * None of them is 1. He writes a clean sentence often enough that an office
 * failing only on clean sentences would still be broken for him.
 */
export const GRANT_LIKE: Persona = {
  slug: 'grant-like',
  version: '2026-09-21.1',
  about: 'Thinks out loud, often into a voice note, often with three things already in flight.',
  unpunctuated: 0.55,
  typos: 0.2,
  filler: 0.35,
  falseStart: 0.2,
  shorthand: 0.25,
  looseApostrophes: 0.5,
  fragments: 0.25,
  vagueReference: 0.45,
  multiRequest: 0.35,
  afterthought: 0.3,
  selfCorrection: 0.25,
  impliedAction: 0.4,
  refersBack: 0.4,
  terseReplies: 0.6,
  approves: 0.55,
}

/**
 * The control.
 *
 * Writes properly, names things, one request per message. If a scenario
 * fails for this persona it is not a messiness defect, and that is the whole
 * value of having her: without a clean control, every failure looks like it
 * is about typos and none of them can be attributed.
 */
export const PRECISE: Persona = {
  slug: 'precise',
  version: '2026-09-21.1',
  about: 'Writes a complete sentence, names the project, asks one thing at a time.',
  unpunctuated: 0,
  typos: 0,
  filler: 0,
  falseStart: 0,
  shorthand: 0,
  looseApostrophes: 0,
  fragments: 0,
  vagueReference: 0,
  multiRequest: 0,
  afterthought: 0,
  selfCorrection: 0,
  impliedAction: 0,
  refersBack: 0.1,
  terseReplies: 0.1,
  approves: 0.5,
}

/**
 * Speaks everything; nothing is typed.
 *
 * A voice transcript is a genuinely different object from typed text, not
 * typed text with mistakes: no punctuation at all, numbers as words, the
 * speaker's own correction left in the stream because the transcriber has no
 * way to remove it. §16 notes the canonical door is one translation step
 * short of the real channels, and this persona is how that step gets
 * exercised without sending anything anywhere.
 */
export const DICTATES: Persona = {
  slug: 'dictates',
  version: '2026-09-21.1',
  about:
    'Everything arrives as a voice-note transcript: no punctuation, spoken numbers, self-corrections left in.',
  unpunctuated: 1,
  typos: 0.05,
  filler: 0.6,
  falseStart: 0.45,
  shorthand: 0,
  looseApostrophes: 0.8,
  fragments: 0.3,
  vagueReference: 0.5,
  multiRequest: 0.45,
  afterthought: 0.45,
  selfCorrection: 0.4,
  impliedAction: 0.4,
  refersBack: 0.35,
  terseReplies: 0.4,
  approves: 0.5,
}

/**
 * Says as little as possible and expects it to be understood.
 *
 * Not Grant, and useful precisely because of that: the office's comprehension
 * layer has more to work with in a rambling message than in four words, so
 * this persona finds the floor. "chase kevin" is a complete request to a
 * person and nearly nothing to a parser.
 */
export const CLIPPED: Persona = {
  slug: 'clipped',
  version: '2026-09-21.1',
  about: 'Four words, no context, expects to be understood.',
  unpunctuated: 0.9,
  typos: 0.1,
  filler: 0,
  falseStart: 0,
  shorthand: 0.6,
  looseApostrophes: 0.7,
  fragments: 0.8,
  vagueReference: 0.6,
  multiRequest: 0.05,
  afterthought: 0.05,
  selfCorrection: 0.05,
  impliedAction: 0.5,
  refersBack: 0.5,
  terseReplies: 0.95,
  approves: 0.5,
}

export const PERSONAS: readonly Persona[] = [GRANT_LIKE, PRECISE, DICTATES, CLIPPED]

export const personaBySlug = (slug: string): Persona | undefined =>
  PERSONAS.find((p) => p.slug === slug)

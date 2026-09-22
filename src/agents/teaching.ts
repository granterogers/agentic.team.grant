/**
 * Telling the office how to do something, in a message, without a coding
 * session.
 *
 * Grant: *"I don't wanna have to do this via Claude... all behaviours, skills,
 * what I want them to do, it can all just be told to them directly via Telegram
 * or Slack."*
 *
 * Issues #48 and #50. Both tables existed and neither could be written to by
 * anything Grant can reach — `app.learn` and `app.teach_skill` had no caller
 * outside their own test suites. A memory only Claude can write to is Claude's
 * memory.
 *
 * ## Two shapes, and telling them apart is the whole job
 *
 * ADR-0015 and ADR-0017 make the distinction load-bearing rather than
 * cosmetic:
 *
 * - **A lesson** is a standing preference. One sentence, 280 characters, and
 *   structurally incapable of holding a procedure. *"Always give me the URL as
 *   well as the screenshot."*
 * - **A skill** is a procedure. As long as it needs to be, and refused if it
 *   contains an address. *"When you write a project brief, read the spec first,
 *   then list the files it touches, then say what you did not do."*
 *
 * Storing a procedure as a lesson would truncate it into nonsense; storing a
 * preference as a skill would bury one sentence in a library of methods. So the
 * reading is explicit and the say-back names which one it made, because the
 * only reliable correction is Grant seeing it was read wrong.
 *
 * ## When it is neither, it is neither
 *
 * The common case is an ordinary instruction, and a recogniser that is eager
 * turns every request into a stored rule. So this returns null readily, and the
 * bar for a skill in particular is a message that actually contains a sequence.
 */

import { withdrawsARule } from './preference.ts'

/** A standing preference. Short by construction — see ADR-0015. */
export interface LessonTaught {
  readonly kind: 'lesson'
  readonly body: string
  /**
   * The person SAID it was lasting, rather than a reader inferring it.
   *
   * "From now on", "always", "never", or an explicit ask to store it. That
   * is the difference between a preference which is unambiguously
   * future-facing and one where "do it this way" might mean this once.
   *
   * The caller routes on it: marked is stored, unmarked is OFFERED. Both
   * halves of #290 turn on this - the recognition that is unreliable, and
   * the storage that must not be silent when recognition is unreliable.
   */
  readonly marked: boolean
}

/** A procedure. See ADR-0017 for what it may and may not contain. */
export interface SkillTaught {
  readonly kind: 'skill'
  readonly name: string
  readonly whenToUse: string
  readonly procedure: string
}

export type Teaching = LessonTaught | SkillTaught

/*
  "From now on", and its relatives.

  These are the phrases that mark a sentence as being ABOUT how the office
  should behave rather than a thing to go and do. "Send me the report" is work;
  "from now on send me the report as a PDF" is a rule about work.
*/
const STANDING =
  /\b(?:from now on|going forward|in future|in the future|always|never|whenever you|every time you|as a rule|by default|remember that|remember to|bear in mind|keep in mind|make sure you always|don't ever|do not ever)\b/i

/*
  A procedure announces itself as one.

  Either by saying so — "here is how", "the way to do X is" — or by containing a
  sequence. The sequence test is what stops a long preference being filed as a
  method.
*/
const ANNOUNCES_A_METHOD =
  /\b(?:here(?:'s| is) how|this is how|the way to|the process (?:is|for)|the procedure (?:is|for)|follow these steps|do it like this|your process for)\b/i

const HAS_STEPS =
  /(?:\bfirst\b[^.!?]{0,120}\bthen\b)|(?:\bthen\b[^.!?]{0,120}\bthen\b)|(?:^|\n)\s*(?:\d+[.)]|[-*•])\s+\S+[\s\S]*?(?:\n)\s*(?:\d+[.)]|[-*•])\s+\S/im

/**
 * "When you write a brief, ..." — the condition half of a procedure.
 *
 * Anchored at a CLAUSE start, which it was not (#237). A plain eight-part work
 * request — *"...flag anything risky, suggest when we should decide, tell me
 * who should own it..."* — matched on "when we should decide," and was filed as
 * a global procedure called **"Shoulding decide"**. None of the eight clauses
 * was answered, and a piece of nonsense went into the office's memory to be
 * "put in front of the relevant work from now on".
 *
 * "suggest WHEN we should decide" is a complement clause: the `when` follows a
 * verb. A condition begins its clause — at the start of the message, or after
 * a full stop, semicolon or comma.
 *
 * That anchor is also what makes it safe to end the clause at a FULL STOP as
 * well as at a comma. The condition-last form — *"Read the spec first,
 * whenever you write a client brief"* — never matched at all before, because
 * the pattern demanded a trailing comma the sentence does not have. Accepting
 * the sentence end would once have swallowed "suggest when we should decide.";
 * with the clause anchor in front of it, that phrase is excluded by where its
 * `when` sits rather than by what follows it.
 */
const WHEN_YOU =
  /(?:^|(?<=[.;:]\s)|(?<=,\s))(?:when|whenever|any time|each time|before you|after you)\b[^.!?,]{3,80}(?:,|\bthen\b|[.!?]|$)/i

/**
 * A request for WORK, which is not a teaching however long it is.
 *
 * The second guard from #237, and the one that would have caught it on its
 * own. Grant asking for eight things is Grant asking for eight things; an
 * explicit teach signal overrides this, because "I need you to remember that
 * ..." is both.
 */
const ASKS_FOR_WORK =
  /^\s*(?:i\s+(?:need|want|would\s+like)\s+(?:you\s+)?to|can\s+you|could\s+you|would\s+you|please\s+(?:can\s+you\s+)?(?:give|send|make|draft|write|look|find|tell|work|compare|check))\b/i

/** Explicitly asking for it to be kept, which settles the question. */
const ASKS_TO_STORE =
  /\b(?:learn this|remember this|write this down|note this down|save this|store this|add this to your|make this a (?:rule|skill|habit)|this is a (?:rule|skill))\b/i

/** A single sentence, trimmed, or the whole thing if it has no full stop. */
const firstSentence = (text: string): string => {
  const cut = /^[\s\S]{10,278}?[.!?](?=\s|$)/.exec(text.trim())
  return (cut === null ? text.trim() : cut[0]).trim()
}

/**
 * A name for the procedure, from the condition it applies under.
 *
 * "When you write a project brief, ..." becomes "Writing a project brief". Not
 * clever, and deliberately so: a model-generated name would be nicer and would
 * cost a call on every message that might be a teaching, most of which are not.
 * Grant renames it on the dashboard if it reads badly.
 */
const nameFrom = (condition: string | null, procedure: string): string => {
  /*
    No stated condition means there is nothing to make a verb phrase out of.

    Decided by the CALLER passing null, not by inspecting the text. The first
    attempt ran the gerund rule over the fallback wording and shipped a skill
    called "Ting applies to the work in hand" into the live office; the second
    attempt guessed at whether the text looked like a verb phrase and produced
    "Whenevering it applies to the work in hand". The condition either exists or
    it does not, and only the caller knows.
  */
  if (condition === null) {
    const clause = (/^[^.!?,;:]{6,60}/.exec(procedure.trim())?.[0] ?? 'How we do this').trim()
    return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}`.slice(0, 80)
  }

  const stripped = condition
    .replace(
      /^\s*(?:when|whenever|any time|each time|before|after)\s+(?:you|we|i|it)\s+(?:are\s+|comes?\s+to\s+)?/i,
      '',
    )
    .replace(/^\s*(?:when|whenever|any time|each time|before|after)\s+/i, '')
    .replace(/[,.!?]+$/, '')
    .trim()
  if (stripped === '') return nameFrom(null, procedure)

  // "write a brief" → "Writing a brief". The first word only, greedily: a
  // non-greedy match took a letter off the front and made a word up.
  const stem = /^([a-z]+)/i.exec(stripped)?.[1]
  if (stem === undefined || /^(?:it|this|that|there|they|a|an|the)$/i.test(stem)) {
    return nameFrom(null, procedure)
  }
  const base = /e$/i.test(stem) && !/ee$/i.test(stem) ? stem.slice(0, -1) : stem
  const gerund = `${base.charAt(0).toUpperCase()}${base.slice(1)}ing${stripped.slice(stem.length)}`
  return gerund.slice(0, 80)
}

/**
 * Read an instruction as a teaching, or decide it is not one.
 *
 * Order matters: a message can look like both, and a procedure read as a
 * preference loses everything after the first full stop.
 */
/**
 * A preference the person marked as lasting only this once.
 *
 * The one thing that must still be refused when a meaning-reader has
 * already called a clause a preference. `preference.one-off-override` is a
 * real family: "keep it short on this one" shapes a single answer and
 * storing it would change every answer afterwards.
 */
const JUST_THIS_ONCE =
  /\b(?:on this one|this one time|just this once|for this one|just now|for now|this time|on this occasion)\b/i

/**
 * @param alreadyAPreference
 *   A reader that can judge MEANING has already classified this clause as a
 *   preference.
 *
 *   `understand.ts` returns a `kind` per surviving clause and `preference`
 *   is one of them, and the handler has been filtering on it and then
 *   handing the clause here — where `STANDING`, a list of lexical markers,
 *   demanded the evidence a second time. So "lead with the conclusion, I
 *   will read the why underneath" was understood as a preference and then
 *   discarded for not saying "always", which is #290: recognised only with
 *   an explicit persistence marker.
 *
 *   The marker is how a preference is spotted when nothing can read
 *   meaning. It is the WEAKER evidence, and it was gating the stronger.
 */
export function readTeaching(instruction: string, alreadyAPreference = false): Teaching | null {
  const text = instruction.trim()
  if (text.length < 20) return null

  const asked = ASKS_TO_STORE.test(text)
  const standing = STANDING.test(text)
  const method = ANNOUNCES_A_METHOD.test(text) || HAS_STEPS.test(text)
  const conditional = WHEN_YOU.exec(text)
  /*
    A request for work is not a teaching, unless it says it is (#237).

    Without this, any long instruction with a conditional clause in it became a
    procedure — and the failure is expensive twice over: the request goes
    unanswered AND the office's memory gains something it will apply to future
    work.
  */
  const isWork = ASKS_FOR_WORK.test(text) && !asked && !standing

  // A procedure: it says it is one, or it has a sequence in it, and there is
  // enough of it to be worth keeping as one.
  if (!isWork && (method || (conditional !== null && text.length >= 140)) && text.length >= 60) {
    const whenToUse =
      conditional === null
        ? // No stated condition. "Always applicable" is honest and retrievable;
          // inventing one would put the procedure in front of the wrong jobs.
          'Whenever it applies to the work in hand'
        : conditional[0]
            .replace(/[,]$/, '')
            .replace(/\s+then$/i, '')
            .trim()

    /*
      The procedure is the whole message, not the part after the condition.

      Cutting it at the comma looked tidier and dropped the first step every
      time the condition came second — "read the spec first, whenever you write
      a brief" is the same instruction with the parts swapped.
    */
    const procedure = text.slice(0, 4000)
    if (procedure.length < 40) return null

    return {
      kind: 'skill',
      name: nameFrom(conditional === null ? null : whenToUse, procedure),
      whenToUse: whenToUse.slice(0, 400),
      procedure,
    }
  }

  /*
    A preference. Short, and marked as standing — by a phrase, by an
    explicit ask to store it, or by a reader that judged the MEANING.

    The lexical marker alone is why "send me the report" does not become a
    rule about reports: nothing in that sentence says it is about how the
    office should work. A meaning-reader that has already said "this clause
    is a preference" has answered the same question better, and requiring
    the marker on top of it discarded the preference (#290).

    `JUST_THIS_ONCE` is the guard that keeps the one-off family working,
    and it applies only to the semantic route: a person who says BOTH
    "from now on" and "just this once" has contradicted themselves, and the
    explicit marker is the one to believe.
  */
  /*
    TAKING A RULE BACK IS ALSO ABOUT STANDING RULES (#310).

    "do not use bullets anymore", "forget what I said about bullets", "no
    longer put links in the replies" — none of these carries a STANDING
    marker, so none reached this branch and none could be acted on. The
    office would accept a preference and had no way to be told to stop, which
    is half a lifecycle: measured live on v705, a withdrawal was answered with
    a paragraph asking Grant to confirm what he had just said.

    `withdrawsARule` is the test rather than a word added to STANDING,
    because it is far stricter than any single word can be: it requires a
    withdrawal operator AND a dimension the office can actually aim at, so
    "I cannot do that anymore" claims nothing. The branch below then reads it
    as the lesson-shaped thing it is, and `remember()` decides it retires a
    rule rather than stating one.
  */
  const takingItBack = withdrawsARule(text) !== null

  if (standing || asked || takingItBack || (alreadyAPreference && !JUST_THIS_ONCE.test(text))) {
    const body = firstSentence(text)
    if (body.length < 8 || body.length > 280) return null
    return { kind: 'lesson', body, marked: standing || asked || takingItBack }
  }

  return null
}

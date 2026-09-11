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

/** A standing preference. Short by construction — see ADR-0015. */
export interface LessonTaught {
  readonly kind: 'lesson'
  readonly body: string
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

/** "When you write a brief, ..." — the condition half of a procedure. */
const WHEN_YOU =
  /\b(?:when|whenever|any time|each time|before you|after you)\b[^.!?,]{3,80}(?:,|\bthen\b)/i

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
export function readTeaching(instruction: string): Teaching | null {
  const text = instruction.trim()
  if (text.length < 20) return null

  const asked = ASKS_TO_STORE.test(text)
  const standing = STANDING.test(text)
  const method = ANNOUNCES_A_METHOD.test(text) || HAS_STEPS.test(text)
  const conditional = WHEN_YOU.exec(text)

  // A procedure: it says it is one, or it has a sequence in it, and there is
  // enough of it to be worth keeping as one.
  if ((method || (conditional !== null && text.length >= 140)) && text.length >= 60) {
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

  // A preference. Short, and only when the message marks itself as standing —
  // otherwise every "send me the report" becomes a rule about reports.
  if (standing || asked) {
    const body = firstSentence(text)
    if (body.length < 8 || body.length > 280) return null
    return { kind: 'lesson', body }
  }

  return null
}

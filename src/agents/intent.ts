/**
 * Intent classification — the cost governor (§6).
 *
 *   `thought` · `question` · `discussion` · `suggestion` ·
 *   `light_investigation` · `assignment` · `direct_command`
 *
 * §6 gives two rules that make it safe, and this file is mostly those two:
 *
 *   - **"Ambiguity resolves downward, never upward. Unsure between
 *     `suggestion` and `assignment` → take the cheaper one and say so."**
 *   - **"Deterministic-first. Do not call a model where ordinary code will
 *     do."**
 *
 * The second is why this is rules rather than a model call. The first is why
 * it is more interesting than a keyword match: a classifier that resolves
 * upward on ambiguity is a classifier that turns a passing remark into a
 * workload, and the cost of that error is unbounded while the cost of the
 * opposite is one clarifying question.
 *
 * ## The asymmetry, stated plainly
 *
 * Misclassifying an `assignment` as a `question` costs a round trip: Grant
 * says "no, actually do it". Misclassifying a `question` as an `assignment`
 * spends quota, occupies the job engine, possibly writes somewhere, and
 * produces work nobody asked for. The two errors are not comparable, so the
 * classifier is not symmetric.
 *
 * ## Why the confidence matters as much as the class
 *
 * Every result carries `confident`. §6's rule is to take the cheaper reading
 * *and say so*, which only works if the caller can tell a confident `question`
 * from a hedged one. An unconfident classification is a prompt to ask rather
 * than a licence to proceed.
 */

/** §6's seven classes, cheapest first. The order is the escalation ladder. */
export const INTENT_CLASSES = [
  'thought',
  'question',
  'discussion',
  'suggestion',
  'light_investigation',
  'assignment',
  'direct_command',
] as const

export type IntentClass = (typeof INTENT_CLASSES)[number]

/** Where each class sits on the cost ladder. Lower is cheaper. */
export const INTENT_COST: Readonly<Record<IntentClass, number>> = {
  thought: 0,
  question: 1,
  discussion: 2,
  suggestion: 3,
  light_investigation: 4,
  assignment: 5,
  direct_command: 6,
}

export interface Classification {
  readonly intent: IntentClass
  /**
   * False when the text supported more than one reading. The cheaper reading
   * was taken; §6 requires saying so, and this is how.
   */
  readonly confident: boolean
  /** Which rules fired, for the audit trail and for debugging a misparse. */
  readonly matched: readonly string[]
  /** The classes that were plausible, cheapest first. */
  readonly considered: readonly IntentClass[]
  /** Non-secret, shown to Grant when a clarification is warranted. */
  readonly reason: string
}

interface Rule {
  readonly name: string
  readonly intent: IntentClass
  readonly pattern: RegExp
}

/**
 * Rules, grouped by the class they argue for.
 *
 * Patterns are anchored on words (`\b`) rather than substrings throughout.
 * "Can you" inside "American you" is not a question, and the effect of getting
 * that wrong is a spurious job.
 */
const RULES: readonly Rule[] = [
  // --- direct_command: an instruction with an imperative and a deadline or
  // an unmistakable "now". The most expensive class, so the most specific.
  {
    name: 'explicit-now',
    intent: 'direct_command',
    pattern: /\b(right now|immediately|asap|urgent(?:ly)?|drop everything)\b/i,
  },
  {
    name: 'imperative-with-deadline',
    intent: 'direct_command',
    pattern:
      /\b(?:by|before)\s+(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|noon|\d{1,2}\s*(?:am|pm))\b/i,
  },

  // --- assignment: delegated work with an owner or an explicit "please do".
  {
    name: 'please-do',
    intent: 'assignment',
    pattern: /\b(?:please|pls)\s+(?:can\s+you\s+)?(?!tell me|let me know|explain|clarify)\w+/i,
  },
  {
    name: 'i-need-you-to',
    intent: 'assignment',
    pattern: /\b(?:i need you to|i want you to|go ahead and|make sure (?:you|we))\b/i,
  },
  {
    name: 'assign-to',
    intent: 'assignment',
    pattern: /\b(?:assign|hand)\s+(?:this|it|that)\s+to\b/i,
  },

  // --- light_investigation: a bounded look, explicitly bounded.
  {
    name: 'have-a-look',
    intent: 'light_investigation',
    pattern:
      /\b(?:have a (?:quick )?look|take a look|look into|dig into|check whether|find out)\b/i,
  },
  {
    name: 'bounded-research',
    intent: 'light_investigation',
    pattern:
      /\b(?:quick(?:ly)?|briefly|rough(?:ly)?)\b.{0,30}\b(?:research|investigate|compare|review)\b/i,
  },
  {
    // A bare imperative opening the instruction — "Research the trade-offs",
    // "Draft the announcement", "Compare the two options". The commonest way
    // anyone actually delegates, and until this rule existed it matched
    // nothing at all: it fell through to `thought`, unconfident, which
    // convenes nobody and asks Grant to rephrase work he had already phrased.
    //
    // Deliberately `light_investigation` and not `assignment`, on §6's
    // downward rule: an imperative says what to do, not how much of it, and
    // the cheap reading of an unbounded verb is a bounded look. An explicit
    // "I need you to …" still reads as an assignment, because that rule is
    // about the delegation and not about the verb.
    name: 'bare-imperative',
    intent: 'light_investigation',
    pattern:
      /^(?:research|investigate|compare|review|draft|write|summari[sz]e|analy[sz]e|outline|assess|evaluate|audit)\s+(?!of\b)/i,
  },

  {
    // The productive imperatives, which are a different case from the
    // investigative ones above and were falling through to an unconfident
    // `thought` — "Generate a slide deck in the notebook" read as thinking out
    // loud, which the new narration channel put in front of Grant in plain
    // English on its first day.
    //
    // `direct_command`, not `light_investigation`, and this does not break §6's
    // downward rule. That rule says take the cheaper reading of an AMBIGUOUS
    // instruction: "research X" could be ten minutes or ten days, so read it as
    // ten minutes. "Make a slide deck" has no cheaper reading — there is no
    // smaller version of making the thing. The ambiguity the rule protects
    // against is absent, so deferring to it here would only be wrong politely.
    //
    // Safe to read this way now in a sense it would not have been last week:
    // 0083 puts every notebook generation behind Grant's own button, so the
    // cost of over-reading one is a question he answers with a tap.
    name: 'make-this',
    intent: 'direct_command',
    pattern:
      /^(?:generate|make|create|produce|build|record|prepare|add|attach|upload|push|send|post|put)\s+/i,
  },

  // --- suggestion: an idea offered, not an instruction given.
  {
    name: 'we-should-maybe',
    intent: 'suggestion',
    pattern:
      /\b(?:we should|maybe we|perhaps we|it might be worth|what if we|worth considering)\b/i,
  },
  {
    name: 'idea-framing',
    intent: 'suggestion',
    pattern: /\b(?:an idea|a thought|just an idea|food for thought)\b/i,
  },

  // --- discussion: an invitation to talk, not to act.
  {
    name: 'what-do-you-think',
    intent: 'discussion',
    pattern: /\b(?:what do you think|thoughts\?|your take|discuss|let's talk|push back)\b/i,
  },

  // --- question: asks for information already held or cheaply retrievable.
  {
    name: 'interrogative-opening',
    intent: 'question',
    // An auxiliary verb only opens a question when a PRONOUN subject follows
    // it. Two defects got this rule here, and the second is the interesting
    // one.
    //
    // First it was a bare alternation including `do`, which read "Do the
    // migration right now" as a QUESTION: the auxiliary matched the
    // imperative. Adding "a subject must follow" looked like the fix, but the
    // subject list included determiners - `the`, `this`, `my` - and "Do the"
    // matched exactly as before. The rule was wrong in the same way twice.
    //
    // Determiners cannot disambiguate, because a determiner after `do` is the
    // imperative's OBJECT at least as often as it is a question's subject:
    // "Do the migration" and "Do the tests pass?" open identically, and only
    // the verb three words later separates them. Pronouns carry no such
    // ambiguity - there is no English imperative "Do you ...".
    //
    // So the rule keeps only what it can actually tell apart. "Do the tests
    // pass?" loses this signal and is caught by `question-mark` instead; an
    // unpunctuated determiner question matches nothing and lands on `thought`,
    // unconfident, which is the safe direction to be wrong in.
    //
    // Worth being precise about the original failure: the downward rule
    // behaved correctly on the input it was given. The defect was upstream, in
    // a rule that argued for `question` when nothing about the text did. A
    // downward bias makes a false cheap signal *more* damaging, not less,
    // because nothing outvotes it.
    pattern:
      /^\s*(?:(?:what|who|whom|whose|when|where|why|how|which)\b|(?:is|are|was|were|do|does|did|can|could|should|shall|will|would|have|has|had)\s+(?:i|you|we|they|he|she|it|there)\b)/i,
  },
  { name: 'question-mark', intent: 'question', pattern: /\?\s*$/ },
  {
    name: 'tell-me',
    intent: 'question',
    pattern: /\b(?:tell me|let me know|remind me|what(?:'| i)s the status)\b/i,
  },

  // --- thought: a remark, addressed to nobody in particular.
  {
    name: 'musing',
    intent: 'thought',
    pattern: /\b(?:just thinking|random thought|fyi|for the record|noting that|note to self)\b/i,
  },
]

/**
 * Classify an instruction.
 *
 * The whole algorithm: collect every class the text argues for, take the
 * **cheapest**, and report whether that was contested.
 *
 * Taking the cheapest is §6's downward rule implemented directly rather than
 * approximated by weighting. A scoring scheme would let three weak
 * `assignment` signals outvote one strong `question` signal, and "the model
 * was fairly sure" is not the standard the rule sets.
 */
export const classifyIntent = (instruction: string): Classification => {
  const text = instruction.trim()

  if (text === '') {
    return {
      intent: 'thought',
      confident: false,
      matched: [],
      considered: [],
      reason: 'the instruction was empty, so the cheapest class was taken',
    }
  }

  const matched: string[] = []
  const classes = new Set<IntentClass>()
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      matched.push(rule.name)
      classes.add(rule.intent)
    }
  }

  if (classes.size === 0) {
    // Nothing matched. §6's rule says the cheapest reading, and the honest
    // cheapest reading of text we do not understand is that it is a remark —
    // NOT that it is work. An unrecognised instruction becoming an assignment
    // is precisely the unbounded-cost error the downward rule exists to stop.
    return {
      intent: 'thought',
      confident: false,
      matched: [],
      considered: [],
      reason:
        `no intent rule matched ${JSON.stringify(text.slice(0, 80))}, so it is treated as a ` +
        'remark rather than as work. Ask before acting on it.',
    }
  }

  const considered = [...classes].sort((a, b) => INTENT_COST[a] - INTENT_COST[b])
  const intent = considered[0] as IntentClass
  const contested = considered.length > 1

  return {
    intent,
    confident: !contested,
    matched,
    considered,
    reason: contested
      ? `the text supports ${considered.join(' and ')}; the cheapest was taken (§6: ambiguity ` +
        'resolves downward, never upward)'
      : `classified ${intent} by ${matched.join(', ')}`,
  }
}

/**
 * Does this classification justify spending a specialist consultation?
 *
 * §9: *"Trivial work spawns no subagents. Simple factual retrieval is not a
 * team meeting."* So the answer is no below `light_investigation`, and no for
 * anything unconfident regardless of class — an uncertain reading is the one
 * case where convening a team is most expensive and least justified.
 */
export const justifiesConsultation = (classification: Classification): boolean =>
  classification.confident && INTENT_COST[classification.intent] >= INTENT_COST.light_investigation

/**
 * Should the system ask rather than act?
 *
 * True when the reading was contested *and* the expensive reading would have
 * done something substantive. A contested `thought`/`question` needs no
 * clarification: both readings are cheap and the cheaper one is harmless.
 */
export const needsClarification = (classification: Classification): boolean => {
  if (classification.confident) return false
  const dearest = classification.considered.at(-1)
  if (dearest === undefined) {
    // Nothing matched at all. Worth asking about precisely because we have no
    // reading, cheap or otherwise.
    return true
  }
  return INTENT_COST[dearest] >= INTENT_COST.light_investigation
}

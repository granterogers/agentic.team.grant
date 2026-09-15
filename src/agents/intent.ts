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
  /**
   * Whether any rule recognised this text at all.
   *
   * `intent` is `thought` in two completely different situations and until
   * #232 nothing downstream could tell them apart:
   *
   *   - Grant wrote a remark and said so — *"fyi"*, *"just thinking"*, *"note
   *     to self"*. A deliberate remark. §9 is right that it convenes nobody.
   *   - No rule matched, so the cheapest reading was taken as a safe default.
   *     *"Run the numbers if we sell it cheaper."* is that case, and it is not
   *     a remark — it is a piece of work whose phrasing this file's regexes do
   *     not cover.
   *
   * Collapsing the two sent every indirect, vague or spoken phrasing to the
   * class that convenes nobody, which is #230's defect one layer up: measured
   * over the #232 corpus, `vague`, `colloquial` and `speech` scored 0% and
   * every one of them had a specialist correctly identified and then discarded
   * here. `pickRoster` reads this to let an UNRECOGNISED request reach at most
   * one specialist when the subject is clear, while a deliberate remark still
   * reaches nobody.
   *
   * Not `confident`, which already means something else: a contested reading
   * is text two rules both understood, and unrecognised text is text no rule
   * understood. CLAUDE.md records what conflating two sources that fail in
   * different directions costs.
   */
  readonly recognised: boolean
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
      /(?:^|(?<=[.!?;]\s{1,3}))(?:research|investigate|compare|review|draft|write|summari[sz]e|analy[sz]e|outline|assess|evaluate|audit)\s+(?!of\b)/i,
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
    /*
      Anchored at the start of ANY SENTENCE, not only of the message (#237).

      The `^` was right about what it excluded — "I don't want you to create a
      task" contains "create a" and must not read as a command — and wrong
      about where it looked. *"Do not draft the plan. Create the tasks
      instead."* is how Grant changes his mind, the imperative is in the second
      sentence, and nothing looked there: it fell to an unconfident `thought`,
      convened nobody and wrote nothing. A whole SHAPE of correction — "not
      that, this instead" — was invisible.

      A lookbehind for a sentence terminator keeps the protection exactly: the
      excluded example has its verb mid-sentence after "want you to", which
      still matches nothing.
    */
    name: 'make-this',
    intent: 'direct_command',
    pattern:
      /(?:^|(?<=[.!?;]\s{1,3}))(?:generate|make|create|produce|build|record|prepare|add|attach|upload|push|send|post|put|log|raise)\s+/i,
  },

  {
    /*
      The same imperative, after an affirmation — and the reason it is separate
      from `make-this` is the anchor.

      `make-this` is anchored at `^`, deliberately: "I don't want you to create
      a task" contains "create a" and must not read as a command. But so does
      *"Yes, do it. Create the task."*, which is Grant confirming something he
      has just been asked about — and it fell through to an unconfident
      `thought`, the class that convenes nobody and writes nothing (#237). A
      session found it: three of four action-versus-discussion turns behaved
      correctly and the fourth, the only one that was actually a command, did
      nothing.

      Anchored after the affirmation rather than unanchored, so the protection
      `make-this` bought is kept: the sentence must OPEN with the agreement.
    */
    name: 'affirmed-imperative',
    intent: 'direct_command',
    pattern:
      /^(?:yes|yeah|yep|yup|ok|okay|right|sure|fine|correct|agreed|go on|do it|go ahead)\b[\s,.!;:—–-]*(?:then\b[\s,]*)?(?:do it\b|go ahead\b|please\b[\s,]*)?(?:generate|make|create|produce|build|record|prepare|add|attach|upload|push|send|post|put|log|raise|do it)\b/i,
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
 * Where an explicit delegation begins, and -1 when there is none.
 *
 * ## The defect
 *
 * *"I need you to find out what the three big competitors charge and then tell
 * me what that means for where we position ourselves."*
 *
 * Three rules fire on that sentence. `i-need-you-to` argues `assignment`,
 * correctly. `have-a-look` argues `light_investigation` because it contains
 * "find out". `tell-me` argues `question` because it contains "tell me". Three
 * classes means contested, contested means `confident: false`, and
 * `routing_decisions_unconfident_stays_small` then caps the roster at ONE
 * person — so a request that plainly needs two specialists reached one, and
 * the recorded reason said the reading was contested.
 *
 * But it is not contested. "find out" and "tell me" are not competing readings
 * of the message; they are the CONTENT of the thing being delegated. The mood
 * of a sentence is set by its main clause, and everything after "I need you
 * to" is subordinate to it.
 *
 * This is `teaching.ts`'s lesson in a second place: *"suggest WHEN we should
 * decide"* was read as a condition because nothing distinguished a complement
 * clause from a main one, and a work request became a global procedure.
 * CLAUDE.md records it. Here the same blindness costs a specialist instead.
 *
 * ## Why only the cheaper classes are suppressed
 *
 * *"I need you to send the deck right now"* still reads `direct_command`, and
 * should: a delegation does not cap how urgent the delegated thing is. What it
 * does rule out is the message being a QUESTION, a SUGGESTION, a DISCUSSION or
 * a REMARK — Grant has already said what it is. So anything at or above
 * `assignment` survives the span and everything below it does not.
 *
 * §6 is untouched by this. Its downward rule resolves ambiguity between
 * PLAUSIBLE readings; a mood word inside delegated content was never a
 * plausible reading of the message, so it is not a candidate to resolve
 * between.
 *
 * ## One source of truth for what a delegation looks like
 *
 * Read from the `i-need-you-to` rule rather than written out again. A second
 * copy of the phrase list is a list that will disagree with the first — the
 * trap CLAUDE.md names about rows, rosters and command-bar groups, and there
 * is no reason it would spare a regex.
 */
const DELEGATION: RegExp = (() => {
  const rule = RULES.find((r) => r.name === 'i-need-you-to')
  if (rule === undefined) throw new Error('intent: the i-need-you-to rule is gone')
  return rule.pattern
})()

const delegationBegins = (text: string): number => DELEGATION.exec(text)?.index ?? -1

/**
 * Is this rule's match subordinate to a delegation that opened before it?
 *
 * Position decides, not presence. *"What is our margin? I need you to check."*
 * has its question BEFORE the delegation, so the question is the message's own
 * and the reading is legitimately contested.
 */
const governed = (from: number, at: number, intent: IntentClass): boolean =>
  from >= 0 && at >= from && INTENT_COST[intent] < INTENT_COST.assignment

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
      recognised: false,
      matched: [],
      considered: [],
      reason: 'the instruction was empty, so the cheapest class was taken',
    }
  }

  const governedFrom = delegationBegins(text)

  const matched: string[] = []
  const classes = new Set<IntentClass>()
  for (const rule of RULES) {
    const hit = rule.pattern.exec(text)
    if (hit === null) continue
    if (governed(governedFrom, hit.index, rule.intent)) {
      // Kept in the audit trail, excluded from the reading. A misparse is
      // debuggable either way, and silently dropping a rule that fired is how
      // a classifier becomes impossible to argue with.
      matched.push(`${rule.name} (inside the delegation)`)
      continue
    }
    matched.push(rule.name)
    classes.add(rule.intent)
  }

  if (classes.size === 0) {
    // Nothing matched. §6's rule says the cheapest reading, and the honest
    // cheapest reading of text we do not understand is that it is a remark —
    // NOT that it is work. An unrecognised instruction becoming an assignment
    // is precisely the unbounded-cost error the downward rule exists to stop.
    return {
      intent: 'thought',
      confident: false,
      recognised: false,
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
    recognised: true,
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

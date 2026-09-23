/**
 * The life of a standing instruction — #310.
 *
 * ## What was wrong, established before anything was designed
 *
 * The lifecycle is *recognise → scope → store → retrieve → modify → withdraw →
 * retire → stop influencing prompts*, and the office had four of those eight.
 *
 *   - **retrieval was already correct.** `lessons_live` excludes a superseded
 *     row and a retracted one, and `app.lessons_for` reads that view.
 *   - **the machinery was already there.** `app.learn` takes `p_supersedes`
 *     and increments `observations` when it is given one; `app.retract_lesson`
 *     retires a rule without replacing it.
 *   - **nothing ever used either.** `remember()` is the only caller, and it
 *     passes `null` for `p_supersedes` and `null` for `p_project_id`, always.
 *     `app.retract_lesson` has no caller in `src/` at all.
 *
 * So `supersedes` is unused for the reason CLAUDE.md records about
 * `recordDecision`'s `delegationDepth`: **a parameter no caller passes is a
 * column that will never hold anything.** No matching was failing, because no
 * matching was attempted.
 *
 * Two of the eight also fail at RECOGNITION, measured: *"do not use bullets
 * anymore"* and *"forget what I said about bullets"* are not read as teachings
 * at all, so a preference can be given and never taken back.
 *
 * ## Why a DIMENSION, and why unknown is a legitimate answer
 *
 * "keep replies short" and "actually, detailed answers are fine" are the same
 * instruction twice, and the office must end up obeying the second. Deciding
 * that from the words alone is what a model would do badly and what a phrase
 * list would do brittlely.
 *
 * What is deterministic is that both are about the same THING: how long an
 * answer is. `quality.ts` already has three of these — `one-paragraph`,
 * `no-lists`, `short` — because the gate needed to apply them; this names the
 * same idea on the way IN, so that two rules about one dimension can be
 * ordered.
 *
 * The asymmetry is the safety property, and it is 0304's:
 *
 *     **failing to recognise a dimension leaves today's behaviour;
 *       recognising the wrong one destroys something Grant said.**
 *
 * So `null` is a perfectly good answer and is the default. A lesson with no
 * dimension supersedes nothing and is superseded by nothing — it accumulates,
 * exactly as it does today, which is the outcome we already live with.
 */

/**
 * The things the office has standing rules ABOUT.
 *
 * A closed set on purpose, and small on purpose. Each is a thing two
 * instructions can genuinely disagree about, which is the only reason to name
 * it: a dimension nothing can contradict buys nothing and risks a wrong
 * supersede.
 */
export type Dimension =
  /** How long an answer is. "keep it short", "detailed answers are fine". */
  | 'answer-length'
  /** Prose or lists. "use bullets", "never bullet points". */
  | 'answer-format'
  /** Whether links and images are included. */
  | 'links-and-images'
  /** Whether a deadline is invented when he did not give one. */
  | 'due-dates'
  /** Whether the office may act without asking first. */
  | 'asking-first'

/*
  Each dimension is recognised by the NOUNS it is about, not by the verb or
  the polarity. That is what makes "use bullets" and "never use bullets" the
  same dimension rather than two, which is the whole point: it is the office's
  job to notice they conflict, not to agree with both.
*/
const ABOUT: readonly (readonly [Dimension, RegExp])[] = [
  [
    'answer-format',
    /\b(?:bullet(?:\s*points?)?|bullets|lists?|numbered|prose|paragraphs?|plain\s+text|tables?)\b/i,
  ],
  /*
    "long" and "longer" are NOT in this list, because "no longer" is the
    commonest withdrawal operator in English and is not about length: "no
    longer put links in" matched both dimensions and therefore matched
    neither, so a perfectly clear withdrawal could not be aimed. "detailed"
    and "thorough" carry the other end of the scale without the collision.
  */
  [
    'answer-length',
    /\b(?:short|shorter|brief|briefly|concise|terse|length|detailed|detail|thorough|words|sentences?|one\s+line|succinct)\b/i,
  ],
  ['links-and-images', /\b(?:links?|urls?|images?|screenshots?|pictures?|attachments?)\b/i],
  ['due-dates', /\b(?:due\s*dates?|deadlines?|dates?)\b/i],
  [
    'asking-first',
    /\b(?:ask(?:ing)?\s+(?:me\s+)?(?:first|before)|without\s+asking|check\s+with\s+me|permission|approval|confirm\s+with\s+me)\b/i,
  ],
]

/**
 * What this instruction is ABOUT, or null when it is not about anything the
 * office can order.
 *
 * Null is the safe answer and is returned whenever more than one dimension
 * matches: an instruction spanning two of them cannot supersede a rule about
 * one, because superseding it would silently drop the other half.
 */
export const dimensionOf = (body: string): Dimension | null => {
  const text = String(body ?? '')
  const hits = ABOUT.filter(([, re]) => re.test(text)).map(([d]) => d)
  return hits.length === 1 ? (hits[0] ?? null) : null
}

/*
  A preference bounded to the conversation it was said in.

  Six identical copies of *"From now on IN THIS CONVERSATION, keep every
  answer to a single short paragraph"* were stored at GLOBAL scope and
  permanently. The sentence says how long it lasts and the office stored it
  for ever - and there is no conversation scope in `lesson_scope` to store it
  in, so inventing one in the wrong column would be worse.

  The honest reading is that it is not a STANDING instruction at all. It
  belongs to the turn, where `pinned_config` already carries what this
  conversation is being asked to do, and the say-back tells him which of the
  two the office took it as.
*/
const FOR_THIS_CONVERSATION =
  /\b(?:in|for|during)\s+this\s+(?:conversation|chat|thread|session|exchange)\b|\bjust\s+for\s+(?:now|today|this\s+one)\b|\bfor\s+the\s+rest\s+of\s+(?:this|the)\s+(?:conversation|chat|thread)\b/i

export const boundToThisConversation = (body: string): boolean =>
  FOR_THIS_CONVERSATION.test(String(body ?? ''))

/*
  Taking a rule BACK, with nothing to put in its place.

  "do not use bullets anymore", "stop doing that", "forget what I said about
  bullets". Distinct from an override, which states the new rule and therefore
  supersedes; this leaves nothing behind, so the old rule is retired and no
  row replaces it.

  The `anymore`/`any more`/`no longer` family is what separates a withdrawal
  from an ordinary prohibition: "never use bullets" is a NEW standing rule and
  must be stored, while "do not use bullets ANY MORE" is about a rule that
  already exists.
*/
const TAKES_IT_BACK =
  /\b(?:any\s*more|no\s+longer|from\s+now\s+on\s+(?:do\s*n[o']?t|don[’']t|stop))\b|\b(?:forget|scrap|drop|ignore|disregard|cancel)\s+(?:what\s+i\s+said|that\s+rule|that\s+instruction|the\s+(?:rule|instruction|preference))\b|\bstop\s+(?:doing\s+that|that)\b/i

/**
 * Is this taking an existing rule back rather than stating a new one?
 *
 * Returns the dimension it is about, so the caller knows WHICH rule to retire,
 * or null. A withdrawal whose dimension cannot be read retires nothing —
 * again the safe direction, because retiring the wrong rule is worse than
 * retiring none.
 */
/**
 * He said the withdrawal applies everywhere, not only where he is standing.
 *
 * The one thing that authorises taking a rule off EVERY project from inside
 * one of them. Narrow for the reason `again.ts` gives about its own
 * authorisation: a miss costs him one more sentence, and the office has just
 * told him which one; a false positive undoes a rule for every other project
 * from a sentence about this one.
 */
export const EVERYWHERE =
  /\b(?:every ?where|for everything|for all(?: of| the)? (?:projects?|it)|on all projects?|in general|altogether|across the board|globally|for good)\b/i

export const withdrawsARule = (body: string): Dimension | null =>
  TAKES_IT_BACK.test(String(body ?? '')) ? dimensionOf(body) : null

/**
 * Are these two instructions the same instruction?
 *
 * Used to turn a repetition into an OBSERVATION rather than a sixth copy.
 * Deliberately strict — content words, in any order, with nothing extra —
 * because a loose match here supersedes a rule Grant still wants.
 *
 * "I've told you to always give your information in the form of clear bullet
 * points" against "always give your information in the form of clear bullet
 * points" is the real case: he is complaining that it did not stick, and the
 * office stored a seventh copy.
 */
/*
  POLARITY IS CONTENT, and treating it as noise was the one way this could be
  actively harmful.

  With "always" and "never" in this list, "always paste image links" and
  "never paste image links" have identical content words - so an OVERRIDE
  would have been recorded as a REPETITION, bumping the old rule's weight
  instead of replacing it, and the office would have answered "already had
  that one" to Grant reversing himself.
*/
const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'that',
  'this',
  'is',
  'are',
  'be',
  'i',
  'you',
  'me',
  'my',
  'your',
  'we',
  'us',
  'it',
  'please',
  'from',
  'now',
  'so',
  'told',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'just',
  'all',
  'any',
  'when',
  'what',
  'would',
  'like',
  'want',
])
const gist = (body: string): Set<string> =>
  new Set(
    String(body ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )

export const restates = (a: string, b: string): boolean => {
  const x = gist(a)
  const y = gist(b)
  if (x.size === 0 || y.size === 0) return false
  let shared = 0
  for (const w of x) if (y.has(w)) shared += 1
  /*
    Every content word of the SHORTER one appears in the longer, and the
    longer is not wildly bigger. "give information form clear bullet points"
    inside "told give information form clear bullet points" is a restatement;
    a rule that merely shares two nouns is not.
  */
  const smaller = Math.min(x.size, y.size)
  const larger = Math.max(x.size, y.size)
  return shared === smaller && larger <= smaller + 3
}

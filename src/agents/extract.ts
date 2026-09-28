/**
 * "Pull the tasks out of that" — recognising a request to extract (#130).
 *
 * #130's headline unlock, and the reason it is still open: *"nothing in the
 * office extracts tasks today. This is a new capability rather than a
 * contract, and it is what makes 'a list of extracted tasks can become real
 * tasks' true."*
 *
 * The `tasks_extracted` shape has been declared and validated since 0272 and
 * has never held a row, which is this repository's most familiar defect — a
 * contract nothing produces, the same family as a column nothing writes and a
 * control nothing presses.
 *
 * ## Why this is not `taskRequest`
 *
 * `taskRequest` reads "make a task to chase the roofing quote": ONE task,
 * stated by Grant, whose title is in the sentence. This reads "pull the tasks
 * out of the pricing brief": MANY tasks, none of them stated, whose titles are
 * inside something the office has to go and read.
 *
 * They are different requests with different answers, and the discriminator is
 * cheap — an extraction names a SOURCE and asks for a plural. Checked before
 * `taskRequest` in the handler, because "make tasks from the brief" satisfies
 * both readings and only one of them is what he meant.
 *
 * ## Deterministic, like every other recogniser here
 *
 * No model decides whether this is an extraction. The expensive direction is
 * the false positive: reading "I made a list of things to do this week" as an
 * instruction would have the office write a dozen tasks nobody asked for, and
 * `hq_task_add` is a real write into a list Grant looks at.
 */

/** A request to find the tasks inside something. */
export interface ExtractRequest {
  /**
   * What to read, in his words, or null for "what this project holds".
   *
   * Not resolved here. Which document that names is a question for the
   * handler, which can see the project's documents; a recogniser that also
   * resolved would need the database and could not be unit-tested at all.
   */
  readonly from: string | null
  /** The phrase that matched, so a report can say why this was read as one. */
  readonly matched: string
}

/*
  The shapes an extraction takes.

  Every one of them requires a PLURAL — tasks, actions, to-dos, next steps —
  because the singular is `taskRequest`'s and routing it here would replace one
  stated task with a model's opinion of several.

  `(?:the\s+)?` rather than a required article: "pull tasks out of the brief"
  is how a person types when they are in a hurry.
*/
const PLURAL = '(?:tasks?|actions?|action items?|to-?dos?|next steps?|follow-?ups?)'
const FROM = '(?:out of|from|in|inside|within)'

const SHAPES: readonly RegExp[] = [
  // pull / extract / lift / get the tasks out of X
  new RegExp(
    // "pull out the tasks due this week from the minutes": a particle, and a
    // short qualifier between the plural and the source (ledger R38).
    `\\b(?:pull|extract|lift|get|take|find|list)\\s+(?:out\\s+)?(?:all\\s+)?(?:the\\s+|any\\s+)?${PLURAL}(?:\\s+(?!${FROM}\\b)\\w+){0,4}\\s+${FROM}\\s+(?<from>.+)`,
    'i',
  ),
  // what are the actions in X · what tasks are in X
  new RegExp(
    `\\bwhat\\s+(?:are\\s+)?(?:the\\s+)?${PLURAL}\\s+(?:are\\s+)?${FROM}\\s+(?<from>.+)`,
    'i',
  ),
  // turn X into tasks · make tasks out of X
  new RegExp(`\\bturn\\s+(?<from>.+?)\\s+into\\s+(?:${PLURAL})\\b`, 'i'),
  new RegExp(`\\b(?:make|create|add)\\s+(?:the\\s+)?${PLURAL}\\s+${FROM}\\s+(?<from>.+)`, 'i'),
  /*
    READ SOMETHING, THEN MAKE TASKS FROM IT — the shape production actually
    produced (#282, anchor B).

      > "Scan the entirety of the Legacy Coaching Project and create
      > appropriate tasks for me to review."

    None of the four above reaches it. The source is named with a reading verb
    rather than with `out of`, and the plural is qualified — "appropriate
    tasks", "a few tasks", "the obvious next steps" — where every pattern above
    allows only a bare `the`. So the sentence fell through to `taskRequest` and
    became ONE personal task called "appropriate tasks for me to review",
    which is the delegation performed as its own title.

    It is a general shape rather than a phrase: a verb of READING a source, the
    source, and a verb of MAKING several tasks out of it. The qualifier between
    the two verbs is bounded so the pattern cannot swallow a sentence that
    merely mentions both ideas a paragraph apart.
  */
  new RegExp(
    `\\b(?:scan|read|go through|look through|review|go over|comb through)\\s+` +
      `(?:the\\s+)?(?:entirety of\\s+|all of\\s+|the whole of\\s+)?(?:the\\s+)?` +
      `(?<from>.+?)\\s+and\\s+(?:make|create|write|add|generate|draw up|put together)\\s+` +
      `(?:\\w+\\s+){0,2}${PLURAL}\\b`,
    'i',
  ),
]

/*
  And the shapes that ask for the same thing without naming a source.

  "What needs doing on this project" is an extraction whose source is the
  project. Separate because there is no `from` group to capture, and folding
  them into the list above with an optional group would make every pattern
  above match a sentence that names nothing.
*/
const WHOLE_PROJECT: readonly RegExp[] = [
  // "pull OUT all the actions" — the particle is optional and commonly there.
  new RegExp(
    `\\b(?:pull|extract|lift|find|list)\\s+(?:out|up)?\\s*(?:all\\s+)?(?:the\\s+)?${PLURAL}\\b`,
    'i',
  ),
  /\bwhat\s+(?:needs|still needs)\s+doing\b/i,
  new RegExp(`\\bwhat\\s+(?:are\\s+)?(?:the\\s+)?${PLURAL}\\b`, 'i'),
]

/*
  A prohibition stops the clause it is in.

  `tasks.ts` learned this as #249 and the note there is worth repeating: "do
  not pull the tasks out yet, just summarise it" is a refusal, and reading it
  as an instruction is the worst false positive available — it does the thing
  he just said not to do.
*/
const FORBIDDEN = /\b(?:do ?n[o']t|never|no need to|rather than|instead of|without)\b/i

/** Something he is REPORTING, not asking for. */
const NOT_ASKING = /\b(?:i (?:made|wrote|pulled|listed)|there (?:are|were)|here (?:are|is))\b/i

/*
  WHAT HE ALREADY HAS, NOT WHAT THE PROJECT HOLDS (ledger R38).

  With no source named, an extraction reads the project's documents to find
  work nobody has listed. "What tasks do I have this week?", "what needs doing
  today", "what's overdue" ask about work that IS listed: a first-person
  subject or a time scope says so. Read as extraction, the question started a
  job that read the project and did not answer it. Only the unsourced shapes
  consult this; "pull the tasks due this week out of the brief" names a source
  and is still an extraction.
*/
const ABOUT_HIS_LIST =
  /\b(?:do|have|did|got|need|should)\s+i\b|\bi(?:'ve|\s+have)?\s+(?:got|to\s+do|on)\b|\b(?:my|mine)\b|\b(?:today|tonight|tomorrow|this\s+(?:week|month|morning|afternoon)|next\s+week|overdue|late|due)\b/i

/** Long enough that the source name is a sentence rather than a thing. */
const SOURCE_MAX = 120

export function extractionRequest(instruction: string): ExtractRequest | null {
  const said = String(instruction ?? '').trim()
  if (said === '') return null
  if (FORBIDDEN.test(said) || NOT_ASKING.test(said)) return null

  for (const shape of SHAPES) {
    const hit = shape.exec(said)
    if (hit === null) continue
    const raw = (hit.groups?.from ?? '')
      .trim()
      /*
        A trailing clause is not part of the name: "…out of the brief, then
        tell me which are urgent" names the brief.

        The full stop must be a SENTENCE boundary — followed by a space or the
        end — because the commonest source Grant names is a filename, and
        splitting on any dot turned "WS02 Pricing.pdf" into "WS02 Pricing" and
        sent the handler looking for a document that does not exist.
      */
      .split(/[,;]|\.\s|\.$|\band then\b|\bthen\b/)[0]
      ?.trim()
      .replace(/\s+/g, ' ')
      .replace(/^(?:the|that|this|our|my)\s+/i, '')
      .replace(/[?!]+$/, '')
    if (raw === undefined || raw === '' || raw.length > SOURCE_MAX) continue
    return { from: raw, matched: hit[0].slice(0, 80) }
  }

  // A question about HIS list is answered from the list (ledger R38).
  for (const shape of WHOLE_PROJECT) {
    const hit = shape.exec(said)
    if (hit === null) continue
    // An imperative to extract is an extraction whatever it is scoped to; a
    // question or a "list" about his own work is answered from his list.
    if (asksAboutHisOwnList(said)) return null
    return { from: null, matched: hit[0].slice(0, 80) }
  }
  return null
}

/*
  ONE PREDICATE, TWO CALLERS (ledger R38). What extraction declines as a
  question about his list is exactly what the list reader must answer: the
  first fix made the extraction decline "What needs doing today?" and the
  answer then fell to the model, which stated what his list held without it
  having been read, and the coherence gate refused all three attempts. He got
  nothing. The handler asks this as well as the model's reading, so a question
  the model labelled differently still reaches his list.
*/
const HIS_LIST_WORDS =
  /\bwhat\s+(?:have|'ve|\u2019ve)\s+i\s+got\b|\bwhat(?:'s|\u2019s|\s+is)\s+(?:on\s+)?my\s+(?:list|plate)\b|\bwhat(?:'s|\u2019s|\s+is)\s+(?:overdue|due|late)\b/i

export function asksAboutHisOwnList(text: string): boolean {
  const said = String(text ?? '').trim()
  if (said === '' || FORBIDDEN.test(said) || NOT_ASKING.test(said)) return false
  // Opening a sentence, after at most a discourse word: "remind me to check
  // what is due" asks for a reminder, not for the list.
  const opens = said
    .split(/(?<=[.!?])\s+/)
    .map((x) =>
      x.replace(
        /^(?:(?:so|and|ok|okay|right|fine|thanks|yes|perfect|great|also|anyway)\b[,\s]*)+/i,
        '',
      ),
    )
  if (opens.some((x) => HIS_LIST_WORDS.test(x) && x.search(HIS_LIST_WORDS) === 0)) return true
  for (const shape of WHOLE_PROJECT) {
    const hit = shape.exec(said)
    if (hit !== null && !/^(?:pull|extract|lift|find)\b/i.test(hit[0]) && ABOUT_HIS_LIST.test(said))
      return true
  }
  return false
}

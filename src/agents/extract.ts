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
    `\\b(?:pull|extract|lift|get|take|find|list)\\s+(?:all\\s+)?(?:the\\s+|any\\s+)?${PLURAL}\\s+${FROM}\\s+(?<from>.+)`,
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
    if (raw === undefined || raw === '' || raw.length > SOURCE_MAX) continue
    return { from: raw, matched: hit[0].slice(0, 80) }
  }

  for (const shape of WHOLE_PROJECT) {
    const hit = shape.exec(said)
    if (hit !== null) return { from: null, matched: hit[0].slice(0, 80) }
  }
  return null
}

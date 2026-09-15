/**
 * Breaking a request into the separate things it asks for.
 *
 * ## The measurement this exists because of
 *
 *   Grant: "I need you to look at which channel is bringing people in and
 *           draft the note we send them when they arrive."
 *
 * Two asks, two specialists: the growth director reads the channels, the
 * communications director writes the note. The office convened the
 * communications director alone.
 *
 * `app.who_knows_about` is a trigram match against the WHOLE message, and a
 * whole-message match can only ever surface the strongest subject in it. The
 * second ask is not missed because the vocabulary is thin — "channel" is in
 * the growth director's expertise — it is missed because it is competing for
 * one answer with a sentence that is mostly about something else.
 *
 * The semantic reader (`subject.ts`) exists precisely for subjects the literal
 * matcher cannot see, and it never ran here: `handlers/instruction.ts` asks it
 * only when the literal matcher found NOBODY, and the literal matcher found
 * somebody. That rule is right and it was being applied at the wrong
 * granularity. CLAUDE.md already records the same shape from #237 — *"a
 * misleading literal hit is exactly the case where the meaning-reader is not
 * consulted"* — and this is the partial-hit version of it: one clause answered
 * silences the reader on every other clause.
 *
 * So the unit of subject lookup is the clause, not the message. Nothing about
 * the vocabulary changes, and nothing about who owns it: this splits the text
 * and asks the same two questions of each piece.
 *
 * ## Deliberately crude
 *
 * Sentence terminators and coordinating conjunctions, nothing else. This is
 * not a parser and it does not need to be: a fragment that is not an ask
 * ("and then", "if we leave it another month") matches no expertise and
 * contributes nobody, which costs one cheap index lookup and changes no
 * answer. The expensive error would be the other one — splitting a single ask
 * into pieces so small that each names nobody — which the length floor below
 * is for.
 */

/**
 * Where one ask ends and the next begins.
 *
 * A sentence terminator, or a coordinator with a comma or a space in front of
 * it. `then` is included because it is how a sequence is spoken — *"find out
 * what they charge and then tell me what it means"* — and without it the whole
 * of a dictated instruction arrives as one clause, which is the case this file
 * exists for.
 */
const BOUNDARY =
  /[.!?;]+\s+|,\s*(?:and\s+then|and|then|but|so)\s+|\s+and\s+then\s+|,\s+|\s+and\s+|\s+then\s+/gi

/**
 * Short enough to name nobody, so not worth a lookup.
 *
 * Twelve characters is the floor `subject.ts` already uses for the same
 * judgement, and repeating the number here rather than importing it would be
 * two sources of truth for one decision.
 */
const SHORTEST = 12

/**
 * At most this many.
 *
 * A bound on cost, not on comprehension: the roster is capped at five people
 * and each clause contributes at most one, so reading past the sixth cannot
 * change the answer. It also stops a pasted document turning one routing
 * decision into forty index lookups.
 */
const MOST = 6

/**
 * The separate asks in a request, in the order they were made.
 *
 * A single-clause request comes back as a one-element list containing the
 * trimmed original, so a caller can tell "this has one subject" from "this has
 * several" by the length rather than by asking again.
 */
export const clauses = (text: string): readonly string[] => {
  const whole = text.trim()
  if (whole === '') return []
  const parts = whole
    .split(BOUNDARY)
    .map((p) => p.trim().replace(/^[,;]\s*/, ''))
    .filter((p) => p.length >= SHORTEST)
  return parts.length <= 1 ? [whole] : parts.slice(0, MOST)
}

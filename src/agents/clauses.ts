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
export const clauses = (text: string): readonly string[] => split(text).map((c) => c.text)

/** An ask, and the words that joined it to the one before. */
export interface Clause {
  readonly text: string
  /**
   * The separator this clause came after, lower-cased and trimmed. Empty for
   * the first clause.
   *
   * Kept because a coordinator is not a neutral comma: *"find the numbers AND
   * THEN write it up"* is a sequence and *"find the numbers AND the dates"* is
   * two independent asks, and #128's whole question is which of the two a
   * request is. `clauses()` discarded it, so a caller wanting to know had to
   * split the text a second time — the two-lists-that-will-disagree defect
   * this repository has already paid for.
   */
  readonly joinedBy: string
}

/**
 * The asks and their joins, from ONE pass of the boundary expression.
 *
 * `String.split` with a capturing group interleaves the separators into the
 * result, so the parts and the joins come out of the same regex rather than
 * two that could drift.
 */
export const split = (text: string): readonly Clause[] => {
  const whole = text.trim()
  if (whole === '') return []

  // The capturing form of BOUNDARY. Built from the same source so the two can
  // never say different things about where a clause ends.
  const capturing = new RegExp(`(${BOUNDARY.source})`, 'gi')
  const pieces = whole.split(capturing)

  const out: { text: string; joinedBy: string }[] = []
  let joinedBy = ''
  for (const [i, raw] of pieces.entries()) {
    const piece = raw ?? ''
    if (i % 2 === 1) {
      // A separator. It becomes the join of whatever clause survives next.
      joinedBy = piece.trim().toLowerCase()
      continue
    }
    const body = piece.trim().replace(/^[,;]\s*/, '')
    if (body.length < SHORTEST) continue
    out.push({ text: body, joinedBy: out.length === 0 ? '' : joinedBy })
  }

  if (out.length <= 1) return [{ text: whole, joinedBy: '' }]
  return out.slice(0, MOST)
}

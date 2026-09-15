/**
 * What the office is entitled to treat as TRUE, as opposed to what merely
 * appeared in front of it.
 *
 * ## The failure this exists because of
 *
 * Asked *"remind me what we decided in the Tuesday call"* — about a meeting
 * that never happened, in a project holding no calendar — the office answered:
 *
 *     1. 3.19 PM - Weekly Standup - Completed: action items for Q3 pricing
 *        review (due Fri Oct 18)
 *     2. 4.02 PM - Client Renewal Review - Open issues: need Priya's churn
 *        analysis, pending Q3 pricing review summary
 *     That's the only event on Tuesday.
 *
 * Three turns earlier it had been asked about a "Q3 pricing review document"
 * and about what "Priya" concluded — both deliberate baits — and it had
 * answered both honestly: *"there is no entry on that"*. Those honest refusals
 * are what supplied the agenda items. **The office's own denial that something
 * existed became the evidence that it existed.**
 *
 * ## Why no existing gate could see it
 *
 * Every anti-fabrication check in `quality.ts` keys on a CLAIM.
 * `claimsToHaveRead` needs "I checked"; `claimsToHaveSent` needs "I posted";
 * `claimsGrantSaid` needs "you told me". That answer claims nothing. It simply
 * asserts, and an assertion with no verb of retrieval in front of it was
 * invisible to all of them.
 *
 * ## The actual defect, which is structural
 *
 * By the time the model sees it, the context is FLAT. `app.conversation_before`
 * returns `{said, answered}` pairs, the handler replays them as ordinary user
 * and assistant messages, the retrieved documents arrive as another block of
 * prose, and nothing anywhere distinguishes:
 *
 *   - a row the office actually holds, from
 *   - a document it actually retrieved this turn, from
 *   - a fact Grant stated, from
 *   - **a noun that exists only because somebody asked a question containing
 *     it**, from
 *   - **a sentence the office itself made up an hour ago.**
 *
 * A model handed all five as undifferentiated dialogue will use all five as
 * memory, and it is right to — nothing told it otherwise. This module is the
 * missing distinction, stated once, so the prompt, the grounding and the
 * output checks all read the same definition rather than three approximations
 * of it.
 *
 * ## The invariant
 *
 * > No externally verifiable, persisted-state or historical fact may be
 * > presented as established unless it is supported by canonical persisted
 * > state, evidence actually retrieved during this operation, or something
 * > Grant himself stated. **Conversational appearance is not provenance.**
 *
 * ## What this deliberately does NOT do
 *
 * It does not try to stop the office USING the conversation. A correction, a
 * referent, a figure Grant gave two turns ago — all of those are his words and
 * all of them stay usable, which is the whole point of #63 and #238 and is
 * asserted by name in the tests. Solving fabrication by making the office
 * amnesiac would be a worse product than the one that fabricates, because at
 * least the fabrication is visible.
 *
 * The line is narrow and it is about DIRECTION: what Grant says is evidence;
 * what the office says is not, until something outside the conversation backs
 * it.
 */

/**
 * The kinds of thing the office can hold, as provenance is actually shaped.
 *
 * Per-DOMAIN rather than one "did you look" flag, because a single flag is
 * wrong in both directions. Having retrieved a document does not entitle the
 * office to say how many meetings are in the diary; having read the project
 * list does not entitle it to count emails. Same lesson `BEYOND_REACH` learned
 * about claimed READS, applied to claimed CONTENTS.
 */
export type Domain = 'documents' | 'projects' | 'tasks' | 'mail' | 'calendar' | 'contacts'

/** Everything that went in front of the model, tagged by where it came from. */
export interface Context {
  /** What Grant is asking right now. His words: provenance. */
  readonly asked: string
  /**
   * What Grant said earlier in this conversation, including anything recalled
   * from beyond the window. His words: provenance.
   */
  readonly saidBefore: readonly string[]
  /**
   * Documents actually retrieved for THIS turn. Evidence, and the only kind
   * this handler has — `retrieve()` queries `public.documents` and nothing
   * else.
   */
  readonly retrieved: readonly string[]
  /**
   * The office's own earlier answers.
   *
   * Carried so the caller cannot forget they exist, and deliberately absent
   * from `established` below. An assistant turn is a record of what was SAID,
   * never of what is TRUE: the office is perfectly capable of having invented
   * it, and when it has, treating it as provenance lets one fabrication
   * launder every repetition of itself afterwards.
   */
  readonly answeredBefore: readonly string[]
  /**
   * Which kinds of record were actually consulted this turn.
   *
   * Empty means the answer rests entirely on the conversation and the model's
   * own knowledge. A domain listed here is one the office genuinely looked at,
   * so counting what it found is reporting rather than inventing.
   */
  readonly consultedDomains: readonly Domain[]
}

/**
 * The text a specific may legitimately have come from.
 *
 * Grant's words and retrieved evidence. Not the office's own prose — see
 * `answeredBefore`.
 */
export const established = (c: Context): string =>
  [c.asked, ...c.saidBefore, ...c.retrieved].filter((p) => p.trim() !== '').join('\n')

/**
 * Which kinds of record this turn actually looked at.
 *
 * Empty means the answer rests entirely on the conversation and the model's
 * own knowledge, which is exactly the state in which a confident claim about
 * the office's records cannot be true.
 */
export const consulted = (c: Context): readonly Domain[] => c.consultedDomains

/**
 * The sentence that tells the model where the line is.
 *
 * Deliberately paired with the checks rather than replacing them. CLAUDE.md
 * records what a prompt-only invariant is worth: the same build obeys it on
 * one run and not the next. This makes the honest answer easy to produce and
 * `assertsRecordsUnseen` makes the dishonest one fail — recovery first, then
 * the gate, which is the order #237 established.
 */
export const PROVENANCE_NOTE =
  'What has been SAID in this conversation is not evidence that it exists. A name, ' +
  'a document, a meeting or a figure that appears only because one of us mentioned ' +
  'it — in a question, as a possibility, or in an answer of your own — is not part ' +
  'of the record. Facts Grant states ARE usable; your own earlier replies are not a ' +
  'source. If you have not been shown something, say you have no record of it, and ' +
  'never fill the gap with plausible detail.'

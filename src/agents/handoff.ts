/**
 * One agent finishing, and another continuing (#128).
 *
 * Grant's example, and the whole of the gap:
 *
 *   > *"Emma researches; Oliver writes it up. Today that is two requests from
 *   > Grant, with him carrying the context between them."*
 *
 * ## What already existed, and why it is not this
 *
 * #233 built fan-OUT: `pickRoster` may name five people and each of the others
 * gets a child job through `app.enqueue_child`, carrying **the same
 * instruction**. That is right for *"look at the channels and draft the note"*
 * — two independent asks, two specialists, in parallel.
 *
 * It is wrong for *"find out what they charge and then tell me what that
 * means"*. The second clause cannot be answered until the first has been, and
 * answering it from the same instruction means the second specialist redoes
 * the first one's work from scratch, in parallel with it.
 *
 * So a handoff is the SEQUENTIAL case, and the thing that makes it a handoff
 * rather than a second request is that it carries **what the first agent
 * produced**.
 *
 * ## How the office knows which it is
 *
 * From the words that joined the clauses, which `clauses.split` now keeps.
 * *"and then"* is a sequence; *"and"* is a list. That is a small distinction
 * and it is the entire difference between the two shapes, so it is asserted in
 * both directions rather than assumed.
 *
 * This is deliberately narrow. A missed handoff costs what the office does
 * today — two parallel answers, one of them redundant — and a WRONG handoff
 * costs a specialist waiting on work that was never coming, so the expensive
 * direction is the one that fires too easily.
 *
 * ## One link, not a chain
 *
 * At most one handoff comes out of one request. A three-link chain inferred
 * from one sentence is speculation about an order nobody stated; the receiving
 * agent can hand on again when it runs, and `enforce_delegation_depth` caps
 * that at `agents.max_delegation_depth`. #128's own warning: *"an agent that
 * can enqueue an agent can enqueue a loop"*.
 */

import type { Clause } from './clauses.ts'

/**
 * A join that means "after that", rather than "as well as".
 *
 * `then` under any of the forms `clauses.BOUNDARY` produces — `and then`,
 * `, then`, ` then `. `so` is deliberately NOT here: *"the pricing is wrong so
 * fix the page"* is one person's job, and a causal link between two clauses
 * says nothing about whether the second needs the first's OUTPUT.
 */
const SEQUENCE_JOIN = /(^|[\s,])then$/i

/**
 * A clause that opens by pointing back at something.
 *
 * The other half of the signal, for the joins the splitter does not treat as
 * boundaries: *"Research the pricing. Based on that, draft the note."* is a
 * sequence whose join is a full stop.
 *
 * Every one of these is a back-REFERENCE — it names a thing the previous
 * clause produced. A clause opening with a bare adverb ("obviously",
 * "meanwhile") is not, and must not be, matched.
 */
const LOOKS_BACK =
  /^(?:after (?:that|which)|once (?:you have|that is|it is|we have)|with (?:that|those)|using (?:that|those)|based on (?:that|those|it)|from (?:that|those)|and (?:then )?(?:use|take) (?:that|those))\b/i

/** What the receiving agent is asked to do, and why it is them. */
export interface Handoff {
  /** The clause they continue with, verbatim. */
  readonly clause: string
  /** Their staff slug. */
  readonly to: string
  /**
   * Why this is a handoff rather than a second request, in the office's own
   * words — the join that made it one. Shown to Grant and stored on the child
   * job, so a chain can be read back without re-deriving it.
   */
  readonly because: string
}

/**
 * The handoff a request implies, if it implies one.
 *
 * `subjectOf` answers "who does clause i", which the instruction handler has
 * already worked out per clause — passing the lookup rather than the whole
 * routing machinery keeps this pure and unit-testable, which is the same split
 * `inference/policy.ts` and `inference/record.ts` make.
 *
 * Returns null far more often than not, and that is the intended shape: the
 * office keeps doing what it does today unless the request is unmistakably a
 * sequence between two different people.
 */
export const handoffIn = (
  parts: readonly Clause[],
  subjectOf: (index: number) => string | undefined,
  answering: string,
): Handoff | null => {
  for (const [i, part] of parts.entries()) {
    if (i === 0) continue

    const sequenced = SEQUENCE_JOIN.test(part.joinedBy) || LOOKS_BACK.test(part.text)
    if (!sequenced) continue

    const to = subjectOf(i)
    if (to === undefined || to === '') continue

    /*
      The same person is not a handoff.

      "Find out what they charge and then tell me what that means" is one
      finance question in two halves when both clauses are the finance
      director's. Handing work from somebody to themselves would cost a second
      job, a second model call and a second answer to read, for nothing.
    */
    if (to === answering) continue

    return {
      clause: part.text,
      to,
      because:
        part.joinedBy === ''
          ? 'It follows on from what was just found out.'
          : `It follows on from the first part — "${part.joinedBy}".`,
    }
  }
  return null
}

/**
 * A sequence is a handoff; a list is not (#128).
 *
 * The distinction is one word — "and" against "and then" — and it decides
 * whether the office runs two specialists in parallel or hands the first one's
 * output to the second. So it is asserted in BOTH directions here, with as
 * many negative controls as positives: a wrong handoff leaves a specialist
 * waiting for work that was never coming, which is the expensive direction.
 */

import { describe, expect, it } from 'vitest'
import { split } from '../../src/agents/clauses.ts'
import { handoffIn } from '../../src/agents/handoff.ts'

/** Whoever the test says each clause belongs to, by index. */
const by =
  (...slugs: (string | undefined)[]) =>
  (i: number): string | undefined =>
    slugs[i]

const RESEARCH = 'research-director'
const COMMS = 'communications-director'
const FINANCE = 'finance-director'

describe('a sequence hands work on', () => {
  it('reads "and then" as a handoff to the second clause’s specialist', () => {
    const h = handoffIn(
      split('find out what they charge and then draft the note we send them'),
      by(FINANCE, COMMS),
      FINANCE,
    )
    expect(h).not.toBeNull()
    expect(h?.to).toBe(COMMS)
    expect(h?.clause).toContain('draft the note')
    // The reason quotes the join, so a chain can be read back without
    // re-deriving why it is one.
    expect(h?.because).toContain('and then')
  })

  it('reads ", then" the same way', () => {
    const h = handoffIn(
      split('Research the competitor pricing, then write the announcement.'),
      by(RESEARCH, COMMS),
      RESEARCH,
    )
    expect(h?.to).toBe(COMMS)
  })

  it('reads a back-reference across a full stop', () => {
    const h = handoffIn(
      split('Research what the competitors charge. Based on that, draft the pricing note.'),
      by(RESEARCH, COMMS),
      RESEARCH,
    )
    expect(h?.to).toBe(COMMS)
    // No join to quote: the boundary was a full stop, so the sentence says the
    // plain thing rather than quoting an empty string.
    expect(h?.because).not.toContain('""')
  })

  it('accepts "once you have" as the opener', () => {
    const h = handoffIn(
      split('Pull the numbers for last quarter. Once you have them, write it up for the board.'),
      by(FINANCE, COMMS),
      FINANCE,
    )
    expect(h?.to).toBe(COMMS)
  })
})

describe('a list does not', () => {
  /*
    The control this whole module exists for. One word apart from the first
    test above, and the opposite answer.
  */
  it('CONTROL: plain "and" is two independent asks, not a chain', () => {
    const h = handoffIn(
      split('look at which channel is bringing people in and draft the note we send them'),
      by(RESEARCH, COMMS),
      RESEARCH,
    )
    expect(h).toBeNull()
  })

  it('CONTROL: a comma list is not a chain', () => {
    const h = handoffIn(
      split('Check the pricing page, the onboarding email and the invoice template'),
      by(FINANCE, COMMS, COMMS),
      FINANCE,
    )
    expect(h).toBeNull()
  })

  it('CONTROL: "so" is causal, not sequential — it says nothing about output', () => {
    const h = handoffIn(
      split('The pricing page is wrong so fix the copy on it please'),
      by(FINANCE, COMMS),
      FINANCE,
    )
    expect(h).toBeNull()
  })

  it('CONTROL: a single clause can never be a handoff', () => {
    const h = handoffIn(split('Draft the announcement for the pricing change'), by(COMMS), COMMS)
    expect(h).toBeNull()
  })
})

describe('the safety rules', () => {
  it('does not hand work from somebody to themselves', () => {
    const h = handoffIn(
      split('find out what they charge and then tell me what that means for margin'),
      by(FINANCE, FINANCE),
      FINANCE,
    )
    expect(h).toBeNull()
  })

  it('hands to nobody when the second clause names nobody', () => {
    const h = handoffIn(
      split('Research the competitor pricing and then have a think about it'),
      by(RESEARCH, undefined),
      RESEARCH,
    )
    expect(h).toBeNull()
  })

  /*
    One link out of one request.

    A three-link chain inferred from a single sentence is speculation about an
    order nobody stated. The receiving agent may hand on again when it runs,
    where `enforce_delegation_depth` is what bounds it.
  */
  it('returns at most one handoff however many sequenced clauses there are', () => {
    const h = handoffIn(
      split('Pull the numbers and then draft the note and then post it to the team'),
      by(FINANCE, COMMS, RESEARCH),
      FINANCE,
    )
    expect(h?.to).toBe(COMMS)
  })

  it('CONTROL: an adverb that merely opens a clause is not a back-reference', () => {
    const h = handoffIn(
      split('Research the competitor pricing. Meanwhile the onboarding email needs a rewrite.'),
      by(RESEARCH, COMMS),
      RESEARCH,
    )
    expect(h).toBeNull()
  })
})

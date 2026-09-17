/**
 * The separate asks in a request (#231).
 *
 * The defect these exist for: *"look at which channel is bringing people in
 * and draft the note we send them when they arrive"* convened the
 * communications director alone, because `who_knows_about` is a trigram match
 * over the WHOLE message and a whole-message match has one winner.
 */
import { describe, expect, it } from 'vitest'
import { clauses } from '../../src/agents/clauses.ts'

describe('clauses', () => {
  it('leaves a single ask whole, so a one-subject request is unchanged', () => {
    expect(clauses('I need you to tell me our gross margin on the middle tier.')).toEqual([
      'I need you to tell me our gross margin on the middle tier.',
    ])
  })

  it('separates two asks joined by "and"', () => {
    const got = clauses(
      'I need you to look at which channel is bringing people in and draft the note we send them when they arrive.',
    )
    expect(got).toHaveLength(2)
    expect(got[0]).toContain('which channel')
    expect(got[1]).toContain('draft the note')
  })

  it('separates a dictated sequence joined by "and then"', () => {
    const got = clauses(
      'I need you to find out what the three big competitors charge and then tell me what that means for where we position ourselves.',
    )
    expect(got).toHaveLength(2)
    expect(got[0]).toContain('competitors charge')
    expect(got[1]).toContain('position ourselves')
  })

  it('separates a comma-listed three-part ask', () => {
    expect(
      clauses(
        'I need you to find what the market charges, work out what that does to our margin, and say how we should announce whatever we decide.',
      ),
    ).toHaveLength(3)
  })

  it('separates sentences', () => {
    expect(clauses('Do not draft the plan. Create the tasks instead.')).toHaveLength(2)
  })

  it('stays a single ask when the split leaves only one piece worth looking up', () => {
    /*
      "and so on" is below the length floor, so the split yields one ask — and
      one ask means the message has one subject, which is the case the
      whole-message lookup and its three-name hedge were always right about.
      Returning the fragment instead of the message would quietly narrow every
      trailing-filler sentence Grant dictates.
    */
    expect(clauses('Check the pricing model and so on')).toEqual([
      'Check the pricing model and so on',
    ])
  })

  it('is empty for empty text, because an empty VALUES list is a syntax error', () => {
    expect(clauses('')).toEqual([])
    expect(clauses('   ')).toEqual([])
  })

  it('bounds a long list, because the roster is capped at five anyway', () => {
    const long = Array.from(
      { length: 20 },
      (_, i) => `review the ${String(i)} thing carefully`,
    ).join(' and ')
    expect(clauses(long).length).toBeLessThanOrEqual(6)
  })
})

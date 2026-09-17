/**
 * The verdict rule, exhaustively (#133).
 *
 * Nine lines of conditional decide every better/worse the replay reports, and
 * the failure mode is silent: an earlier draft counted one tie plus one
 * preference as agreement, which would have turned half the position-biased
 * pairs into reported movement. Every combination is enumerated here, so the
 * next edit to that rule cannot quietly widen it.
 */

import { describe, expect, it } from 'vitest'
import type { Comparison } from '../../src/eval/judge.ts'
import { direction } from '../../src/eval/judge.ts'

const said = (better: 'A' | 'B' | 'tie'): Comparison => ({
  better,
  reason: 'because',
  model: 'test',
})

describe('direction', () => {
  it('calls the new answer better only when both orders agree it is', () => {
    // then: old=A new=B, the judge picked B. swapped: new=A old=B, it picked A.
    expect(direction(said('B'), said('A'))).toBe('better')
  })

  it('calls it worse only when both orders agree it is', () => {
    expect(direction(said('A'), said('B'))).toBe('worse')
  })

  it('calls two ties unchanged', () => {
    expect(direction(said('tie'), said('tie'))).toBe('unchanged')
  })

  it('refuses to rank a judge that picked the same POSITION twice', () => {
    // Both answers cannot be better than each other. This is position bias.
    expect(direction(said('A'), said('A'))).toBe('unscoreable')
    expect(direction(said('B'), said('B'))).toBe('unscoreable')
  })

  it('refuses to rank a tie against a preference', () => {
    // The trap the earlier draft fell into: half an opinion is not agreement.
    expect(direction(said('tie'), said('A'))).toBe('unscoreable')
    expect(direction(said('tie'), said('B'))).toBe('unscoreable')
    expect(direction(said('A'), said('tie'))).toBe('unscoreable')
    expect(direction(said('B'), said('tie'))).toBe('unscoreable')
  })

  it('is unscoreable when either comparison could not be read', () => {
    expect(direction(null, said('A'))).toBe('unscoreable')
    expect(direction(said('A'), null)).toBe('unscoreable')
    expect(direction(null, null)).toBe('unscoreable')
  })

  it('never reports movement from a single comparison', () => {
    // Every verdict needs both orders. Nine of the sixteen combinations are
    // unscoreable, which is the point: the instrument abstains more often than
    // it speaks, and #133 asks for exactly that.
    const sides: ('A' | 'B' | 'tie')[] = ['A', 'B', 'tie']
    const all = sides.flatMap((x) => sides.map((y) => direction(said(x), said(y))))
    expect(all.filter((d) => d === 'unscoreable')).toHaveLength(6)
    expect(all.filter((d) => d === 'better')).toHaveLength(1)
    expect(all.filter((d) => d === 'worse')).toHaveLength(1)
    expect(all.filter((d) => d === 'unchanged')).toHaveLength(1)
  })
})

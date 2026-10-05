import { describe, expect, it } from 'vitest'
import {
  type Cols,
  fillCoverage,
  hourOf,
  hoursBetween,
  render,
} from '../../scripts/forensics/timeline.ts'

describe('hours', () => {
  it('hourOf cuts an ISO timestamp to the hour', () => {
    expect(hourOf('2026-10-04T17:30:00.000Z')).toBe('2026-10-04T17')
  })
  it('hoursBetween is inclusive and crosses midnight', () => {
    expect(hoursBetween('2026-10-04T23', '2026-10-05T01')).toEqual([
      '2026-10-04T23',
      '2026-10-05T00',
      '2026-10-05T01',
    ])
  })
})

describe('coverage: a dash means not captured, a zero means captured and quiet', () => {
  it('writes a zero for a count in an hour the capture covered but had no rows for', () => {
    const cols: Cols = { '2026-10-05T01': { timeouts: 18 } }
    fillCoverage(cols, ['2026-10-05T01', '2026-10-05T03'], [])
    expect(cols['2026-10-05T02']?.timeouts).toBe(0)
    expect(cols['2026-10-05T02']?.gw).toBe(0)
    expect(cols['2026-10-05T01']?.timeouts).toBe(18)
  })
  it('does not invent anything outside the hours a capture returned', () => {
    const cols: Cols = {}
    fillCoverage(cols, ['2026-10-05T01', '2026-10-05T02'], [])
    expect(cols['2026-10-05T00']).toBeUndefined()
    expect(cols['2026-10-05T03']).toBeUndefined()
  })
  it('the first window fills only the Postgres counts it kept, not gateway or auth columns', () => {
    const cols: Cols = {}
    fillCoverage(cols, [], ['2026-10-04T00', '2026-10-04T02'])
    expect(cols['2026-10-04T01']?.timeouts).toBe(0)
    expect(cols['2026-10-04T01']?.gw).toBeUndefined()
  })
  it('render shows - for an uncovered cell and 0 for a covered one', () => {
    const md = render({ '2026-10-04T01': { timeouts: 0 } })
    const row = md.split('\n')[2] ?? ''
    expect(row).toContain('| 0 |')
    expect(row).toContain('| - |')
  })
})

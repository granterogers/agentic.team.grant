/**
 * Ledger R30 — a claimed read is disproved only when nothing is cited.
 */
import { describe, expect, it } from 'vitest'
import { metadataProblems } from '../../src/agents/quality.ts'

const base = {
  confidence: 'medium',
  evidence: 'inferred',
  contradictions: null,
  path: 'inference',
  body: "I've pulled the booking terms for Holloway Barn: the deposit is £4,317.",
} as const
const flagged = (m: object) =>
  metadataProblems(m as never).some((p) => p.problem.includes('claims to have read'))

describe('claimed read vs what was cited', () => {
  it('the measured refusal: a read over a retrieved, cited document is not refused', () => {
    expect(flagged({ ...base, sources: ['notion:23b2269e Venue terms - Holloway Barn'] })).toBe(
      false,
    )
  })
  it('NEGATIVE CONTROL: the same claim with nothing cited is still refused', () => {
    expect(flagged({ ...base, sources: [] })).toBe(true)
  })
  it('NEGATIVE CONTROL: "consulted" alone does not excuse it (it is on every turn)', () => {
    expect(
      flagged({
        ...base,
        sources: [],
        consulted: { consulted: ['documents', 'projects'], complete: ['projects'] },
      }),
    ).toBe(true)
  })
})

import { readFileSync } from 'node:fs'

describe('R31: a retry does not call its own first attempt "already in hand"', () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  it("the already-in-hand sentence is gated on the child NOT being this job's own", () => {
    expect(src).toMatch(/if \(handed\?\.created === false && !ownEarlierAttempt\) \{/)
    expect(src).toMatch(
      /String\(\(r\.rows\[0\] as \{ p\?: string \} \| undefined\)\?\.p \?\? ''\) === job\.jobId/,
    )
  })
})

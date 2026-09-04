/**
 * The quality gate (§10, §16).
 *
 * The rule under test is that provenance decides, never importance. §16 is
 * explicit about why: "was it important?" is not checkable and "how was it
 * produced?" is, so a gate keyed on the first is a gate decided ad hoc.
 */
import { describe, expect, it } from 'vitest'
import {
  canCommit,
  disagreementNeedsGrant,
  metadataProblems,
  reviewRequired,
  SUBSTANTIVE_KINDS,
} from '../../src/agents/quality.ts'

describe('provenance decides, not importance', () => {
  it('sends everything a model wrote to review, however trivial it looks', () => {
    // The tempting exemption, and the one §16 rules out. A status line is
    // routine; a status line a model wrote is a model's words.
    const d = reviewRequired({ path: 'inference', kind: 'status' })
    expect(d.required).toBe(true)
    expect(d.exempt).toBe(false)
  })

  it('exempts a deterministic retrieval, however important it looks', () => {
    const d = reviewRequired({ path: 'deterministic_retrieval', kind: 'status' })
    expect(d.required).toBe(false)
    expect(d.exempt).toBe(true)
  })

  it.each(SUBSTANTIVE_KINDS)('requires review for %s under inference', (kind) => {
    expect(reviewRequired({ path: 'inference', kind }).required).toBe(true)
  })

  it('still reviews a mechanical path that introduces outside material', () => {
    // No model was involved, so the exemption was available and is withheld:
    // a mechanical path into a wrong belief is still a wrong belief.
    for (const kind of ['external_source_introduced', 'notebook_write'] as const) {
      const d = reviewRequired({ path: 'mechanical_transformation', kind })
      expect(d.required).toBe(true)
      expect(d.reason).toContain(kind)
    }
  })

  it('exempts a quote from already-reviewed material', () => {
    expect(reviewRequired({ path: 'quoted_from_reviewed', kind: 'restatement' }).exempt).toBe(true)
  })
})

describe('metadata combinations that are individually legal and jointly impossible', () => {
  const base = {
    confidence: 'medium',
    evidence: 'inferred',
    sources: [],
    contradictions: null,
  } as const

  it('accepts a coherent set', () => {
    expect(metadataProblems(base)).toEqual([])
  })

  it('rejects verified with nothing to verify against', () => {
    const p = metadataProblems({ ...base, evidence: 'verified' })
    expect(p.map((x) => x.field)).toEqual(['sources'])
  })

  it('accepts verified when there are sources', () => {
    expect(metadataProblems({ ...base, evidence: 'verified', sources: ['notebook:abc'] })).toEqual(
      [],
    )
  })

  it('rejects high confidence in a speculative finding', () => {
    const p = metadataProblems({ ...base, evidence: 'speculative', confidence: 'high' })
    expect(p.map((x) => x.field)).toEqual(['confidence'])
  })

  it('rejects high confidence alongside a recorded contradiction', () => {
    // The averaging failure at its source: naming a disagreement and then
    // reporting high confidence has resolved it silently.
    const p = metadataProblems({
      ...base,
      confidence: 'high',
      contradictions: 'Source A says 4%, source B says 11%.',
    })
    expect(p).toHaveLength(1)
    expect(p[0]?.problem).toContain('averaging')
  })

  it('does not fire on whitespace masquerading as a contradiction', () => {
    expect(metadataProblems({ ...base, confidence: 'high', contradictions: '   ' })).toEqual([])
  })

  it('reports every problem, not the first', () => {
    const p = metadataProblems({
      confidence: 'high',
      evidence: 'speculative',
      sources: [],
      contradictions: 'They disagree.',
    })
    expect(p.length).toBe(2)
  })
})

describe('when Grant is told about a disagreement', () => {
  it('is told when a contradiction survived review and shipped anyway', () => {
    for (const status of ['approved', 'approved_with_reservations'] as const) {
      expect(disagreementNeedsGrant({ status, contradictions: 'A and B disagree.' })).toBe(true)
    }
  })

  it('is not told when the output was rejected — nothing shipped', () => {
    expect(
      disagreementNeedsGrant({ status: 'rejected', contradictions: 'A and B disagree.' }),
    ).toBe(false)
  })

  it('is not told when there is no disagreement', () => {
    expect(disagreementNeedsGrant({ status: 'approved', contradictions: null })).toBe(false)
  })
})

describe('canCommit mirrors the database trigger', () => {
  it('permits approved and approved-with-reservations', () => {
    expect(canCommit(['approved', 'approved_with_reservations'])).toBe(true)
  })

  it('refuses pending, rejected and needs_revision', () => {
    expect(canCommit(['approved', 'pending'])).toBe(false)
    expect(canCommit(['rejected'])).toBe(false)
    expect(canCommit(['needs_revision'])).toBe(false)
  })

  it('permits a job with no outputs at all', () => {
    // A job that produced nothing has nothing to review. The 0018 trigger takes
    // the same view, and these two must not drift apart.
    expect(canCommit([])).toBe(true)
  })
})

/**
 * A request that names a change is not complete while nothing has landed (0.116.1).
 *
 * The Cowork test of 24 November 2026 found "Moved … to the Done column" and "Renamed … column" said with nothing changed, and
 * the classifier had called those turns `completed`, which lets any claim through. A question stays complete.
 */
import { describe, expect, it } from 'vitest'
import { type CanonicalOutcome, classifyOutcome } from '../../src/agents/outcome.ts'

const at = (over: Partial<CanonicalOutcome> = {}): CanonicalOutcome =>
  ({
    wanted: 0,
    landed: 0,
    pendingActions: 0,
    awaitingApproval: false,
    missing: [],
    capabilityRefused: false,
    attempt: 1,
    maxAttempts: 4,
    asked: false,
    settled: true,
    ...over,
  }) as CanonicalOutcome

describe('a change that did not land is not complete', () => {
  it('a move the classifier did not read as work, with nothing landed, is not complete', () => {
    expect(classifyOutcome(at({ asked: true, wanted: 0, landed: 0 }))).toBe('blocked_needs_user')
  })
  it('a question with nothing landed stays complete', () => {
    expect(classifyOutcome(at({ asked: false, wanted: 0, landed: 0 }))).toBe('completed')
  })
  it('a change that did land, as the classifier did not read it, is complete', () => {
    expect(classifyOutcome(at({ asked: true, wanted: 0, landed: 1 }))).toBe('completed')
  })
})

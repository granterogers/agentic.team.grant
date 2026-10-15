/**
 * The archive lifecycle rules. Each refusal sits beside the move that must still be allowed, so a rule that refuses
 * everything cannot pass.
 */
import { describe, expect, it } from 'vitest'
import {
  canMove,
  isLifecycleState,
  isLive,
  LIFECYCLE_STATES,
  type LifecycleState,
} from '../../src/portability/lifecycle.ts'

const ALLOWED_MOVES: ReadonlyArray<[LifecycleState, LifecycleState]> = [
  ['active', 'archiving'],
  ['archiving', 'archived'],
  ['archiving', 'active'],
  ['archived', 'restoring'],
  ['restoring', 'active'],
  ['restoring', 'archived'],
]

describe('archive lifecycle moves', () => {
  it.each(ALLOWED_MOVES)('allows %s -> %s', (from, to) => {
    expect(canMove(from, to)).toBe(true)
  })

  it('refuses a project being archived twice, or restored while live', () => {
    expect(canMove('archived', 'archiving')).toBe(false)
    expect(canMove('active', 'restoring')).toBe(false)
  })

  it('refuses skipping the middle of an operation', () => {
    expect(canMove('active', 'archived')).toBe(false)
    expect(canMove('archived', 'active')).toBe(false)
  })

  it('refuses a move to itself', () => {
    for (const state of LIFECYCLE_STATES) expect(canMove(state, state)).toBe(false)
  })

  it('every state is reachable from active and can return to it', () => {
    const reachable = new Set<LifecycleState>(['active'])
    let grew = true
    while (grew) {
      grew = false
      for (const [from, to] of ALLOWED_MOVES) {
        if (reachable.has(from) && !reachable.has(to)) {
          reachable.add(to)
          grew = true
        }
      }
    }
    expect([...reachable].sort()).toEqual([...LIFECYCLE_STATES].sort())
  })
})

describe('lifecycle vocabulary', () => {
  it('accepts the four states and refuses anything else', () => {
    for (const state of LIFECYCLE_STATES) expect(isLifecycleState(state)).toBe(true)
    expect(isLifecycleState('deleted')).toBe(false)
    expect(isLifecycleState(null)).toBe(false)
  })

  it('only an active project is live', () => {
    expect(isLive('active')).toBe(true)
    expect(isLive('archiving')).toBe(false)
    expect(isLive('archived')).toBe(false)
    expect(isLive('restoring')).toBe(false)
  })
})

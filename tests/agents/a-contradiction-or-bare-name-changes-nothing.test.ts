/**
 * A finish request that contradicts itself, or names a task the reader could not find, changes nothing (0.116.1).
 *
 * The Cowork test of 24 November 2026: "Mark the Test task one task done, and keep it open." ticked "Test move this card", the one
 * other open task in the conversation. A pronoun ("mark it done") still means the one task in front of the person.
 */
import { describe, expect, it } from 'vitest'
import { taskStateChange } from '../../src/agents/mine.ts'

describe('a finish request that cannot be read exactly changes nothing', () => {
  it('a contradiction is not read as a finish', () => {
    expect(taskStateChange('Mark the Test task one task done, and keep it open.')).toBeNull()
  })
  it('a named task whose name was not read is not the only task', () => {
    expect(taskStateChange('Mark the Test task one task done.')?.name ?? null).not.toBeNull()
  })
  it('a pronoun still finishes the one task in front of the person', () => {
    expect(taskStateChange('Mark it done.')).toEqual({ state: 'done', name: null })
  })
})

/**
 * Ledger R34 — sentences that mention making a task without asking for one.
 */
import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import { personalTaskRequest, taskStateChange } from '../../src/agents/mine.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

const now = new Date('2026-09-24T10:00:00Z')
const anyTask = (s: string) =>
  personalTaskRequest(s, now) !== null || taskRequest(s, classifyIntent(s), s) !== null

describe('a mention is not a request', () => {
  it.each([
    "Don't add a task to chase the roofer.",
    "Kevin said 'add a task to chase the roofer' but I think that's daft",
    'Should I add a task to chase the roofer?',
    'Emma suggested we add a task for the insurance',
    'There is no need to put anything on my list for that',
  ])('no task: %s', (s) => {
    expect(anyTask(s)).toBe(false)
  })

  it.each([
    'Could you add a task to chase the roofer?',
    'Remind me not to ring Kevin before ten',
    "Add a task: don't sign anything until legal replies",
    "put 'renew the insurance' on my list",
  ])('NEGATIVE CONTROL, still a task: %s', (s) => {
    expect(anyTask(s)).toBe(true)
  })
})

describe('a completion taken back, or prohibited, does nothing', () => {
  it.each([
    'Can you not delete that one please',
    'Mark the Hartley one done, actually no, leave it',
  ])('%s', (s) => {
    expect(taskStateChange(s)).toBeNull()
  })
  it('NEGATIVE CONTROL', () => {
    expect(taskStateChange('Mark the Hartley one done')).toEqual({ state: 'done', name: 'hartley' })
  })
})

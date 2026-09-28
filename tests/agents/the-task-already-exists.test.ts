/**
 * Ledger R4 — "the task" names one that exists; it does not ask for a new one.
 *
 * "And put it down as mine" was rewritten "put the task down as belonging to
 * Grant", and a task called "down as belonging to Grant" was filed.
 */
import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

const read = (s: string) => taskRequest(s, classifyIntent(s))

describe('a definite task is a reference', () => {
  it.each([
    'put the task down as belonging to Grant',
    'make the task urgent',
    'Move this task to Monday',
    'put that to-do under the Legacy project',
    'mark my reminder as high priority',
  ])('%s', (s) => {
    expect(read(s)).toBeNull()
  })
})

describe('NEGATIVE CONTROL: a request for a task still is one', () => {
  it.each([
    ['Add a task to chase the roofer', 'chase the roofer'],
    ['add the task to chase the roofer', 'chase the roofer'],
    ['Create a task for me to review the Hartley proposal', 'review the Hartley proposal'],
    ['add another task to book the venue', 'book the venue'],
    ['Make a new task called Renew the insurance', 'Renew the insurance'],
  ])('%s', (s, title) => {
    expect(read(s)?.title?.toLowerCase()).toBe(title.toLowerCase())
  })
})

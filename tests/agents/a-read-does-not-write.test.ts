/**
 * A request to find, list or say something is not a request to write a task (0.116.1).
 *
 * The Cowork test of 24 November 2026: "Find the two most overdue tasks on this project. Say which one to do first…" was filed as a
 * task titled "the two most overdue tasks on this project". A request that makes a task still does (the real writing tests cover that).
 */
import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

const ask = (s: string) => taskRequest(s, classifyIntent(s))

describe('a read is not a write', () => {
  it.each([
    'Find the two most overdue tasks on this project. Say which one to do first and why, in under sixty words.',
    'List the tasks on this project that are blocked.',
    'Show me the tasks due this week.',
    'Which tasks are overdue on this project?',
  ])('writes no task for: %s', (said) => {
    expect(ask(said)).toBeNull()
  })
})

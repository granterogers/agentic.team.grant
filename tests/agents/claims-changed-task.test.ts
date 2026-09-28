import { describe, expect, it } from 'vitest'
import { claimsToHaveChangedTask, metadataProblems } from '../../src/agents/quality.ts'

/*
  Ledger R3. The measured answer, and neighbours of it in the shapes a model
  writes a completed change — past tense, perfect, passive, subject dropped.
*/
const CLAIMS = [
  'Task “Review the Hartley proposal” is now marked as done.',
  'Done — I have marked the Hartley task as complete.',
  'The minibus task has been deleted.',
  'I’ve removed the minibus booking task from your list.',
  'Your task “Chase the caterers” has been moved to Monday.',
  'I have reassigned the task to you.',
  'Ticked it off: the “Send the Brightwell invoice” task.',
  'The reminder was cancelled.',
]

const NOT_CLAIMS = [
  // plans, offers, conditions and questions
  'I can mark the Hartley task as done once you confirm.',
  'Shall I delete the minibus task?',
  'If you want, I will move the task to Monday.',
  // denials — the honest answer the gate should push towards
  'I have not marked the task as done; you can tick it off on the dashboard.',
  'No task has been deleted.',
  // somebody else did it
  'You have already marked that task as done.',
  // a state change that is not about a task
  'The meeting has been moved to Monday.',
  'The venue is now booked.',
  // creation is claimsToHaveMade's job, not this one's
  'Added it: Review the Hartley proposal.',
]

describe('a claim that a task was changed', () => {
  it.each(CLAIMS)('is recognised: %s', (body) => {
    expect(claimsToHaveChangedTask(body)).not.toBeNull()
  })
  it.each(NOT_CLAIMS)('NEGATIVE CONTROL is not: %s', (body) => {
    expect(claimsToHaveChangedTask(body)).toBeNull()
  })
})

describe('is refused only when no task row changed', () => {
  const base = {
    confidence: 'medium',
    evidence: 'inferred',
    sources: [],
    contradictions: null,
    path: 'inference',
    body: 'Task “Review the Hartley proposal” is now marked as done.',
  } as const
  const has = (p: readonly { problem: string }[]) =>
    p.some((x) => x.problem.includes('changed no task'))

  it('the measured case: two specialists convened, no row changed', () => {
    expect(has(metadataProblems({ ...base, acted: 2, tasksChanged: 0 } as never))).toBe(true)
  })
  it('CONTROL: a row did change', () => {
    expect(has(metadataProblems({ ...base, acted: 1, tasksChanged: 1 } as never))).toBe(false)
  })
  it('CONTROL: not counted never accuses', () => {
    expect(has(metadataProblems({ ...base, acted: 0 } as never))).toBe(false)
  })
})

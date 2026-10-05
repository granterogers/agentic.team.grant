import { describe, expect, it } from 'vitest'
// @ts-expect-error - a browser module with no type declarations
import { dueWords, isLate } from '../../web/studio/bc/miniatures.js'

// A date well in the past, so the test does not depend on the day it runs.
const PAST = '2020-01-15'

describe('the words beside a due date agree with isLate', () => {
  it('an open task that is past due says overdue, and is late', () => {
    const t = { due_on: PAST, state: 'todo' }
    expect(dueWords(t)).toMatch(/overdue/)
    expect(isLate(t)).toBe(true)
  })

  it('a finished task past its date is NOT called overdue, and is not late', () => {
    for (const state of ['done', 'cancelled']) {
      const t = { due_on: PAST, state }
      expect(dueWords(t)).not.toMatch(/overdue/)
      expect(dueWords(t)).toMatch(/15 Jan/)
      expect(isLate(t)).toBe(false)
    }
  })

  it('the raw state wins when both are present, as isDone reads it', () => {
    const t = { due_on: PAST, state: 'In progress', state_raw: 'done' }
    expect(dueWords(t)).not.toMatch(/overdue/)
  })

  it('a future date is just the date, whatever the state', () => {
    const t = { due_on: '2099-03-02', state: 'todo' }
    expect(dueWords(t)).toMatch(/2 Mar/)
    expect(dueWords(t)).not.toMatch(/overdue/)
  })
})

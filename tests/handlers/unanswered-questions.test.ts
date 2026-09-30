import { describe, expect, it } from 'vitest'
import { unansweredQuestions } from '../../src/handlers/instruction.ts'

// Review R2-6: a question is a SENTENCE ending in a question mark, not a fragment containing one.
describe('unansweredQuestions', () => {
  it('finds a real question after a request', () => {
    expect(unansweredQuestions('Add a task to call Kevin. Is the venue booked yet?')).toEqual([
      'Is the venue booked yet?',
    ])
  })
  it('does not read a link query string as a question', () => {
    expect(unansweredQuestions('Remind me to read https://example.com/a?id=5 tomorrow')).toEqual([])
  })
  it('does not split at an abbreviation', () => {
    expect(
      unansweredQuestions('Ask Dr. Smith about the budget for Q3 and then confirm it?'),
    ).toHaveLength(1)
  })
  it('finds nothing when nothing was asked', () => {
    expect(unansweredQuestions('Add a task to call Kevin.')).toEqual([])
  })
})

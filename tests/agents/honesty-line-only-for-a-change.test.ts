/**
 * The line "I have not done this yet, and nothing has been changed" is said only when the request names a change in the
 * world (0.111.0, narrowed at Grant's word on 24 November 2026). A question or a request to read the office never gets it.
 *
 * The sentence is still made, and still true, for a request that asks for a change: a draft, a send, a booking.
 */
import { describe, expect, it } from 'vitest'
import { clauses } from '../../src/agents/clauses.ts'
import { asksForChange } from '../../src/agents/request.ts'

const change = (said: string): boolean => asksForChange(said, clauses)

describe('the honesty line is for a request that changes something', () => {
  it.each([
    'Read the office and tell me what is overdue on the trip',
    'In this project, which travel tasks are overdue?',
    'Which projects are active?',
    'What do you know about the venue budget?',
    'Is the 2027 Financial Plan on track?',
  ])('does not say it for a question or a read: %s', (said) => {
    expect(change(said)).toBe(false)
  })

  it.each([
    'Book the venue walkthrough for Friday',
    'Draft an email to Kevin about the launch date, but do not send it',
    'Send the invoice to Kevin',
    'Create a task for the caterers',
  ])('still says it for a request that changes something: %s', (said) => {
    expect(change(said)).toBe(true)
  })
})

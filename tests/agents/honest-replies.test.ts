/**
 * Replies the Cowork test found false (0.117.2): a booking claimed for a team that cannot book, and a promise to come back with
 * nothing running.
 */
import { describe, expect, it } from 'vitest'
import { bookingReplyFor, undeliveredPromiseFor } from '../../src/agents/honest-replies.ts'

describe('a booking is never claimed', () => {
  it('replaces "I\'ll lock it in" for a booking request', () => {
    expect(
      bookingReplyFor(
        'Book the venue for 14 December for four hours.',
        'Give me the venue name and I will lock it in.',
      ),
    ).toMatch(/Nothing has been booked/)
  })
  it('leaves a reply that does not claim a booking alone', () => {
    expect(
      bookingReplyFor('Book the venue for 14 December.', 'Which venue do you mean?'),
    ).toBeNull()
  })
  it('leaves a reply to a request that is not about a booking alone', () => {
    expect(bookingReplyFor('What is on the schedule?', "I'll lock it in.")).toBeNull()
  })
})

describe('a promise to come back is kept only while work is running', () => {
  it('replaces the promise when nothing is running', () => {
    expect(undeliveredPromiseFor('I will come back with what each one actually found.', 0)).toMatch(
      /Nothing else is running/,
    )
  })
  it('leaves the promise alone while work is running', () => {
    expect(
      undeliveredPromiseFor('I will come back with what each one actually found.', 2),
    ).toBeNull()
  })
  it('leaves an ordinary reply alone', () => {
    expect(undeliveredPromiseFor('Two tasks are overdue.', 0)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { personalTaskRequest } from '../../src/agents/mine.js'

const now = new Date('2026-09-25T09:00:00Z')

describe('"put down that I need to…" is titled with the work (R38)', () => {
  it.each([
    [
      'Put down that I need to send the insurers the claim form by Tuesday.',
      'Send the insurers the claim form',
    ],
    ['Note down that I have to ring the bank tomorrow.', 'Ring the bank'],
    ['Make a note that I need to book the vet.', 'Book the vet'],
    ['Stick it down that I need to call the council.', 'Call the council'],
  ])('%s', (said, title) => {
    expect(personalTaskRequest(said, now)?.title).toBe(title)
  })

  // Negative controls: a "that" inside the work stays.
  it('a that after the commitment is part of the work', () => {
    expect(personalTaskRequest('I need to check that the deposit cleared.', now)?.title).toBe(
      'Check that the deposit cleared',
    )
  })
  it('a that not followed by his commitment is not stripped', () => {
    expect(
      personalTaskRequest('Remind me to tell Kevin that the van is booked.', now)?.title,
    ).toMatch(/^Tell Kevin that the van is booked/)
  })
})

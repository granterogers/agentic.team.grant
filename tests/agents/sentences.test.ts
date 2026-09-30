import { describe, expect, it } from 'vitest'
import { sentencesOf } from '../../src/agents/sentences.ts'

describe('sentencesOf', () => {
  it('splits ordinary sentences and keeps their terminators', () => {
    expect(
      sentencesOf(
        'Remind me tomorrow to call Kevin. From now on give me the conclusion first. What is on?',
      ),
    ).toEqual([
      'Remind me tomorrow to call Kevin.',
      'From now on give me the conclusion first.',
      'What is on?',
    ])
  })

  it.each([
    ['Remind me to call Dr. Smith tomorrow.'],
    ['Remind me to email Acme Inc. about the contract on Friday.'],
    ['Remind me to call Mr. Jones at 3.30pm.'],
    ["Remind me to call St. Mary's school on Monday."],
    ['Ask J. Smith about the lease.'],
    ['Review https://docs.example.com/plan.html before Friday.'],
    ['Pay 12.50 to the vendor.'],
  ])('does not split inside one sentence: %s', (said) => {
    expect(sentencesOf(said)).toEqual([said])
  })

  it('does not break a numbered list at its numbers', () => {
    expect(sentencesOf('Remind me to: 1. call Kevin. 2. book flights.')).toEqual([
      'Remind me to: 1. call Kevin. 2. book flights.',
    ])
  })

  it('CONTROL: it does split where the next sentence plainly starts, even after an abbreviation-looking word', () => {
    expect(sentencesOf('I spoke to Dr. Smith. He agreed. Call him.')).toEqual([
      'I spoke to Dr. Smith.',
      'He agreed.',
      'Call him.',
    ])
  })
})

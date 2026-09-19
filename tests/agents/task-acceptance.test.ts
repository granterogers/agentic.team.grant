/*
  The independent acceptance pass, as regressions.

  Every case here is a sentence the product got WRONG when it was spoken to
  like a stranger rather than like its own test corpus — written after Phase 1
  was declared complete, for exactly the reason CLAUDE.md gives: a corpus
  written alongside an implementation can only say the implementation does what
  its author meant.

  The negative controls matter more than the positives. Two of the findings
  were FALSE POSITIVES — a question that created a task and swallowed itself —
  and the fix for a false positive is one narrowing away from also refusing the
  real thing, so each guard is paired with the sentence it must leave alone.
*/
import { describe, expect, it } from 'vitest'
import { personalTaskChange, personalTaskRequest, whenFor } from '../../src/agents/mine.ts'

// A Saturday, so a weekday reference is unambiguous.
const NOW = new Date('2026-09-19T09:00:00Z')

const title = (said: string): string | null => personalTaskRequest(said, NOW)?.title ?? null

describe('a question about the list is not a task', () => {
  it('does not invent a task from "remind me how"', () => {
    expect(personalTaskRequest('Remind me how the pricing works', NOW)).toBeNull()
    expect(personalTaskRequest('remind me again how we handle refunds', NOW)).toBeNull()
  })

  it('leaves the reminder reading of "when" alone, which is why "how" is safe', () => {
    expect(title('remind me when the deadline approaches')).not.toBeNull()
  })

  it('does not create a task from "did I ever add a task about X?"', () => {
    expect(personalTaskRequest('Did I ever add a task about the domain?', NOW)).toBeNull()
    expect(
      personalTaskRequest('have you put a reminder on my list for the invoice?', NOW),
    ).toBeNull()
  })

  it('CONTROL: a polite request in the same words is still a task', () => {
    expect(title('Can you add a task to review the Q4 numbers')).toBe('Review the Q4 numbers')
    expect(title('could you put a reminder on my list to call the bank')).toBe('Call the bank')
  })
})

describe('shapes a person uses that the corpus had never been told', () => {
  it('hears "I must remember to"', () => {
    expect(title('I must remember to renew the domain before it lapses')).toBe(
      'Renew the domain before it lapses',
    )
    expect(title('I need to remember to send the contract')).toBe('Send the contract')
  })

  it('drops an interjection instead of putting it on the list', () => {
    expect(title('Oh — I must remember to renew the domain')).toBe('Renew the domain')
    expect(title('Hmm, I need to book the dentist')).toBe('Book the dentist')
  })

  it('CONTROL: an interjection that is also a verb is not an opener', () => {
    // "Look into the pricing" is the office's work. Stripping "look" would
    // leave "into the pricing", which no rule understands.
    expect(personalTaskRequest('Look into the pricing', NOW)).toBeNull()
  })

  it('hears the list named without the word task', () => {
    expect(title("Stick 'call the accountant' on my list for Tuesday")).toBe('Call the accountant')
    expect(title('put chasing the invoice on my to-do list')).toBe('Chasing the invoice')
  })

  it('and keeps the date the same sentence carried', () => {
    expect(
      personalTaskRequest("Stick 'call the accountant' on my list for Tuesday", NOW)?.due,
    ).toBe('2026-09-22')
  })

  it('CONTROL: the same phrase with no putting verb is a question about the list', () => {
    expect(personalTaskRequest('What is on my list for today?', NOW)).toBeNull()
    expect(personalTaskRequest('how much is on my plate this week', NOW)).toBeNull()
  })

  it('hears the hurried shape', () => {
    expect(title('Add: buy a birthday present for mum')).toBe('Buy a birthday present for mum')
    expect(title('todo: ring the landlord')).toBe('Ring the landlord')
  })

  it('CONTROL: the same verb without the colon is work for the team', () => {
    expect(personalTaskRequest('Add the figures to the deck', NOW)).toBeNull()
  })

  it('CONTROL: a task named for somebody else is still not his', () => {
    expect(
      personalTaskRequest('put a task for Emma on my list to research pricing', NOW),
    ).toBeNull()
  })
})

describe('the dates a person says that had no reading', () => {
  it('understands next month, clamped to a day that exists', () => {
    expect(whenFor('next month', new Date('2026-01-31T09:00:00Z'))).toBe('2026-02-28')
    expect(whenFor('next month', NOW)).toBe('2026-10-19')
  })

  it('understands a distance in days, weeks and months', () => {
    expect(whenFor('in 3 days', NOW)).toBe('2026-09-22')
    expect(whenFor('in two weeks', NOW)).toBe('2026-10-03')
    expect(whenFor('in a fortnight', NOW)).toBe('2026-10-03')
    expect(whenFor('in 2 months', NOW)).toBe('2026-11-19')
  })

  it('CONTROL: an absurd distance is refused rather than guessed', () => {
    expect(whenFor('in 900 days', NOW)).toBeNull()
  })

  it('CONTROL: an explicit day that does not exist is still refused', () => {
    // A DISTANCE may be clamped; a named day may not. "On the 31st" said in
    // February means a day February has not got.
    expect(whenFor('on the 31st', new Date('2026-02-05T09:00:00Z'))).toBeNull()
  })
})

describe('follow-ups that changed nothing', () => {
  it('hears a rename that says "that" rather than "it"', () => {
    expect(personalTaskChange('rename that to "chase the invoice again"', NOW)?.title).toBe(
      'chase the invoice again',
    )
    expect(personalTaskChange('call that the October review', NOW)?.title).toBe(
      'the October review',
    )
  })

  it('hears the rename shape whose referent is buried in the phrase', () => {
    /*
      "make it called X" leaves "it called" behind once the name is taken out,
      and `it` followed by a word is not a bare referent — so the ONE rename
      shape that existed before this pass was the one it refused. The witness
      for `namedReferent`: without that branch this case returns null while
      every other rename in this file still passes.
    */
    expect(personalTaskChange('make it called the October review', NOW)?.title).toBe(
      'the October review',
    )
  })

  it('takes the dictation quotes off the new name', () => {
    expect(personalTaskChange('call it “renew the domain”', NOW)?.title).toBe('renew the domain')
  })

  it('CONTROL: a rename naming no task at all is refused', () => {
    // "change the wording to X" could be about anything on the screen. With
    // nothing pointing at the last task, the office asks rather than guesses.
    expect(personalTaskChange('change the wording to "renew innergy.com"', NOW)).toBeNull()
  })

  it('hears "up the list" and "down the list"', () => {
    expect(personalTaskChange('bump that up the list', NOW)?.priority).toBe(20)
    expect(personalTaskChange('push that down the list', NOW)?.priority).toBe(100)
  })

  it('hears a postponement said as a postponement', () => {
    const c = personalTaskChange('that can wait until next month', NOW)
    expect(c?.due).toBe('2026-10-19')
    expect(c?.priority).toBe(100)
  })

  it('CONTROL: a sentence with a subject of its own is still not a follow-up', () => {
    expect(personalTaskChange('make that pricing document urgent', NOW)).toBeNull()
    expect(personalTaskChange('bump the onboarding project up the list', NOW)).toBeNull()
  })

  it('CONTROL: a new task is never read as a change to the last one', () => {
    expect(personalTaskChange('actually, remind me Monday to ring them', NOW)).toBeNull()
  })
})

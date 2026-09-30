/**
 * `task.indirect` — the mission's own example of the defect it exists for.
 *
 *   "Make me a note to call Kevin" fails while "Remind me to call Kevin"
 *   works, so the finding is INDIRECT FUTURE-ACTION INTENT.
 *
 * `classifyIntent` read it as a confident `direct_command` on all three
 * corpora. `personalTaskRequest` filed nothing, so the turn ended having
 * understood an instruction it had no path to carry out — #289's
 * disagreement, on the sentence the brief names.
 *
 * The cause was a class with three of its words in it. `MAKE_A_TASK`'s
 * artifact nouns were `task`, `to-do` and `reminder`; `note`, `item`,
 * `entry` and `line` were missing, and `note` was already in the VERB list
 * of the same pattern.
 *
 * They are separate because they are polysemous, and the INFINITIVE is what
 * separates them: a note TO DO something is an action, a note OF something
 * is a record. Structural, so it holds for phrasings nobody enumerated.
 */

import { describe, expect, it } from 'vitest'
import { personalTaskRequest } from '../../src/agents/mine.ts'

describe('a to-do asked for by a word that also means something else', () => {
  const files: [string, string][] = [
    ['make me a note to ring Kevin back about the quote', 'Ring Kevin back about the quote'],
    ['put a note on to chase the invoice', 'Chase the invoice'],
    ['stick a note to call the venue on friday', 'Call the venue'],
    ['leave me a note to review the contract', 'Review the contract'],
    ['add an item to book the room', 'Book the room'],
    ['put an entry on to email the funding officer', 'Email the funding officer'],
    ['drop me a line to follow up with the council', 'Follow up with the council'],
    ['bung a memo on to reconcile the accounts', 'Reconcile the accounts'],
  ]

  for (const [said, title] of files) {
    it(`files it, titled by the ACTION: ${said.slice(0, 42)}`, () => {
      const got = personalTaskRequest(said)
      expect(got, said).not.toBeNull()
      expect(got?.title).toBe(title)
    })
  }

  /*
    The half that decides whether the class may be widened at all. Every one
    of these uses the same nouns and is a RECORD, not a to-do, and the only
    thing keeping them out is the absence of the infinitive.
  */
  const records = [
    'make a note of the price before you send it',
    'I made a note about that yesterday',
    'can you note the deadline in the summary',
    'make a note on the pricing review',
    'there is a note about it in the folder',
    'the item on the agenda is the budget',
    'add a line about the discount to the draft',
  ]

  for (const said of records) {
    it(`is a record and stays out: ${said.slice(0, 42)}`, () => {
      expect(personalTaskRequest(said), said).toBeNull()
    })
  }

  it('leaves the constructions that already worked exactly as they were', () => {
    expect(personalTaskRequest('make a task to review the budget')?.title).toBe('Review the budget')
    expect(personalTaskRequest('add a reminder to call the printers')?.title).toBe(
      'Call the printers',
    )
    expect(personalTaskRequest('remind me to add the figures to the deck')?.title).toBe(
      'Add the figures to the deck',
    )
  })

  /*
    A pre-existing defect in the older path, fixed with this one because
    leaving one of two identical bugs standing is how the second gets
    argued about later.
  */
  it('titles the older path by the action too', () => {
    expect(personalTaskRequest('put a to-do on to check the numbers')?.title).toBe(
      'Check the numbers',
    )
  })
})

import { personalTaskRequest as personalTask } from '../../src/agents/mine.ts'

describe('the task is the sentence that asked for it (final audit, invariant 4)', () => {
  const now = new Date('2026-09-30T10:00:00Z')
  it('a rule and a question around a reminder do not end up in its title', () => {
    const t = personalTask(
      'From now on give me the conclusion first. Also remind me tomorrow to call Kevin. And what is the status of the venue?',
      now,
    )
    expect(t?.title).toBe('Call Kevin')
  })
  it('a reminder followed by a rule is titled by the reminder alone', () => {
    expect(
      personalTask(
        'Remind me tomorrow to call Kevin. From now on give me the conclusion first.',
        now,
      )?.title,
    ).toBe('Call Kevin')
  })
  it('CONTROL: a one-sentence reminder reads exactly as before', () => {
    expect(personalTask('Remind me tomorrow to call Kevin about the roof.', now)?.title).toBe(
      'Call Kevin about the roof',
    )
  })
  it('CONTROL: a message with no request sentence files nothing', () => {
    expect(
      personalTask(
        'From now on give me the conclusion first. And what is the status of the venue?',
        now,
      ),
    ).toBeNull()
  })
})

describe('an abbreviation or a list number does not end the request sentence (review R2-1)', () => {
  const now = new Date('2026-09-30T10:00:00Z')
  it.each([
    ['Remind me to call Dr. Smith tomorrow.', 'Call Dr. Smith'],
    [
      'Remind me to email Acme Inc. about the contract on Friday.',
      'Email Acme Inc. about the contract',
    ],
    ['Remind me to call Mr. Jones at 3.30pm.', 'Call Mr. Jones'],
    ["Remind me to call St. Mary's school on Monday.", "Call St. Mary's school"],
  ])('%s', (said, title) => {
    expect(personalTask(said, now)?.title).toBe(title)
  })
  it('a numbered list is one request, as it was', () => {
    expect(personalTask('Remind me to: 1. call Kevin. 2. book flights.', now)).not.toBeNull()
  })
})

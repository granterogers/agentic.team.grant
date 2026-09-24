import { describe, expect, it } from 'vitest'
import { namedColleague } from '../../src/agents/named.ts'

const STAFF = [
  { slug: 'research-director', name: 'Emma' },
  { slug: 'finance-director', name: 'Daniel' },
  { slug: 'communications-director', name: 'Oliver' },
  { slug: 'quality-director', name: 'Grace' },
]

describe('a colleague named as the one to do it (ledger R21)', () => {
  it.each([
    [
      'Right, can you ask Emma to pull together everything we have on the Holloway Barn booking',
      'research-director',
    ],
    ['get Daniel to work out what share of £20,000 that is', 'finance-director'],
    ['have Oliver draft the note to members', 'communications-director'],
    ['Emma, can you look into coach hire around Leeds?', 'research-director'],
    ['ok Grace - is there a GDPR problem here', 'quality-director'],
    ['pass it to Daniel when she is done', 'finance-director'],
  ])('%s', (clause, slug) => {
    expect(namedColleague(clause, STAFF)).toBe(slug)
  })

  it.each([
    'Emma said the deposit was high',
    'what did Daniel make of it?',
    'I spoke to Grace yesterday about the venue',
    'Draft the announcement email for the pricing change',
    // a first name that is also an ordinary word must be a whole word
    'send the emmanuel invoice',
  ])('NEGATIVE CONTROL: %s', (clause) => {
    expect(namedColleague(clause, STAFF)).toBeNull()
  })
})

import { groundedIn } from '../../src/agents/named.ts'

describe('a new task title is grounded in what he said (ledger R4b)', () => {
  it.each([
    ['review the Pemberton renewal', 'And put it down as mine.'],
    ['down as belonging to Grant', 'And put it down as mine.'],
    ['Chase the venue about parking', 'yeah do that'],
  ])('NOT grounded: "%s" from "%s"', (title, said) => {
    expect(groundedIn(title, said)).toBe(false)
  })
  it.each([
    [
      'Review the Hartley proposal',
      'Fine. Create a task to review the Hartley proposal on Friday.',
    ],
    [
      'Renew the public liability insurance',
      'Couple of things. Add a task to renew the public liability insurance by the 30th',
    ],
    ['Book the minibus for the away day', 'Thanks. Also one to book the minibus for the away day.'],
    // dictation: the title and the message come from the same words
    ['ring the plumbr about the boilr', 'add a task to ring the plumbr about the boilr tomorow'],
  ])('grounded: "%s"', (title, said) => {
    expect(groundedIn(title, said)).toBe(true)
  })
})

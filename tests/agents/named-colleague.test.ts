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

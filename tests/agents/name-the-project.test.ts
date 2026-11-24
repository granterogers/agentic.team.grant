/**
 * A question about what to do next gets the rule to name the project each item belongs to (0.113.0).
 */
import { describe, expect, it } from 'vitest'
import { asksWhatIsNext, NAME_THE_PROJECT_LINE } from '../../src/agents/name-the-project.ts'

describe('a question about what to do next names the project', () => {
  it.each([
    'What should I focus on today? Keep it short.',
    'What is overdue?',
    'What is the most important thing next?',
  ])('gets the rule: %s', (said) => expect(asksWhatIsNext(said)).toBe(true))
  it.each(['How much did we spend on the venue?', 'Email the client about the delay'])(
    'does not: %s',
    (said) => expect(asksWhatIsNext(said)).toBe(false),
  )
  it('says to name the project and to say when there is none', () => {
    expect(NAME_THE_PROJECT_LINE).toMatch(/which project/)
    expect(NAME_THE_PROJECT_LINE).toMatch(/belongs to no project/)
  })
})

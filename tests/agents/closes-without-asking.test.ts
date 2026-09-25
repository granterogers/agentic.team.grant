import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { closesWithoutAsking } from '../../src/agents/negation.js'

describe('a close that asks for nothing is answered as one (R43)', () => {
  it.each([
    "and yeah that's it thanks",
    'Thanks!',
    'Cheers, that is all for now.',
    'OK great, thank you very much.',
    "That's everything, ta.",
  ])('%s', (said) => {
    expect(closesWithoutAsking(said)).toBe(true)
  })
  // Negative controls: anything with content, a question, or no closing word.
  it.each([
    'Thanks, and can you add a task to ring the bank?',
    "Thanks, that's it for the florist but chase the printers.",
    'Yes, go ahead.',
    'Perfect.',
    'Is that it?',
    'Thanks for the venue figures, now draft the note.',
  ])('%s is not a bare close', (said) => {
    expect(closesWithoutAsking(said)).toBe(false)
  })
  it('the handler never closes over a question it asked', () => {
    const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    expect(src).toMatch(/Number\(last\.waitingOnYou \?\? 0\) === 0 && !weAsked/)
  })
})

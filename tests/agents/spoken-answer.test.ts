/**
 * Ledger R33 — "Yes, go ahead." answers the question the office asked.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { optionFor, spokenAnswer } from '../../src/agents/spoken-answer.ts'

const OPTIONS = ['Yes, do it', 'No, leave it']

describe('a short yes or no', () => {
  it.each(['Yes, go ahead.', 'yes please', 'ok', 'Go for it', 'Yes', 'sure, thanks'])(
    'yes: %s',
    (s) => {
      expect(spokenAnswer(s)).toBe('yes')
      expect(optionFor('yes', OPTIONS)).toBe('Yes, do it')
    },
  )
  it.each(['no, leave it', 'nope', 'not now'])('no: %s', (s) => {
    expect(spokenAnswer(s)).toBe('no')
    expect(optionFor('no', OPTIONS)).toBe('No, leave it')
  })
  it.each([
    'yes but change the title first',
    'no idea',
    'ok so what about the budget',
    'Yes, and also book the barn',
  ])('NEGATIVE CONTROL, not a bare answer: %s', (s) => {
    expect(spokenAnswer(s)).toBeNull()
  })
  it('NEGATIVE CONTROL: options with no yes-shaped answer are never guessed', () => {
    expect(optionFor('yes', ['Notion', 'Drive'])).toBeNull()
    expect(optionFor('yes', ['Yes, add them', 'Yes, but only the PDFs'])).toBeNull()
  })
})

describe("the handler answers only this conversation's ONE open question", () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  it('through the same door the dashboard uses', () => {
    expect(src).toMatch(/app\.hq_answer_blocker\(\$\{lit\(q\.id\)\}::uuid, \$\{lit\(option\)\}\)/)
  })
  it('asks when there is more than one', () => {
    expect(src).toMatch(/if \(open\.length > 1\) \{/)
  })
})

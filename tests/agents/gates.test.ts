import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { answerOutranks, decideEarlyGate } from '../../src/agents/gates.ts'
import { answerClause, asHumanWords, buildTurn } from '../../src/agents/turn.ts'

const F = { answer: null, rejects: false, closes: false, questionWaiting: false, weAsked: false }

describe('an answer to a waiting question outranks rejection and close', () => {
  it.each([
    [{ ...F, answer: 'yes' as const, rejects: true, closes: true }, 'answer'],
    [{ ...F, answer: 'no' as const, rejects: true }, 'answer'],
    [{ ...F, rejects: true, closes: true }, 'reject'],
    [{ ...F, closes: true }, 'close'],
    [{ ...F, closes: true, questionWaiting: true }, null],
    [{ ...F, closes: true, weAsked: true }, null],
    [{ ...F, answer: 'unclear' as const }, null],
    [F, null],
  ])('%j -> %s', (facts, want) => {
    expect(decideEarlyGate(facts)).toBe(want)
  })
})

describe('a whole-message answer outranks a call-off; a mixed one does not', () => {
  const t = (said: string, waiting: boolean) =>
    buildTurn({
      said,
      cleaned: said,
      retraction: null,
      answer: waiting ? answerClause(asHumanWords(said)) : null,
      resolved: { instruction: said, changed: false, from: null },
      addressedTo: null,
      isBranch: false,
    })
  it('bare no with a question waiting', () => {
    expect(answerOutranks(t('No.', true), 'call_off')).toBe(true)
  })
  it('nothing waiting: not an answer', () => {
    expect(answerOutranks(t('No.', false), 'call_off')).toBe(false)
  })
})

describe('the handler cannot reach a consequence-bearing reader directly', () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  it.each([
    'readPlan',
    'wantsAnotherGo',
    'callsItOff',
    'populateRequest',
    'connectRequest',
    'linkRequest',
    'pageRequest',
    'readCorrection',
    'readTeaching',
    'spokenAnswer',
  ])('does not import %s', (name) => {
    const imports = code.match(/^import[\s\S]*?from '[^']+'/gm) ?? []
    expect(imports.filter((i) => new RegExp(`\\b${name}\\b`).test(i))).toEqual([])
  })
  it('never hands a resolved paraphrase to an entitled reader', () => {
    expect(code).not.toMatch(/entitled\.\w+\(\s*(?:instruction|turn\.resolved)\b/)
  })
})

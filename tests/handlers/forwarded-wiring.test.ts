import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Forwarded words are content, not intent (Run 5, 0624; the link door, #393). The three writers that used to read
  a forwarded message as his instruction each carry the wired condition - asserted as the expression that gates the
  write, because a name appearing in a file is not evidence that anything calls it.
*/
const src = readFileSync(new URL('../../src/handlers/instruction.ts', import.meta.url), 'utf8')
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('a forwarded turn does not read as his instruction (the class, not three writers)', () => {
  it('asks once, from the durable record, before any reader runs', () => {
    const ask = code.indexOf('select app.job_forwarded(')
    const firstReader = code.indexOf('entitled.anotherGo(turn.kept)')
    expect(ask).toBeGreaterThan(0)
    expect(ask).toBeLessThan(firstReader)
  })
  it('a failed ask reads as forwarded (a permitting guard fails closed); only a missing function reads as not', () => {
    expect(code).toMatch(
      /\.catch\(\(error: unknown\) => !\/42883\|does not exist\/i\.test\(String\(\(error as Error\)\.message\)\)\)/,
    )
  })
  it('every consequence-bearing reader is reached through an `entitled` that is the silent one for a forwarded turn', () => {
    expect(code).toMatch(/const entitled = forwarded \? noneEntitled : allEntitled/)
  })
  it('and the handler still reaches no reader any other way', () => {
    expect(code).not.toMatch(
      /(?<![.\w])(readPlan|populateRequest|connectRequest|linkRequest|pageRequest|callsItOff|readTeaching|readCorrection|wantsAnotherGo|spokenAnswer)\(/,
    )
  })
})

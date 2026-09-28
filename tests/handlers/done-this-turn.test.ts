import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Ledger R42. When a turn both acts and asks, the answering model must be told
  what the office already did, or it answers the performed clause again and
  contradicts the confirmation printed above it. Asserted on the wired
  expression, not the name (CLAUDE.md: assert the call).
*/
const src = readFileSync('src/handlers/instruction.ts', 'utf8')

describe('what this turn already did reaches the answering prompt (R42)', () => {
  it('the confirmation is a system block in the answering messages', () => {
    expect(src).toMatch(
      /\.\.\.\(confirmation === null\s*\?\s*\[\]\s*:\s*\[\s*\{\s*role: 'system' as const,\s*content:\s*'The office has ALREADY done/,
    )
  })
  it('and it is not offered as grounding: the office’s prose is not provenance', () => {
    expect(src).not.toMatch(/\.\.\.\(confirmation === null \? \[\] : \[confirmation\]\)/)
  })
  it('the answering path runs for an act-and-ask turn', () => {
    expect(src).toMatch(/const answering = confirmation === null \|\| alsoAsked/)
  })
  it('a handled call-off leaves the count of wanted work', () => {
    expect(src).toMatch(
      /wantedWork - \(stopped === null \? 0 : 1\) - \(answersDelegation \? delegations : 0\)/,
    )
  })
})

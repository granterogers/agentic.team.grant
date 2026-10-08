/**
 * The backup-model policy is wired where the answer is written, where authority is decided and where the router answers (#444).
 *
 * Asserted on the expressions that act, not on names appearing in a file: each is what a sabotage has to remove.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const handler = readFileSync('src/handlers/instruction.ts', 'utf8')
const approval = readFileSync('src/agents/approval.ts', 'utf8')
const router = readFileSync('src/providers/router.ts', 'utf8')

describe('the answer', () => {
  it('is checked only when a backup served it', () => {
    expect(handler).toMatch(
      /if \(\(completion\.servedBy\?\.rank \?\? 0\) > 0 && keptRequest !== null\)/,
    )
  })
  it('gets one second opinion from a DIFFERENT model inside a tighter budget', () => {
    expect(handler).toMatch(
      /skipModels: \[completion\.model, \.\.\.\(completion\.servedBy\?\.tried \?\? \[\]\)\],\s+chainBudgetMs: 40_000/,
    )
  })
  it('falls to the limitation composed from the evidence, and says why on the trace', () => {
    expect(handler).toMatch(/said = limitationAnswer\(\{ retrieved: heldTexts \}\)/)
    expect(handler).toMatch(/fallback_answer_refused/)
  })
  it('records the model that actually wrote the delivered answer', () => {
    expect(handler).toMatch(/model: answeredBy\.model,/)
  })
})

describe('authority', () => {
  it('asks the router trace, over the whole conversation, whether a backup served it', () => {
    expect(approval).toMatch(/await fallbackServedTurn\(db, judged\)/)
    expect(approval).toMatch(/t\.kind = 'decision' and t\.detail ->> 'fallback' = 'true'/)
  })
  it('reports its own reason', () => {
    expect(approval).toMatch(/\? 'fallback_model'/)
  })
})

describe('the router', () => {
  it('says where in the measured order an answer sat, and records every fallback on the job trace', () => {
    expect(router).toMatch(
      /servedBy: \{ rank, tried: \[\.\.\.skip, \.\.\.tried\.slice\(0, -1\)\] \}/,
    )
    expect(router).toMatch(/\.\.\.\(rank > 0 \? \{ fallback: true, rank \} : \{\}\)/)
  })
  it('never offers a model that was asked to be skipped', () => {
    expect(router).toMatch(/ordered\.filter\(\(m\) => !skip\.has\(m\)\)/)
  })
})

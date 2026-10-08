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
  it("admits the promise gate's rewrite too when a backup wrote it, and ends at the composed truth if refused", () => {
    expect(handler).toMatch(
      /if \(\(redo\.servedBy\?\.rank \?\? 0\) > 0 && !admit\(rewritten\)\.ok\) return ''/,
    )
  })
  it('records the model that actually wrote the delivered answer, and none for the text composed in code', () => {
    expect(handler).toMatch(/model: wroteInCode \? null : answeredBy\.model,/)
  })
})

describe('what counts as asking for a change', () => {
  it('a noun in a question about the contract is not a request (the real C2 sentence)', async () => {
    const { WRITING_WORDS } = await import('../../src/handlers/instruction.ts')
    for (const q of [
      'Is there a cancellation cap in the venue contract?',
      'What is the booking fee and when is the confirmation due?',
      // A word that is both noun and verb ("the changes") cannot be told apart lexically; it errs towards "may be a
      // request", which admits MORE answers, never refuses one. Only the derived nouns above are decidable.
    ])
      expect(WRITING_WORDS.test(q), q).toBe(false)
  })
  it('the verbs that do ask for one still do, in the forms a person types', async () => {
    const { WRITING_WORDS } = await import('../../src/handlers/instruction.ts')
    for (const q of [
      'Remind me about the venue deposit',
      'Can you cancel the booking?',
      'Please add a task for the insurance certificate',
      'Send it to Kevin',
      'Mark the call done',
      'Write me a summary',
    ])
      expect(WRITING_WORDS.test(q), q).toBe(true)
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

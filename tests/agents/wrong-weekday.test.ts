import { describe, expect, it } from 'vitest'
import { wrongWeekday } from '../../src/agents/derivable.js'
import { metadataProblems } from '../../src/agents/quality.js'
import { onDay, taskSpine } from '../../src/handlers/instruction.js'

const now = new Date('2026-09-25T09:00:00Z')

describe('a weekday that contradicts its own date is refused (R39)', () => {
  it.each([
    'Ring the caterers – due 2026-09-28 (Wednesday)',
    'UI probe – due 2026-09-26 (Tuesday)',
    'The deposit is due Friday 28 September.',
    'See you Thu, 30 Sep.',
    'It lands on Tuesday, September 29th... no wait',
  ])('%s', (body) => {
    // 29 Sep 2026 is a Tuesday, so the last one is right: controls below.
    if (body.startsWith('It lands')) expect(wrongWeekday(body, now)).toBeNull()
    else expect(wrongWeekday(body, now)).not.toBeNull()
  })

  // Negative controls: right pairs, and dates or weekdays on their own.
  it.each([
    'Ring the bank – due 2026-09-28 (Monday)',
    'Monday 28 September works.',
    'Sat 26 Sep is the fair.',
    'See you Wed, 30 Sep.',
    'Due 2026-09-28.',
    'Let us do it on Wednesday.',
    'The meeting on the 28th, and another on Wednesday.',
  ])('%s passes', (body) => {
    expect(wrongWeekday(body, now)).toBeNull()
  })

  it('the coherence gate refuses it', () => {
    const problems = metadataProblems({
      body: 'Ring the caterers – due 2026-09-28 (Wednesday)',
      confidence: 'medium',
      evidence: 'inferred',
      sources: [],
      contradictions: null,
      path: 'inference',
    } as never)
    expect(problems.some((p) => /weekday/.test(p.problem))).toBe(true)
  })

  it('the list reaches the model with the weekday already derived', () => {
    expect(onDay('2026-09-26')).toBe('Saturday 26 September')
    const spine = taskSpine([], [], [{ title: 'Ring the bank', due_on: '2026-09-28' } as never], {
      all: 1,
    })
    expect(spine).toContain('Ring the bank (due Monday 28 September, 2026-09-28)')
  })
})

describe('as the model actually writes it (R39)', () => {
  it('non-breaking hyphens in the date', () => {
    expect(wrongWeekday('UI probe – due 2026‑09‑26 (Tuesday)', now)).not.toBeNull()
  })
})

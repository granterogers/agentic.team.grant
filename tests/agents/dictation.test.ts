/**
 * Ledger R27 — a transcript without the noise speech puts into it.
 */
import { describe, expect, it } from 'vitest'
import { cleanDictation } from '../../src/agents/dictation.ts'
import { personalTaskRequest } from '../../src/agents/mine.ts'
import { readRetraction } from '../../src/agents/retraction.ts'

const now = new Date('2026-09-24T10:00:00Z')

describe('fillers, stutters and a date corrected in place', () => {
  it.each([
    [
      'um so can you er add a task to uh chase the the printers',
      'so can you add a task to chase the printers',
    ],
    ['for friday no wait thursday', 'for thursday'],
    ['tomorrow actually no make it monday', 'monday'],
    ['friday, no, sorry, thursday', 'thursday'],
    ['remind me at 3 sorry 4 to call sarah', 'remind me at 4 to call sarah'],
  ])('%s', (said, clean) => {
    expect(cleanDictation(said)).toBe(clean)
  })

  it('the measured case now files the date he ended on', () => {
    const s = cleanDictation('remind me to ring the the bank tomorrow actually no make it monday')
    expect(personalTaskRequest(s, now)).toMatchObject({ title: 'Ring the bank', due: '2026-09-28' })
  })
})

describe('NEGATIVE CONTROL: what is not noise is left alone', () => {
  it.each([
    'I had had enough',
    'that that was the problem',
    'add a task to chase kevin, no actually, email kevin about the quote',
    'the umbrella budget and the error log',
  ])('%s', (said) => {
    expect(cleanDictation(said)).toBe(said)
  })

  it('keeps his punctuation, so the retraction reader reads the same thing', () => {
    const real =
      'Create a task for me and the um... No actually, you know what? Scan the entirety of the Legacy Coaching Project and create appropriate tasks for me to review.'
    expect(readRetraction(cleanDictation(real))?.kept).toBe(readRetraction(real)?.kept)
  })
})

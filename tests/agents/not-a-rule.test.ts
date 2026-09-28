/**
 * Ledger R35 — an always/never sentence that is not a rule for the office.
 * Production stored all four of the first group as standing rules.
 */
import { describe, expect, it } from 'vitest'
import { readTeaching } from '../../src/agents/teaching.ts'

describe('not a rule', () => {
  it.each([
    'Emma never replies before ten, by the way.',
    'Should you always use bullet points?',
    'I never said to use bullet points.',
    'My accountant always sends invoices late.',
    'Kevin always wants everything in bullet points',
    "Last time you said you'd always check with me first",
  ])('%s', (s) => {
    expect(readTeaching(s)).toBeNull()
  })
})

describe('NEGATIVE CONTROL: rules are still rules', () => {
  it.each([
    'From now on, always answer in bullet points.',
    'Always CC me when you email the venue',
    'Please never use emojis in anything you send me',
    'Oliver should always sign off as Oliver',
    'Never put a due date on anything unless I give you one',
  ])('%s', (s) => {
    expect(readTeaching(s)?.kind).toBe('lesson')
  })
  it('an explicit ask to remember a fact is still stored', () => {
    expect(readTeaching('Remember that my accountant always sends invoices late.')?.kind).toBe(
      'lesson',
    )
  })
})

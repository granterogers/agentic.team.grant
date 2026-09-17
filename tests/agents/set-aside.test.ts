/**
 * #242 — the office says which constraint it set aside, or the gate says so.
 *
 * The negative cases outnumber the positive ones on purpose. A gate that fires
 * on a good answer is one somebody switches off, and this repository has paid
 * for that twice: a credential check that matched its own placeholder, and a
 * clock-time check that read a price as a time.
 */
import { describe, expect, it } from 'vitest'
import { formRules, setAsideUnsaid } from '../../src/agents/quality.ts'

const ONE_PARA = ['Keep every answer to a single short paragraph.']
const NO_LISTS = ['No bullet points in anything you send me.']
const SHORT = ['Keep it short.']
const CAPPED = ['Answers under 50 words, always.']

describe('reading the form rules out of standing guidance', () => {
  it('finds the three shapes it can check', () => {
    expect(formRules(ONE_PARA).map((r) => r.kind)).toEqual(['one-paragraph'])
    expect(formRules(NO_LISTS).map((r) => r.kind)).toEqual(['no-lists'])
    expect(formRules(CAPPED)[0]).toMatchObject({ kind: 'short', words: 50 })
  })

  it('and ignores the ones no detector can judge', () => {
    /*
      A rule about CONTENT has no shape to check. Reading one as checkable
      would be the gate inventing a test, which is worse than not having one.
    */
    expect(formRules(['Always consider the margin before recommending a price.'])).toEqual([])
    expect(formRules(['Be sceptical of anything a supplier tells us.'])).toEqual([])
    expect(formRules([''])).toEqual([])
  })
})

describe('a rule broken in silence', () => {
  it('catches a list where one paragraph was asked for', () => {
    const body = 'Here they are:\n\n1. First\n2. Second\n3. Third'
    expect(setAsideUnsaid(body, ONE_PARA)).toBe(ONE_PARA[0])
  })

  it('catches two paragraphs where one was asked for', () => {
    expect(setAsideUnsaid('The first thought.\n\nAnd a second one.', ONE_PARA)).toBe(ONE_PARA[0])
  })

  it('catches bullets against a no-bullets rule', () => {
    expect(setAsideUnsaid('Points:\n- one\n- two', NO_LISTS)).toBe(NO_LISTS[0])
  })

  it('catches an answer well over a stated word cap', () => {
    expect(setAsideUnsaid(`${'word '.repeat(80)}`, CAPPED)).toBe(CAPPED[0])
  })
})

describe('and every way of saying so, which the gate must accept', () => {
  it.each([
    'I cannot keep this to one paragraph, so here they are:\n\n1. First\n2. Second',
    'You asked for a single paragraph and this will not fit in one.\n\n1. First\n2. Second',
    'Normally I would keep this to one paragraph.\n\n1. First\n2. Second',
    'Setting your one-paragraph rule aside for this.\n\n1. First\n2. Second',
  ])('accepts %j', (body) => {
    expect(setAsideUnsaid(body, ONE_PARA)).toBeNull()
  })

  it('accepts an acknowledgement of a length rule in its own words', () => {
    const body = `I know you asked me to keep it short and this one runs long. ${'word '.repeat(80)}`
    expect(setAsideUnsaid(body, CAPPED)).toBeNull()
  })
})

describe('and the answers it must never touch', () => {
  it('says nothing when the rule was kept', () => {
    expect(setAsideUnsaid('One paragraph, as asked, and nothing else.', ONE_PARA)).toBeNull()
    expect(setAsideUnsaid('No bullets here at all.', NO_LISTS)).toBeNull()
    expect(setAsideUnsaid('Short.', CAPPED)).toBeNull()
  })

  it('says nothing when no rule was in force', () => {
    const listy = 'Here they are:\n\n1. First\n2. Second'
    expect(setAsideUnsaid(listy, [])).toBeNull()
    expect(setAsideUnsaid(listy, ['Always consider the margin.'])).toBeNull()
  })

  it('says nothing about an empty answer, which is a different defect', () => {
    expect(setAsideUnsaid('', ONE_PARA)).toBeNull()
    expect(setAsideUnsaid('   ', ONE_PARA)).toBeNull()
  })

  it('does not read a hyphen mid-sentence as a list', () => {
    /*
      The marker has to START a line. An em-dashed aside and a hyphenated word
      are both commoner than a list and neither is one.
    */
    expect(setAsideUnsaid('A single paragraph - with an aside - and no list.', ONE_PARA)).toBeNull()
    expect(setAsideUnsaid('One paragraph about the up-to-date figures.', NO_LISTS)).toBeNull()
  })

  it('does not treat a generously-long answer as breaking a vague short rule', () => {
    /*
      "Keep it short" has no number in it, so the number is invented and has to
      be large enough that only an answer nobody would call short trips it.
    */
    expect(setAsideUnsaid('word '.repeat(150), SHORT)).toBeNull()
    expect(setAsideUnsaid('word '.repeat(300), SHORT)).toBe(SHORT[0])
  })
})

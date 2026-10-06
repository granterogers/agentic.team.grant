import { describe, expect, it } from 'vitest'
import { entitled, noneEntitled } from '../../src/agents/entitled.ts'
import {
  chooseStyleSource,
  type StyleSourceCandidate,
  styleKeepRequest,
} from '../../src/agents/style-keep.ts'
import { asHumanWords } from '../../src/agents/turn.ts'

const read = (t: string) => styleKeepRequest(asHumanWords(t))

describe('styleKeepRequest: the natural ways of saying it', () => {
  const POSITIVE = [
    "Use this report's style for this project.",
    'Save this as the project report style.',
    'I like this design — use it for future reports in this project.',
    'I like this design, use it for future reports in this project.',
    'I love this look. Use it for all future reports in this project.',
    'Make this the default style for my reports',
    'Keep this design for the project',
    'Save this report’s style',
    'Remember this report format for this project',
    'Can you use this report’s look for future reports?',
    'Please save the style of this report as the default for this project, thanks',
    'ok, use this report’s design going forward',
    'Adopt this report’s layout for this project',
    'Use this as the project style',
  ]
  for (const t of POSITIVE) {
    it(`reads: ${t}`, () => {
      expect(read(t)).not.toBeNull()
    })
  }

  it('names the report when he does', () => {
    expect(read("Use the pricing report's style for this project")?.hint).toBe('pricing')
    expect(read('Save the style of the onboarding report for this project')?.hint).toBe(
      'onboarding',
    )
    expect(read("Use this report's style for this project")?.hint).toBeNull()
  })

  it('says when the message held more than the request, so the reply can say the rest was not done', () => {
    expect(read("Use this report's style for this project.")?.onlyThat).toBe(true)
    expect(read("Use this report's style for this project, thanks!")?.onlyThat).toBe(true)
    expect(
      read("Use this report's style for this project and create tasks for the venue")?.onlyThat,
    ).toBe(false)
    expect(
      read("Use this report's style for this project. Also remind me to call Kevin.")?.onlyThat,
    ).toBe(false)
  })
})

describe('styleKeepRequest: the negative controls (recall was not bought with precision)', () => {
  const NEGATIVE = [
    'Save this as a PDF',
    'Save this as a template',
    'Use a different style',
    'Use a different style for this project',
    'Use the new style for this project',
    'Make this report’s style bolder',
    'Keep this design but change the title',
    'Apply this style to the report',
    'How do I save this report’s style?',
    'What does saving a style do?',
    'Don’t save this style for this project',
    'Never use this report’s style for this project',
    'I like this design',
    'Save this',
    'Use this style',
    'Make this report longer',
    'Save the report',
    'Create a new design for this project',
    'Send me the report',
    'What is the style of this report?',
    'Should we use this report’s style for the project?',
    'Change the style of this report',
    'Remind me to save this report’s style',
  ]
  for (const t of NEGATIVE) {
    it(`does not read: ${t}`, () => {
      expect(read(t)).toBeNull()
    })
  }
})

describe('a style request is his words only', () => {
  it('is reached through entitled, and a forwarded message is silent', () => {
    const w = asHumanWords("Use this report's style for this project.")
    expect(entitled.keepStyle(w)).not.toBeNull()
    expect(noneEntitled.keepStyle(w)).toBeNull()
  })
})

const c = (
  id: string,
  title: string,
  o: Partial<StyleSourceCandidate> = {},
): StyleSourceCandidate => ({
  documentId: id,
  title,
  createdAt: '2026-10-01T00:00:00Z',
  inThread: false,
  hasSnapshot: true,
  ...o,
})

describe('chooseStyleSource: this one, or ask, never guess', () => {
  it('uses the one report this conversation produced', () => {
    const r = chooseStyleSource([c('a', 'Pricing', { inThread: true }), c('b', 'Onboarding')], null)
    expect(r).toMatchObject({ kind: 'one', candidate: { documentId: 'a' } })
  })
  it('uses the only report the project has', () => {
    expect(chooseStyleSource([c('a', 'Pricing')], null)).toMatchObject({ kind: 'one' })
  })
  it('asks when two were produced here', () => {
    const r = chooseStyleSource(
      [c('a', 'A', { inThread: true }), c('b', 'B', { inThread: true })],
      null,
    )
    expect(r).toMatchObject({ kind: 'ask', why: 'several_in_thread' })
  })
  it('asks when none was produced here and the project has several', () => {
    expect(chooseStyleSource([c('a', 'A'), c('b', 'B')], null)).toMatchObject({
      kind: 'ask',
      why: 'several_in_project',
    })
  })
  it('says there is nothing when the project has no made report', () => {
    expect(chooseStyleSource([], null)).toEqual({ kind: 'none', why: 'no_reports' })
  })
  it('a name narrows to one, to none, or to several (and several is asked)', () => {
    const all = [c('a', 'Pricing review'), c('b', 'Onboarding findings'), c('d', 'Pricing history')]
    expect(chooseStyleSource(all, 'onboarding')).toMatchObject({
      kind: 'one',
      candidate: { documentId: 'b' },
    })
    expect(chooseStyleSource(all, 'budget')).toEqual({ kind: 'none', why: 'hint_matches_none' })
    expect(chooseStyleSource(all, 'pricing')).toMatchObject({
      kind: 'ask',
      why: 'hint_matches_several',
    })
    expect(chooseStyleSource(all, 'pricing review')).toMatchObject({ kind: 'one' })
  })
  it('a name beats the thread (he said which)', () => {
    const r = chooseStyleSource(
      [c('a', 'Pricing', { inThread: true }), c('b', 'Onboarding')],
      'onboarding',
    )
    expect(r).toMatchObject({ kind: 'one', candidate: { documentId: 'b' } })
  })
  it('does not count one document twice', () => {
    expect(chooseStyleSource([c('a', 'A'), c('a', 'A')], null)).toMatchObject({ kind: 'one' })
  })
  it('a report in the thread with no recorded style is still THE report (the save says why it cannot)', () => {
    const r = chooseStyleSource(
      [c('a', 'Old', { inThread: true, hasSnapshot: false }), c('b', 'New')],
      null,
    )
    expect(r).toMatchObject({ kind: 'one', candidate: { documentId: 'a' } })
  })
})

import { describe, expect, it } from 'vitest'
import { entitled, noneEntitled } from '../../src/agents/entitled.ts'
import { asHumanWords } from '../../src/agents/turn.ts'

/*
  Forwarded words are content, not intent. For a forwarded turn the handler is handed `noneEntitled`; this pins that
  it has EVERY reader the real object has (the type guarantees the keys; this guarantees nobody added one and gave
  it a real body) and that each is silent for the sentences the real readers accept.
*/
const SAMPLES = [
  'Create a notebook called Launch and add the sources from the project, then make a slide deck.',
  'Connect this project to the Notion database https://www.notion.so/Plan-0123456789abcdef0123456789abcdef',
  'Save this link https://example.com/a to the project notebook',
  'Read https://example.com/page for me',
  'Stop working on the venue report',
  'From now on always put the conclusion first',
  'That is not what I meant at all',
  'Give it another go',
  'yes',
]
describe('noneEntitled', () => {
  it('has exactly the readers entitled has', () => {
    expect(Object.keys(noneEntitled).sort()).toEqual(Object.keys(entitled).sort())
  })
  it('is silent for every sample', () => {
    for (const text of SAMPLES) {
      const w = asHumanWords(text)
      expect(noneEntitled.plan(w)).toBeNull()
      expect(noneEntitled.populate(w)).toBe(false)
      expect(noneEntitled.connect(w)).toBeNull()
      expect(noneEntitled.link(w)).toBeNull()
      expect(noneEntitled.page(w)).toBeNull()
      expect(noneEntitled.callsItOff(w)).toBeNull()
      expect(noneEntitled.teaching(w)).toBeNull()
      expect(noneEntitled.correction(w, true)).toBeNull()
      expect(noneEntitled.anotherGo(w)).toBeNull()
      expect(noneEntitled.answer(w)).toBeNull()
    }
  })
  it('the control: the real readers are NOT silent for these samples (the test can fail)', () => {
    const live = SAMPLES.filter((t) => {
      const w = asHumanWords(t)
      return (
        entitled.plan(w) !== null ||
        entitled.populate(w) !== false ||
        entitled.connect(w) !== null ||
        entitled.link(w) !== null ||
        entitled.page(w) !== null ||
        entitled.callsItOff(w) !== null ||
        entitled.teaching(w) !== null ||
        entitled.correction(w, true) !== null ||
        entitled.anotherGo(w) !== null ||
        entitled.answer(w) !== null
      )
    })
    expect(live.length).toBeGreaterThanOrEqual(5)
  })
})

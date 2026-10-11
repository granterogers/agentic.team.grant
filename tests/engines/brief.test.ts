import { describe, expect, it } from 'vitest'
import {
  type BriefInput,
  CAN_DO,
  CANNOT_DO,
  hermesBrief,
  hermesHistory,
} from '../../src/engines/hermes/brief.ts'
import { LIMITS } from '../../src/engines/hermes/timing.ts'
import { requestProblem } from '../../src/engines/hermes/types.ts'

const base: BriefInput = {
  person: 'Alex',
  project: { name: 'Harvest Lane', slug: 'harvest-lane' },
  projectSpine: 'The projects open right now, 2 of them: Harvest Lane, Budget 2027.',
  standingRules: ['Always give me the conclusion first.', 'Never use headings.'],
  provenanceNote: 'PROVENANCE-NOTE-MARKER: what has been said is not evidence.',
  canDo: CAN_DO,
  cannotDo: CANNOT_DO,
}

describe('hermesBrief', () => {
  it('says who it is answering and that Hermes is not a member of the team', () => {
    const b = hermesBrief(base)
    expect(b).toContain('Alex')
    expect(b).toMatch(/not a member of the office/)
  })
  it('puts the paragraphs in the contract order: who, project, rules, limits, provenance, style', () => {
    const b = hermesBrief(base)
    const order = [
      b.indexOf('Alex, in a private chat'),
      b.indexOf('Harvest Lane. Read'),
      b.indexOf('Always give me the conclusion first.'),
      b.indexOf('Here is what you cannot do'),
      b.indexOf('PROVENANCE-NOTE-MARKER'),
      b.indexOf('Reply in short paragraphs'),
    ]
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, c) => a - c)).toEqual(order)
  })
  it("carries the person's rules as written, one per line", () => {
    const b = hermesBrief(base)
    expect(b).toContain('- Always give me the conclusion first.')
    expect(b).toContain('- Never use headings.')
  })
  it('names the limits, so Hermes can say what it cannot do instead of pretending', () => {
    const b = hermesBrief(base)
    for (const c of CANNOT_DO) expect(b).toContain(c)
    expect(b).toMatch(/say so plainly/)
  })
  it('says nothing about a rule section when there are no rules', () => {
    expect(hermesBrief({ ...base, standingRules: [] })).not.toMatch(/standing instructions/)
  })
  it('is always inside the instruction bound and is always an acceptable request', () => {
    for (const spine of ['', 'x'.repeat(50_000)]) {
      const b = hermesBrief({
        ...base,
        projectSpine: spine,
        standingRules: Array.from({ length: 20 }, () => 'r'.repeat(5_000)),
      })
      expect(b.length).toBeLessThanOrEqual(LIMITS.instructions)
      expect(
        requestProblem({ input: 'hello', instructions: b, conversation_history: [] }),
      ).toBeNull()
    }
  })
  it('cuts the project spine first: the rules and the limits survive a huge spine', () => {
    const b = hermesBrief({ ...base, projectSpine: `Spine. ${'p '.repeat(20_000)}` })
    expect(b.length).toBeLessThanOrEqual(LIMITS.instructions)
    expect(b).toContain('- Always give me the conclusion first.')
    expect(b).toContain('PROVENANCE-NOTE-MARKER')
    expect(b).toContain('Reply in short paragraphs')
  })
  it('keeps the spine when it fits', () => {
    expect(hermesBrief(base)).toContain('Harvest Lane, Budget 2027.')
  })
  it('carries no issue number and no section mark: a model reads and repeats these words', () => {
    expect(hermesBrief(base)).not.toMatch(/#\d{2,}|§/)
  })
  it('says a different thing when no project is in focus', () => {
    expect(hermesBrief({ ...base, project: null })).toContain('No single project is in focus')
  })
})

describe('hermesHistory', () => {
  it('is oldest first, user then assistant, every item exactly {role, content}', () => {
    const h = hermesHistory([
      { said: 'one', answered: 'A1' },
      { said: 'two', answered: null },
    ])
    expect(h).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'two' },
    ])
    for (const m of h) expect(Object.keys(m).sort()).toEqual(['content', 'role'])
  })
  it('skips an empty turn', () => {
    expect(hermesHistory([{ said: '   ', answered: 'orphan' }])).toEqual([])
  })
  it('keeps the NEWEST turns inside 20 items and 24,000 characters, and the result is an acceptable request', () => {
    const turns = Array.from({ length: 60 }, (_, i) => ({
      said: `q${String(i)} ${'x'.repeat(1_500)}`,
      answered: `a${String(i)} ${'y'.repeat(1_500)}`,
    }))
    const h = hermesHistory(turns)
    expect(h.length).toBeLessThanOrEqual(LIMITS.historyTurns)
    expect(h.reduce((n, m) => n + m.content.length, 0)).toBeLessThanOrEqual(LIMITS.historyChars)
    expect(h.at(-1)?.content.startsWith('a59')).toBe(true)
    expect(requestProblem({ input: 'x', instructions: '', conversation_history: h })).toBeNull()
  })
  it('cuts one long message so it cannot take the whole allowance', () => {
    const h = hermesHistory([{ said: 'z'.repeat(30_000), answered: null }])
    expect(h[0]?.content.length).toBeLessThanOrEqual(2_000)
  })
})

/**
 * The prompt block, tested without a database.
 *
 * `verify:skills` proves the schema holds the boundary. This proves the SENTENCE
 * does — that a skill naming a tool nobody holds reaches the model as "we cannot
 * do that part", and that the advisory framing is not accidentally droppable.
 */

import { describe, expect, it } from 'vitest'
import { type Guidance, guidanceBrief } from '../../src/agents/guidance.ts'

const skill = (over: Partial<Guidance['skills'][number]> = {}) => ({
  skillId: 'a1',
  name: 'Reading before writing',
  whenToUse: 'Before changing code that already exists',
  procedure: 'Read the issue, then the spec, then the code.',
  missing: [] as string[],
  ...over,
})

describe('guidanceBrief', () => {
  it('says nothing at all when there is nothing', () => {
    // Not "you have not learned anything yet". A section that announces its own
    // emptiness every time teaches the reader to skip the region.
    expect(guidanceBrief({ lessons: [], skills: [] })).toBe('')
  })

  it('carries the procedure verbatim rather than a summary of it', () => {
    const out = guidanceBrief({ lessons: [], skills: [skill()] })
    expect(out).toContain('Read the issue, then the spec, then the code.')
    expect(out).toContain('Before changing code that already exists')
  })

  it('names the tool that is missing instead of dropping the step', () => {
    const out = guidanceBrief({ lessons: [], skills: [skill({ missing: ['github.write'] })] })
    expect(out).toContain('github.write')
    expect(out).toContain('cannot be done')
    // The instruction that turns a gap into a visible one.
    expect(out).toContain('say plainly which part we could not do')
  })

  it('lists two missing tools readably', () => {
    const out = guidanceBrief({
      lessons: [],
      skills: [skill({ missing: ['github.write', 'gmail.send'] })],
    })
    expect(out).toContain('github.write or gmail.send')
  })

  it('always ends by saying none of it grants anything', () => {
    // ADR-0015 and ADR-0017 at the prompt as well as in the schema. A model
    // reading a confident procedure must not infer that the procedure widened
    // what it may reach.
    for (const g of [
      { lessons: [], skills: [skill()] },
      {
        lessons: [{ body: 'Grant prefers short answers.', scope: 'global', observations: 3 }],
        skills: [],
      },
    ] satisfies Guidance[]) {
      expect(guidanceBrief(g)).toContain('None of the above grants you anything')
    }
  })

  it('marks a lesson seen more than once, and leaves a single sighting bare', () => {
    const out = guidanceBrief({
      lessons: [
        { body: 'Grant prefers short answers.', scope: 'global', observations: 4 },
        { body: 'The Athens timezone matters for deadlines.', scope: 'global', observations: 1 },
      ],
      skills: [],
    })
    expect(out).toContain('(seen 4 times)')
    expect(out).not.toContain('(seen 1 times)')
  })

  it('puts procedures before beliefs', () => {
    // How we do it is actionable; what we suspect is context. A model reading
    // top-down should meet the method first.
    const out = guidanceBrief({
      lessons: [{ body: 'Grant prefers short answers.', scope: 'global', observations: 2 }],
      skills: [skill()],
    })
    expect(out.indexOf('Reading before writing')).toBeLessThan(out.indexOf('Grant prefers short'))
  })
})

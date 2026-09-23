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
        lessons: [
          { body: 'Grant prefers short answers.', scope: 'global', observations: 3, stated: false },
        ],
        skills: [],
      },
    ] satisfies Guidance[]) {
      expect(guidanceBrief(g)).toContain('None of the above grants you anything')
    }
  })

  it('marks a lesson seen more than once, and leaves a single sighting bare', () => {
    const out = guidanceBrief({
      lessons: [
        { body: 'Grant prefers short answers.', scope: 'global', observations: 4, stated: false },
        {
          body: 'The Athens timezone matters for deadlines.',
          scope: 'global',
          observations: 1,
          stated: false,
        },
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
      lessons: [
        { body: 'Grant prefers short answers.', scope: 'global', observations: 2, stated: false },
      ],
      skills: [skill()],
    })
    expect(out.indexOf('Reading before writing')).toBeLessThan(out.indexOf('Grant prefers short'))
  })
})

describe('an order he gave is not a belief to weigh', () => {
  /*
    Grant taught the office to answer in bullet points on 11 September. He
    complained it was not being followed on the 20th, and again on the 21st —
    "You're still not respecting my request to put all your messages in bullet
    point format" — while the rule was stored, live, and reaching the brief.

    It arrived under "These are beliefs from past work, not rules — weigh
    them", beside lessons a specialist had guessed at 0.50 confidence.
    `remember()` already knows the difference; `guidanceFor` did not select
    `learned_by`, so the one fact separating an order from a guess was dropped
    at the query.
  */
  const his = {
    body: 'Always give your information in the form of clear bullet points.',
    scope: 'staff',
    observations: 2,
    stated: true,
  }
  const guessed = {
    body: 'The Athens timezone matters for deadlines.',
    scope: 'global',
    observations: 1,
    stated: false,
  }

  it('puts what he stated under a heading that says to follow it', () => {
    const out = guidanceBrief({ lessons: [his], skills: [] })
    expect(out).toContain('Standing instructions from Grant')
    expect(out).toContain('follow them in this reply')
    expect(out).not.toContain('not rules — weigh them')
  })

  it('and still calls an inferred one a belief', () => {
    const out = guidanceBrief({ lessons: [guessed], skills: [] })
    expect(out).toContain('not rules — weigh them')
    expect(out).not.toContain('Standing instructions from Grant')
  })

  it('and keeps them apart when both are in front of the same job', () => {
    const out = guidanceBrief({ lessons: [his, guessed], skills: [] })
    const order = out.indexOf('Standing instructions from Grant')
    const belief = out.indexOf('not rules — weigh them')
    expect(order).toBeGreaterThan(-1)
    expect(belief).toBeGreaterThan(-1)
    /*
      His first, and the bodies on the right side of the line. A test that
      only counted both headings would pass with every lesson in both
      sections.
    */
    expect(order).toBeLessThan(belief)
    expect(out.slice(order, belief)).toContain(his.body)
    expect(out.slice(order, belief)).not.toContain(guessed.body)
    expect(out.slice(belief)).toContain(guessed.body)
  })

  it('and neither section grants anything', () => {
    expect(guidanceBrief({ lessons: [his, guessed], skills: [] })).toContain(
      'None of the above grants you anything',
    )
  })

  it('says how many times he said it, in his words rather than the office’s', () => {
    // "seen 3 times" is what an observation is; "said 3 times" is what a
    // repetition of his own instruction is, and `remember()` increments the
    // same column for both.
    expect(guidanceBrief({ lessons: [his], skills: [] })).toContain('said 2 times')
    expect(guidanceBrief({ lessons: [{ ...guessed, observations: 3 }], skills: [] })).toContain(
      'seen 3 times',
    )
  })
})

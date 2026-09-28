import { describe, expect, it } from 'vitest'
import { asksForWriting } from '../../src/agents/goal.js'

describe('a result he wants to keep is a written one (R47)', () => {
  it.each([
    'Go through the onboarding material for this project and then work out what is out of date in it, so that I have something concrete to pick up later.',
    'Look through the contracts and pull out the renewal dates so I have something I can come back to.',
    'Check the budget against the quotes and give me something I can work from on Monday.',
    'Read the minutes and list the open actions for later.',
    'Go over the feedback and put the themes somewhere I can refer back to.',
  ])('%s', (said) => {
    expect(asksForWriting(said)).toBe(true)
  })
  // Negative controls: R22's cases, analysis told to him now, stay undrafted.
  it.each([
    'Go through the onboarding material and tell me what is out of date.',
    'Work out what share of the £20,000 budget the deposit is.',
    'Look at the venue terms and tell me if the deposit is refundable.',
    'Find out when the printers can deliver, then tell me if Saturday works.',
  ])('%s is analysis told to him, not a draft', (said) => {
    expect(asksForWriting(said)).toBe(false)
  })
})

describe('and "to keep" meaning to continue is not a request to write (R47, measured)', () => {
  it('his own sentence', () => {
    expect(
      asksForWriting(
        'Grant is weighing whether to keep building this system or buy an off-the-shelf one instead.',
      ),
    ).toBe(false)
  })
})

import { withoutUnaskedDrafts } from '../../src/agents/goal.js'

describe("the plan verify:composes saw survives R22's filter (R47)", () => {
  const plan = {
    goal: 'find what is out of date',
    steps: [
      {
        id: 's1',
        capability: 'notebook.read',
        why: 'read the onboarding material',
        needs: [],
        specialist: null,
      },
      {
        id: 's2',
        capability: 'draft.create',
        why: 'write up what is out of date',
        needs: ['s1'],
        specialist: null,
      },
    ],
    unreachable: [],
    refused: [],
    how: 'model',
  } as never
  it('kept when he asks for something to pick up later', () => {
    const said =
      'Go through the onboarding material for this project and then work out what is out of date in it, so that I have something concrete to pick up later.'
    expect(withoutUnaskedDrafts(plan, said).steps).toHaveLength(2)
  })
  it('still dropped when he asks to be told (R22 unchanged)', () => {
    const said = 'Go through the onboarding material and tell me what is out of date.'
    expect(withoutUnaskedDrafts(plan, said).steps).toHaveLength(1)
  })
})

import { describe, expect, it } from 'vitest'
import { asksForWriting, type GoalPlan, withoutUnaskedDrafts } from '../../src/agents/goal.ts'

const plan = (steps: { id: string; capability: string; needs?: string[] }[]): GoalPlan =>
  ({
    goal: 'g',
    steps: steps.map((s) => ({ why: s.id, specialist: null, audience: 'office', needs: [], ...s })),
    unreachable: [],
    refused: [],
    how: 'model',
    why: null,
    model: null,
  }) as unknown as GoalPlan

describe('a draft is only for a request to WRITE something (ledger R22)', () => {
  it('the measured plans: analysis told to him is not a draft', () => {
    for (const request of [
      'Get Emma to dig out what the Holloway Barn deposit is from our documents, and then have Daniel work out what share of a £20,000 event budget that deposit is.',
      'Go through the onboarding material for this project and then tell me what is out of date',
    ]) {
      const got = withoutUnaskedDrafts(
        plan([
          { id: 's1', capability: 'notebook.read' },
          { id: 's2', capability: 'draft.create', needs: ['s1'] },
        ]),
        request,
      )
      expect(got.steps.map((s) => s.capability)).toEqual(['notebook.read'])
      expect(got.refused.join(' ')).toContain('nobody asked for')
    }
  })

  it('and a step that needed the dropped draft goes with it', () => {
    const got = withoutUnaskedDrafts(
      plan([
        { id: 's1', capability: 'db.read' },
        { id: 's2', capability: 'draft.create', needs: ['s1'] },
        { id: 's3', capability: 'task.create', needs: ['s2'] },
      ]),
      'look at the numbers and tell me',
    )
    expect(got.steps.map((s) => s.id)).toEqual(['s1'])
  })

  it.each([
    'Draft the announcement email for the pricing change',
    'Write me a one-pager on where the venue thing has got to',
    'put together a short summary I can send the board',
    'Prepare the reply to the landlord',
  ])('NEGATIVE CONTROL: a writing request keeps its draft: %s', (request) => {
    expect(asksForWriting(request)).toBe(true)
    const p = plan([
      { id: 's1', capability: 'db.read' },
      { id: 's2', capability: 'draft.create', needs: ['s1'] },
    ])
    expect(withoutUnaskedDrafts(p, request)).toBe(p)
  })
})

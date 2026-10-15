import { describe, expect, it } from 'vitest'
import {
  type StepApprovalContext,
  stepActionBinds,
  stepActionFingerprint,
  stepLegacyFingerprint,
} from '../../src/agents/step-approval.ts'

/*
  COS-092 / COS-093 / REG-006. Behavioural: these call the real functions and compare fingerprints. They do
  not read source text, so a refactor that keeps the behaviour keeps them green and a regression turns them red.
*/

const base: StepApprovalContext = {
  projectId: '11111111-1111-4111-8111-111111111111',
  request: 'Create a comparison document of the replies',
  step: {
    id: 's1',
    capability: 'document.write',
    why: 'Write up the replies so Grant can compare them',
    needs: ['doc:aaa'],
    audience: 'office',
    specialist: 'research-director',
  },
}

const withStep = (patch: Partial<StepApprovalContext['step']>): StepApprovalContext => ({
  ...base,
  step: { ...base.step, ...patch },
})

describe('a regenerated plan that says the same work again', () => {
  it('keeps the same approval identity when the step id is renumbered', async () => {
    expect(await stepActionFingerprint(withStep({ id: 's4' }))).toBe(
      await stepActionFingerprint(base),
    )
  })

  it('a reworded reason for INTERNAL work keeps its approval: the same effect, described differently (DEC-014)', async () => {
    expect(
      await stepActionFingerprint(
        withStep({ why: 'Draft the summary so the replies can be compared' }),
      ),
    ).toBe(await stepActionFingerprint(base))
  })

  it('a reworded reason for work that REACHES OUTSIDE is asked again: the words are what he agreed to (DEC-014)', async () => {
    const outside = withStep({ audience: 'outside' })
    expect(
      await stepActionFingerprint({
        ...outside,
        step: { ...outside.step, why: 'Send the summary to the venue' },
      }),
    ).not.toBe(await stepActionFingerprint(outside))
  })

  it('keeps the same approval identity when the request wording changes but the step has a reason', async () => {
    expect(
      await stepActionFingerprint({
        ...base,
        request: 'Compare what everyone replied, in a document',
      }),
    ).toBe(await stepActionFingerprint(base))
  })
})

describe('a change that IS a different piece of work', () => {
  it('a different capability is a different approval', async () => {
    expect(await stepActionFingerprint(withStep({ capability: 'task.create' }))).not.toBe(
      await stepActionFingerprint(base),
    )
  })

  it('a different project is a different approval', async () => {
    expect(
      await stepActionFingerprint({ ...base, projectId: '22222222-2222-4222-8222-222222222222' }),
    ).not.toBe(await stepActionFingerprint(base))
  })

  it('a different specialist (who acts) is a different approval', async () => {
    expect(await stepActionFingerprint(withStep({ specialist: 'quality-director' }))).not.toBe(
      await stepActionFingerprint(base),
    )
  })

  it('a different audience (who it reaches) is a different approval', async () => {
    expect(await stepActionFingerprint(withStep({ audience: 'outside' }))).not.toBe(
      await stepActionFingerprint(base),
    )
  })

  it('different inputs are a different approval', async () => {
    expect(await stepActionFingerprint(withStep({ needs: ['doc:bbb'] }))).not.toBe(
      await stepActionFingerprint(base),
    )
  })

  it('a step with no reason is identified by its request, so a changed request is a different approval', async () => {
    const noReason = withStep({ why: '' })
    expect(await stepActionFingerprint(noReason)).not.toBe(
      await stepActionFingerprint({ ...noReason, request: 'Delete the old drafts' }),
    )
  })
})

describe('the legacy shape keeps matching what was already asked', () => {
  it('the legacy identity still follows the planner id, as every question before it did', async () => {
    expect(await stepLegacyFingerprint(withStep({ id: 's4' }))).not.toBe(
      await stepLegacyFingerprint(base),
    )
  })

  it('the legacy identity is distinct from the material identity, so the two never collide by accident', async () => {
    expect(await stepLegacyFingerprint(base)).not.toBe(await stepActionFingerprint(base))
  })

  it('internal work binds no planner position or reason: neither the step id nor the why is in it', () => {
    const binds = stepActionBinds(base) as Record<string, unknown>
    expect(Object.keys(binds).sort()).toEqual([
      'audience',
      'capability',
      'needs',
      'project',
      'specialist',
    ])
  })

  it('outside work binds its reason as well, and still never the step id', () => {
    const binds = stepActionBinds(withStep({ audience: 'outside' })) as Record<string, unknown>
    expect(Object.keys(binds).sort()).toEqual([
      'audience',
      'capability',
      'needs',
      'project',
      'specialist',
      'why',
    ])
  })

  it('an approval given to one reason does not carry to a different reason for outside work', async () => {
    const cancel = withStep({
      audience: 'outside',
      why: 'Email the caterer about cancelling the order',
    })
    const allergy = withStep({
      audience: 'outside',
      why: 'Email the caterer about the allergy list',
    })
    expect(await stepActionFingerprint(cancel)).not.toBe(await stepActionFingerprint(allergy))
  })
})

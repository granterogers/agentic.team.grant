/**
 * WAS THE GOAL MET, AND MAY THE OFFICE TRY AGAIN? (#283)
 *
 * `assess` is the only thing standing between "every step ended" and "Grant
 * got what he asked for", and it is also the gate on bounded re-planning —
 * `worthAnotherRoute` is what decides whether the office spends another model
 * call and another round of actions.
 *
 * So each verdict has a case, and each has a counterpart. A function that said
 * `satisfied` for everything would pass a file of satisfied cases, and one
 * that said `worthAnotherRoute` for everything would turn every refusal into a
 * loop — which is the failure the bounds exist for and the one this file must
 * be able to see.
 */
import { describe, expect, it } from 'vitest'
import type { GoalPlan } from '../../src/agents/goal.ts'
import type { Observation } from '../../src/agents/perform.ts'
import { assess } from '../../src/agents/satisfied.ts'

const step = (id: string, capability: string, why = `do ${id}`) => ({
  id,
  capability,
  why,
  needs: [] as readonly string[],
  specialist: null,
  audience: 'grant' as const,
})

const planOf = (steps: ReturnType<typeof step>[], unreachable: string[] = []): GoalPlan => ({
  goal: 'bring the handbook up to date',
  steps,
  unreachable,
  refused: [],
  how: 'model',
  why: null,
  model: 'test/model',
})

const found = (capability: string, ids: string[] = ['id-1']): Observation => ({
  capability,
  found: true,
  ids,
  saw: `what ${capability} found`,
})
const missed = (capability: string, impediment: string): Observation => ({
  capability,
  found: false,
  ids: [],
  saw: '',
  impediment,
})

const done = { kind: 'done' as const }

describe('the seven answers are actually distinguished', () => {
  it('satisfied: everything produced, and something was left behind', () => {
    const plan = planOf([step('look', 'db.read'), step('note', 'task.create')])
    const got = assess(
      plan,
      { 'look:db.read': found('db.read'), 'note:task.create': found('task.create', ['task-9']) },
      done,
    )
    expect(got.verdict).toBe('satisfied')
    expect(got.unmet).toHaveLength(0)
    expect(got.worthAnotherRoute).toBe(false)
  })

  it('partially satisfied: one step produced and one did not, and another route is worth trying', () => {
    const plan = planOf([step('look', 'db.read'), step('note', 'task.create')])
    const got = assess(
      plan,
      {
        'look:db.read': found('db.read'),
        'note:task.create': missed('task.create', 'the writer refused it'),
      },
      done,
    )
    expect(got.verdict).toBe('partially_satisfied')
    expect(got.unmet).toContain('do note')
    expect(got.worthAnotherRoute).toBe(true)
  })

  it('awaiting Grant: a pause for approval is not a failure, and is not re-planned around', () => {
    const plan = planOf([step('look', 'db.read'), step('note', 'task.create')])
    const got = assess(
      plan,
      { 'look:db.read': found('db.read') },
      {
        kind: 'paused',
        pauseReason: 'awaiting_approval',
      },
    )
    expect(got.verdict).toBe('awaiting_grant')
    /*
      THE IMPORTANT HALF. He has to answer; another route would be the office
      going around him, which is the one thing an approval gate must prevent.
    */
    expect(got.worthAnotherRoute).toBe(false)
  })

  it('temporarily unavailable: an outage resolves itself and is not re-planned around', () => {
    const plan = planOf([step('look', 'notebook.read'), step('write', 'draft.create')])
    const got = assess(
      plan,
      { 'look:notebook.read': found('notebook.read') },
      {
        kind: 'paused',
        pauseReason: 'provider_unavailable',
      },
    )
    expect(got.verdict).toBe('temporarily_unavailable')
    expect(got.worthAnotherRoute).toBe(false)
  })

  it('impossible here: nothing the plan needed has been built, so asking again cannot help', () => {
    const plan = planOf([step('post', 'slack.post')])
    const got = assess(
      plan,
      { 'post:slack.post': missed('slack.post', 'nothing in the office performs it yet') },
      done,
    )
    expect(got.verdict).toBe('impossible_here')
    expect(got.worthAnotherRoute).toBe(false)
  })

  it('blocked: the policy said no, and re-planning into a refusal is the loop the bounds exist for', () => {
    const plan = planOf([step('note', 'task.create')])
    const got = assess(
      plan,
      {
        'note:task.create': missed(
          'task.create',
          'I did not do this: Observing means it does not write',
        ),
      },
      done,
    )
    expect(got.verdict).toBe('blocked')
    expect(got.worthAnotherRoute).toBe(false)
  })

  it('failed: it looked and found nothing — the one case where another route IS worth trying', () => {
    const plan = planOf([step('look', 'notebook.read')])
    const got = assess(
      plan,
      { 'look:notebook.read': missed('notebook.read', 'nothing in the material matches') },
      done,
    )
    expect(got.verdict).toBe('failed')
    expect(got.worthAnotherRoute).toBe(true)
  })
})

describe('a completion claim needs something to point at', () => {
  it('a plan that MEANT to act and left no receipt is not satisfied', () => {
    /*
      The one claim the office must never make. Every step reported success and
      nothing exists to show for it — "created a task" without a task. Reported
      as partially satisfied, with the step named, rather than waved through.
    */
    const plan = planOf([step('note', 'task.create')])
    const got = assess(plan, { 'note:task.create': { ...found('task.create'), ids: [] } }, done)
    expect(got.verdict).toBe('partially_satisfied')
    expect(got.because).toContain('nothing it did left a record')
  })

  it('CONTROL: a plan of pure READS is satisfied by having read, with no receipt to give', () => {
    /*
      Without this the rule above would make every question the office answers
      permanently unsatisfied — a reader has nothing to point at and is right
      not to.
    */
    const plan = planOf([step('look', 'db.read'), step('study', 'notebook.read')])
    const got = assess(
      plan,
      {
        'look:db.read': { ...found('db.read'), ids: [] },
        'study:notebook.read': { ...found('notebook.read'), ids: [] },
      },
      done,
    )
    expect(got.verdict).toBe('satisfied')
  })

  it('CONTROL: an acting plan WITH a receipt is satisfied, so the rule is not simply refusing', () => {
    const plan = planOf([step('note', 'task.create')])
    const got = assess(plan, { 'note:task.create': found('task.create', ['task-7']) }, done)
    expect(got.verdict).toBe('satisfied')
  })
})

describe('what a re-plan is allowed to address', () => {
  it('unmet carries the steps that did not produce AND what the planner could not reach', () => {
    /*
      `unmet` is the entire input to a second round, so what is in it is what
      the office may plan for. Work the first plan already said it could not
      reach belongs there; anything Grant did not ask for does not.
    */
    const plan = planOf(
      [step('look', 'db.read'), step('note', 'task.create', 'put the gaps on the list')],
      ['search the open web for their prices'],
    )
    const got = assess(
      plan,
      {
        'look:db.read': found('db.read'),
        'note:task.create': missed('task.create', 'the writer refused it'),
      },
      done,
    )
    expect(got.unmet).toEqual(['put the gaps on the list', 'search the open web for their prices'])
  })

  it('a step that never ran is unmet, not forgotten', () => {
    // A pause stops the plan; the steps after it have not failed and have not
    // happened. Dropping them would make a half-run plan look complete.
    const plan = planOf([step('look', 'db.read'), step('note', 'task.create')])
    const got = assess(
      plan,
      { 'look:db.read': found('db.read') },
      {
        kind: 'paused',
        pauseReason: 'awaiting_approval',
      },
    )
    expect(got.unmet).toContain('do note')
  })
})

describe('a partial success does not make a refusal negotiable', () => {
  it('a read that worked plus a write the policy refused is NOT worth another route', () => {
    /*
      The bound that matters most, and the one the first version of `assess`
      got wrong: it applied the finality rule only where NOTHING produced, so a
      plan that read successfully and was then refused the write came back
      "partially satisfied, worth another go" — and the suite caught the office
      re-planning around `observe`. If a refusal can be routed around, the
      autonomy dial is a suggestion.
    */
    const plan = planOf([step('look', 'db.read'), step('note', 'task.create')])
    const got = assess(
      plan,
      {
        'look:db.read': found('db.read'),
        'note:task.create': missed(
          'task.create',
          'I did not do this: Observing means it does not write, even internally.',
        ),
      },
      done,
    )
    expect(got.verdict).toBe('partially_satisfied')
    expect(got.worthAnotherRoute).toBe(false)
  })

  it('and the same shape with a capability nobody built is also final', () => {
    const plan = planOf([step('look', 'db.read'), step('post', 'slack.post')])
    const got = assess(
      plan,
      {
        'look:db.read': found('db.read'),
        'post:slack.post': missed('slack.post', 'nothing in the office performs it yet'),
      },
      done,
    )
    expect(got.worthAnotherRoute).toBe(false)
  })

  it('CONTROL: a read that worked plus a search that found nothing IS worth another route', () => {
    // Without this the rule above would turn every partial result final, which
    // is re-planning switched off rather than bounded.
    const plan = planOf([step('look', 'db.read'), step('study', 'notebook.read')])
    const got = assess(
      plan,
      {
        'look:db.read': found('db.read'),
        'study:notebook.read': missed('notebook.read', 'nothing in the material matches that'),
      },
      done,
    )
    expect(got.worthAnotherRoute).toBe(true)
  })
})

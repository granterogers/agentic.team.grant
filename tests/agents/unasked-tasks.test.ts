/**
 * #408 closure: a review is a reading. A plan may write to a task list only when he asked for tasks to be made.
 *
 * Found by driving the deployed worker: "Ask the finance director to review the outstanding work in this project and tell me
 * what needs attention first" was planned notebook.read -> task.extract and six tasks were filed into the project (twelve for
 * the travel project) as the "review". Every case here has an honest neighbour that must keep its write.
 */
import { describe, expect, it } from 'vitest'
import { asksForTasks, withoutUnaskedTasks } from '../../src/agents/goal.ts'

const step = (id: string, capability: string, needs: string[] = []) => ({
  id,
  capability,
  why: 'x',
  needs,
  specialist: null,
  audience: 'office',
})
const planOf = (...steps: ReturnType<typeof step>[]) =>
  ({
    goal: 'g',
    steps,
    unreachable: [],
    refused: [],
    how: 'model',
    why: null,
    model: null,
  }) as never

describe('asking to be told is not asking for tasks', () => {
  it.each([
    'Ask the finance director to review the outstanding work in this project and tell me what needs attention first.',
    'Have the research director review the unresolved travel work and identify the most important next steps.',
    'Ask the appropriate person on the team to review our launch preparation and identify anything important that is still unfinished.',
    'Go through the onboarding material and tell me what needs doing first.',
    'Review the open tasks and tell me which are most at risk.',
  ])('%s', (said) => {
    expect(asksForTasks(said)).toBe(false)
    const plan = planOf(step('s1', 'notebook.read'), step('s2', 'task.extract', ['s1']))
    expect(withoutUnaskedTasks(plan, said).steps.map((s) => s.capability)).toEqual([
      'notebook.read',
    ])
  })

  it('the dependants of a dropped write go with it, and a plan of only writes falls back', () => {
    const said = 'Tell me what needs attention.'
    const dependent = planOf(
      step('s1', 'notebook.read'),
      step('s2', 'task.extract', ['s1']),
      step('s3', 'draft.create', ['s2']),
    )
    expect(withoutUnaskedTasks(dependent, said).steps).toHaveLength(1)
    expect(withoutUnaskedTasks(planOf(step('s1', 'task.create')), said).how).toBe('fallback')
  })
})

describe('and asking for tasks keeps the write', () => {
  it.each([
    'Read the venue brief and create tasks for everything that needs doing.',
    'Go through the budget notes and put the follow-ups on my list.',
    'Pull the action items out of the minutes.',
    'Turn the itinerary into tasks.',
    'Add a task to chase the roofer.',
    'Remind me to renew the insurance.',
  ])('%s', (said) => {
    expect(asksForTasks(said)).toBe(true)
    const plan = planOf(step('s1', 'notebook.read'), step('s2', 'task.extract', ['s1']))
    expect(withoutUnaskedTasks(plan, said).steps).toHaveLength(2)
  })

  it('a fallback plan is left alone', () => {
    const fb = { ...(planOf() as object), how: 'fallback' } as never
    expect(withoutUnaskedTasks(fb, 'tell me')).toBe(fb)
  })
})

/**
 * A reply that says a project has no record is checked against the project's own read (0.116.1). Cowork test of 24 November 2026.
 */
import { describe, expect, it } from 'vitest'
import {
  claimsNoRecord,
  projectReadingLine,
  type WorkBrief,
} from '../../src/agents/project-work.ts'

const brief = (over: Partial<WorkBrief> = {}): WorkBrief =>
  ({
    name: 'Legacy Coaching Course',
    shown: 0,
    tasks: [],
    here: true,
    context: {
      documents: {
        total: 46,
        titles: ['a7-check.md', 'Legacy Opening Assessment', 'Untitled.png'],
      },
      team: [],
    },
    ...over,
  }) as unknown as WorkBrief

describe('a "no record" claim is checked against the project', () => {
  it('recognises the claim the Cowork test received', () => {
    expect(claimsNoRecord('I have no record of this project, so I can’t give a status.')).toBe(true)
    expect(
      claimsNoRecord(
        "I can't locate any documents, tasks, or notes referencing it in our databases.",
      ),
    ).toBe(true)
  })
  it('an answer that does not claim it is left alone', () => {
    expect(claimsNoRecord('The project holds 46 documents.')).toBe(false)
  })
  it('the sentence written from the read names the documents and the tasks', () => {
    expect(projectReadingLine(brief())).toBe(
      'Legacy Coaching Course holds 46 documents (for example a7-check.md, Legacy Opening Assessment, Untitled.png) and no open tasks on the project page.',
    )
  })
  it('a project with neither documents nor tasks has nothing to write from', () => {
    expect(
      projectReadingLine(brief({ context: { documents: { total: 0, titles: [] }, team: [] } })),
    ).toBeNull()
  })
})

describe('a question from a project page does not ask which project is meant', () => {
  it('recognises the question the Cowork test received', async () => {
    const { asksWhichProject } = await import('../../src/agents/project-work.ts')
    expect(
      asksWhichProject("I can't tell what's overdue until I know which project you mean."),
    ).toBe(true)
    expect(asksWhichProject('Let me know the project name and I will pull the list.')).toBe(true)
    expect(asksWhichProject('Two tasks are overdue on this project.')).toBe(false)
  })
})

describe('a reply that says nothing is overdue or blocked agrees with the project', () => {
  const task = (over: Record<string, unknown>) => ({
    title: 'Agree instructor pay rates',
    state: 'todo',
    late: false,
    due_on: null,
    blocked_on: null,
    ...over,
  })
  const withTasks = (tasks: unknown[]) => brief({ tasks: tasks as never })
  it('says what is overdue when the reply says nothing is', async () => {
    const { contradictedCounts } = await import('../../src/agents/project-work.ts')
    expect(
      contradictedCounts(
        'No overdue items are recorded for this project.',
        withTasks([task({ late: true, due_on: '2026-10-22' })]),
      ),
    ).toBe(
      '1 task is overdue on Legacy Coaching Course: Agree instructor pay rates (due 2026-10-22).',
    )
  })
  it('says what is blocked when the reply says nothing is', async () => {
    const { contradictedCounts } = await import('../../src/agents/project-work.ts')
    expect(
      contradictedCounts(
        'There are no blocked tasks recorded.',
        withTasks([task({ state: 'blocked', blocked_on: 'the budget' })]),
      ),
    ).toBe(
      '1 task is blocked on Legacy Coaching Course: Agree instructor pay rates (waiting for: the budget).',
    )
  })
  it('leaves a reply that agrees with the project alone', async () => {
    const { contradictedCounts } = await import('../../src/agents/project-work.ts')
    expect(
      contradictedCounts('Two tasks are overdue.', withTasks([task({ late: true })])),
    ).toBeNull()
    expect(contradictedCounts('No overdue items are recorded.', withTasks([task({})]))).toBeNull()
  })
})

describe('the wordings the live check received are corrected', () => {
  it('corrects "I have no record of any tasks… nothing is flagged as blocked"', async () => {
    const { contradictedCounts, claimsNoRecord } = await import('../../src/agents/project-work.ts')
    const reply =
      'I have no record of any tasks in the system, so nothing is flagged as blocked. If you point me to the task list or where it’s saved, I can check each item.'
    const brief = {
      name: 'Wellness Studio Launch',
      tasks: [
        {
          title: 'Agree instructor pay rates',
          state: 'blocked',
          late: true,
          due_on: null,
          blocked_on: 'the budget figures',
        },
        {
          title: 'Hang the studio signage',
          state: 'blocked',
          late: false,
          due_on: null,
          blocked_on: 'the sign wording',
        },
      ],
    } as never
    expect(claimsNoRecord(reply)).toBe(true)
    expect(contradictedCounts(reply, brief)).toMatch(
      /^2 tasks are blocked on Wellness Studio Launch/,
    )
  })
})

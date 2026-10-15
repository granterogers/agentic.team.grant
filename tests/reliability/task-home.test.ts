import { describe, expect, it } from 'vitest'
import { CHIEF_OF_STAFF, taskHome } from '../../src/agents/task-home.ts'

/*
  COS-096 / COS-098 / COS-099. Behavioural on the real function. The rule: ordinary internal work is never Grant's
  by default; his own list is for work that is his.
*/
describe('where a plan task lives and who owns it', () => {
  const project = '11111111-1111-4111-8111-111111111111'

  it("internal work with a named specialist is that specialist's project task, not Grant's", () => {
    expect(
      taskHome({ audience: 'office', specialist: 'research-director', projectId: project }),
    ).toEqual({ kind: 'project', owner: 'research-director' })
  })

  it("internal work with no named specialist is the Chief of Staff's, never Grant's", () => {
    expect(taskHome({ audience: 'office', specialist: null, projectId: project })).toEqual({
      kind: 'project',
      owner: CHIEF_OF_STAFF,
    })
  })

  it('a step that is for Grant himself lands on his personal list', () => {
    expect(
      taskHome({ audience: 'grant', specialist: 'finance-director', projectId: project }),
    ).toEqual({ kind: 'personal' })
  })

  it('work outside the office is still a project task owned by the step, not by Grant', () => {
    expect(
      taskHome({ audience: 'outside', specialist: 'communications-director', projectId: project }),
    ).toEqual({ kind: 'project', owner: 'communications-director' })
  })

  it('a plan with no project has nowhere to hold a project task, so it stays on his list until one exists', () => {
    expect(
      taskHome({ audience: 'office', specialist: 'research-director', projectId: null }),
    ).toEqual({ kind: 'personal' })
  })

  it('Grant is never the owner of a project task', () => {
    for (const audience of ['office', 'outside', null]) {
      for (const specialist of ['research-director', null]) {
        const home = taskHome({ audience, specialist, projectId: project })
        if (home.kind === 'project') expect(home.owner).not.toBe('grant')
      }
    }
  })
})

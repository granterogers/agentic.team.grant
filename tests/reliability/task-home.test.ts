import { describe, expect, it } from 'vitest'
import { CHIEF_OF_STAFF, taskHome } from '../../src/agents/task-home.ts'

/*
  COS-096 / COS-098 / COS-099. Behavioural on the real function. The rule: ordinary internal work is never Grant's
  by default; his own list is for work that is his.
*/
describe('where a plan task lives and who owns it', () => {
  it("internal work with a named specialist is that specialist's project task, not Grant's", () => {
    expect(taskHome({ audience: 'office', specialist: 'research-director' })).toEqual({
      kind: 'project',
      owner: 'research-director',
    })
  })

  it("internal work with no named specialist is the Chief of Staff's, never Grant's", () => {
    expect(taskHome({ audience: 'office', specialist: null })).toEqual({
      kind: 'project',
      owner: CHIEF_OF_STAFF,
    })
  })

  it('a step that is for Grant himself lands on his personal list', () => {
    expect(taskHome({ audience: 'grant', specialist: 'finance-director' })).toEqual({
      kind: 'personal',
    })
  })

  it('work outside the office is still a project task owned by the step, not by Grant', () => {
    expect(taskHome({ audience: 'outside', specialist: 'communications-director' })).toEqual({
      kind: 'project',
      owner: 'communications-director',
    })
  })

  it('projectless internal work is an owned task, never a task on his list (ADR-0024 catch-all project)', () => {
    expect(taskHome({ audience: 'office', specialist: 'research-director' })).toEqual({
      kind: 'project',
      owner: 'research-director',
    })
    expect(taskHome({ audience: null, specialist: null })).toEqual({
      kind: 'project',
      owner: CHIEF_OF_STAFF,
    })
  })

  it('Grant is never the owner of a project task', () => {
    for (const audience of ['office', 'outside', null]) {
      for (const specialist of ['research-director', null]) {
        const home = taskHome({ audience, specialist })
        if (home.kind === 'project') expect(home.owner).not.toBe('grant')
      }
    }
  })
})

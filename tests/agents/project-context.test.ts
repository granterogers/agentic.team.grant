/**
 * The project's documents and team reach the agents (A20).
 *
 * The agents were given a project's tasks and nothing else, so "how many documents does this project have" was answered
 * "no record". These pin the new lines: the count with the most recent titles, the team once with each role, and the
 * rule that a failed read is "not read", never "none".
 */
import { describe, expect, it } from 'vitest'
import { projectWorkSpine, readProjectWork, type WorkBrief } from '../../src/agents/project-work.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

const base = (over: Partial<WorkBrief> = {}): WorkBrief => ({
  project_id: 'p1',
  name: 'Legacy Coaching Course',
  today: '2026-11-19',
  counts: { open: 0, done: 0, overdue: 0, blocked: 0, total: 0 },
  shown: 0,
  tasks: [],
  ...over,
})

const context = {
  documents: { total: 24, titles: ['A7 check', 'People - Grant Rogers'] },
  team: [
    { name: 'Claire', role: 'Chief of Staff' },
    { name: 'Dana', role: 'Finance & Data Director' },
  ],
}

describe('the project brief says what documents and people it holds (A20)', () => {
  it('states the document count, the most recent titles, and the team for the project in front of the model', () => {
    const s = projectWorkSpine([base({ here: true, context })])
    expect(s).toContain('holds 24 documents')
    expect(s).toContain('"A7 check"')
    expect(s).toContain('Dana (Finance & Data Director)')
  })

  it('writes the team once, for the project the conversation is filed under, not for every project', () => {
    const s = projectWorkSpine([
      base({ here: true, context }),
      base({ project_id: 'p2', name: 'Japan Spring Trip', here: false, context }),
    ])
    expect(s.split('The team, and who holds each role').length - 1).toBe(1)
  })

  it('says a project holds no documents when the count is zero, which is a fact the read gave', () => {
    const s = projectWorkSpine([base({ context: { documents: { total: 0, titles: [] }, team: [] } })])
    expect(s).toContain('holds no documents')
  })

  it('says nothing about documents when the read did not happen, rather than claiming there are none', () => {
    const s = projectWorkSpine([base({ here: true })])
    expect(s).not.toContain('holds no documents')
    expect(s).not.toContain('holds 0')
  })

  it('reads the context for each project and attaches it, and a failed read leaves it out', async () => {
    const answers: Record<string, unknown[]> = {
      'app.unnamed_project': [{ p: 'unnamed-id' }],
      'app.projects_named_in': [],
      'app.project_work_brief': [{ b: base() }],
      'app.project_context_brief': [{ c: context }],
    }
    const db = {
      execute: async (sql: string) => {
        for (const [needle, rows] of Object.entries(answers)) if (sql.includes(needle)) return { rows }
        return { rows: [] }
      },
    } as unknown as SqlExecutor
    const lit = (v: string) => `'${v}'`
    const out = await readProjectWork(db, 'job-1', 'wellness', 'q', lit)
    expect(out).toHaveLength(1)
    expect(out[0]?.context?.documents.total).toBe(24)

    const failing = {
      execute: async (sql: string) => {
        if (sql.includes('app.project_context_brief')) throw new Error('boom')
        for (const [needle, rows] of Object.entries(answers)) if (sql.includes(needle)) return { rows }
        return { rows: [] }
      },
    } as unknown as SqlExecutor
    const partial = await readProjectWork(failing, 'job-1', 'wellness', 'q', lit)
    expect(partial).toHaveLength(1)
    expect(partial[0]?.context).toBeUndefined()
  })
})

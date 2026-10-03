/**
 * What the team is shown of a project's WORK (#408).
 *
 * The office retrieved a project's documents and read its tasks from nowhere, so a question about overdue work was
 * answered with "I don't see any". These pin the shape of what is now read and, because a name appearing in a file is
 * not evidence that anything calls it, the wiring itself: the handler must CALL the reader with the turn's own project
 * and words, and the result must reach the prompt, the grounding and the consulted domains.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MAX_PROJECTS_OF_WORK,
  projectWorkSpine,
  readProjectWork,
  type WorkBrief,
} from '../../src/agents/project-work.ts'
import { assertsRecordsUnseen } from '../../src/agents/quality.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

const brief = (over: Partial<WorkBrief> = {}): WorkBrief => ({
  project_id: 'p1',
  name: 'Japan Spring Trip',
  today: '2026-10-03',
  counts: { open: 38, done: 2, overdue: 1, blocked: 1, total: 40 },
  shown: 2,
  tasks: [
    {
      title: 'Book the return flight',
      state: 'todo',
      due_on: '2026-09-28',
      starts_on: null,
      late: true,
      who: 'you',
      milestone: false,
      under: 'Flights and hotels',
      labels: ['bookings'],
      blocked_on: '',
      note: null,
    },
    {
      title: 'Find out whether the ryokan can store luggage',
      state: 'blocked',
      due_on: '2026-10-18',
      starts_on: null,
      late: false,
      who: null,
      milestone: false,
      under: null,
      labels: null,
      blocked_on: 'Waiting for the ryokan to reply',
      note: null,
    },
  ],
  ...over,
})

describe('projectWorkSpine', () => {
  it('is empty when nothing was read, so a failed read cannot read as an empty project', () => {
    expect(projectWorkSpine([])).toBe('')
  })

  it('states the counts, the date and what was left out', () => {
    const s = projectWorkSpine([brief()])
    expect(s).toContain('Japan Spring Trip')
    expect(s).toContain('38 open, 2 done, 1 overdue, 1 blocked')
    expect(s).toContain('today is 2026-10-03')
    expect(s).toContain('the other 38 are not shown here')
  })

  it('says a late task is late, a blocked one why, and where a subtask sits', () => {
    const s = projectWorkSpine([brief()])
    expect(s).toContain(
      'Book the return flight (due 2026-09-28 (late); with you; under "Flights and hotels"; [bookings])',
    )
    expect(s).toContain('blocked: Waiting for the ryokan to reply')
  })

  it('says a project with no tasks holds none, which is a fact and not an order', () => {
    const s = projectWorkSpine([
      brief({
        counts: { open: 0, done: 0, overdue: 0, blocked: 0, total: 0 },
        shown: 0,
        tasks: [],
      }),
    ])
    expect(s).toBe('The project "Japan Spring Trip" holds no tasks.')
    expect(s.toLowerCase()).not.toMatch(/\b(do not|never|must not)\b/)
  })

  it('says which project the conversation is in, so "this project" has a referent', () => {
    expect(projectWorkSpine([brief({ here: true })])).toContain(
      'the project this conversation is about',
    )
    expect(projectWorkSpine([brief({ here: false })])).not.toContain(
      'the project this conversation is about',
    )
  })

  it('says all of them are listed when none was cut', () => {
    const s = projectWorkSpine([
      brief({ counts: { open: 2, done: 0, overdue: 1, blocked: 1, total: 2 }, shown: 2 }),
    ])
    expect(s).toContain('All of them are listed')
  })
})

/** An executor that answers by pattern and records what it was asked. */
const executor = (answers: Record<string, unknown[]>) => {
  const asked: string[] = []
  const db: SqlExecutor = {
    execute: async (sql: string) => {
      asked.push(sql)
      for (const [needle, rows] of Object.entries(answers)) {
        if (sql.includes(needle)) return { rows: rows as Record<string, unknown>[] }
      }
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  return { db, asked }
}
const lit = (v: string): string => `'${v}'`

describe('readProjectWork: which projects, and why only those', () => {
  it('reads the asking project and one the question names, and no others', async () => {
    const { db, asked } = executor({
      'app.unnamed_project': [{ p: 'unnamed-id' }],
      'app.projects_named_in': [{ project_id: 'japan', name: 'Japan Spring Trip' }],
      'app.project_work_brief': [{ b: brief() }],
    })
    const out = await readProjectWork(db, 'job-1', 'wellness', 'what about the Japan trip', lit)
    expect(out).toHaveLength(2)
    const briefs = asked.filter((s) => s.includes('app.project_work_brief('))
    expect(briefs).toHaveLength(2)
    expect(briefs[0]).toContain("'wellness'")
    expect(briefs[1]).toContain("'japan'")
  })

  it('never reads the reserved catch-all, which holds conversations and not work', async () => {
    const { db, asked } = executor({
      'app.unnamed_project': [{ p: 'unnamed-id' }],
      'app.projects_named_in': [],
    })
    expect(await readProjectWork(db, 'job-1', 'unnamed-id', 'hello', lit)).toEqual([])
    expect(asked.some((s) => s.includes('app.project_work_brief('))).toBe(false)
  })

  it('reads a named project even when the turn is filed under nothing', async () => {
    const { db, asked } = executor({
      'app.unnamed_project': [{ p: 'unnamed-id' }],
      'app.projects_named_in': [{ project_id: 'japan', name: 'Japan Spring Trip' }],
      'app.project_work_brief': [{ b: brief() }],
    })
    const out = await readProjectWork(
      db,
      'job-1',
      null,
      'what is overdue on the Japan Spring Trip',
      lit,
    )
    expect(out).toHaveLength(1)
    expect(asked.filter((s) => s.includes('app.project_work_brief(')).length).toBe(1)
  })

  it('is capped, so a question naming every project is not a dump', async () => {
    const { db } = executor({
      'app.unnamed_project': [{ p: 'unnamed-id' }],
      'app.projects_named_in': ['a', 'b', 'c', 'd'].map((x) => ({ project_id: x, name: x })),
      'app.project_work_brief': [{ b: brief() }],
    })
    const out = await readProjectWork(db, 'job-1', 'own', 'everything', lit)
    expect(out.length).toBe(MAX_PROJECTS_OF_WORK)
  })

  it('answers nothing, not an empty project, when the read fails', async () => {
    const db = {
      execute: async () => {
        throw new Error('boom')
      },
    } as unknown as SqlExecutor
    expect(await readProjectWork(db, 'job-1', 'own', 'x', lit)).toEqual([])
  })

  it('skips a project the database says is not this office’s (null) rather than inventing one', async () => {
    const { db } = executor({
      'app.unnamed_project': [{ p: 'unnamed-id' }],
      'app.projects_named_in': [],
      'app.project_work_brief': [{ b: null }],
    })
    expect(await readProjectWork(db, 'job-1', 'foreign', 'x', lit)).toEqual([])
  })
})

describe('a complete project task list entitles an exhaustiveness claim, and only then', () => {
  const answer = 'The only overdue task is Book the return flight.'
  const grounding = projectWorkSpine([
    brief({ counts: { open: 2, done: 0, overdue: 1, blocked: 1, total: 2 }, shown: 2 }),
  ])
  it('is refused when the tasks were not held whole (a search is not a census)', () => {
    expect(
      assertsRecordsUnseen(answer, grounding, { consulted: ['tasks'], complete: [] }),
    ).not.toBeNull()
  })
  it('is allowed when every task was listed', () => {
    expect(
      assertsRecordsUnseen(answer, grounding, { consulted: ['tasks'], complete: ['tasks'] }),
    ).toBeNull()
  })
  it('the handler declares tasks complete only when every brief listed all of its tasks', () => {
    const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    expect(src).toMatch(/projectWorkBriefs\.every\(\(b\) => b\.shown >= b\.counts\.total\)/)
  })
})

describe('the handler wires it', () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')

  it('calls the reader with the job, the turn’s own project and his words', () => {
    expect(src).toMatch(
      /await readProjectWork\(deps\.db, job\.jobId, job\.projectId, instruction, lit\)/,
    )
  })

  it('puts the result in the prompt, the grounding and the consulted domains', () => {
    expect(src).toMatch(/content: projectWork \}\]/)
    expect(src).toMatch(/\[projectWork\]\)/)
    expect(src).toMatch(/projectWorkBriefs\.length > 0 \? \(\['tasks'\] as const\)/)
  })
})

describe('the reader is office-scoped in the database', () => {
  const sql = readFileSync('migrations/0869_a_project_can_say_what_work_is_in_it.sql', 'utf8')
  it('takes the office from require_office and filters tasks and the project by it', () => {
    expect(sql).toContain('app.require_office(p_office)')
    expect(sql).toMatch(/tk\.office_id = v_office/)
    expect(sql).toMatch(/p\.office_id = v_office/)
  })
  it('is not callable by a browser role', () => {
    expect(sql).toMatch(
      /revoke all on function app\.project_work_brief[^;]*from public, anon, authenticated/,
    )
  })
})

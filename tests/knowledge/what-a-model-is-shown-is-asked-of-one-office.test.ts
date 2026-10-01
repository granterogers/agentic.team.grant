/**
 * What a model is shown is built by readers that are asked of ONE office (multi-user P3, cluster g-context).
 *
 * The database half is proved by `scripts/isolated/p3-cases/70-context.ts` against a clone, with two offices and a
 * canary in each. This is the TypeScript half, and it asserts properties rather than spellings:
 *
 *   - the office a reader is asked of is the CLAIMED job's (resolved in SQL by `app.job_office`) or a named office,
 *     and reaches the SQL as the FIRST argument of every converted function;
 *   - a retrieval with no project is still bounded by the office (the office's own Unnamed, never "every project");
 *   - no call in `src/` to a converted function leaves the office out, whichever file makes it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { capabilityNow } from '../../src/agents/capability.ts'
import { guidanceFor } from '../../src/agents/guidance.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { officeOf } from '../../src/knowledge/office.ts'
import {
  awaiting,
  correspondence,
  coverageOf,
  retrieve,
  retrieveAcrossOffice,
} from '../../src/knowledge/retrieval.ts'

const JOB = '11111111-1111-4111-8111-111111111111'
const OFFICE = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const SIBLING = '44444444-4444-4444-8444-444444444444'
const BY_JOB = `app.job_office('${JOB}'::uuid)`

/** An executor that records what it was asked and answers nothing. */
const recorder = () => {
  const seen: string[] = []
  const db = {
    execute: async (sql: string) => {
      seen.push(sql.replace(/\s+/g, ' '))
      // a sibling to widen to, so the second search the widening makes is made at all
      if (sql.includes('projects_named_in'))
        return {
          rows: [{ project_id: SIBLING, name: 'A sibling', account_level: false }],
        }
      return { rows: [{ k: { blank: [], complete: true, documents: 0 } }] }
    },
  } as unknown as SqlExecutor
  return { db, seen }
}

describe('the office a reader is asked of', () => {
  it("is the claimed job's, resolved in SQL, or a named office - never anything else", () => {
    expect(officeOf({ jobId: JOB })).toBe(BY_JOB)
    expect(officeOf({ officeId: OFFICE })).toBe(`'${OFFICE}'::uuid`)
  })

  it('cannot be smuggled in through a quote', () => {
    const hostile = officeOf({ jobId: `x'); drop table public.jobs; --` })
    expect(hostile).toContain("x''); drop table public.jobs; --")
    expect(hostile.startsWith('app.job_office(')).toBe(true)
  })
})

describe('retrieval is asked of the office, in the statement that fetches', () => {
  it("search: the office is the first argument, and the join back to documents is the office's too", async () => {
    const { db, seen } = recorder()
    await retrieve(db, { jobId: JOB }, 'pricing', PROJECT, 5)
    const sql = seen.join('\n')
    expect(sql).toContain(`app.search_documents(${BY_JOB}, 'pricing', '${PROJECT}'::uuid`)
    expect(sql).toContain(`d.office_id = ${BY_JOB}`)
  })

  it("a retrieval with no project is bounded by the office's own Unnamed, not by every project", async () => {
    const { db, seen } = recorder()
    await retrieve(db, { officeId: OFFICE }, 'pricing', null, 5)
    const sql = seen.join('\n')
    expect(sql).toContain(`app.unnamed_project('${OFFICE}'::uuid)`)
    expect(sql).not.toContain('app.unnamed_project()')
    expect(sql).not.toMatch(/search_documents\([^)]*, null,/)
  })

  it("widening to siblings asks the office for them, and the sibling search is the office's as well", async () => {
    const { db, seen } = recorder()
    await retrieveAcrossOffice(db, { jobId: JOB }, 'what about the other thing', PROJECT)
    const sql = seen.join('\n')
    expect(sql).toContain(`app.projects_named_in(${BY_JOB}, `)
    // every search the widening makes names the office, not only the first
    const searches = seen.filter((s) => s.includes('app.search_documents('))
    // the asking project's own search and the sibling's: two, both the office's
    expect(searches.length).toBeGreaterThanOrEqual(2)
    expect(searches.some((s) => s.includes(`'${SIBLING}'::uuid`))).toBe(true)
    for (const s of searches) expect(s).toContain(`app.search_documents(${BY_JOB}, `)
  })

  it("mail, waiting threads and coverage are the office's, each", async () => {
    const { db, seen } = recorder()
    await correspondence(db, { jobId: JOB }, PROJECT, 'renewal')
    await awaiting(db, { jobId: JOB }, PROJECT)
    await coverageOf(db, { jobId: JOB }, PROJECT)
    const sql = seen.join('\n')
    expect(sql).toContain(`app.mail_for_project(${BY_JOB}, '${PROJECT}'::uuid`)
    expect(sql).toContain(`app.mail_search(${BY_JOB}, 'renewal'`)
    expect(sql).toContain(`app.mail_awaiting(${BY_JOB}, '${PROJECT}'::uuid`)
    expect(sql).toContain(`app.project_knowledge(${BY_JOB}, '${PROJECT}'::uuid`)
  })

  it("memory and the capability brief are the office's: lessons, skills and what the agent may do", async () => {
    const { db, seen } = recorder()
    await guidanceFor(db, { jobId: JOB }, 'research-director', 'office.instruction', PROJECT)
    await capabilityNow(db, { jobId: JOB }, 'research-director')
    const sql = seen.join('\n')
    expect(sql).toContain(`app.lessons_for(${BY_JOB}, `)
    expect(sql).toContain(`app.skills_for(${BY_JOB}, `)
    expect(sql).toContain(`app.capability_index(${BY_JOB}, `)
  })
})

/**
 * No call in src/ to a converted function leaves the office out. Read as a property of every file rather than of the
 * handful that were edited, so the next call somebody adds is held to it too. A first argument is accepted when it is
 * the claimed job's office, an `officeOf(...)` expression, or a visibly named office; a call whose first argument is
 * anything else (a project, a query, a slug) fails.
 */
describe('every call in src/ to a converted function names an office first', () => {
  const NAMES = [
    'search_documents',
    'lessons_for',
    'skills_for',
    'project_instruction_for',
    'project_knowledge',
    'sibling_projects',
    'projects_named_in',
    'mail_for_project',
    'mail_search',
    'mail_awaiting',
    'mail_coverage',
    'forget_mail_before',
    'forget_mail_bodies_before',
    'decisions_about',
    'resolve_project',
    'resolve_project_by_name',
    'add_project_alias',
    'propose_standing_rule',
    'propose_standing_procedure',
    'raise_suggestions',
    'container_refs',
    'calendar_task_plan',
    'morning_briefing_facts',
    'write_briefing',
    'notification_allowed',
    'capability_index',
    'learn',
  ]
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
    })
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const OK =
    /^(app\.job_office\(|\$\{officeOf\(|\$\{office\}|p_office\b|app\.office|app\.sole_person_office|app\.test_office|\$\{TEST_OFFICE\}|o\.office_id|\(select office_id)/

  it('src/ makes the calls it makes with the office stated', () => {
    const calls: { file: string; name: string; first: string }[] = []
    for (const file of walk('src')) {
      const text = strip(readFileSync(file, 'utf8'))
      for (const name of NAMES) {
        for (const m of text.matchAll(
          new RegExp(`\\bapp\\.${name}\\(\\s*([^,)]*(?:\\([^)]*\\))?[^,)]*)`, 'g'),
        )) {
          calls.push({ file, name, first: (m[1] ?? '').trim() })
        }
      }
    }
    // the control: the scan has to be able to see calls at all, or a clean result says nothing
    expect(calls.length).toBeGreaterThan(15)
    const bad = calls.filter((c) => !OK.test(c.first))
    expect(bad.map((b) => `${b.file}: app.${b.name}(${b.first}`)).toEqual([])
  })

  it('a RetrievalOffice is never interpolated bare: it is an object, and the SQL it would build is invalid', () => {
    // A bare interpolation compiles (any value goes into a template literal), reaches the database as the text
    // "[object Object]", and the reader's catch turns the resulting error into an empty answer: a guard that cannot
    // fail loudly. Found after a merge left it in guidance.ts, where it silently emptied every agent's lessons.
    const bare = /\$\{office\}/
    const offenders: string[] = []
    for (const file of walk('src')) {
      const text = strip(readFileSync(file, 'utf8'))
      if (/\boffice: RetrievalOffice\b/.test(text) && bare.test(text)) offenders.push(file)
    }
    expect(offenders).toEqual([])
    // the control: the same scan has to see a file that does it
    const sample = strip('function f(office: RetrievalOffice) { return `where o = ${office}` }')
    expect(/\boffice: RetrievalOffice\b/.test(sample) && bare.test(sample)).toBe(true)
  })

  it('and the control can fail: a call that leaves the office out is seen as bad', () => {
    const sample = strip('select app.lessons_for(${uuid(projectId)}, null, null, 8)')
    const m = /\bapp\.lessons_for\(\s*([^,)]*(?:\([^)]*\))?[^,)]*)/.exec(sample)
    expect(OK.test((m?.[1] ?? '').trim())).toBe(false)
  })
})

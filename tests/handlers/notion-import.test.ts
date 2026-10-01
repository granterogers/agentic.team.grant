/**
 * The plan Grant approved is the work performed (#131).
 *
 * The rest of #131 was closed in `6d7e334`: three handlers plan, approvals
 * carry the plan, and `verify:dryrun` proves a handler cannot do more than it
 * said. `office.notion_import` was left open, and its comment says exactly why:
 *
 *   > Its plan depends on `curriculum()`, a MODEL call. Planning and then
 *   > executing would run it twice and get different modules, so the plan Grant
 *   > approved would not be the work performed — the exact failure this issue
 *   > is about, reached by obeying it naively.
 *
 * The fix is that the STORED plan is the thing executed. Two properties make
 * that true and both are tested here, because each fails silently on its own:
 *
 * 1. **The plan carries the curriculum losslessly.** If a module's tasks or
 *    sources do not survive the round trip, executing from the plan is not the
 *    same work — it is a quieter version of the same defect.
 * 2. **Execution does not ask the model again.** A handler that reads the plan
 *    and then calls `curriculum()` anyway would pass (1) and still perform a
 *    different import.
 *
 * Neither needs Notion. Faking the whole API faithfully would be a second
 * implementation of it, and a test whose double is wrong proves nothing — so
 * the outward call is made to fail and what is asserted is what happened
 * BEFORE it.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import {
  type Module,
  modulesFromPlan,
  notionImportHandler,
  type Prepared,
  planFrom,
} from '../../src/handlers/notion-import.ts'
import type { Job } from '../../src/jobs/worker.ts'

const MODULES: Module[] = [
  {
    name: 'Module 1 — Finding your first client',
    summary: 'Where the first one comes from, and what to charge.',
    tasks: ['Draft the outreach note', 'List ten people to approach'],
    sources: ['WS01 Getting started.pdf'],
  },
  {
    name: 'Module 2 — Pricing without flinching',
    summary: 'Saying the number out loud.',
    tasks: ['Write three price points'],
    sources: ['WS02 Pricing.pdf', 'WS01 Getting started.pdf'],
  },
]

const READY: Prepared = {
  stop: null,
  projectId: '11111111-1111-1111-1111-111111111111',
  projectName: 'Coaching Course',
  token: 'not-a-real-token',
  docsDb: 'docs-db',
  projectsDb: 'projects-db',
  tasksDb: 'tasks-db',
  sources: [
    { title: 'WS01 Getting started.pdf', content: 'a'.repeat(200) },
    { title: 'WS02 Pricing.pdf', content: 'b'.repeat(20_000) },
  ],
}

describe('#131 — the plan is the thing executed', () => {
  it('carries the curriculum through the plan without losing any of it', () => {
    const back = modulesFromPlan(planFrom(READY, MODULES))
    expect(back).toEqual(MODULES)
  })

  /*
    A module step is recognised BY its payload, so a plan of ordinary steps must
    read as "no approved curriculum" rather than as an empty one. The difference
    matters: null falls back to deriving a curriculum, an empty list would
    import nothing and report success.
  */
  it('reports no approved curriculum rather than an empty one', () => {
    expect(modulesFromPlan({ steps: [] })).toBeNull()
    expect(modulesFromPlan({ none: true })).toBeNull()
    expect(modulesFromPlan(undefined)).toBeNull()
    expect(
      modulesFromPlan({
        steps: [{ verb: 'create', what: 'WS01.pdf', where: 'Notion', writes: 1 }],
      }),
    ).toBeNull()
  })

  /*
    The plan a person reads names every page, not just the modules — six pages
    into Notion is what #131 is named for, and an approval that listed two of
    them would be consent to a category again.
  */
  it('names every page it would create, not only the modules', () => {
    const plan = planFrom(READY, MODULES)
    const named = plan.steps.map((s) => s.what)
    expect(named).toContain('Module 1 — Finding your first client')
    expect(named).toContain('WS02 Pricing.pdf')
    expect(named).toContain('Draft the outreach note')
    // Two modules, two sources, three tasks.
    expect(plan.steps).toHaveLength(7)
    expect(plan.tool).toBe('notion.write')
    expect(plan.reaches).toEqual(['notion'])
  })

  /*
    And the writes a step claims must account for the calls it really makes: a
    long source costs an extra append, and every doc costs its relation. A step
    that under-claims is what `verify:dryrun` catches at runtime, so getting it
    wrong here would make that check fire on correct behaviour.
  */
  it('claims the extra call a long source costs', () => {
    const plan = planFrom(READY, MODULES)
    const short = plan.steps.find((s) => s.what === 'WS01 Getting started.pdf')
    const long = plan.steps.find((s) => s.what === 'WS02 Pricing.pdf')
    expect(short?.writes).toBe(2)
    expect(long?.writes).toBe(3)
  })

  /**
   * A database that answers the handler's three reads and nothing else.
   *
   * `storedPlan` is what `app.job_plan` comes back with, which is the only
   * difference between the two cases below.
   */
  const fakeDb = (storedPlan: unknown): SqlExecutor =>
    ({
      kind: 'fake',
      execute: async (sql: string): Promise<SqlResult> => {
        if (sql.includes('app.job_plan(')) return { rows: [{ p: storedPlan }] }
        // The import was asked for, so every destination proceeds (the gate is proved in policy-notion-destination).
        if (sql.includes('authorize_effect')) {
          return {
            rows: [{ d: { verdict: 'proceed', asked_for: true, because: 'You asked for this.' } }],
          }
        }
        if (sql.includes('decrypted_secrets')) {
          return {
            rows: [
              {
                token: 'not-a-real-token',
                project_name: 'Coaching Course',
                targets: { document: 'docs-db', artifact: 'projects-db', task: 'tasks-db' },
              },
            ],
          }
        }
        if (sql.includes('from public.documents')) {
          return { rows: READY.sources.map((s) => ({ title: s.title, content: s.content })) }
        }
        return { rows: [] }
      },
    }) as unknown as SqlExecutor

  const job: Job = {
    jobId: '22222222-2222-2222-2222-222222222222',
    kind: 'office.notion_import',
    correlationId: '22222222-2222-2222-2222-222222222222',
    projectId: READY.projectId,
    idempotencyKey: 'notion-import-test',
    attempt: 1,
  }

  /** A router that records whether anybody asked it to think. */
  const countingRouter = (): { router: never; asked: () => number } => {
    let asked = 0
    const router = {
      complete: async () => {
        asked += 1
        return {
          model: 'fake',
          content: JSON.stringify({ modules: MODULES }),
          promptTokens: 1,
          completionTokens: 1,
          cost: 0,
        }
      },
    }
    return { router: router as never, asked: () => asked }
  }

  /*
    The property the whole issue turns on.

    Notion is unreachable in both runs — the handler throws when it gets there —
    and that is deliberate: what is being asserted happened strictly before the
    first outward call, so no Notion double is needed and none can be wrong.
  */
  it('does not ask the model again when a plan was approved', async () => {
    const { router, asked } = countingRouter()
    const approved = planFrom(READY, MODULES)
    const handler = notionImportHandler({ db: fakeDb(approved), router })
    const outward = vi.fn(async () => {
      throw new Error('notion unreachable')
    }) as unknown as typeof fetch
    const previous = globalThis.fetch
    globalThis.fetch = outward
    try {
      await handler.handle(job, fakeDb(approved)).catch(() => undefined)
    } finally {
      globalThis.fetch = previous
    }
    expect(asked()).toBe(0)
  })

  /*
    The other half, and the reason the one above is not vacuous: with NO stored
    plan the handler must still work, and the only way it can is by deriving a
    curriculum — so the model IS asked. If both cases came back zero, the first
    assertion would be passing because the handler died before it got there.
  */
  it('CONTROL: it does ask the model when no plan was stored', async () => {
    const { router, asked } = countingRouter()
    const handler = notionImportHandler({ db: fakeDb({ none: true }), router })
    const outward = vi.fn(async () => {
      throw new Error('notion unreachable')
    }) as unknown as typeof fetch
    const previous = globalThis.fetch
    globalThis.fetch = outward
    try {
      await handler.handle(job, fakeDb({ none: true })).catch(() => undefined)
    } finally {
      globalThis.fetch = previous
    }
    expect(asked()).toBe(1)
  })
})

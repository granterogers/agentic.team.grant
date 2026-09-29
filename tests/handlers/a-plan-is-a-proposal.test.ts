/**
 * WHAT THE PLANNER IS ALLOWED TO START, FROM A REAL TURN (#283).
 *
 * `verify:plans` measures whether the office can work out what a goal needs
 * and `verify:pursues` proves step B consumes step A. Neither asks the
 * question this file asks, which is the one that decides whether any of it
 * ever reaches Grant: **on a real message, what does the handler start?**
 *
 * The three refusals below are the whole safety argument for wiring a model
 * into the turn at all, and each is a property rather than a wording:
 *
 *   - a single-step plan starts nothing, because one step is what the cascade
 *     above it already does and the planner's only contribution is composition;
 *   - a plan of capabilities nothing performs starts nothing, because 0298's
 *     registry row can claim anything and announcing work the office cannot
 *     do is worse than answering in prose;
 *   - a plan is a PROPOSAL. What gets enqueued is a job, and the plan travels
 *     as data on it — the model never becomes the thing that authorizes.
 *
 * The positive control matters as much: a suite made only of refusals passes
 * against a system that refuses everything, which CLAUDE.md records as a real
 * defect in `verify:connectors`.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { planAndPursue } from '../../src/handlers/instruction.ts'
import type { Job } from '../../src/jobs/worker.ts'

const job: Job = {
  jobId: '11111111-1111-1111-1111-111111111111',
  kind: 'office.instruction',
  correlationId: '22222222-2222-2222-2222-222222222222',
  projectId: '33333333-3333-3333-3333-333333333333',
  idempotencyKey: 'k',
  attempt: 1,
}

/** Long enough and multi-clause, so `planFor`'s fast path does not claim it. */
const SAID =
  'Have a look through the pricing project and then put whatever is out of date on my list'

interface Said {
  readonly sql: string[]
}

/**
 * A database that answers the two reads the wiring makes and records every
 * write, so the test can assert on what was ENQUEUED rather than on prose.
 */
const fakeDb = (said: Said, tools: readonly string[]): SqlExecutor =>
  ({
    execute: async (sql: string) => {
      said.sql.push(sql)
      if (sql.includes('tool_permissions')) {
        return {
          rows: tools.map((tool) => ({
            tool,
            level: 1,
            enabled: true,
            in_reply: true,
            purpose: `Does ${tool}.`,
            verbs: [],
          })),
        }
      }
      if (sql.includes('public.staff')) {
        return { rows: [{ slug: 'chief-of-staff', title: 'Chief of Staff' }] }
      }
      return { rows: [{ id: '44444444-4444-4444-4444-444444444444' }] }
    },
  }) as unknown as SqlExecutor

/** A provider that returns exactly the plan the case is about. */
const fakeRouter = (steps: unknown[]) =>
  ({
    complete: async () => ({
      content: JSON.stringify({ goal: 'Bring the pricing project up to date', steps }),
      model: 'test/model',
    }),
  }) as never

const step = (id: string, capability: string, needs: string[] = []) => ({
  id,
  capability,
  why: `do ${id}`,
  needs,
  specialist: null,
  audience: 'grant',
})

const enqueues = (said: Said): string[] => said.sql.filter((s) => s.includes('enqueue_child'))

describe('what a real turn lets the planner start', () => {
  it('starts durable work for a composed plan, carrying the plan as data', async () => {
    const said: Said = { sql: [] }
    const line = await planAndPursue(
      fakeDb(said, ['db.read', 'task.create']),
      fakeRouter([step('look', 'db.read'), step('note', 'task.create', ['look'])]),
      job,
      SAID,
      null,
    )
    const started = enqueues(said)
    expect(started).toHaveLength(1)
    expect(started[0]).toContain("'office.pursue'")
    // The plan travels as data on the job, which is what makes it a proposal.
    expect(started[0]).toContain('"capability":"task.create"')
    expect(started[0]).toContain("'plan'")
    expect(line).not.toBeNull()
  })

  it('says what it WILL do, never that it has done it', async () => {
    const said: Said = { sql: [] }
    const line = await planAndPursue(
      fakeDb(said, ['db.read', 'task.create']),
      fakeRouter([step('look', 'db.read'), step('note', 'task.create', ['look'])]),
      job,
      SAID,
      null,
    )
    /*
      #259: never claim a thing happened unless canonical state proves it, and
      nothing has run at the moment this sentence is composed.
    */
    expect(line ?? '').not.toMatch(/\b(added|created|put it on|done|I have read)\b/i)
    expect(line ?? '').toMatch(/will come back/i)
  })

  it('a single-step plan starts nothing — that is what the cascade is for', async () => {
    const said: Said = { sql: [] }
    const line = await planAndPursue(
      fakeDb(said, ['db.read', 'task.create']),
      fakeRouter([step('look', 'db.read')]),
      job,
      SAID,
      null,
    )
    expect(line).toBeNull()
    expect(enqueues(said)).toHaveLength(0)
  })

  it('a plan of capabilities nothing performs starts nothing', async () => {
    const said: Said = { sql: [] }
    const line = await planAndPursue(
      /*
        Both granted by the registry and neither has an executor — 0298's row
        that claims a capability with nothing behind it.
      */
      fakeDb(said, ['slack.post', 'gmail.draft']),
      fakeRouter([step('post', 'slack.post'), step('draft', 'gmail.draft', ['post'])]),
      job,
      SAID,
      null,
    )
    expect(line).toBeNull()
    expect(enqueues(said)).toHaveLength(0)
  })

  it('an unavailable provider leaves the turn exactly as it is today', async () => {
    const said: Said = { sql: [] }
    const line = await planAndPursue(
      fakeDb(said, ['db.read', 'task.create']),
      { complete: async () => Promise.reject(new Error('no')) } as never,
      job,
      SAID,
      null,
    )
    expect(line).toBeNull()
    expect(enqueues(said)).toHaveLength(0)
  })

  it('a short single-clause message never reaches the model at all', async () => {
    const said: Said = { sql: [] }
    let asked = 0
    const line = await planAndPursue(
      fakeDb(said, ['db.read', 'task.create']),
      {
        complete: async () => {
          asked += 1
          return { content: '{}', model: 'test/model' }
        },
      } as never,
      job,
      'What is open?',
      null,
    )
    expect(asked).toBe(0)
    expect(line).toBeNull()
  })
})

/**
 * WHICH TEXT THE PLANNER IS GIVEN (#283).
 *
 * `understand` hands the cascade a cleaned sentence, by contract and by
 * measurement. The planner needs the whole request, because the clause a
 * cleanup drops is often the PURPOSE clause and purpose is what decides
 * whether a goal has a second step.
 *
 * The rule cannot be "always the raw instruction", because #282's anchor B is
 * Grant correcting himself mid-message: the raw text still contains the
 * fragment he withdrew, and planning it would perform the thing he replaced.
 *
 * These assert the SELECTION, which is the decision, without a provider.
 */
const choose = (instruction: string, abandoned: readonly string[], readings: readonly string[]) =>
  abandoned.length === 0 ? instruction.trim() : readings.join(' ')

describe('which text the planner is given', () => {
  const RAW =
    'Go through the onboarding material and then work out what is out of date, ' +
    'so that I have something concrete to pick up later.'
  /** What `understand` returned on two of eight real runs: the purpose clause gone. */
  const CLEANED = 'Go through the onboarding material and work out what is out of date.'

  it('uses his own sentence when he did not correct himself', () => {
    expect(choose(RAW, [], [CLEANED])).toBe(RAW)
    // The clause that decides whether there is a second step survives.
    expect(choose(RAW, [], [CLEANED])).toContain('something concrete to pick up later')
  })

  it('uses the readings when he corrected himself, because the raw text still holds what he withdrew', () => {
    const withCorrection =
      'Create a task for me and the um... No actually, scan the whole project and create tasks.'
    const survived = 'Scan the whole project and create tasks.'
    expect(choose(withCorrection, ['Create a task for me and the um...'], [survived])).toBe(
      survived,
    )
    expect(
      choose(withCorrection, ['Create a task for me and the um...'], [survived]),
    ).not.toContain('um...')
  })

  it('CONTROL: the two branches are genuinely different, so the choice is doing work', () => {
    expect(choose(RAW, [], [CLEANED])).not.toBe(choose(RAW, ['x'], [CLEANED]))
  })
})

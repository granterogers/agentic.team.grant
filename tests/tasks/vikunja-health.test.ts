/**
 * An outage of Vikunja is recorded where Settings reads it (0981). The real duty (`tasksSyncHandler`) and the real
 * `VikunjaProvider` run over an in-memory Vikunja with injected faults; the database is a recorder that answers by function
 * name, so what is asserted is WHICH reading each round leaves behind and that the watermark never moves on a failure. The
 * SQL itself is driven in scripts/isolated/vikunja-health.ts.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { tasksSyncHandler } from '../../src/handlers/tasks-sync.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { outcomeOfError, outcomeOfReport, recordVikunjaHealth } from '../../src/tasks/health.ts'
import { VikunjaProvider } from '../../src/tasks/vikunja.ts'
import { FakeVikunja } from './fake-vikunja.ts'

const OFFICE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const JOB = '3b3de5e5-59da-4cb9-9382-b8a9742008eb'
const job = {
  jobId: JOB,
  kind: 'tasks.sync',
  correlationId: JOB,
  projectId: null,
  idempotencyKey: JOB,
  attempt: 1,
} as unknown as Job

const world = (opts: { pushedStamp?: string } = {}) => {
  const sql: string[] = []
  const db = {
    kind: 'fake',
    execute: async (q: string) => {
      sql.push(q)
      if (q.includes('app.vikunja_settings'))
        return { rows: [{ v: { configured: true, base_url: 'https://v.test', project_id: 1 } }] }
      if (q.includes('deployment_credential'))
        return { rows: [{ v: 'tk_abcdefghijklmnopqrstuvwxyz012345' }] }
      if (q.includes('app.job_office')) return { rows: [{ o: OFFICE }] }
      if (q.includes('app.tasks_to_push')) return { rows: [{ v: { upserts: [], deletes: [] } }] }
      if (q.includes('app.vikunja_health_record')) return { rows: [{ r: { ok: true } }] }
      return { rows: [{ v: { ok: true } }] }
    },
  } as unknown as SqlExecutor
  void opts
  return { db, sql, health: () => sql.filter((q) => q.includes('app.vikunja_health_record')) }
}
const tick = async (v: FakeVikunja, w: ReturnType<typeof world>) =>
  tasksSyncHandler(w.db, {
    provider: (c) =>
      new VikunjaProvider({
        baseUrl: c.baseUrl,
        token: c.token,
        projectId: c.projectId,
        fetch: v.fetch,
      }),
  }).handle(job, w.db)

describe('the outcome of a round', () => {
  it('maps a round to a reading from what it reported, never from text', () => {
    expect(outcomeOfReport({ down: null, downKind: null })).toEqual({ ok: true })
    expect(outcomeOfReport({ down: 'http 503', downKind: 'unreachable' })).toMatchObject({
      ok: false,
      kind: 'unreachable',
      detail: 'http 503',
    })
    expect(
      outcomeOfReport({ down: 'the token was refused (http 401)', downKind: 'refused' }),
    ).toMatchObject({ ok: false, kind: 'refused' })
    // an unlabelled down is an outage, not a refusal, so it can never raise a reconnect chore
    expect(outcomeOfReport({ down: 'x' })).toMatchObject({ kind: 'unreachable' })
    expect(outcomeOfError(new Error('http 404'))).toMatchObject({ ok: false, kind: 'failed' })
  })
})

describe('the duty records the connection after every round', () => {
  it('a healthy round records ok', async () => {
    const w = world()
    await tick(new FakeVikunja(), w)
    expect(w.health()).toHaveLength(1)
    expect(w.health()[0]).toMatch(/, true, null, null\)/)
  })
  it('a 503 outage records unreachable with the reason, and changes nothing in the office', async () => {
    const w = world()
    const v = new FakeVikunja()
    v.faults = [{ on: 'GET /projects/1/tasks', status: 503 }]
    const out = await tick(v, w)
    expect(w.health()).toHaveLength(1)
    expect(w.health()[0]).toContain("false, 'unreachable'")
    expect(w.health()[0]).toContain('503')
    expect(out.announce).toBe(true)
    // the watermark: nothing marked a task as pushed or pulled
    expect(w.sql.some((q) => /task_pushed|task_pulled|task_delete_pushed/.test(q))).toBe(false)
  })
  it('a refused token records refused', async () => {
    const w = world()
    const v = new FakeVikunja()
    v.faults = [{ on: 'GET /projects/1/tasks', status: 401 }]
    await tick(v, w)
    expect(w.health()[0]).toContain("false, 'refused'")
    expect(w.health()[0]).toContain('http 401')
  })
  it('recovery: the next healthy round records ok again', async () => {
    const w = world()
    const v = new FakeVikunja()
    v.faults = [{ on: 'GET /projects/1/tasks', status: 503, times: 1 }]
    await tick(v, w)
    await tick(v, w)
    expect(w.health().map((q) => (q.includes("false, 'unreachable'") ? 'down' : 'ok'))).toEqual([
      'down',
      'ok',
    ])
  })
  it('a round that THROWS records failed and still throws', async () => {
    const w = world()
    const v = new FakeVikunja()
    v.faults = [{ on: 'GET /projects/1/tasks', status: 404 }]
    await expect(tick(v, w)).rejects.toThrow()
    expect(w.health()[0]).toContain("false, 'failed'")
  })
  it('control: nothing is recorded when Vikunja is not configured (a choice, not an outage)', async () => {
    const w = world()
    const db = {
      kind: 'fake',
      execute: async (q: string) => {
        w.sql.push(q)
        return { rows: [{ v: { configured: false } }] }
      },
    } as unknown as SqlExecutor
    await tasksSyncHandler(db).handle(job, db)
    expect(w.health()).toHaveLength(0)
  })
})

describe('recording never fails the round', () => {
  it('a database without 0981 reports the problem as a value and the duty still returns', async () => {
    const w = world()
    const inner = w.db
    const db = {
      kind: 'fake',
      execute: async (q: string) => {
        if (q.includes('vikunja_health_record'))
          throw new Error('function app.vikunja_health_record does not exist')
        return inner.execute(q)
      },
    } as unknown as SqlExecutor
    const said = await recordVikunjaHealth(db, OFFICE, { ok: true })
    expect(said).toMatch(/could not record/)
    const out = await tasksSyncHandler(db, {
      provider: (c) =>
        new VikunjaProvider({
          baseUrl: c.baseUrl,
          token: c.token,
          projectId: c.projectId,
          fetch: new FakeVikunja().fetch,
        }),
    }).handle(job, db)
    expect(String(out.body)).toMatch(/agree/)
  })
  it('the sentence is escaped into the call, so a quote in a failure cannot break out of it', async () => {
    const w = world()
    await recordVikunjaHealth(w.db, OFFICE, { ok: false, kind: 'failed', detail: "it's 'bad'" })
    expect(w.health()[0]).toContain("it''s ''bad''")
  })
})

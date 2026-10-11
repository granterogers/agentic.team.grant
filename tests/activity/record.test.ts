/**
 * The worker's way into the unified activity ledger (src/activity/record.ts, migration 1060).
 *
 * What the isolated proofs cannot say cheaply: the exact statement the worker sends, that it is best effort, and that the sweep
 * itself calls it. Each assertion about a call is made on the wired expression, not on a name appearing in a file.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recordRecovered } from '../../src/activity/record.ts'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { recoverStalled } from '../../src/jobs/worker.ts'

const executor = (
  answer: (sql: string) => SqlResult | Error,
): { db: SqlExecutor; statements: string[] } => {
  const statements: string[] = []
  const db = {
    kind: 'test',
    execute: async (sql: string) => {
      statements.push(sql)
      const r = answer(sql)
      if (r instanceof Error) throw r
      return r
    },
  } as unknown as SqlExecutor
  return { db, statements }
}
const none: SqlResult = { rows: [] } as unknown as SqlResult

describe('recordRecovered', () => {
  it('sends one best-effort write per reclaimed job, keyed on the job and its attempt', async () => {
    const { db, statements } = executor(() => none)
    await recordRecovered(db, [
      {
        jobId: '5b6f0c1e-1234-4abc-9def-0123456789ab',
        fromState: 'running',
        reason: 'lease expired',
      },
      {
        jobId: '6c7a1d2f-2345-4bcd-8e01-123456789abc',
        fromState: 'committing',
        reason: 'lease expired',
      },
    ])
    expect(statements).toHaveLength(2)
    for (const s of statements) {
      expect(s).toContain('app.record_activity_safely(')
      expect(s).toContain("p_event_type => 'system.recovered'")
      expect(s).toContain("'recovery:' || j.job_id::text || ':' || j.attempt::text")
      expect(s).toContain("p_actor_kind => 'system'")
    }
    expect(statements[0]).toContain("where j.job_id = '5b6f0c1e-1234-4abc-9def-0123456789ab'::uuid")
  })

  it('takes the office, project and correlation from the job row, never from the caller', async () => {
    const { db, statements } = executor(() => none)
    await recordRecovered(db, [
      { jobId: '5b6f0c1e-1234-4abc-9def-0123456789ab', fromState: 'running', reason: 'x' },
    ])
    const s = statements[0] ?? ''
    expect(s).toContain('p_office => j.office_id')
    expect(s).toContain('p_project_id => j.project_id')
    expect(s).toContain('p_correlation_id => j.correlation_id')
  })

  it('stores a state name and an attempt and nothing a person wrote: the reason text is not sent at all', async () => {
    const { db, statements } = executor(() => none)
    await recordRecovered(db, [
      {
        jobId: '5b6f0c1e-1234-4abc-9def-0123456789ab',
        fromState: 'running',
        reason: 'SECRET REASON TEXT',
      },
    ])
    expect(statements[0]).not.toContain('SECRET REASON TEXT')
  })

  it('quotes what it interpolates', async () => {
    const { db, statements } = executor(() => none)
    await recordRecovered(db, [
      {
        jobId: '5b6f0c1e-1234-4abc-9def-0123456789ab',
        fromState: "x'); drop table jobs; --",
        reason: '',
      },
    ])
    expect(statements[0]).toContain("'x''); drop table jobs; --'")
  })

  it('never throws when the ledger cannot be reached or the function is missing', async () => {
    const { db, statements } = executor(
      () => new Error('function app.record_activity_safely does not exist'),
    )
    await expect(
      recordRecovered(db, [
        { jobId: '5b6f0c1e-1234-4abc-9def-0123456789ab', fromState: 'running', reason: '' },
      ]),
    ).resolves.toBeUndefined()
    expect(statements).toHaveLength(1)
  })

  it('writes nothing for an empty sweep', async () => {
    const { db, statements } = executor(() => none)
    await recordRecovered(db, [])
    expect(statements).toHaveLength(0)
  })
})

describe('the recovery sweep calls it', () => {
  const stalled = {
    rows: [
      {
        job_id: '5b6f0c1e-1234-4abc-9def-0123456789ab',
        from_state: 'running',
        reason: 'lease expired',
      },
    ],
  } as unknown as SqlResult

  it('records each reclaimed job and still returns them', async () => {
    const { db, statements } = executor((sql) =>
      sql.includes('app.recover_stalled_jobs()') ? stalled : none,
    )
    const out = await recoverStalled(db)
    expect(out.map((r) => r.jobId)).toEqual(['5b6f0c1e-1234-4abc-9def-0123456789ab'])
    expect(statements.filter((s) => s.includes('app.record_activity_safely'))).toHaveLength(1)
  })

  it('is not stopped by a ledger that refuses every write', async () => {
    const { db } = executor((sql) =>
      sql.includes('record_activity_safely')
        ? new Error('ledger unavailable')
        : sql.includes('app.recover_stalled_jobs()')
          ? stalled
          : none,
    )
    const out = await recoverStalled(db)
    expect(out).toHaveLength(1)
  })

  it("wires the call with the sweep's own rows, before the requeue (the wired expression, not a name)", () => {
    const src = readFileSync('src/jobs/worker.ts', 'utf8')
    const a = src.indexOf('export const recoverStalled')
    const b = src.indexOf('select app.requeue_retrying()', a)
    const body = src.slice(a, b)
    expect(body).toMatch(
      /await recordRecovered\(\s*db,\s*\(rows as \{ job_id: string; from_state: string; reason: string \}\[\]\)\.map/,
    )
  })
})

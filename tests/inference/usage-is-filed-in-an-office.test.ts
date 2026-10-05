import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { recordUsage } from '../../src/inference/record.ts'

/*
  Multi-user P3. Every model call is filed in an office, explicitly. A call made for a job is the job's office; a call with no
  job (a capability probe, a health check) is the DEPLOYMENT's own and is filed in the system office. It must never be left to
  the compatibility bridge: with one person on the deployment the bridge files an unattributed row under that person, and 81 of
  Grant's own rows were deployment overhead for that reason.
*/
const recorder = () => {
  const seen: string[] = []
  const db = {
    execute: async (sql: string) => {
      seen.push(sql.replace(/\s+/g, ' '))
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  return { db, seen }
}
const base = {
  provider: 'openrouter',
  modelId: 'm',
  correlationId: '11111111-1111-4111-8111-111111111111',
  outcome: 'ok' as const,
  providerReportedCost: null,
}

describe('recordUsage names the office the usage belongs to', () => {
  it('a call for a job is filed in that job’s office, resolved in SQL from the claimed job', async () => {
    const { db, seen } = recorder()
    await recordUsage(db, { ...base, jobId: '22222222-2222-4222-8222-222222222222' })
    const sql = seen[0] ?? ''
    expect(sql).toMatch(/insert into public\.inference_usage \(office_id,/)
    expect(sql).toMatch(/values \(app\.job_office\('22222222-2222-4222-8222-222222222222'::uuid\),/)
  })

  it('a call with no job is the deployment’s own: filed in the system office, never left to the bridge', async () => {
    const { db, seen } = recorder()
    await recordUsage(db, { ...base })
    const sql = seen[0] ?? ''
    expect(sql).toMatch(/insert into public\.inference_usage \(office_id,/)
    expect(sql).toMatch(/values \(app\.require_office\(app\.system_office\(\)\),/)
  })

  it('CONTROL: the old shape (no office column when there is no job) would not match', () => {
    const old = 'insert into public.inference_usage (provider, model_id, correlation_id'
    expect(/insert into public\.inference_usage \(office_id,/.test(old)).toBe(false)
  })
})

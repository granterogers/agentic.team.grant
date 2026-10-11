/**
 * Native tool-call events (src/activity/record.ts `recordToolCall`, wired in src/agents/perform.ts).
 *
 * The replica proof (scripts/isolated/activity-native-writers.ts) drives the SQL. What it cannot say cheaply: exactly what the
 * statement carries and does not carry, that a down ledger cannot fail a step, and that the plan executor calls it on the path
 * where the policy said proceed and nowhere else. Each assertion about a call is made on the wired expression, bounded by both
 * ends of the block it must sit in.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recordToolCall } from '../../src/activity/record.ts'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'

const recorder = (fail = false): { db: SqlExecutor; statements: string[] } => {
  const statements: string[] = []
  const db = {
    kind: 'test',
    execute: async (sql: string): Promise<SqlResult> => {
      statements.push(sql)
      if (fail) throw new Error('ledger unreachable')
      return { rows: [] } as unknown as SqlResult
    },
  } as unknown as SqlExecutor
  return { db, statements }
}

describe('recordToolCall', () => {
  it('writes one best-effort statement through the safe writer, naming the type, the job and the step', async () => {
    const { db, statements } = recorder()
    await recordToolCall(db, {
      jobId: '11111111-1111-1111-1111-111111111111',
      capability: 'drive.read',
      step: 's1',
      specialist: 'research-director',
      phase: 'completed',
      outcome: 'found',
      durationMs: 123.6,
    })
    expect(statements).toHaveLength(1)
    const sql = statements[0] as string
    expect(sql).toContain('app.record_activity_safely')
    expect(sql).toContain(`p_event_type => 'tool.call_completed'`)
    expect(sql).toContain(`'11111111-1111-1111-1111-111111111111'::uuid`)
    expect(sql).toContain(`'duration_ms', 124`)
    expect(sql).toContain(`'outcome', 'found'`)
    expect(sql).toContain(`p_agent_slug => 'research-director'`)
    expect(sql).toContain(`p_actor_kind => 'agent'`)
  })

  it('keys by job, step, phase and attempt, so a retried attempt is a new event and a redelivery is not', async () => {
    const { db, statements } = recorder()
    await recordToolCall(db, { jobId: 'a', capability: 'x.y', step: 's1', phase: 'requested' })
    const sql = statements[0] as string
    expect(sql).toMatch(
      /p_idempotency_key => left\('tool:' \|\| j\.job_id::text \|\| ':' \|\| 's1' \|\| ':' \|\| 'requested' \|\| ':' \|\| j\.attempt::text, 200\)/,
    )
  })

  it('carries a capability, a step id and an error CLASS, never an error message, an input or an output', async () => {
    const { db, statements } = recorder()
    await recordToolCall(db, {
      jobId: 'a',
      capability: 'gmail.read',
      step: 's2',
      phase: 'failed',
      errorClass: 'TypeError',
    })
    const sql = statements[0] as string
    expect(sql).toContain(`'error_class', 'TypeError'`)
    // the only free-text value a call can carry is a short, fixed-shape one
    expect(sql).not.toMatch(/message|input|result|output|body|payload/i)
  })

  it('escapes what it interpolates', async () => {
    const { db, statements } = recorder()
    await recordToolCall(db, {
      jobId: 'a',
      capability: "x'; drop table jobs; --",
      step: "s'1",
      phase: 'requested',
    })
    const sql = statements[0] as string
    expect(sql).toContain(`'x''; drop table jobs; --'`)
    expect(sql).toContain(`'s''1'`)
  })

  it('cannot fail a step: a ledger that throws is swallowed', async () => {
    const { db } = recorder(true)
    await expect(
      recordToolCall(db, { jobId: 'a', capability: 'x.y', step: 's', phase: 'completed' }),
    ).resolves.toBeUndefined()
  })
})

describe('the plan executor', () => {
  const source = readFileSync('src/agents/perform.ts', 'utf8')
  // The block between the policy's "ask" branch ending and the step returning its answer: the only place a tool is run.
  const start = source.indexOf('const toolCall = {')
  const end = source.indexOf(
    'return isLater(answered) ? { pause: answered.pause } : { outcome: answered }',
  )
  const block = source.slice(start, end)

  it('records requested, completed and failed around the one executor call, in that block', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(block).toContain(`await recordToolCall(db, { ...toolCall, phase: 'requested' })`)
    expect(block).toContain(`phase: 'completed'`)
    expect(block).toContain(`phase: 'failed'`)
    expect(block.match(/executor\.run\(/g)?.length).toBe(1)
    // order: requested is written before the tool runs, completed after, failed in the catch that rethrows
    expect(block.indexOf(`phase: 'requested'`)).toBeLessThan(block.indexOf('executor.run('))
    expect(block.indexOf('executor.run(')).toBeLessThan(block.indexOf(`phase: 'completed'`))
    expect(block).toMatch(/catch \(error\) \{[\s\S]*phase: 'failed'[\s\S]*throw error/)
  })

  it('runs only after the policy has answered: nothing is recorded for a refusal, a question or an absent executor', () => {
    const policy = source.indexOf('const decision = await mayAct(db, {')
    const refused = source.indexOf(`if (decision.verdict === 'ask') {`)
    expect(policy).toBeGreaterThan(0)
    expect(start).toBeGreaterThan(refused)
    // a step with no executor returns before the policy is even asked, so it can never reach the recorder
    expect(source.indexOf('if (executor === undefined) {')).toBeLessThan(policy)
  })

  it('does not hand the recorder the step inputs', () => {
    const call = block.slice(
      block.indexOf('const toolCall = {'),
      block.indexOf('await recordToolCall('),
    )
    expect(call).not.toMatch(/request|from\b|needs|why/)
  })
})

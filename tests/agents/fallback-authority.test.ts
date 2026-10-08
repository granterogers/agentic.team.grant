/**
 * What a backup-served turn may do on its own, through the REAL `mayAct` over a fake executor (#444).
 *
 * The policy's own answer (`app.authorize_effect`) and the router's trace entry are the two inputs; the verdict is the only output.
 * The replica proof `fallback-turns` (F5) drives the same thing against the real function; this holds the cases a database cannot
 * produce on demand: an unreadable trace must count as served-by-a-fallback, because a downgrade that fails open is no downgrade.
 */
import { describe, expect, it } from 'vitest'
import { mayAct } from '../../src/agents/approval.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

const policy = (over: Record<string, unknown> = {}) => ({
  verdict: 'proceed',
  tool: 'task.create',
  because: 'the dial allows it',
  action_level: 1,
  autonomy: 'act',
  ...over,
})
const executor = (opts: {
  policy: Record<string, unknown>
  trace: boolean | 'throws'
}): SqlExecutor => ({
  kind: 'fake',
  execute: async (sql: string) => {
    if (/authorize_effect/.test(sql)) return { rows: [{ d: opts.policy }] }
    if (/job_traces/.test(sql)) {
      if (opts.trace === 'throws') throw new Error('Failed to run sql query: write CONNECT_TIMEOUT')
      return { rows: [{ f: opts.trace }] }
    }
    return { rows: [] }
  },
})
const JOB = '00000000-0000-0000-0000-000000000001'
const ask = (db: SqlExecutor) => mayAct(db, { projectId: null, tool: 'task.create', job: JOB })

describe('a backup-served turn and the policy', () => {
  it('proceeds when the first model served the turn', async () => {
    expect((await ask(executor({ policy: policy(), trace: false }))).verdict).toBe('proceed')
  })
  it('asks, with its own reason, when a backup served any call in the conversation', async () => {
    const d = await ask(executor({ policy: policy(), trace: true }))
    expect(d.verdict).toBe('ask')
    expect(d.reason).toBe('fallback_model')
    expect(d.because).toMatch(/backup model/)
  })
  it('treats an unreadable trace as served-by-a-fallback (fails closed)', async () => {
    expect((await ask(executor({ policy: policy(), trace: 'throws' }))).verdict).toBe('ask')
  })
  it('leaves a read, an already-approved action and a refusal alone', async () => {
    expect(
      (await ask(executor({ policy: policy({ action_level: 0 }), trace: true }))).verdict,
    ).toBe('proceed')
    expect((await ask(executor({ policy: policy({ approved: true }), trace: true }))).verdict).toBe(
      'proceed',
    )
    expect(
      (await ask(executor({ policy: policy({ verdict: 'refuse' }), trace: true }))).verdict,
    ).toBe('refuse')
  })
  it('does not even ask the trace when nothing could change (no extra query on a read)', async () => {
    let asked = 0
    const db: SqlExecutor = {
      kind: 'fake',
      execute: async (sql: string) => {
        if (/job_traces/.test(sql)) asked += 1
        if (/authorize_effect/.test(sql)) return { rows: [{ d: policy({ action_level: 0 }) }] }
        return { rows: [] }
      },
    }
    await ask(db)
    expect(asked).toBe(0)
  })
})

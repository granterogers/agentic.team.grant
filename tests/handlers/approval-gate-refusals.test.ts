/**
 * `mayStart` refuses what an approval does not cover (deep systems audit, M3, M4, M4b).
 *
 * The three refusals - a claim nothing backs, a recorded yes for something else, and a recorded yes the policy still
 * says no to - were reachable by no test, so each could be gutted with the suite green. They are the last thing between
 * a model's "this was approved" and an effect, so the property is driven: a stub database that would say YES to
 * anything lets the refusals be the only thing standing, and the controls show the same gate still starts work.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { type ApprovalCheck, mayStart } from '../../src/handlers/approval-gate.ts'
import type { Job } from '../../src/jobs/worker.ts'

const job = { jobId: '11111111-1111-4111-8111-111111111111', projectId: null } as unknown as Job

const check = (state: ApprovalCheck['state']): ApprovalCheck => ({
  state,
  why: `approval state is ${state}`,
  fingerprint: 'fp',
  askingJob: '22222222-2222-4222-8222-222222222222',
  blocker: '33333333-3333-4333-8333-333333333333',
})

/** A policy database. `verdict` is what authorize_effect would answer; every other statement answers nothing. */
const database = (verdict: 'proceed' | 'refuse' | 'ask') => {
  const asked: string[] = []
  const db: SqlExecutor = {
    kind: 'stub-policy-database',
    execute: async (sql: string) => {
      asked.push(sql)
      if (sql.includes('authorize_effect')) {
        return {
          rows: [
            { d: { verdict, because: `the policy said ${verdict}`, tool: 'notebook.generate' } },
          ],
        }
      }
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  return { db, asked }
}

describe('mayStart refuses an approval that does not hold, however permissive the policy', () => {
  for (const state of ['none', 'forged', 'mismatch'] as const) {
    it(`refuses ${state} without asking the policy, and says why`, async () => {
      const { db, asked } = database('proceed')
      const start = await mayStart(db, job, check(state), 'notebook.generate')
      expect(start.ok).toBe(false)
      expect(asked).toEqual([])
      if (!start.ok) expect(start.why.length).toBeGreaterThan(0)
    })
  }

  for (const state of ['approved', 'approved_legacy'] as const) {
    it(`refuses a recorded yes (${state}) when the policy says no`, async () => {
      const { db } = database('refuse')
      const start = await mayStart(db, job, check(state), 'notebook.generate')
      expect(start.ok).toBe(false)
      if (!start.ok) expect(start.why).toContain('the policy said refuse')
    })

    it(`CONTROL: a recorded yes (${state}) the policy allows does start`, async () => {
      const { db, asked } = database('proceed')
      const start = await mayStart(db, job, check(state), 'notebook.generate')
      expect(start).toEqual({ ok: true })
      expect(asked.some((s) => s.includes('authorize_effect'))).toBe(true)
    })
  }

  it('asks the policy about the tool being started, not about another', async () => {
    const { db, asked } = database('proceed')
    await mayStart(db, job, check('approved'), 'office.execute_plan')
    expect(asked.join('\n')).toContain("p_tool => 'office.execute_plan'")
  })
})

import { describe, expect, it } from 'vitest'
import { referentCandidates } from '../../src/handlers/instruction.js'

const fake = (answers: ((sql: string) => unknown)[]) => {
  const seen: string[] = []
  return {
    seen,
    execute: async (sql: string) => {
      seen.push(sql)
      const next = answers.shift()
      const out = next?.(sql)
      if (out instanceof Error) throw out
      return out as { rows: unknown[] }
    },
  }
}

const JOB = '22222222-2222-2222-2222-222222222222'

describe('the referent works on either side of 0593 (R42)', () => {
  it('uses the new signature when it exists', async () => {
    const db = fake([() => ({ rows: [{ t: { candidates: [{ id: 'a', title: 'X' }] } }] })])
    const r = await referentCandidates(db as never, '11111111-1111-1111-1111-111111111111', JOB)
    expect((r.rows[0] as { t: { candidates: unknown[] } }).t.candidates).toHaveLength(1)
    expect(db.seen).toHaveLength(1)
  })
  it("asks in the CLAIMED job's office, never one found from the command (0783)", async () => {
    const db = fake([() => ({ rows: [{ t: { candidates: [] } }] })])
    await referentCandidates(db as never, '11111111-1111-1111-1111-111111111111', JOB)
    // The office is the first argument and it is derived from the claimed job.
    expect(db.seen[0]).toMatch(
      new RegExp(`app\\.my_task_referent\\(app\\.job_office\\('${JOB}'::uuid\\), `),
    )
  })
  it('falls back to the one-argument call when the new one does not exist', async () => {
    const db = fake([
      () =>
        new Error(
          'ERROR: 42883: function app.my_task_referent(uuid, p_any_task => boolean) does not exist',
        ),
      () => ({ rows: [{ t: { id: 'b', title: 'Chase the printers' } }] }),
    ])
    const r = await referentCandidates(db as never, '11111111-1111-1111-1111-111111111111', JOB)
    expect((r.rows[0] as { t: { candidates: unknown[] } }).t.candidates).toEqual([
      { id: 'b', title: 'Chase the printers' },
    ])
    expect(db.seen[1]).not.toContain('p_any_task')
  })
  it('an ambiguous old answer carries no ids, so no candidates', async () => {
    const db = fake([
      () => new Error('does not exist'),
      () => ({ rows: [{ t: { ambiguous: 2, titles: ['a', 'b'] } }] }),
    ])
    const r = await referentCandidates(db as never, '', JOB)
    expect((r.rows[0] as { t: { candidates: unknown[] } }).t.candidates).toEqual([])
  })
  // Control: a real failure is not an absent function.
  it('any other error still throws', async () => {
    const db = fake([() => new Error('ERROR: 57014: canceling statement due to statement timeout')])
    await expect(referentCandidates(db as never, '', JOB)).rejects.toThrow(/timeout/)
  })
})

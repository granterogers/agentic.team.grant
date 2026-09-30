import { describe, expect, it } from 'vitest'
import { pauseJob } from '../../src/jobs/checkpoint.js'

const pause = { reason: 'awaiting_approval', detail: 'd', resumeWhen: 'an answer' } as never
const held = { leasedBy: 'w1', claimGen: 4 } as never

const exec = (fail: (sql: string) => Error | null) => {
  const calls: string[] = []
  return {
    calls,
    db: {
      execute: async (sql: string) => {
        calls.push(sql)
        const e = fail(sql)
        if (e) throw e
        return []
      },
    } as never,
  }
}

describe('pauseJob under a claim', () => {
  it('passes the claim when the database has the fenced arity', async () => {
    const x = exec(() => null)
    await pauseJob(x.db, 'j', pause, held)
    expect(x.calls).toHaveLength(1)
    expect(x.calls[0]).toContain("p_worker => 'w1'")
    expect(x.calls[0]).toContain('p_gen => 4')
  })
  it('falls back only when the fenced arity does not exist', async () => {
    const x = exec((s) =>
      s.includes('p_worker') ? new Error('42883 function does not exist') : null,
    )
    await pauseJob(x.db, 'j', pause, held)
    expect(x.calls).toHaveLength(2)
    expect(x.calls[1]).not.toContain('p_worker')
  })
  it('a stale-claim refusal is never retried unfenced', async () => {
    const x = exec(() => new Error('stale worker: claim lost'))
    await expect(pauseJob(x.db, 'j', pause, held)).rejects.toThrow(/stale/)
    expect(x.calls).toHaveLength(1)
  })
})

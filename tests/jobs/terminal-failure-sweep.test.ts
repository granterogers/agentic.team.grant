/**
 * `sweepOwedWords` (1024): a death by SQL speaks exactly as one through `runJob`.
 *
 * Behavioural, against a fake executor that answers the SQL the sweep and `lastWord` ask. The SQL itself is proved on
 * the replica (`scripts/isolated/terminal-job-owes-a-word.ts`); this pins the decisions the TypeScript makes: who it
 * calls, how many, what one failure does to the next, what it does with no notifier, and that "already handled" is not
 * counted as told.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { sweepOwedWords } from '../../src/jobs/lastword.ts'

interface Fake {
  readonly db: SqlExecutor
  readonly claimed: string[]
  readonly settled: string[]
  readonly notified: string[]
}

const owing = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    job_id: `00000000-0000-0000-0000-00000000000${i}`,
    correlation_id: `10000000-0000-0000-0000-00000000000${i}`,
    project_id: null,
    kind: 'office.instruction',
    office_id: '20000000-0000-0000-0000-000000000000',
  }))

const fake = (opts: {
  rows: unknown[]
  lose?: ReadonlySet<string>
  sweepThrows?: boolean
}): Fake => {
  const claimed: string[] = []
  const settled: string[] = []
  const id = (sql: string) => /([0-9a-f-]{36})/.exec(sql)?.[1] ?? ''
  const db = {
    execute: async (sql: string) => {
      if (sql.includes('app.jobs_owing_a_word')) {
        if (opts.sweepThrows) throw new Error('sweep unavailable')
        return { rows: opts.rows }
      }
      if (sql.includes('app.owed_a_word')) {
        return {
          rows: [
            { channel: 'telegram', account_ref: '1', target_ref: '1', thread_ref: null, kind: 'k' },
          ],
        }
      }
      if (sql.includes('app.claim_last_word')) {
        claimed.push(id(sql))
        return { rows: [{ won: opts.lose?.has(id(sql)) !== true }] }
      }
      if (sql.includes('app.settle_last_word')) {
        settled.push(id(sql))
        return { rows: [] }
      }
      if (sql.includes('voice_file_id')) return { rows: [{ spoken: false }] }
      if (sql.includes('insert into public.outputs')) return { rows: [{ id: 'out-1' }] }
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  return { db, claimed, settled, notified: [] }
}

describe('sweepOwedWords', () => {
  it('tells every owed turn once and records each as told', async () => {
    const f = fake({ rows: owing(3) })
    const told = await sweepOwedWords(f.db, async (job) => {
      f.notified.push(job.jobId)
      return { note: 'stub' } as never
    })
    expect(told).toBe(3)
    expect(f.notified).toHaveLength(3)
    expect(f.settled).toEqual(f.claimed)
  })

  it('does not send for a turn another road already claimed, and does not count it', async () => {
    const rows = owing(2)
    const lost = rows[0]?.job_id as string
    const f = fake({ rows, lose: new Set([lost]) })
    const told = await sweepOwedWords(f.db, async (job) => {
      f.notified.push(job.jobId)
      return { note: 'stub' } as never
    })
    expect(f.notified).not.toContain(lost)
    expect(f.notified).toHaveLength(1)
    expect(told).toBe(1)
  })

  it('a notifier that throws is not told, is not settled, and does not stop the next turn', async () => {
    const rows = owing(2)
    const first = rows[0]?.job_id as string
    const f = fake({ rows })
    const told = await sweepOwedWords(f.db, async (job) => {
      f.notified.push(job.jobId)
      if (job.jobId === first) throw new Error('notifier down')
      return { note: 'stub' } as never
    })
    expect(f.notified).toHaveLength(2)
    expect(told).toBe(1)
    expect(f.settled).not.toContain(first)
  })

  it('says nothing without a notifier, and never exceeds its limit', async () => {
    const f = fake({ rows: owing(5) })
    expect(await sweepOwedWords(f.db, undefined)).toBe(0)
    expect(f.claimed).toHaveLength(0)
    const g = fake({ rows: owing(5) })
    const told = await sweepOwedWords(g.db, async () => ({ note: 'stub' }) as never, 2)
    expect(told).toBe(2)
  })

  it('a sweep that cannot be read is not a failure of the tick', async () => {
    const f = fake({ rows: [], sweepThrows: true })
    await expect(sweepOwedWords(f.db, async () => ({ note: 'stub' }) as never)).resolves.toBe(0)
  })
})

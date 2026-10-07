import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isFirstWrite, type WriteEvent } from '../../scripts/rollout/gate-lib.ts'
import { writeLedgerRow } from '../../scripts/rollout/ledger-write.ts'
import { logWrite, readLines, WRITE_LOG } from '../../scripts/rollout/log.ts'

/*
  Found on the first production `record --go` (7 October 2026): the ledger row was written and the tool said so, but the write
  log held only `record-attempt 1023` with ok:false, because only apply and rollback ever logged a completion. A log that cannot
  tell a successful record from a crashed one is not an audit trail. These drive the real writer with a fake executor and read the
  real log back; nothing here reaches a network.
*/
const fake = (afterCount: number | 'throw') => {
  const sql: string[] = []
  return {
    sql,
    execute: async (q: string) => {
      sql.push(q)
      if (afterCount === 'throw' && !q.startsWith('select')) throw new Error('boom')
      return { rows: q.startsWith('select') ? [{ n: afterCount }] : [] }
    },
  }
}
const run = (action: 'record' | 'unrecord', db: ReturnType<typeof fake>) =>
  writeLedgerRow({
    db,
    action,
    stepId: '1023',
    name: '1023_x.sql',
    sha256: 'ab'.repeat(32),
    logWrite,
  })
const log = (): WriteEvent[] => readLines<WriteEvent>(WRITE_LOG)

let cwd = ''
beforeEach(() => {
  cwd = process.cwd()
  process.chdir(mkdtempSync(join(tmpdir(), 'ledger-')))
})
afterEach(() => {
  process.chdir(cwd)
  vi.restoreAllMocks()
})

describe('what a ledger write leaves in the rollout write log', () => {
  it('a successful record ends in a completed entry with ok:true, after the attempt', async () => {
    const r = await run('record', fake(1))
    expect(r).toEqual({ ok: true, after: 1 })
    expect(log().map((l) => [l.what, l.ok])).toEqual([
      ['record-attempt 1023', false],
      ['record 1023', true],
    ])
  })

  it('a successful unrecord is the same shape under its own name', async () => {
    await run('unrecord', fake(0))
    expect(log().map((l) => [l.what, l.ok])).toEqual([
      ['unrecord-attempt 1023', false],
      ['unrecord 1023', true],
    ])
  })

  it('a write whose result is not what was asked ends in a completed entry with ok:false, which differs from success', async () => {
    const r = await run('record', fake(0))
    expect(r.ok).toBe(false)
    const last = log().at(-1)
    expect(last?.what).toBe('record 1023')
    expect(last?.ok).toBe(false)
    expect(last?.detail).toMatch(/not what was asked/)
  })

  it('a write that throws is closed as a failed completion and the error still reaches the caller', async () => {
    await expect(run('record', fake('throw'))).rejects.toThrow('boom')
    const last = log().at(-1)
    expect(last?.what).toBe('record 1023')
    expect(last?.ok).toBe(false)
    expect(last?.detail).toBe('threw')
    expect(JSON.stringify(log())).not.toContain('boom')
  })

  it('a bare attempt is the only thing a crashed process can leave, so every finished call must close it', async () => {
    for (const [action, db] of [
      ['record', fake(1)],
      ['unrecord', fake(0)],
      ['record', fake(0)],
    ] as const) {
      await run(action, db)
    }
    const names = log().map((l) => l.what)
    const attempts = names.filter((n) => n.includes('-attempt')).length
    const completions = names.filter((n) => !n.includes('-attempt')).length
    expect(completions).toBe(attempts)
  })

  it('does not look like an apply to the first-write rule', async () => {
    await run('record', fake(1))
    expect(isFirstWrite(log())).toBe(true)
  })

  it('step.ts reaches the ledger only through writeLedgerRow, with the real logger, and keeps no inline copy', () => {
    const src = readFileSync(join(cwd, 'scripts/rollout/step.ts'), 'utf8')
    // The wired call, bounded at both ends: an import line or a mention in a comment is not a call.
    const start = src.indexOf('= await writeLedgerRow({')
    expect(start).toBeGreaterThan(0)
    const call = src.slice(start, src.indexOf('})', start) + 2)
    expect(call).toMatch(/\bdb,/)
    expect(call).toMatch(/\bsha256: S\.migrationSha256,/)
    expect(call).toMatch(/\blogWrite,/)
    // the old inline path logged only the attempt; no second writer of the ledger may come back
    expect(src).not.toMatch(/insert into app\.schema_migrations/)
    expect(src).not.toMatch(/\$\{action\}-attempt/)
  })

  it('writes one statement and no other: the insert names the row and the pinned checksum', async () => {
    const db = fake(1)
    await run('record', db)
    expect(db.sql.filter((s) => !s.startsWith('select'))).toHaveLength(1)
    expect(db.sql[0]).toContain("'1023_x.sql'")
    expect(db.sql[0]).toContain('ab'.repeat(32))
  })
})

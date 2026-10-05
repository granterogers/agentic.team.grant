import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { applyFresh } from '../../src/migrations/fresh.ts'

/** Executor that fails any statement containing "boom" and records what ran. */
const fake = (): { ran: string[]; ex: SqlExecutor } => {
  const ran: string[] = []
  const ex = {
    execute: async (sql: string) => {
      ran.push(sql)
      if (sql.includes('boom')) throw new Error('P0001: boom happened')
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  return { ran, ex }
}
const sql = 'create table a(x int); do $$ begin perform boom; end $$; create table b(x int);'

describe('applyFresh', () => {
  it('applies a clean file whole, in one request', async () => {
    const { ran, ex } = fake()
    const r = await applyFresh({ name: '0100_x.sql', sql: 'select 1; select 2;' }, ex, {})
    expect(ran).toEqual(['select 1; select 2;'])
    expect(r.tolerated).toEqual([])
  })
  it('never replays a failing file statement by statement unless it is listed', async () => {
    const { ran, ex } = fake()
    await expect(applyFresh({ name: '0100_x.sql', sql }, ex, {})).rejects.toThrow('boom')
    expect(ran).toHaveLength(1)
  })
  it('tolerates only the listed message, keeps the rest of the file, and stops at any other error', async () => {
    const { ran, ex } = fake()
    const r = await applyFresh({ name: '0100_x.sql', sql }, ex, { '0100_x.sql': ['boom happened'] })
    expect(r.tolerated).toHaveLength(1)
    expect(ran).toContain('create table b(x int)')
    const other = fake()
    await expect(
      applyFresh({ name: '0100_x.sql', sql }, other.ex, { '0100_x.sql': ['something else'] }),
    ).rejects.toThrow('not on the tolerance list')
  })
  it('never tolerates a failing schema statement, even with its message listed', async () => {
    const { ex } = fake()
    const ddl =
      'create table a(x int); create function boom() returns int as $$ select 1 $$ language sql;'
    await expect(
      applyFresh({ name: '0100_x.sql', sql: ddl }, ex, { '0100_x.sql': ['boom happened'] }),
    ).rejects.toThrow('not a self-check')
  })
  it('may skip a failing do block or seed insert when listed', async () => {
    const { ex } = fake()
    const r = await applyFresh(
      {
        name: '0100_x.sql',
        sql: "-- check\ndo $$ begin perform boom; end $$; insert into t values ('boom');",
      },
      ex,
      { '0100_x.sql': ['boom happened'] },
    )
    expect(r.skipped).toHaveLength(2)
  })
  it('is atomic from 0592 on even when listed', async () => {
    const { ran, ex } = fake()
    await expect(
      applyFresh({ name: '0592_x.sql', sql }, ex, { '0592_x.sql': ['boom happened'] }),
    ).rejects.toThrow('boom')
    expect(ran).toHaveLength(1)
  })
})

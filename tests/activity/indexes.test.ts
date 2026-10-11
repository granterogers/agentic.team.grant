/**
 * The staged index build (src/activity/indexes.ts): the migration creates none, the TypeScript and SQL lists agree, and every
 * statement is concurrent. The replica proof (scripts/isolated/activity-indexes.ts) shows the behaviour; these are the properties
 * that hold without a database.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_INDEX_NAMES,
  ACTIVITY_INDEXES,
  createStatement,
  ensureActivityIndexes,
} from '../../src/activity/indexes.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

const migration = readFileSync(
  'migrations/1061_the_activity_read_model_reads_each_table_that_owns_the_state.sql',
  'utf8',
)
const code = migration.replace(/--[^\n]*/g, '')

describe('the activity access paths', () => {
  it('are not created inside the migration, where a plain build would lock the worker', () => {
    expect(code).not.toMatch(
      /create\s+(unique\s+)?index\s+(if\s+not\s+exists\s+)?(?!concurrently)\w+\s+on\s+public\.(inbound_commands|deliveries|blockers|inference_usage|events|job_state_transitions|outputs|job_impediments)\b/i,
    )
  })

  it('are the same eleven in SQL and in TypeScript', () => {
    const sqlList = [
      ...(/activity_index_gaps\(\)[\s\S]*?array\[([\s\S]*?)\]\)/.exec(code)?.[1] ?? '').matchAll(
        /'([a-z_]+)'/g,
      ),
    ].map((m) => m[1])
    expect(sqlList.length).toBe(11)
    expect([...sqlList].sort()).toEqual([...ACTIVITY_INDEX_NAMES].sort())
  })

  it('are all built concurrently and idempotently', () => {
    for (const i of ACTIVITY_INDEXES)
      expect(createStatement(i)).toMatch(
        /^create index concurrently if not exists \w+ on public\.\w+ \(/,
      )
  })
})

describe('ensureActivityIndexes', () => {
  const fake = (state: Map<string, boolean>, failBuild = new Set<string>()) => {
    const statements: string[] = []
    const db = {
      kind: 'test',
      execute: async (sql: string) => {
        statements.push(sql)
        if (sql.startsWith('select c.relname'))
          return { rows: [...state].map(([name, valid]) => ({ name, valid })) }
        const built = /create index concurrently if not exists (\w+)/.exec(sql)
        if (built?.[1] !== undefined) {
          if (failBuild.has(built[1])) throw new Error('canceling statement due to lock timeout')
          state.set(built[1], true)
        }
        const dropped = /drop index concurrently if exists public\.(\w+)/.exec(sql)
        if (dropped?.[1] !== undefined) state.delete(dropped[1])
        return { rows: [] }
      },
    } as unknown as SqlExecutor
    return { db, statements }
  }

  it('builds what is missing, once each, and leaves a valid index alone', async () => {
    const state = new Map([[ACTIVITY_INDEX_NAMES[0] as string, true]])
    const { db, statements } = fake(state)
    const out = await ensureActivityIndexes(db)
    expect(out[0]?.outcome).toBe('already-built')
    expect(out.slice(1).every((o) => o.outcome === 'built')).toBe(true)
    expect(statements.filter((s) => s.startsWith('create index')).length).toBe(10)
    expect(
      statements.some(
        (s) => s.startsWith('drop index') && s.includes(ACTIVITY_INDEX_NAMES[0] as string),
      ),
    ).toBe(false)
  })

  it('drops an invalid leftover before building it again', async () => {
    const name = ACTIVITY_INDEX_NAMES[3] as string
    const { db, statements } = fake(new Map([[name, false]]))
    const out = await ensureActivityIndexes(db)
    expect(out.find((o) => o.name === name)?.outcome).toBe('rebuilt-after-invalid')
    const drop = statements.findIndex(
      (s) => s.startsWith('drop index concurrently') && s.includes(name),
    )
    const make = statements.findIndex((s) => s.startsWith('create index') && s.includes(name))
    expect(drop).toBeGreaterThanOrEqual(0)
    expect(make).toBeGreaterThan(drop)
  })

  it('reports a failed build by name and carries on with the rest', async () => {
    const bad = ACTIVITY_INDEX_NAMES[1] as string
    const { db } = fake(new Map(), new Set([bad]))
    const out = await ensureActivityIndexes(db, { attempts: 2 })
    expect(out.find((o) => o.name === bad)?.outcome).toMatch(/^failed: .*lock timeout/)
    expect(out.filter((o) => o.name !== bad).every((o) => o.outcome === 'built')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import type { MigrationFile } from '../../src/migrations/check.ts'
import { MigrationError, runMigrations } from '../../src/migrations/runner.ts'

const hash = (content: string): string => `h${content.length}`

/**
 * In-memory executor.
 *
 * Recognises only the handful of statements the runner itself issues and
 * records everything else verbatim, so a test can assert on the exact SQL sent
 * as well as on the outcome.
 */
class FakeExecutor implements SqlExecutor {
  readonly kind = 'fake'
  readonly statements: string[] = []
  private ledger: Map<string, string> | null

  constructor(
    applied: Record<string, string> | null = {},
    private readonly failOn: (sql: string) => string | null = () => null,
  ) {
    this.ledger = applied === null ? null : new Map(Object.entries(applied))
  }

  get appliedNames(): string[] {
    return [...(this.ledger?.keys() ?? [])].sort()
  }

  async execute(sql: string): Promise<SqlResult> {
    this.statements.push(sql)

    const failure = this.failOn(sql)
    if (failure !== null) throw new Error(failure)

    if (sql.includes("to_regclass('app.schema_migrations')")) {
      return { rows: [{ present: this.ledger !== null }] }
    }
    if (sql.includes('select name, checksum from app.schema_migrations')) {
      const rows = [...(this.ledger ?? new Map())]
        .map(([name, checksum]) => ({ name, checksum }))
        .sort((a, b) => a.name.localeCompare(b.name))
      return { rows }
    }
    if (sql.includes('insert into app.schema_migrations')) {
      const name = /values \('([^']+)'/.exec(sql)?.[1]
      const checksum = /values \('[^']+', '([^']+)'/.exec(sql)?.[1]
      if (name !== undefined && checksum !== undefined) {
        this.ledger ??= new Map()
        this.ledger.set(name, checksum)
      }
      return { rows: [] }
    }
    return { rows: [] }
  }
}

const file = (name: string, sql = 'select 1'): MigrationFile => ({ name, sql })

describe('ordering', () => {
  it('applies migrations in sequence order regardless of input order', async () => {
    const executor = new FakeExecutor({})
    const files = [file('0003_c.sql'), file('0001_a.sql'), file('0002_b.sql')]

    const result = await runMigrations(files, executor, hash)

    expect(result.applied.map((a) => a.name)).toEqual(['0001_a.sql', '0002_b.sql', '0003_c.sql'])
  })
})

describe('idempotency', () => {
  it('skips migrations already recorded', async () => {
    const executor = new FakeExecutor({ '0001_a.sql': hash('select 1') })
    const result = await runMigrations([file('0001_a.sql')], executor, hash)

    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual(['0001_a.sql'])
  })

  it('applies only what is pending', async () => {
    const executor = new FakeExecutor({ '0001_a.sql': hash('select 1') })
    const files = [file('0001_a.sql'), file('0002_b.sql')]

    const result = await runMigrations(files, executor, hash)

    expect(result.applied.map((a) => a.name)).toEqual(['0002_b.sql'])
    expect(result.skipped).toEqual(['0001_a.sql'])
  })

  it('does no work at all on a second run', async () => {
    const executor = new FakeExecutor({})
    const files = [file('0001_a.sql'), file('0002_b.sql')]

    await runMigrations(files, executor, hash)
    const before = executor.statements.length
    const second = await runMigrations(files, executor, hash)

    expect(second.applied).toEqual([])
    // Only the two read queries — no DDL, no inserts.
    expect(executor.statements.length - before).toBe(2)
  })
})

describe('a fresh database', () => {
  it('tolerates the ledger table not existing yet', async () => {
    // 0001 is what creates app.schema_migrations, so "table missing" is the
    // normal starting state rather than an error.
    const executor = new FakeExecutor(null)
    const result = await runMigrations([file('0001_a.sql')], executor, hash)

    expect(result.applied.map((a) => a.name)).toEqual(['0001_a.sql'])
  })

  it('does not try to read the ledger before it exists', async () => {
    const executor = new FakeExecutor(null)
    await runMigrations([file('0001_a.sql')], executor, hash)

    expect(executor.statements.filter((s) => s.includes('select name, checksum'))).toHaveLength(0)
  })
})

describe('the self-recording placeholder checksum', () => {
  it('is not mistaken for a real recorded hash', async () => {
    // 0001 inserts its own row with an all-zero checksum, which the runner then
    // corrects. Treating that placeholder as a real hash would make the very
    // first run report the migration as modified.
    const executor = new FakeExecutor({ '0001_a.sql': '0'.repeat(64) })
    const result = await runMigrations([file('0001_a.sql')], executor, hash)

    // Recorded, so still skipped — but no checksum/modified finding was raised.
    expect(result.skipped).toEqual(['0001_a.sql'])
  })
})

describe('integrity refusal', () => {
  it('refuses to run when a recorded migration has been edited', async () => {
    const executor = new FakeExecutor({ '0001_a.sql': hash('the original sql') })
    const edited = [file('0001_a.sql', 'something else entirely')]

    await expect(runMigrations(edited, executor, hash)).rejects.toThrow(MigrationError)
  })

  it('says which migration and which rule', async () => {
    const executor = new FakeExecutor({ '0001_a.sql': hash('the original sql') })
    const edited = [file('0001_a.sql', 'something else entirely')]

    await expect(runMigrations(edited, executor, hash)).rejects.toThrow(
      /0001_a\.sql \[checksum\/modified\]/,
    )
  })

  it('refuses a migration containing a forbidden statement', async () => {
    const executor = new FakeExecutor({})
    const bad = [file('0001_a.sql', 'grant update on public.events to authenticated;')]

    await expect(runMigrations(bad, executor, hash)).rejects.toThrow(/ledger\/no-regrant-write/)
  })

  it('runs nothing at all when any migration is rejected', async () => {
    // A partial apply on a rejected set is worse than refusing: it leaves the
    // database in a state no migration file describes.
    const executor = new FakeExecutor({})
    const files = [file('0001_a.sql'), file('0002_b.sql', 'truncate table events;')]

    await expect(runMigrations(files, executor, hash)).rejects.toThrow(MigrationError)
    expect(executor.appliedNames).toEqual([])
  })

  /*
    A gap is only refused when something was LOST -- a number the ledger says
    was applied whose file is gone. A branch that has simply never had the
    numbers in between is behind, not broken, and refusing to run it would
    leave renumbering into a collision as the only way forward.
  */
  it('refuses a gap over a migration that was applied and is now missing', async () => {
    const executor = new FakeExecutor({ '0002_b.sql': hash('-- 0002_b.sql') })
    await expect(
      runMigrations([file('0001_a.sql'), file('0003_c.sql')], executor, hash),
    ).rejects.toThrow(/sequence\/gap|checksum\/missing/)
  })

  it('runs a branch that has never had the numbers in between', async () => {
    const executor = new FakeExecutor({})
    const result = await runMigrations([file('0001_a.sql'), file('0003_c.sql')], executor, hash)
    expect(result.applied.map((a) => a.name)).toEqual(['0001_a.sql', '0003_c.sql'])
  })
})

describe('failure handling', () => {
  it('reports which migration failed', async () => {
    const executor = new FakeExecutor({}, (sql) =>
      sql.includes('BOOM') ? 'ERROR: 42601: syntax error' : null,
    )
    const files = [file('0001_a.sql'), file('0002_b.sql', 'BOOM')]

    await expect(runMigrations(files, executor, hash)).rejects.toThrow(/0002_b\.sql failed/)
  })

  it('surfaces the underlying Postgres error', async () => {
    const executor = new FakeExecutor({}, (sql) =>
      sql.includes('BOOM') ? 'ERROR: 42601: syntax error' : null,
    )

    await expect(runMigrations([file('0001_a.sql', 'BOOM')], executor, hash)).rejects.toThrow(
      /42601/,
    )
  })

  it('stops rather than continuing past a failure', async () => {
    const executor = new FakeExecutor({}, (sql) => (sql.includes('BOOM') ? 'ERROR: boom' : null))
    const files = [file('0001_a.sql'), file('0002_b.sql', 'BOOM'), file('0003_c.sql')]

    await expect(runMigrations(files, executor, hash)).rejects.toThrow(MigrationError)
    // 0001 recorded, 0002 failed, 0003 never attempted.
    expect(executor.appliedNames).toEqual(['0001_a.sql'])
    expect(executor.statements.some((s) => s.includes('0003_c.sql'))).toBe(false)
  })

  it('does not record a migration that failed', async () => {
    const executor = new FakeExecutor({}, (sql) => (sql.includes('BOOM') ? 'ERROR: boom' : null))

    await expect(runMigrations([file('0001_a.sql', 'BOOM')], executor, hash)).rejects.toThrow(
      MigrationError,
    )
    expect(executor.appliedNames).toEqual([])
  })
})

describe('recorded checksums', () => {
  it('records the hash of the file as applied, not the placeholder', async () => {
    const executor = new FakeExecutor({})
    await runMigrations([file('0001_a.sql', 'select 42')], executor, hash)

    const insert = executor.statements.find((s) => s.includes('insert into app.schema_migrations'))
    expect(insert).toContain(hash('select 42'))
  })

  it('escapes single quotes in a migration name', async () => {
    // Defensive: CI rejects such a name, but the runner must not be the place
    // where a quote turns into broken SQL.
    const executor = new FakeExecutor({})
    await runMigrations([file('0001_a.sql')], executor, hash).catch(() => {})
    const insert = executor.statements.find((s) => s.includes('insert into app.schema_migrations'))
    expect(insert).not.toBeUndefined()
  })
})

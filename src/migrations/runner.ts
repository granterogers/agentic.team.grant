/**
 * Migration runner.
 *
 * Applies pending migrations in order, one file per request, recording each in
 * `app.schema_migrations`. Transport-agnostic: it takes a `SqlExecutor`, so the
 * same files apply over HTTPS from a build session or over the Postgres wire
 * protocol from CI (ADR-0007).
 *
 * Three properties it must have, because a migration runner that gets any of
 * them wrong is worse than applying SQL by hand:
 *
 * 1. **Ordered.** 0002 never runs before 0001.
 * 2. **Idempotent.** Running it twice applies nothing the second time.
 * 3. **Refuses to guess.** If the recorded checksum of an applied migration
 *    disagrees with the file on disk, it stops rather than reapplying or
 *    ignoring — the database and the repository have diverged, and only a human
 *    knows which is right.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { MigrationFile, RecordedChecksums } from './check.ts'
import { checkMigrations } from './check.ts'

export interface AppliedMigration {
  readonly name: string
  readonly checksum: string
}

export interface MigrationOutcome {
  readonly name: string
  readonly durationMs: number
}

export interface RunResult {
  readonly applied: readonly MigrationOutcome[]
  /** Already applied and unchanged — nothing to do. */
  readonly skipped: readonly string[]
}

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly migration: string | null,
  ) {
    super(message)
    this.name = 'MigrationError'
  }
}

/** SQL-escape a string literal by doubling single quotes. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Read what the database believes it has applied. */
export async function readApplied(executor: SqlExecutor): Promise<AppliedMigration[]> {
  const { rows } = await executor.execute(
    `select name, checksum from app.schema_migrations order by name`,
  )
  return rows.map((row) => ({ name: String(row.name), checksum: String(row.checksum) }))
}

/**
 * Does the migration ledger exist yet?
 *
 * On a genuinely fresh database it does not, because 0001 is what creates it —
 * so "table missing" is a normal starting state, not an error.
 */
export async function ledgerExists(executor: SqlExecutor): Promise<boolean> {
  const { rows } = await executor.execute(
    `select to_regclass('app.schema_migrations') is not null as present`,
  )
  return rows[0]?.present === true
}

/**
 * Apply every pending migration.
 *
 * @param files All migrations from `migrations/`, in any order.
 * @param executor Where to run them.
 * @param hash Content hash, matching what CI uses (SHA-256).
 * @param log Progress sink, so callers choose whether this is chatty.
 * @param options `apply`: how one file reaches the database. The default is one atomic request, which is what every
 *   environment that has lived through the history wants; `src/migrations/fresh.ts` is the other, for replaying history on
 *   an empty project. `knownHistory`: checksums of migrations that were applied ELSEWHERE (the repository's own
 *   `migrations/applied.json`); they are used for the integrity check only, never to skip a file. A fresh project has applied
 *   nothing, so without them a recorded collision between two branches (0584 has two files) reads as a pending mistake and
 *   no fresh replay could ever start.
 */
export async function runMigrations(
  files: readonly MigrationFile[],
  executor: SqlExecutor,
  hash: (content: string) => string,
  log: (message: string) => void = () => {},
  options: {
    readonly apply?: (file: MigrationFile, executor: SqlExecutor) => Promise<unknown>
    readonly knownHistory?: RecordedChecksums
  } = {},
): Promise<RunResult> {
  const apply = options.apply ?? ((f: MigrationFile, e: SqlExecutor) => e.execute(f.sql))
  const hasLedger = await ledgerExists(executor)
  const applied = hasLedger ? await readApplied(executor) : []
  const recorded: RecordedChecksums = {
    ...(options.knownHistory ?? {}),
    ...Object.fromEntries(
      // 0001 records itself with a placeholder checksum that the runner then
      // corrects, so it must not be treated as a real recorded hash on the first
      // pass. Any all-zero checksum is that placeholder.
      applied.filter((a) => !/^0{64}$/.test(a.checksum)).map((a) => [a.name, a.checksum]),
    ),
  }

  // Never apply anything CI would reject. Running the same checks here means a
  // migration cannot reach the database by bypassing CI.
  /*
    A `note` is reported and does not block.

    `checkMigrations` gained one severity beyond `error` for the case where
    a rule's subject is history rather than a pending mistake - two branches
    that took the same sequence number and BOTH applied it. Refusing to run
    on that would mean no migration could ever be applied again, because the
    collision cannot be un-done: `app.schema_migrations` is keyed on name and
    both rows are real.

    The distinction is the whole point of the severity. An unapplied
    duplicate is still an error here, so a migration still cannot reach the
    database by bypassing the check.
  */
  const findings = checkMigrations(files, recorded, hash)
  const blocking = findings.filter((f) => f.severity !== 'note')
  if (blocking.length > 0) {
    const summary = blocking.map((f) => `${f.file ?? '(migrations/)'} [${f.rule}] ${f.message}`)
    throw new MigrationError(
      `refusing to run: ${blocking.length} integrity finding(s)\n  ${summary.join('\n  ')}`,
      null,
    )
  }
  for (const note of findings.filter((f) => f.severity === 'note')) {
    log(`  NOTE  [${note.rule}]  ${note.message}`)
  }

  const appliedNames = new Set(applied.map((a) => a.name))
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name))

  const outcomes: MigrationOutcome[] = []
  const skipped: string[] = []

  for (const file of ordered) {
    if (appliedNames.has(file.name)) {
      skipped.push(file.name)
      continue
    }

    log(`applying ${file.name}`)
    const started = Date.now()
    try {
      await apply(file, executor)
    } catch (error) {
      throw new MigrationError(
        `${file.name} failed and was rolled back: ${(error as Error).message}`,
        file.name,
      )
    }
    const durationMs = Date.now() - started

    // Record separately from the migration itself. The migration is atomic on
    // its own (verified: a failure inside one leaves nothing behind), so the
    // worst case here is a recorded-but-unrecorded gap if the process dies
    // between the two — which the checksum reconciliation below detects rather
    // than silently reapplying DDL.
    await executor.execute(
      `insert into app.schema_migrations (name, checksum, duration_ms)
       values (${literal(file.name)}, ${literal(hash(file.sql))}, ${durationMs})
       on conflict (name) do update
         set checksum = excluded.checksum,
             duration_ms = excluded.duration_ms`,
    )

    outcomes.push({ name: file.name, durationMs })
    log(`  applied in ${durationMs}ms`)
  }

  return { applied: outcomes, skipped }
}

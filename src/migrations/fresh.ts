/**
 * Replaying history on a FRESH project.
 *
 * `runMigrations` applies each file as one request, atomically. That is right for a database that has lived through the
 * history, and wrong for an empty one: twenty-nine of the migrations before 0592 close with a self-check that needs the
 * production rows the migration was written against ("need one harness job and one real job to drive with"), and on an empty
 * project that check raises, the whole file rolls back, and the replay stops at 0054 with the schema half built.
 *
 * `scripts/isolated/replica.sh` has always handled this with psql's ON_ERROR_ROLLBACK for the history before 0592. Over the
 * Management API (the only transport a build session has, ADR-0007) the same effect is: try the file whole; if it fails and
 * ONLY if the file is on the committed tolerance list, apply it a statement at a time, tolerate exactly the errors the list
 * names, and stop at any other. A file that is not on the list is never run this way, and a tolerated error that has changed
 * its words is not tolerated. Everything from 0592 on is atomic and stops at its first error, exactly as `migrate` does.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { MigrationFile } from './check.ts'
import { isTransactionControl, splitExecutable, withoutLeadingComments } from './split.ts'

/** file name -> message prefixes that may be tolerated in that file. */
export type Tolerances = Readonly<Record<string, readonly string[]>>

/**
 * What a tolerated error may cost. The 33 errors tolerated today are all in self-check `do` blocks (assertions that need
 * production rows) or in seed `insert`s that name production's vault and delivery ids. SCHEMA is never skippable: a
 * `create`, `alter`, `drop` or `grant` that fails is a divergence from the canonical schema, tolerated message or not.
 */
export const skippable = (statement: string): boolean =>
  /^(do\b|insert\s+into\b)/i.test(withoutLeadingComments(statement).trimStart())

/** The history before this is replayed tolerantly where listed; from here on every file is atomic. */
export const ATOMIC_FROM = '0592'

export interface FreshResult {
  readonly tolerated: readonly string[]
  /** The head of each statement that was skipped, so a person can see WHAT a tolerated error cost (never only the message). */
  readonly skipped: readonly string[]
}

export async function applyFresh(
  file: MigrationFile,
  executor: SqlExecutor,
  tolerances: Tolerances,
): Promise<FreshResult> {
  try {
    await executor.execute(file.sql)
    return { tolerated: [], skipped: [] }
  } catch (whole) {
    const allowed = tolerances[file.name]
    if (allowed === undefined || file.name.slice(0, 4) >= ATOMIC_FROM) throw whole
    // A file that opens its own `begin` and fails leaves a session-pooled connection inside an aborted transaction; over the
    // Management API each request is its own session and this is a no-op warning.
    await executor.execute('rollback').catch(() => undefined)
    const tolerated: string[] = []
    const skipped: string[] = []
    for (const statement of splitExecutable(file.sql)) {
      if (isTransactionControl(statement)) continue
      try {
        await executor.execute(statement)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (allowed.some((prefix) => message.includes(prefix)) && skippable(statement)) {
          tolerated.push(message.slice(0, 160))
          skipped.push(statement.replace(/\s+/g, ' ').trim().slice(0, 140))
          continue
        }
        throw new Error(
          `${file.name}: ${message} (not on the tolerance list for this file, or not a self-check/seed statement)`,
        )
      }
    }
    return { tolerated, skipped }
  }
}

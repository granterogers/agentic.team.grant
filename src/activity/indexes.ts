/**
 * The indexes the unified activity read model leans on, and how to build them without stopping the office.
 *
 * They are NOT in migration 1061. The migration runner applies a file as one statement batch, and `CREATE INDEX CONCURRENTLY`
 * cannot run inside one; a plain `CREATE INDEX` holds a write lock on its table for the whole build (measured on a 2 000 000
 * row, 523 MB table with a live writer: 2.1 s build, the writer's slowest insert 2 061 ms plain against 88 ms concurrent,
 * see docs/activity-ledger/MIGRATION-PLAN.md). Each of these tables is written by the worker on every job, so the build is a
 * separate, repeatable, resumable step: `npm run activity:indexes`.
 *
 * The read model is correct without them and only slower, and `app.activity_ledger_health` reports which are missing, so the
 * activation checklist can refuse to switch the ledger on until none is.
 *
 * `ACTIVITY_INDEX_NAMES` is held equal to the list `app.activity_index_gaps` carries in SQL by a test, because two lists of one
 * thing are how a gap goes unreported.
 */
import type { SqlExecutor } from '../db/executor.ts'

export interface ActivityIndex {
  readonly name: string
  readonly table: string
  readonly columns: string
  /** A partial index's predicate. */
  readonly where?: string
  /** The read the index serves. */
  readonly serves: string
}

export const ACTIVITY_INDEXES: readonly ActivityIndex[] = [
  {
    name: 'inbound_commands_office_received_idx',
    table: 'inbound_commands',
    columns: 'office_id, received_at desc',
    serves: 'requests',
  },
  {
    name: 'deliveries_office_updated_idx',
    table: 'deliveries',
    columns: 'office_id, updated_at desc',
    serves: 'delivery failures and retries',
  },
  {
    name: 'deliveries_office_sent_idx',
    table: 'deliveries',
    columns: 'office_id, sent_at desc',
    where: 'sent_at is not null',
    serves: 'delivery confirmations',
  },
  {
    name: 'deliveries_office_send_started_idx',
    table: 'deliveries',
    columns: 'office_id, send_started_at desc',
    where: 'send_started_at is not null',
    serves: 'delivery attempts',
  },
  {
    name: 'blockers_office_created_idx',
    table: 'blockers',
    columns: 'office_id, created_at desc',
    serves: 'questions raised',
  },
  {
    name: 'inference_usage_office_time_idx',
    table: 'inference_usage',
    columns: 'office_id, occurred_at desc',
    serves: 'model calls',
  },
  {
    name: 'events_office_time_idx',
    table: 'events',
    columns: 'office_id, occurred_at desc',
    serves: 'the action ledger',
  },
  {
    name: 'job_transitions_time_idx',
    table: 'job_state_transitions',
    columns: 'occurred_at desc',
    serves: 'job state changes',
  },
  {
    name: 'outputs_created_idx',
    table: 'outputs',
    columns: 'created_at desc',
    serves: 'answers produced',
  },
  {
    name: 'outputs_reviewed_idx',
    table: 'outputs',
    columns: 'reviewed_at desc',
    where: 'reviewed_at is not null',
    serves: 'answers reviewed',
  },
  {
    name: 'job_impediments_time_idx',
    table: 'job_impediments',
    columns: 'created_at desc',
    serves: 'things the office could not do',
  },
]

export const ACTIVITY_INDEX_NAMES: readonly string[] = ACTIVITY_INDEXES.map((i) => i.name)

export const createStatement = (i: ActivityIndex): string =>
  `create index concurrently if not exists ${i.name} on public.${i.table} (${i.columns})${
    i.where === undefined ? '' : ` where ${i.where}`
  }`

export interface IndexState {
  readonly name: string
  readonly present: boolean
  /** A concurrent build that failed leaves the index behind, invalid; it must be dropped before it can be built again. */
  readonly valid: boolean
}

export const inspectActivityIndexes = async (db: SqlExecutor): Promise<IndexState[]> => {
  const { rows } = await db.execute(
    `select c.relname as name, i.indisvalid as valid
       from pg_class c join pg_index i on i.indexrelid = c.oid
      where c.relnamespace = 'public'::regnamespace
        and c.relname in (${ACTIVITY_INDEX_NAMES.map((n) => `'${n}'`).join(', ')})`,
  )
  const found = new Map(
    (rows as { name: string; valid: boolean }[]).map((r) => [String(r.name), r.valid === true]),
  )
  return ACTIVITY_INDEX_NAMES.map((name) => ({
    name,
    present: found.has(name),
    valid: found.get(name) === true,
  }))
}

export type IndexOutcome = 'already-built' | 'built' | 'rebuilt-after-invalid' | `failed: ${string}`

export interface EnsureOptions {
  /** Per attempt; applies when the executor keeps one session (a direct connection). Default 3000. */
  readonly lockTimeoutMs?: number
  /** Default 3. */
  readonly attempts?: number
  readonly log?: (line: string) => void
}

/**
 * Builds whatever is missing or invalid, one index at a time, each as its own statement (CONCURRENTLY allows nothing else in the
 * request). Idempotent and resumable: a second run reports `already-built` for every index the first one finished. It never drops
 * a VALID index, and it drops an INVALID one only because that is the shape a failed concurrent build leaves behind.
 */
export const ensureActivityIndexes = async (
  db: SqlExecutor,
  options: EnsureOptions = {},
): Promise<{ name: string; outcome: IndexOutcome }[]> => {
  const attempts = options.attempts ?? 3
  const log = options.log ?? (() => undefined)
  const results: { name: string; outcome: IndexOutcome }[] = []
  for (const index of ACTIVITY_INDEXES) {
    let outcome: IndexOutcome = 'failed: not attempted'
    let sawInvalid = false
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const state = (await inspectActivityIndexes(db)).find((s) => s.name === index.name)
      if (state?.valid === true) {
        outcome = sawInvalid ? 'rebuilt-after-invalid' : attempt === 1 ? 'already-built' : 'built'
        break
      }
      try {
        if (state?.present === true) {
          sawInvalid = true
          log(`${index.name}: dropping the invalid leftover of an earlier build`)
          await db.execute(`drop index concurrently if exists public.${index.name}`)
        }
        await db.execute(`set lock_timeout = '${String(options.lockTimeoutMs ?? 3000)}ms'`)
        log(`${index.name}: building on ${index.table} (attempt ${String(attempt)})`)
        await db.execute(createStatement(index))
      } catch (error) {
        outcome = `failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`
        log(`${index.name}: ${outcome}`)
      }
    }
    results.push({ name: index.name, outcome })
  }
  return results
}

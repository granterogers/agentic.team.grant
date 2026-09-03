/**
 * Capture a manifest of the source database, for the restore rehearsal to
 * compare against.
 *
 * §16: "A backup feature is incomplete until restoration is tested." Testing it
 * means more than "psql exited zero" — it means the ledger, job state and, above
 * all, the *enforcement* came back. That needs something to compare to, taken at
 * dump time.
 *
 * Prints JSON on stdout. Contains counts only — no data, so it is safe to store
 * alongside the dump and safe to print in a workflow log.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const { rows } = await db.execute(`
  select
    (select count(*) from app.schema_migrations)         as migrations,
    (select count(*) from public.events)                 as events,
    (select count(*) from public.jobs)                   as jobs,
    (select count(*) from public.job_state_transitions)  as job_transitions,
    (select count(*) from public.projects)               as projects,
    (select count(*) from public.system_config)          as system_config,
    (select count(*) from app.job_transitions_allowed)   as allowed_transitions,
    (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'job_state')                     as job_state_values,
    (select max(name) from app.schema_migrations)        as latest_migration
`)

const row = rows[0] ?? {}
const manifest = {
  captured_at: new Date().toISOString(),
  source_project: process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  counts: {
    migrations: Number(row.migrations),
    events: Number(row.events),
    jobs: Number(row.jobs),
    job_transitions: Number(row.job_transitions),
    projects: Number(row.projects),
    system_config: Number(row.system_config),
    allowed_transitions: Number(row.allowed_transitions),
    job_state_values: Number(row.job_state_values),
  },
  latest_migration: String(row.latest_migration),
}

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)

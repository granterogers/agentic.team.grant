/**
 * Verify a restored database.
 *
 *   RESTORE_URL=postgres://... MANIFEST=manifest.json npm run verify:restore
 *
 * §16 requires testing restoration of "the project registry, event ledger, job
 * state, staff settings, encrypted-secret reference behaviour, and
 * reconciliation with external systems after restore".
 *
 * The part that is easy to skip is the most important: a restore that brings
 * back every row but loses the append-only triggers is a silent catastrophe.
 * Nothing would fail, and the ledger would be quietly mutable from then on. So
 * this re-runs the enforcement probes against the RESTORED database and
 * requires them to fail exactly as they do against the original.
 */
import { readFileSync } from 'node:fs'
import { PgExecutor } from '../../src/db/pg-executor.ts'
import { JOB_STATES } from '../../src/jobs/states.ts'

const url = process.env.RESTORE_URL
const manifestPath = process.env.MANIFEST
if (url === undefined || url === '' || manifestPath === undefined) {
  console.error('RESTORE_URL and MANIFEST are required')
  process.exit(2)
}

interface Manifest {
  counts: Record<string, number>
  latest_migration: string
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest

const db = new PgExecutor(url)
await db.connect()

interface Check {
  what: string
  outcome: string
  passed: boolean
}
const checks: Check[] = []

const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] ?? {}

// --- 1. The data came back -------------------------------------------------
const counts = await one(`
  select
    (select count(*)::int from app.schema_migrations)        as migrations,
    (select count(*)::int from public.events)                as events,
    (select count(*)::int from public.jobs)                  as jobs,
    (select count(*)::int from public.job_state_transitions) as job_transitions,
    (select count(*)::int from public.projects)              as projects,
    (select count(*)::int from public.system_config)         as system_config,
    (select count(*)::int from app.job_transitions_allowed)  as allowed_transitions
`)

for (const [table, expected] of Object.entries(manifest.counts)) {
  if (table === 'job_state_values') continue
  const actual = Number(counts[table])
  checks.push({
    what: `${table} restored`,
    outcome: `${actual} rows, expected ${expected}`,
    passed: actual === expected,
  })
}

const latest = await one('select max(name) as n from app.schema_migrations')
checks.push({
  what: 'migration history restored to the same point',
  outcome: `${String(latest.n)}, expected ${manifest.latest_migration}`,
  passed: String(latest.n) === manifest.latest_migration,
})

// --- 2. The schema came back -----------------------------------------------
const enumValues = (
  await db.execute(`
  select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'job_state' order by e.enumsortorder
`)
).rows.map((r) => String(r.enumlabel))
checks.push({
  what: 'job_state enum restored with all fourteen values in order',
  outcome: `${enumValues.length} values`,
  passed:
    enumValues.length === JOB_STATES.length && enumValues.every((v, i) => v === JOB_STATES[i]),
})

// --- 3. The ENFORCEMENT came back ------------------------------------------
// The whole point. Rows without triggers is the silent failure.
async function mustFail(what: string, sql: string, expect: string): Promise<void> {
  try {
    await db.execute(sql)
    checks.push({
      what,
      outcome: 'SUCCEEDED against the restore — enforcement was LOST',
      passed: false,
    })
  } catch (error) {
    const message = (error as Error).message
    const ok = message.toLowerCase().includes(expect.toLowerCase())
    checks.push({
      what,
      outcome: ok
        ? `refused: ${message.split('\n')[0]?.slice(0, 90)}`
        : `wrong error: ${message.slice(0, 90)}`,
      passed: ok,
    })
  }
}

await mustFail(
  'the restored ledger still refuses UPDATE',
  `update public.events set actor = 'tampered' where true`,
  'append-only',
)
await mustFail(
  'the restored ledger still refuses DELETE',
  'delete from public.events where true',
  'append-only',
)
await mustFail(
  'the restored ledger still refuses TRUNCATE',
  'truncate table public.events',
  'append-only',
)
await mustFail(
  'the restored transition history is still append-only',
  `update public.job_state_transitions set to_state = 'failed' where true`,
  'append-only',
)
await mustFail(
  'the restored job engine still refuses an illegal transition',
  `update public.jobs set state = 'committing'
   where state = 'output_created'
      or job_id = (select job_id from public.jobs where state <> 'output_created' limit 1)`,
  'illegal job transition',
)

const rls = await one(`
  select
    (select count(*)::int from pg_class
      where relname in ('events','jobs','projects','system_config','job_state_transitions','provider_health')
        and relrowsecurity and relforcerowsecurity) as forced
`)
checks.push({
  what: 'row-level security still enabled and FORCED on all six tables',
  outcome: `${String(rls.forced)} of 6 tables`,
  passed: Number(rls.forced) === 6,
})

// --- 4. Secret references, not secrets (§15) -------------------------------
// Nothing in Phase 1 stores a credential, and the restore must not be the
// moment that stops being true. Asserting it now means the check already
// exists when Phase 2 adds slack_app_credentials.
const leaked = await one(`
  select count(*)::int as n from public.events
  where coalesce(rationale_summary, '') ~ '(xox[abposr]-|sk-or-v1-|sbp_|sk-proj-)'
     or coalesce(before_state::text, '') ~ '(xox[abposr]-|sk-or-v1-|sbp_|sk-proj-)'
     or coalesce(after_state::text, '') ~ '(xox[abposr]-|sk-or-v1-|sbp_|sk-proj-)'
`)
checks.push({
  what: 'no credential-shaped string anywhere in the restored ledger (§15)',
  outcome: `${String(leaked.n)} matches`,
  passed: Number(leaked.n) === 0,
})

await db.end()

console.log('| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} restore checks passed`)
if (failed.length > 0) {
  console.error('\nTHE RESTORE IS NOT TRUSTWORTHY')
  process.exit(1)
}

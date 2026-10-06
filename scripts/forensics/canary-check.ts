/**
 * A read-only GO / NO-GO reading of production before and between stabilisation steps (6 October 2026).
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/forensics/canary-check.ts [--counters]
 *
 * It asks exactly what `src/safety/canary.ts` defines: the platform health API (auth, db, rest, storage), then ONE query over
 * `cron.job_run_details` (the last five heartbeat runs, runs in the last ten minutes, "job startup timeout" in the last hour).
 * A bad health reading stops there and asks the database nothing more.
 *
 * `--counters` adds one cheap statistics read for the baseline and for comparing a step with the one before it: database size,
 * `pg_stat_database` counters (blocks hit and read, temp bytes, commits, backends) and the last heartbeat durations. Cumulative
 * counters say nothing alone: record two readings a known time apart and difference them.
 *
 * Read-only. It writes nothing, retries once, and exits 1 on NO-GO.
 */
import '../../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { canaryPrecondition, fetchProviderHealth } from '../../src/safety/canary.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set: nothing was asked')
  process.exit(2)
}
const db = new ManagementApiExecutor(ref, token)
const readRows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

const stamp = new Date().toISOString()
const verdict = await canaryPrecondition({
  readHealth: () => fetchProviderHealth(ref, token),
  readRows,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
console.log(`canary ${stamp}: ${verdict.go ? 'GO' : 'NO-GO'}`)
for (const c of verdict.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`)
for (const r of verdict.reasons) console.log(`  reason: ${r}`)

if (verdict.go && process.argv.includes('--counters')) {
  const rows = await readRows(`
    select now() as at,
           pg_database_size(current_database()) as db_bytes,
           d.blks_hit, d.blks_read, d.temp_files, d.temp_bytes, d.xact_commit, d.xact_rollback, d.numbackends,
           d.tup_returned, d.tup_fetched, d.tup_inserted, d.tup_updated, d.tup_deleted,
           (select coalesce(json_agg(r), '[]'::json) from (
              select round(extract(epoch from (end_time - start_time))::numeric, 2)::float as s
                from cron.job_run_details where jobid = 1 order by start_time desc limit 10) r) as heartbeat_s
      from pg_stat_database d where d.datname = current_database()`)
  console.log(`counters ${stamp}: ${JSON.stringify(rows[0])}`)
}
process.exit(verdict.go ? 0 : 1)

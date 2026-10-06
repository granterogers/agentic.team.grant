/**
 * The rollout's canary log and the two-GO gate.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/rollout/gate.ts read [--counters]   one canary reading, appended to the log
 *   npx tsx scripts/rollout/gate.ts status                                          offline: does the two-GO condition hold now?
 *
 * `read` is the canary the runbook uses everywhere (health for auth, db, rest and storage; cron job 1: the last five runs succeeded
 * in under a second, ten runs in ten minutes; no "job startup timeout" in an hour). It asks exactly what src/safety/canary.ts asks,
 * stops after a bad health reading without asking the database anything, and records the reading in .out/rollout/gate-log.jsonl.
 * `--counters` adds one statistics read (database size, pg_stat_database counters, the last ten heartbeat durations) so that two
 * readings a known time apart give rates. The two canaries before the first write carry it, so they are also the baseline pair.
 *
 * `status` reads only the log (no network): two consecutive GO readings 8 to 20 minutes apart, the latest not stale, and no
 * production write since the first of them. Production writes made with scripts/rollout/step.ts and the deploy tools are logged in
 * .out/rollout/writes.jsonl.
 */
import { type Reading, twoGo, type WriteEvent } from './gate-lib.ts'
import { appendLine, GATE_LOG, readLines, WRITE_LOG } from './log.ts'

const action = process.argv[2] ?? ''
if (action === 'status') {
  const verdict = twoGo(readLines<Reading>(GATE_LOG), readLines<WriteEvent>(WRITE_LOG), new Date())
  console.log(`two-GO gate: ${verdict.ok ? 'HOLDS' : 'DOES NOT HOLD'}`)
  if (verdict.pair !== null)
    for (const r of verdict.pair)
      console.log(
        `  ${r.at}  ${r.go ? 'GO' : 'NO-GO'}  ${r.health.map((s) => `${s.name ?? '?'}=${s.status}`).join(' ')}`,
      )
  for (const r of verdict.reasons) console.log(`  reason: ${r}`)
  process.exit(verdict.ok ? 0 : 1)
}

if (action !== 'read') {
  console.error('usage: gate.ts <read [--counters] | status>')
  process.exit(2)
}

await import('../../src/safety/require-production-checks.ts')
const { ManagementApiExecutor } = await import('../../src/db/executor.ts')
const { canaryPrecondition, fetchProviderHealth } = await import('../../src/safety/canary.ts')
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set: nothing was asked')
  process.exit(2)
}
const db = new ManagementApiExecutor(ref, token)
const readRows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

let seen: { name?: string; status: string }[] = []
const at = new Date().toISOString()
const verdict = await canaryPrecondition({
  readHealth: async () => {
    seen = (await fetchProviderHealth(ref, token)) as { name?: string; status: string }[]
    return seen
  },
  readRows,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
let counters: Record<string, unknown> | null = null
if (verdict.go && process.argv.includes('--counters')) {
  counters =
    (
      await readRows(`
    select now() as at,
           pg_database_size(current_database()) as db_bytes,
           d.blks_hit, d.blks_read, d.temp_files, d.temp_bytes, d.xact_commit, d.xact_rollback, d.numbackends,
           d.tup_returned, d.tup_fetched, d.tup_inserted, d.tup_updated, d.tup_deleted,
           (select coalesce(json_agg(r), '[]'::json) from (
              select round(extract(epoch from (end_time - start_time))::numeric, 2)::float as s
                from cron.job_run_details where jobid = 1 order by start_time desc limit 10) r) as heartbeat_s
      from pg_stat_database d where d.datname = current_database()`)
    )[0] ?? null
}
const reading: Reading = {
  at,
  go: verdict.go,
  health: seen.map((s) =>
    s.name === undefined ? { status: s.status } : { name: s.name, status: s.status },
  ),
  checks: [...verdict.checks],
  reasons: [...verdict.reasons],
  counters,
}
appendLine(GATE_LOG, reading)
console.log(`canary ${at}: ${verdict.go ? 'GO' : 'NO-GO'}`)
for (const c of verdict.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`)
for (const r of verdict.reasons) console.log(`  reason: ${r}`)
if (counters !== null) console.log(`counters ${at}: ${JSON.stringify(counters)}`)
const gate = twoGo(readLines<Reading>(GATE_LOG), readLines<WriteEvent>(WRITE_LOG), new Date())
console.log(
  `two-GO gate after this reading: ${gate.ok ? 'HOLDS' : 'does not hold yet'}${gate.ok ? '' : ` (${gate.reasons[0] ?? ''})`}`,
)
process.exit(verdict.go ? 0 : 1)

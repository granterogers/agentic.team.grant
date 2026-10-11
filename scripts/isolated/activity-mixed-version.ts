// biome-ignore-all format: dense proof script kept readable as written
/**
 * The NEW worker's ledger writers over a schema that does not have the ledger (the mixed-version cell "new worker, old schema").
 *
 *   npx tsx scripts/isolated/activity-mixed-version.ts <a replica clone WITHOUT migrations 1060 to 1062>
 *
 * The gate's candidate always carries the ledger, so this is run by hand against `post` built from main (see MIGRATION-PLAN.md, "Mixed
 * versions"). It proves what a deploy ordering mistake costs: the worker deployed before the migration. The TypeScript writers
 * (src/activity/record.ts) must never throw into the sweep or the plan step that called them, and must not write anywhere.
 */
import { recordRecovered, recordToolCall } from '../../src/activity/record.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'mm_old')
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
let exit = 1
try {
  const has = Number(((await db.execute(`select count(*) as c from pg_proc where proname in ('record_activity_safely', 'record_activity')`)).rows[0] as { c: number }).c)
  check('premise: this database has no ledger writer (the old schema)', has === 0, `${has} writer functions`)
  const hasTable = Number(((await db.execute(`select count(*) as c from information_schema.tables where table_name = 'activity_events'`)).rows[0] as { c: number }).c)
  check('premise: and no activity_events table', hasTable === 0, `${hasTable} tables`)
  const job = await realParent(db)
  let threw = ''
  try {
    await recordRecovered(db, [{ jobId: job, fromState: 'running', reason: 'lease expired' }])
    await recordToolCall(db, { jobId: job, capability: 'drive.read', step: 's1', phase: 'requested' })
    await recordToolCall(db, { jobId: job, capability: 'drive.read', step: 's1', phase: 'failed', outcome: 'error', errorClass: 'timeout', durationMs: 1200 })
  } catch (e) {
    threw = (e as Error).message
  }
  check('new worker, old schema: the recovery and tool-call writers resolve and never throw into the caller', threw === '', threw || 'resolved three calls')
  const stillThere = Number(((await db.execute(`select count(*) as c from public.jobs where job_id = '${job}'::uuid`)).rows[0] as { c: number }).c)
  check('new worker, old schema: the work the writers were called about is untouched', stillThere === 1, `${stillThere} job`)
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)

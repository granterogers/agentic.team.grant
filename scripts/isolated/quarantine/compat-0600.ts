/**
 * QUARANTINED (see ./README.md): never run by a gate. Its precondition (the 0600 schema, app.job_origin absent) is false on
 * every candidate, so it can only fail.
 *
 * RC2 deployment compatibility (#381): the RC2 worker's gate against the
 * schema production has BEFORE 0601 (app.job_origin absent).
 *
 *   npx tsx scripts/isolated/quarantine/compat-0600.ts <a replica database with 0601 not applied>
 */
import { containmentRefusal } from '../../../src/jobs/containment.ts'
import { isolated } from '../guard.ts'

const db = await isolated(process.argv[2] ?? 'compat0600')
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: boolean[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const absent = (await one(`select to_regproc('app.job_origin') is null as v`)).v
check(
  'precondition: app.job_origin does not exist (the 0600 schema)',
  absent === true,
  String(absent),
)
const job = async (by: string) =>
  String(
    (
      await one(`insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
        values (gen_random_uuid(), 'compat:${run}:${by}', 'office.notion_import', '${by}') returning job_id::text as v`)
    ).v,
  )
const real = await job('duty:notion-sync')
const harness = await job('verify:compat')
const r1 = await containmentRefusal(db, { jobId: real, kind: 'office.notion_import' })
check(
  'a real external-writing job still runs (fallback to app.harness_job)',
  r1 === null,
  r1 ?? 'allowed',
)
const r2 = await containmentRefusal(db, { jobId: harness, kind: 'office.notion_import' })
check('a harness external-writing job is still refused', r2 !== null, r2 ?? 'ALLOWED')
const r3 = await containmentRefusal(db, { jobId: real, kind: 'office.instruction' })
check('an internal kind is never asked about', r3 === null, r3 ?? 'allowed')
// A present-but-failing job_origin is NOT the absent case: it must refuse, never fall back.
await db.execute(`create function app.job_origin(p uuid) returns text language plpgsql as $f$
  begin raise exception 'policy check failed on purpose'; end $f$`)
const r4 = await containmentRefusal(db, { jobId: real, kind: 'office.notion_import' })
check(
  'a job_origin that errors (not absent) refuses, with no permissive fallback',
  r4 !== null && /could not establish/.test(r4),
  r4 ?? 'ALLOWED',
)
await db.execute(
  `create or replace function app.job_origin(p uuid) returns text language sql as $f$ select 'probably-fine'::text $f$`,
)
const r5 = await containmentRefusal(db, { jobId: real, kind: 'office.notion_import' })
check('an origin word the gate does not know refuses', r5 !== null, r5 ?? 'ALLOWED')
await db.execute('drop function app.job_origin(uuid)')
const claimed = await one(
  `select outcome from app.claim_delivery(app.job_office('${real}'::uuid), 'telegram', 'compat:${run}:d', 'acct', '-7000000000000099', 'result', null, null, null, '${real}'::uuid)`,
)
check(
  'the pre-0601 delivery guard accepts the RC2 call shape (job id passed)',
  typeof claimed.outcome === 'string',
  String(claimed.outcome),
)
const failed = results.filter((x) => !x).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)

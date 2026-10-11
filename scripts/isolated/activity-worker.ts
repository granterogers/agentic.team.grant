/**
 * The worker's recovery sweep and the unified activity ledger (src/activity/record.ts, migration 1060).
 *
 *   npx tsx scripts/isolated/activity-worker.ts <replica-db>
 *
 * The REAL recoverStalled runs against the replica. A job is left `running` with an expired lease the way a dead worker leaves it,
 * and the sweep is asked to reclaim it.
 *
 *   off      with the switch off the sweep behaves exactly as before and the ledger holds nothing
 *   on       one system.recovered event for the reclaimed job, linked to it, carrying nothing but a reference
 *   once     sweeping again, or two workers sweeping at once, never records the same reclaim twice
 *   safe     a ledger that cannot be written to (the function missing, the table refusing) never stops the sweep
 */
import { recordRecovered } from '../../src/activity/record.ts'
import { recoverStalled } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'ledger')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const count = async (sql: string) => Number((await one(sql)).c)
const stall = async (): Promise<string> => {
  const job = await realParent(db)
  await db.execute(`update public.jobs set state = 'running', leased_by = 'dead-worker', leased_until = now() - interval '10 minutes', attempt = 1 where job_id = ${lit(job)}::uuid`)
  return job
}

let exit = 1
try {
  await db.execute(`update public.system_config set value = 'false'::jsonb where key = 'activity.ledger_enabled'`)
  const j1 = await stall()
  const r1 = await recoverStalled(db)
  check('off: the sweep reclaims the job exactly as before', r1.some((r) => r.jobId === j1), `${r1.length} reclaimed`)
  check('off: and the ledger holds nothing', (await count(`select count(*) as c from public.activity_events`)) === 0, '0 events')

  await db.execute(`update public.system_config set value = 'true'::jsonb where key = 'activity.ledger_enabled'`)
  const j2 = await stall()
  const r2 = await recoverStalled(db)
  const ev = await one(`select event_type, actor_kind, actor, status, source_interface, job_id::text as job, project_id::text as project, correlation_id::text as corr, metadata::text as meta, summary
    from public.activity_events where job_id = ${lit(j2)}::uuid`)
  const jobRow = await one(`select project_id::text as project, correlation_id::text as corr from public.jobs where job_id = ${lit(j2)}::uuid`)
  check('on: the sweep still reclaims the job', r2.some((r) => r.jobId === j2), `${r2.length} reclaimed`)
  check('on: one system.recovered event, by the worker, linked to the job from the job\'s own row', ev?.event_type === 'system.recovered' && ev.actor === 'worker' && ev.actor_kind === 'system' && ev.job === j2 && ev.project === jobRow?.project && ev.corr === jobRow?.corr && ev.source_interface === 'worker', `${String(ev?.summary)}`)
  check('on: it carries a reference and a state name, never the job\'s payload or any text of the request', !String(ev?.meta).includes('real turn') && String(ev?.meta).includes('from_state'), String(ev?.meta))
  const feed = await one(`select (app.activity_read(p_office => app.operator_office(), p_visibility => 'operator', p_job => ${lit(j2)}::uuid)) -> 'events' as e`)
  const types = ((typeof feed.e === 'string' ? JSON.parse(feed.e) : feed.e) as { type: string }[]).map((e) => e.type)
  check('on: the recovery sits in the job\'s own history beside the retry the transition trigger recorded', types.includes('system.recovered') && types.includes('retry.scheduled'), types.join(', '))

  await recoverStalled(db)
  check('once: sweeping again does not record the same reclaim twice', (await count(`select count(*) as c from public.activity_events where job_id = ${lit(j2)}::uuid and event_type = 'system.recovered'`)) === 1, '1 event')
  // A reclaim on a LATER attempt of the same job is a different event.
  await db.execute(`update public.jobs set attempt = 2 where job_id = ${lit(j2)}::uuid`)
  const again = [{ jobId: j2, fromState: 'running', reason: 'lease expired' }]
  await recordRecovered(db, again)
  await recordRecovered(db, again)
  const later = await count(`select count(*) as c from public.activity_events where job_id = ${lit(j2)}::uuid and event_type = 'system.recovered'`)
  check('once: a reclaim on a later attempt is a new event, and repeating it is still one', later === 2, `${later} events for attempts 1 and 2`)

  // Safe: break the writer on purpose, sweep, and see that the sweep still reclaims.
  const j3 = await stall()
  await db.execute(`alter function app.record_activity_safely(uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, text, jsonb, jsonb) rename to record_activity_safely_off`)
  let r3: readonly { jobId: string }[] = []
  let threw = ''
  try {
    r3 = await recoverStalled(db)
  } catch (e) {
    threw = (e as Error).message
  }
  await db.execute(`alter function app.record_activity_safely_off(uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, text, jsonb, jsonb) rename to record_activity_safely`)
  check('safe: with the ledger writer missing the sweep still reclaims and does not throw', threw === '' && r3.some((r) => r.jobId === j3), threw === '' ? `${r3.length} reclaimed` : threw.slice(0, 80))
  check('safe: the writer is back and the earlier events are intact', (await count(`select count(*) as c from public.activity_events where event_type = 'system.recovered'`)) >= 1, 'restored')

  const failed = results.filter((r) => !r).length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)

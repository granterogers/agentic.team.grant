/**
 * Stop every job that holds a live Hermes run, ahead of rolling the worker back (Hermes, M4). An OPERATOR command: it writes to production.
 *
 *   npm run engine:drain                      every office
 *   npm run engine:drain -- --office=<id|operator>
 *
 * Switch Hermes OFF first (remove the office from engine.hermes.offices): this refuses, and stops nothing, while Hermes is still on for
 * an office that holds a live run. It prints what it stopped and what it could not; it never prints a message body or a credential.
 * See src/engines/hermes/drain.ts for why the order matters.
 */
import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { drainEngineRuns } from '../../src/engines/hermes/drain.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const officeArg = process.argv.find((a) => a.startsWith('--office='))?.slice(9)
const officeId =
  officeArg === undefined
    ? null
    : officeArg === 'operator'
      ? String((await db.execute('select app.operator_office()::text as o')).rows[0]?.o ?? '')
      : officeArg

const result = await drainEngineRuns(db, officeId)
console.log(`live runs: ${String(result.live.length)}`)
if (result.refused !== undefined) {
  console.error(`REFUSED: ${result.refused}`)
  process.exit(1)
}
for (const s of result.stopped) console.log(`stopped job ${s.job_id} (run ${s.run_id}): ${s.note}`)
for (const f of result.failed)
  console.error(`COULD NOT STOP job ${f.job_id} (run ${f.run_id}): ${f.why}`)
console.log(
  result.ok
    ? 'Done. Restore the older worker now, not before.'
    : 'Some jobs were not stopped. Do not restore the older worker until they are.',
)
process.exit(result.ok ? 0 : 1)

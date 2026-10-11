/**
 * Has any message a person sent to Hermes been answered by the team instead? (Hermes release audit; migration 1077)
 *
 *   npm run check:engine-mismatch
 *
 * A production READ, behind the production-read gate (ALLOW_PRODUCTION_CHECKS=1, which only a person sets). It asks `app.engine_mismatches`
 * for every office that has ever chosen Hermes: jobs whose own command chose Hermes, that are over, and that have no engine run. Ids and
 * channel only; it prints no text anybody said. It exits 1 on any, because the thing the integration promises never to do silently is
 * exactly this: a worker that predates the engine seam, rolled back or never deployed, answering a Hermes message as the team.
 *
 * Run it after every deploy step of the Hermes release, after any worker rollback, and daily while Hermes is on for an office. With
 * Hermes never used it reports "no office has chosen Hermes" and exits 0 (it says so, so the empty case is not read as a pass).
 * The function behind it is proved on the replica by scripts/isolated/engine-mixed.ts (12 checks, 5 sabotages).
 */
import '../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set: this check asks the database')
  process.exit(2)
}
const db = new ManagementApiExecutor(ref, accessToken)

interface Mismatch {
  job_id: string
  channel: string
  state: string
  finished_at: string | null
}

const hasEngine = (
  await db.execute(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inbound_commands' and column_name = 'engine'`,
  )
).rows
if (hasEngine.length === 0) {
  console.log(
    'the database predates migration 1070 (inbound_commands has no engine column): nobody can have chosen Hermes, so nothing can be mismatched',
  )
  process.exit(0)
}
const offices = (
  await db.execute(
    `select distinct office_id::text as office from public.inbound_commands where engine = 'hermes'`,
  )
).rows as { office: string }[]
if (offices.length === 0) {
  console.log(
    'no office has chosen Hermes: nothing to check (this is the state before Hermes is turned on, not a finding)',
  )
  process.exit(0)
}
let mismatched = 0
for (const { office } of offices) {
  const row = (await db.execute(`select app.engine_mismatches('${office}'::uuid) as r`)).rows[0] as
    | { r: unknown }
    | undefined
  const v = (typeof row?.r === 'string' ? JSON.parse(row.r) : row?.r) as
    | { mismatched?: number; jobs?: Mismatch[] }
    | undefined
  const n = Number(v?.mismatched ?? Number.NaN)
  if (Number.isNaN(n)) {
    console.error(
      `office ${office.slice(0, 8)}: the function answered something this check cannot read`,
    )
    process.exit(2)
  }
  mismatched += n
  console.log(`office ${office.slice(0, 8)}: ${String(n)} Hermes message(s) answered by the team`)
  for (const j of v?.jobs ?? [])
    console.log(`  job ${j.job_id} ${j.channel} ${j.state} ${j.finished_at ?? ''}`)
}
console.log(
  mismatched === 0
    ? `check:engine-mismatch clean: ${String(offices.length)} office(s) have chosen Hermes and none was answered by the team`
    : `check:engine-mismatch FAILED: ${String(mismatched)} message(s) a person sent to Hermes were answered by the team`,
)
process.exit(mismatched === 0 ? 0 : 1)

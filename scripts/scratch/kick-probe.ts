/**
 * Scratch: measure how long the DEPLOYED gateway takes to get a message
 * picked up, to prove the hq-api worker kick actually fires.
 *
 * Aimed at a fixture project on purpose. 0523's default-deny means a harness
 * job may only deliver to a registered test destination and none is
 * registered, so the answer cannot reach Grant — and an EXISTING fixture
 * project that already carries jobs is used rather than a new one, because a
 * project that has gathered a job can never be deleted.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { testOrigins } from '../verify/lib/test-origin.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const token = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
if (token === '') {
  console.error('no hq.api_token in the vault')
  process.exit(2)
}
const project = process.argv[2] ?? ''
const before = new Date().toISOString()
// Declared first (#381): the database refuses a project that has real work, so
// this cannot be pointed at one of Grant's.
await (await testOrigins(db, 'scratch:kick-probe')).declare('teamhq', project)

const res = await fetch('https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'say',
    args: { p_project_id: project, p_text: 'Latency probe for the hq-api worker kick.' },
  }),
})
console.log(`gateway: http ${String(res.status)} ${(await res.text()).slice(0, 160)}`)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
for (let i = 0; i < 40; i += 1) {
  await new Promise((r) => setTimeout(r, 1500))
  const { rows } = await db.execute(`
    select j.job_id::text as id, j.state::text as st,
      round(extract(epoch from (
        (select min(t.occurred_at) from public.job_state_transitions t
          where t.job_id = j.job_id and t.to_state = 'running') - j.created_at)))::int as pickup
    from public.jobs j
    where j.kind = 'office.instruction' and j.project_id = ${lit(project)}::uuid
      and j.created_at > ${lit(before)}::timestamptz
    order by j.created_at desc limit 1`)
  const r = rows[0] as { id?: string; st?: string; pickup?: number } | undefined
  if (r === undefined) {
    console.log(`  ${String((i + 1) * 1.5)}s — no job yet`)
    continue
  }
  if (r.pickup !== null && r.pickup !== undefined) {
    console.log(`PICKED UP after ${String(r.pickup)}s — job ${String(r.id)} now ${String(r.st)}`)
    process.exit(0)
  }
  console.log(`  ${String((i + 1) * 1.5)}s — job ${String(r.id)} still ${String(r.st)}`)
}
console.error('never picked up within 60s')
process.exit(1)

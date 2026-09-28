import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { dequeue, runJob } from '../../src/jobs/worker.ts'
import { buildPass } from '../../src/office/pass.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const [jobId] = process.argv.slice(2) as [string]
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const j = await one(
  `select requested_by, state::text as s from public.jobs where job_id = '${jobId}'::uuid`,
)
await db.execute('select app.requeue_retrying()')
const WORKER = `runone-${Date.now().toString(36)}`
const pass = await buildPass(db, WORKER, {
  max: 1,
  canTranscribe: false,
  canSubprocess: false,
  projectRef: process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
})
let got = null
for (let t = 0; t < 20 && got === null; t++) {
  const g = await dequeue(db, WORKER, false, false, undefined, String(j.requested_by))
  if (g?.jobId === jobId) got = g
  else if (g !== null) await runJob(db, g, pass.handlers, pass.review).catch(() => undefined)
  else await new Promise((r) => setTimeout(r, 500))
}
console.log(got === null ? `LOST THE RACE (state ${String(j.s)})` : 'BRANCH CODE ran it')
if (got !== null) console.log(JSON.stringify(await runJob(db, got, pass.handlers, pass.review)))
const after = await one(
  `select state::text as s, left(state_reason, 90) as r from public.jobs where job_id = '${jobId}'::uuid`,
)
const outs = await db.execute(
  `select reviewer_status::text as st, deterministic from public.outputs where job_id = '${jobId}'::uuid order by created_at`,
)
console.log(after, outs.rows)

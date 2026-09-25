import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { dequeue, runJob } from '../../src/jobs/worker.ts'
import { buildPass } from '../../src/office/pass.ts'
const db = new ManagementApiExecutor(process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg', process.env.SUPABASE_ACCESS_TOKEN ?? '')
const [jobId, answer] = process.argv.slice(2) as [string, string]
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const j = await one(`select requested_by from public.jobs where job_id = '${jobId}'::uuid`)
const b = await one(`select blocker_id from public.blockers where job_id = '${jobId}'::uuid and state = 'open' order by created_at desc limit 1`)
await db.execute(`select app.hq_answer_blocker('${String(b.blocker_id)}'::uuid, '${answer}');
  update public.jobs set not_before = app.now_utc() + interval '3 seconds' where job_id = '${jobId}'::uuid`)
const WORKER = `approve-${Date.now().toString(36)}`
const pass = await buildPass(db, WORKER, { max: 1, canTranscribe: false, canSubprocess: false, projectRef: process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg' })
await new Promise((r) => setTimeout(r, 3500))
let got = null
for (let t = 0; t < 10 && got === null; t++) {
  const g = await dequeue(db, WORKER, false, false, undefined, String(j.requested_by))
  if (g?.jobId === jobId) got = g
  else if (g !== null) await runJob(db, g, pass.handlers, pass.review).catch(() => undefined)
  else await new Promise((r) => setTimeout(r, 500))
}
console.log(got === null ? 'LOST THE RACE (deployed worker ran it)' : 'BRANCH CODE ran it')
if (got !== null) await runJob(db, got, pass.handlers, pass.review)
const after = await one(`select state::text, state_reason from public.jobs where job_id = '${jobId}'::uuid`)
const open = await one(`select count(*)::int n from public.blockers where job_id = '${jobId}'::uuid and state = 'open'`)
const docs = await one(`select count(*)::int n from public.documents where produced_by_job = '${jobId}'::uuid`)
console.log({ answer, state: after.state, reason: String(after.state_reason).slice(0, 90), openBlockers: open.n, documents: docs.n })

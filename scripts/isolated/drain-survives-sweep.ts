/**
 * ONE BROKEN JOB CANNOT STOP THE OFFICE — the worker half (ledger R48).
 *
 *   npx tsx scripts/isolated/drain-survives-sweep.ts <replica-db>
 *
 * The replica must NOT have 0599, so the recovery sweep genuinely raises: a
 * job stalled in output_created with an output is sent to notifying, which is
 * illegal. `drain` must still dequeue and run the healthy job queued beside
 * it. Before this pass the sweep was awaited bare and the throw aborted the
 * tick — the 87-minute production outage.
 */
import { drain, type Handler, type Job, type Reviewer } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const database = process.argv[2] ?? 'drain_proof'
const db = await isolated(database)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>

const broken = await one(`
  with j as (insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id)
             values (app.test_office(), 'office.instruction', 'teamhq:verify-drain-broken', app.unnamed_project(app.test_office()),
                     'verify-drain-broken-' || gen_random_uuid(), gen_random_uuid()) returning job_id)
  select job_id::text as id from j`)
await db.execute(`
  update public.jobs set state = 'running', leased_by = 'dead', leased_until = now() + interval '1 hour' where job_id = '${String(broken.id)}';
  insert into public.outputs (job_id, body, confidence, evidence, deterministic) values ('${String(broken.id)}', 'left by a dead worker', 'low', 'inferred', true);
  update public.jobs set state = 'output_created' where job_id = '${String(broken.id)}';
  update public.jobs set leased_until = now() - interval '1 minute' where job_id = '${String(broken.id)}'`)
const sweepRaises = await db
  .execute('begin; select * from app.recover_stalled_jobs(); rollback;')
  .then(() => false)
  .catch(() => true)
await db.execute('rollback').catch(() => undefined)

const healthy = await one(`
  with j as (insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id)
             values (app.test_office(), 'verify.drain', 'teamhq:verify-drain-healthy', app.unnamed_project(app.test_office()),
                     'verify-drain-healthy-' || gen_random_uuid(), gen_random_uuid()) returning job_id)
  select job_id::text as id from j`)

let ran = 0
const handler: Handler = {
  kind: 'verify.drain',
  reach: 'internal',
  handle: async (job: Job) => {
    ran += 1
    return {
      body: 'drained',
      confidence: 'high',
      evidence: 'verified',
      sources: [`job:${job.jobId}`],
      contradictions: null,
      path: 'deterministic_retrieval',
      model: null,
      announce: false,
    } as never
  },
}
const review: Reviewer = async () => ({ status: 'approved', notes: 'isolated proof' })
let drained = 'returned'
await drain(db, 'drain-proof', [handler], review, 5, {
  canTranscribe: false,
  canSubprocess: false,
}).catch((e: unknown) => {
  drained = `THREW: ${String((e as Error).message).slice(0, 120)}`
})
const after = await one(
  `select state::text as s from public.jobs where job_id = '${String(healthy.id)}'`,
)
console.log({ sweepRaises, drained, healthyRanTimes: ran, healthyState: after.s })
const pass = sweepRaises && drained === 'returned' && ran === 1 && after.s === 'complete'
console.log(
  pass ? 'PASS: the tick survived a sweep that raised and ran the healthy job once' : 'FAIL',
)
await db.end()
process.exitCode = pass ? 0 : 1

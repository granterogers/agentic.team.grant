/**
 * ONE BROKEN JOB CANNOT STOP THE OFFICE — the worker half (ledger R48).
 *
 *   npx tsx scripts/isolated/drain-survives-sweep.ts <replica-db>
 *
 * On a replica WITHOUT 0599 (`pre`, the control) the recovery sweep genuinely
 * raises: a job stalled in output_created with an output is sent to
 * notifying, which is illegal. `drain` must still dequeue and run the healthy
 * job queued beside it. On a replica WITH 0599 (`post`) the sweep must not
 * raise, the broken job must be recovered, and the healthy job still runs.
 * The mode is read from the database (see below). Before this pass the sweep was awaited bare and the throw aborted the
 * tick — the 87-minute production outage.
 */
import { drain, type Handler, type Job, type Reviewer } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const database = process.argv[2] ?? 'drain_proof'
const db = await isolated(database)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>

/*
  Two modes, because the proof has two jobs. Run it against `pre` (no 0599: the control) and the sweep MUST raise and
  the drain must survive it anyway. Run it against `post` (0599 applied) and the sweep must NOT raise at all (it
  contains the broken row) and the drain must still run the healthy job once. The mode is read from the database,
  never chosen by the caller, so a `post` run cannot be passed off as the control and the other way round. The
  fixture is shaped by the schema it finds: a replica from before the office model has no office_id on jobs and
  an unnamed_project() with no argument; the current one requires both.
*/
if (process.argv[3] === 'control-without-0599') {
  /*
    The control, made on the CURRENT schema: put back the sweep as it was before 0599 (a bare loop that sends any stalled
    job holding an output to notifying, with no per-row containment). The pre-office `pre` replica cannot be the control
    any more, because the current worker queries office_id. Everything else is the real schema and the real worker.
  */
  await db.execute(`create or replace function app.recover_stalled_jobs()
    returns table(job_id uuid, from_state public.job_state, to_state public.job_state, reason text)
    language plpgsql set search_path = pg_catalog, app, public as $f$
    declare r record;
    begin
      for r in select j.job_id, j.state from public.jobs j
                where j.state in ('running','output_created','quality_review','committing','committed','notifying')
                  and (j.leased_until is null or j.leased_until < now()) order by j.created_at for update
      loop
        update public.jobs j set state = 'notifying', state_reason = 'pre-0599 sweep', leased_by = null, leased_until = null
         where j.job_id = r.job_id;
        return query select r.job_id, r.state, 'notifying'::public.job_state, 'pre-0599 sweep'::text;
      end loop;
    end $f$`)
}
const officeAware =
  Number(
    (
      await one(
        `select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'office_id'`,
      )
    ).n,
  ) === 1
const officeCol = officeAware ? 'office_id, ' : ''
const officeVal = officeAware ? 'app.test_office(), ' : ''
const unnamed = officeAware ? 'app.unnamed_project(app.test_office())' : 'app.unnamed_project()'
const contained = Boolean(
  (
    await one(
      `select position('exception when others' in lower(pg_get_functiondef('app.recover_stalled_jobs()'::regprocedure))) > 0 as c`,
    )
  ).c,
)

const broken = await one(`
  with j as (insert into public.jobs (${officeCol}kind, requested_by, project_id, idempotency_key, correlation_id)
             values (${officeVal}'office.instruction', 'teamhq:verify-drain-broken', ${unnamed},
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
  with j as (insert into public.jobs (${officeCol}kind, requested_by, project_id, idempotency_key, correlation_id)
             values (${officeVal}'verify.drain', 'teamhq:verify-drain-healthy', ${unnamed},
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
const brokenAfter = await one(
  `select state::text as s from public.jobs where job_id = '${String(broken.id)}'`,
)
console.log({
  mode: contained ? 'post (0599: the sweep contains the broken row)' : 'pre (control: the sweep raises)',
  sweepRaises,
  drained,
  healthyRanTimes: ran,
  healthyState: after.s,
  brokenState: brokenAfter.s,
})
const drainOk = drained === 'returned' && ran === 1 && after.s === 'complete'
// pre: the sweep raises and the tick survives it. post: the sweep does NOT raise and the broken row has left
// output_created (it was recovered, not skipped for ever).
const pass = contained
  ? !sweepRaises && drainOk && brokenAfter.s !== 'output_created'
  : sweepRaises && drainOk
console.log(
  pass
    ? contained
      ? 'PASS: the sweep contained the broken row, the broken job was recovered, and the healthy job ran once'
      : 'PASS: the tick survived a sweep that raised and ran the healthy job once'
    : 'FAIL',
)
await db.end()
process.exitCode = pass ? 0 : 1

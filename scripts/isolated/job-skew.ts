/**
 * Run 4 - version skew: NEW worker code on the OLD schema (before 0619 and 0620).
 *
 *   npx tsx scripts/isolated/job-skew.ts <db built from production + 0613..0618>
 *
 * The worker is deployed after the migration, but a rollback of the schema, a second region or a runner on
 * stale code can put the new code in front of the old database. It must fail SAFE: keep every guarantee the
 * old schema can carry, and switch off - not crash on - the ones it cannot. The other direction (old code on
 * the new schema) is a job carrying no claim, proved in job-lifecycle.ts.
 */
import { startHeartbeat } from '../../src/jobs/fence.ts'
import { dequeue, type Handler, type HandlerOutput, runJob } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'skew_old')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const scope = `verify:skew-${run}`
const KIND = 'research.summarise'
const review = async () => ({ status: 'approved' as const, notes: 'isolated proof' })
const out = (body: string): HandlerOutput => ({
  body,
  confidence: 'high',
  evidence: 'verified',
  sources: ['db:isolated proof'],
  contradictions: null,
  path: 'deterministic_retrieval',
  model: null,
})
const newJob = async () =>
  String(
    (
      await one(`insert into public.jobs (kind, requested_by, idempotency_key, correlation_id, announce)
        values (${lit(KIND)}, ${lit(scope)}, ${lit(`skew-${run}-${crypto.randomUUID()}`)}, gen_random_uuid(), false)
        returning job_id::text as id`)
    ).id,
  )

const schema =
  await one(`select to_regprocedure('app.job_held(uuid,text,integer)') is not null as has_held,
  exists (select 1 from information_schema.columns where table_name = 'jobs' and column_name = 'origin_kind') as has_origin`)
check(
  'the database really is the OLD schema (no job_held, no origin columns)',
  schema.has_held === false && schema.has_origin === false,
  JSON.stringify(schema),
)

{
  const id = await newJob()
  const w = await dequeue(db, `old-${run}`, true, true, [KIND], scope)
  const h: Handler = {
    reach: 'internal',
    kind: KIND,
    handle: async () => out('done on the old schema'),
  }
  const r = await runJob(db, w as never, [h], review)
  check(
    'the new worker completes a job on the old schema (the check asks nothing it cannot ask)',
    r.finalState === 'complete',
    r.finalState,
  )
  void id
}
{
  // The plain-SQL half of the fence needs no new function, so a stale worker is still refused.
  const id = await newJob()
  const w1 = await dequeue(db, `s1-${run}`, true, true, [KIND], scope)
  let release: () => void = () => undefined
  const gate = new Promise<void>((res) => {
    release = res
  })
  const slow: Handler = {
    reach: 'internal',
    kind: KIND,
    handle: async () => {
      await gate
      return out('W1 late')
    },
  }
  const first = runJob(db, w1 as never, [slow], review)
  await new Promise((r) => setTimeout(r, 300))
  await db.execute(
    `update public.jobs set leased_until = now() - interval '1 minute' where job_id = ${lit(id)}::uuid`,
  )
  await db.execute(`select * from app.recover_stalled_jobs()`)
  await db.execute(`select app.requeue_retrying()`)
  const w2 = await dequeue(db, `s2-${run}`, true, true, [KIND], scope)
  const fast: Handler = { reach: 'internal', kind: KIND, handle: async () => out('W2 done') }
  await runJob(db, w2 as never, [fast], review)
  release()
  const stale = await first
  const j = await one(
    `select state::text as s, leased_by from public.jobs where job_id = ${lit(id)}::uuid`,
  )
  check(
    'on the old schema a stale worker still cannot finish over the holder (moveTo carries the check itself)',
    (stale.finalState === 'abandoned' || stale.finalState === 'complete') &&
      j.s === 'complete' &&
      String(j.leased_by).startsWith('s2-'),
    `${stale.finalState} / ${JSON.stringify(j)}`,
  )
}
{
  // The heartbeat has no renew_lease to call: it must stop itself quietly.
  const id = await newJob()
  const w = await dequeue(db, `hb-${run}`, true, true, [KIND], scope)
  const stop = startHeartbeat(db, w as never, 40)
  await new Promise((r) => setTimeout(r, 400))
  stop()
  const j = await one(`select state::text as s from public.jobs where job_id = ${lit(id)}::uuid`)
  check(
    'the heartbeat on a schema with no renewal stops quietly and the job is untouched',
    j.s === 'running',
    String(j.s),
  )
  await db.execute(
    `update public.jobs set state = 'failed', state_reason = 'proof done', leased_by = null, leased_until = null where job_id = ${lit(id)}::uuid`,
  )
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

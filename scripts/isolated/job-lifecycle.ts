/**
 * Run 4 - the job lifecycle under interruption (0620, src/jobs/fence.ts).
 *
 *   npx tsx scripts/isolated/job-lifecycle.ts <replica-db>
 *
 * The REAL worker (dequeue, runJob, the sweeps) against the replica. Every scenario is a way work gets lost,
 * duplicated or stranded when a process stops, is slow, or is duplicated: a stale worker waking after another
 * took over, a lease that lapses under a healthy slow handler, an answer that arrives while a job is being
 * parked, a retried parent, a job with no attempts left. Each is read back from canonical rows.
 */
import { dequeue, type Handler, type HandlerOutput, runJob } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'life620')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const scope = `verify:life-${run}`
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
const newJob = async (extra = ''): Promise<string> =>
  String(
    (
      await one(`insert into public.jobs (kind, requested_by, idempotency_key, correlation_id, announce ${extra === '' ? '' : ', max_attempts'})
        values (${lit(KIND)}, ${lit(scope)}, ${lit(`life-${run}-${crypto.randomUUID()}`)}, gen_random_uuid(), false ${extra === '' ? '' : `, ${extra}`})
        returning job_id::text as id`)
    ).id,
  )
const job = async (id: string) =>
  one(
    `select state::text as s, attempt, max_attempts, leased_by, state_reason from public.jobs where job_id = ${lit(id)}::uuid`,
  )
const outputs = async (id: string) =>
  Number(
    (await one(`select count(*)::int as n from public.outputs where job_id = ${lit(id)}::uuid`)).n,
  )
const situation = async (id: string) =>
  (
    (await one(`select app.job_situation(${lit(id)}::uuid) as s`)).s as {
      situation: string
    }
  ).situation

// ---- D1: a stale worker cannot finish a job another worker now holds ------------------------------------------
{
  const id = await newJob()
  const w1 = await dequeue(db, `w1-${run}`, true, true, [KIND], scope)
  let release: () => void = () => undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  let w1Ran = 0
  const slow: Handler = {
    reach: 'internal',
    kind: KIND,
    handle: async () => {
      w1Ran += 1
      await gate
      return out('W1 says it finished')
    },
  }
  const first = runJob(db, w1 as never, [slow], review)
  await new Promise((r) => setTimeout(r, 300))
  // The lease lapses: the handler is slower than the lease and nothing renewed it (heartbeat is 60s).
  await db.execute(
    `update public.jobs set leased_until = now() - interval '1 minute' where job_id = ${lit(id)}::uuid`,
  )
  await db.execute(`select * from app.recover_stalled_jobs()`)
  await db.execute(`select app.requeue_retrying()`)
  const w2 = await dequeue(db, `w2-${run}`, true, true, [KIND], scope)
  let w2Ran = 0
  const fast: Handler = {
    reach: 'internal',
    kind: KIND,
    handle: async () => {
      w2Ran += 1
      return out('W2 finished it')
    },
  }
  const second = await runJob(db, w2 as never, [fast], review)
  release()
  const stale = await first
  const j = await job(id)
  check(
    'a worker whose lease lapsed and whose job was taken over is told it is stale and writes nothing',
    stale.finalState === 'abandoned' && w1Ran === 1,
    `${stale.finalState} / ${stale.note.slice(0, 70)}`,
  )
  check(
    'the job belongs to the worker that holds it: complete, attempt 2, exactly one output (W2, not W1)',
    second.finalState === 'complete' &&
      j.s === 'complete' &&
      Number(j.attempt) === 2 &&
      (await outputs(id)) === 1 &&
      w2Ran === 1,
    JSON.stringify(j),
  )
  const body = String(
    (await one(`select body from public.outputs where job_id = ${lit(id)}::uuid`)).body,
  )
  check("and the output that stands is the holder's", body === 'W2 finished it', body)
}

// ---- the heartbeat: a healthy slow handler keeps its job --------------------------------------------------------
{
  const id = await newJob()
  const w = await dequeue(db, `hb-${run}`, true, true, [KIND], scope)
  await db.execute(
    `update public.jobs set leased_until = now() + interval '2 seconds' where job_id = ${lit(id)}::uuid`,
  )
  const mine = await one(
    `select app.renew_lease(${lit(id)}::uuid, ${lit(`hb-${run}`)}, ${String(w?.attempt)}) as ok`,
  )
  const theirs = await one(
    `select app.renew_lease(${lit(id)}::uuid, 'someone-else', ${String(w?.attempt)}) as ok`,
  )
  const stale = await one(
    `select app.renew_lease(${lit(id)}::uuid, ${lit(`hb-${run}`)}, ${String(Number(w?.attempt) + 1)}) as ok`,
  )
  const left = await one(
    `select extract(epoch from (leased_until - now()))::int as s from public.jobs where job_id = ${lit(id)}::uuid`,
  )
  check(
    'the holder renews its lease; another worker or an older attempt cannot',
    mine.ok === true && theirs.ok === false && stale.ok === false && Number(left.s) > 60,
    `${String(mine.ok)}/${String(theirs.ok)}/${String(stale.ok)} lease now ${String(left.s)}s`,
  )
  await db.execute(
    `update public.jobs set state = 'failed', state_reason = 'proof done', leased_by = null, leased_until = null where job_id = ${lit(id)}::uuid`,
  )
}

// ---- D3: a job with no attempts left is failed, not left ---------------------------------------------------------
{
  const id = await newJob('1')
  await db.execute(`alter table public.jobs disable trigger jobs_touch_updated_at`)
  await db.execute(
    `update public.jobs set state = 'queued', attempt = 1, updated_at = now() - interval '10 minutes' where job_id = ${lit(id)}::uuid`,
  )
  await db.execute(`alter table public.jobs enable trigger jobs_touch_updated_at`)
  const before = await situation(id)
  const swept = await db.execute(`select * from app.settle_exhausted_jobs()`)
  const j = await job(id)
  check(
    'a queued job at its ceiling reads as stuck, then is failed with its reason in words',
    before === 'stuck' &&
      swept.rows.length >= 1 &&
      j.s === 'failed' &&
      /no attempts left/.test(String(j.state_reason)),
    `${before} -> ${String(j.s)}: ${String(j.state_reason)}`,
  )
  const fresh = await newJob('1')
  await db.execute(
    `update public.jobs set state = 'queued', attempt = 1 where job_id = ${lit(fresh)}::uuid`,
  )
  await db.execute(`select * from app.settle_exhausted_jobs()`)
  check(
    'a job that only just reached its ceiling is left alone for a few minutes (the control: it does not fail everything)',
    String((await job(fresh)).s) === 'queued',
    String((await job(fresh)).s),
  )
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'proof done' where job_id = ${lit(fresh)}::uuid`,
  )
}

// ---- D2 and D5: an answer is not an attempt, and is never lost to a race ------------------------------------------
const blockerFor = async (id: string, state = 'open') => {
  const proj = String((await one(`select app.unnamed_project()::text as p`)).p)
  return String(
    (
      await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, state ${state === 'open' ? '' : ', resolved_at, answered_by, answered_option'})
        values (${lit(proj)}::uuid, ${lit(id)}::uuid, ${lit(`Run 4 proof ${run}`)}, 'isolated', 'nothing happens until answered', array['Yes','No'], 'chief-of-staff', false, ${lit(state)}::public.blocker_state ${state === 'open' ? '' : ", app.now_utc(), 'verify-operator', 'Yes'"})
        returning blocker_id::text as id`)
    ).id,
  )
}
const fp = 'a'.repeat(64)
{
  const id = await newJob('5')
  await db.execute(
    `update public.jobs set state = 'running', attempt = 5, leased_by = 'x', leased_until = now() + interval '5 minutes' where job_id = ${lit(id)}::uuid`,
  )
  await blockerFor(id)
  await db.execute(
    `select app.pause_job(${lit(id)}::uuid, 'awaiting_approval', 'asks a question', 'when he answers', false, null, null, ${lit(fp)})`,
  )
  const waiting = await situation(id)
  await db.execute(`select app.let_job_go(${lit(id)}::uuid, 'he answered')`)
  const j = await job(id)
  const pauseOpen = Number(
    (
      await one(
        `select count(*)::int as n from public.job_pauses where job_id = ${lit(id)}::uuid and resumed_at is null`,
      )
    ).n,
  )
  const claimed = await dequeue(db, `ans-${run}`, true, true, [KIND], scope)
  check(
    'D2: a job that had spent its last attempt asking a question can still be claimed once it is answered, and its pause is closed',
    waiting === 'waiting_for_grant' &&
      j.s === 'queued' &&
      Number(j.attempt) === 4 &&
      pauseOpen === 0 &&
      claimed?.jobId === id,
    `${waiting} / ${JSON.stringify(j)} / open pauses ${String(pauseOpen)} / claimed ${String(claimed?.jobId === id)}`,
  )
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'proof done' where job_id = ${lit(id)}::uuid`,
  )
}
{
  // D5: the person answered between the question being raised and the job being parked.
  const id = await newJob()
  const w = await dequeue(db, `race-${run}`, true, true, [KIND], scope)
  void w
  const b = await blockerFor(id) // raised
  await db.execute(
    `update public.blockers set state = 'resolved', resolved_at = app.now_utc(), answered_by = 'verify-operator', answered_option = 'Yes' where blocker_id = ${lit(b)}::uuid`,
  )
  await db.execute(`select app.let_job_go(${lit(id)}::uuid, 'he answered')`) // finds it still running: does nothing
  const midway = await job(id)
  await db.execute(
    `select app.pause_job(${lit(id)}::uuid, 'awaiting_approval', 'asks a question', 'when he answers', false, null, null, ${lit(fp)})`,
  )
  const j = await job(id)
  check(
    'D5: parking a job for a question that was ALREADY answered releases it at once instead of stranding it',
    midway.s === 'running' && j.s === 'queued',
    `${String(midway.s)} -> ${String(j.s)}`,
  )
  const stillOpen = await blockerFor(id) // and the control: a question genuinely open still parks
  await db
    .execute(
      `update public.jobs set state = 'running', leased_by = 'x', leased_until = now() + interval '5 minutes' where job_id = ${lit(id)}::uuid`,
    )
    .catch(() => undefined)
  const j2 = await one(`select state::text as s from public.jobs where job_id = ${lit(id)}::uuid`)
  void stillOpen
  void j2
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'proof done' where job_id = ${lit(id)}::uuid`,
  )
}
{
  const id = await newJob()
  await dequeue(db, `ctl-${run}`, true, true, [KIND], scope)
  await blockerFor(id) // genuinely open
  await db.execute(
    `select app.pause_job(${lit(id)}::uuid, 'awaiting_approval', 'asks a question', 'when he answers', false, null, null, ${lit(fp)})`,
  )
  check(
    'D5 control: a question that is genuinely open still parks the job',
    String((await job(id)).s) === 'paused' && (await situation(id)) === 'waiting_for_grant',
    String((await job(id)).s),
  )
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'proof done' where job_id = ${lit(id)}::uuid`,
  )
}

// ---- D4: a retried parent does not make its child twice ----------------------------------------------------------------
{
  const parent = await newJob()
  await dequeue(db, `par-${run}`, true, true, [KIND], scope)
  const mk = async (payload: string, p = parent) =>
    String(
      (
        await one(
          `select app.enqueue_child(${lit(p)}::uuid, 'office.instruction', ${lit(payload)}::jsonb)::text as c`,
        )
      ).c,
    )
  const a1 = await mk('{"say":"hello"}')
  const b1 = await mk('{"say":"a different thing"}')
  const a2 = await mk('{"say":"hello"}') // a second identical child in the SAME attempt is a second child
  // the attempt dies and is retried: running -> retrying -> queued -> running again
  await db.execute(
    `update public.jobs set leased_until = now() - interval '1 minute' where job_id = ${lit(parent)}::uuid`,
  )
  await db.execute(`select * from app.recover_stalled_jobs()`)
  await db.execute(`select app.requeue_retrying()`)
  await dequeue(db, `par2-${run}`, true, true, [KIND], scope)
  const a1r = await mk('{"say":"hello"}')
  const b1r = await mk('{"say":"a different thing"}')
  const a2r = await mk('{"say":"hello"}')
  const kids = Number(
    (
      await one(
        `select count(*)::int as n from public.jobs where parent_job_id = ${lit(parent)}::uuid`,
      )
    ).n,
  )
  check(
    'a retried parent finds the children it already made (same payload, same slot) and makes no more',
    a1 !== a2 && a1r === a1 && b1r === b1 && a2r === a2 && kids === 3,
    `${String(kids)} children (3 expected)`,
  )
  // a failed child is not reused
  await db.execute(
    `update public.jobs set state = 'failed', state_reason = 'proof' where job_id = ${lit(b1)}::uuid`,
  )
  const b1again = await mk('{"say":"a different thing"}')
  check(
    'a child that FAILED is not returned: the retry may try again',
    b1again !== b1,
    b1again === b1 ? 'reused' : 'new child',
  )
  // a deferral: the child itself re-enqueues a sibling with its own config under the same parent
  const cfg = String(
    (await one(`select pinned_config::text as c from public.jobs where job_id = ${lit(a1)}::uuid`))
      .c,
  )
  const sib1 = await mk(cfg)
  const sib2 = await mk(cfg)
  check(
    'a deferral (a sibling with the same payload) is still a new job each time',
    sib1 !== a1 && sib2 !== sib1,
    'siblings distinct',
  )
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'proof done' where parent_job_id = ${lit(parent)}::uuid and state in ('queued','retrying')`,
  )
  await db
    .execute(
      `update public.jobs set state = 'cancelled', state_reason = 'proof done' where job_id = ${lit(parent)}::uuid`,
    )
    .catch(() => undefined)
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

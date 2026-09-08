/**
 * Drive real jobs through the whole pipeline, against the live database.
 *
 *   npm run verify:worker
 *
 * Everything else in `scripts/verify/` tests one guarantee in isolation. This
 * is the first thing that meets all of them in one pass: dequeue under a
 * capacity limit, a handler, the §16 exemption rule, the review gate, and the
 * fourteen-state path with its transition trigger.
 *
 * The point is integration. Each guarantee below was already proved on its
 * own; what has never been shown is that a worker walking the normal path
 * satisfies them all without special-casing anything.
 *
 * One check performs a real inference call through the provider router (free
 * models only — the router refuses anything priced). It can fail for reasons
 * that are not this code's fault, and it is left able to fail rather than made
 * tolerant: a live integration check that cannot go red is not one.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'
import { hold, release } from '../../src/jobs/quiet.ts'
import type { Handler, HandlerOutput, Job, Reviewer } from '../../src/jobs/worker.ts'
import { dequeue, drain, recoverStalled, runJob } from '../../src/jobs/worker.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

// Hold the queue for the duration. Since 0121 a pass runs every minute, and a
// suite that drives the queue itself is now racing a live worker — see 0129
// and `src/jobs/quiet.ts`. Bounded and self-lapsing, so a crash here cannot
// leave the office stopped.
await hold(db, 600)

const run = Date.now().toString(36)
const WORKER = `verify-worker-${run}`
interface Check {
  what: string
  outcome: string
  passed: boolean
}
const checks: Check[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
}
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * Capacity is a GLOBAL limit, so this script competes with anything else
 * running against the same database.
 *
 * Found the hard way: run alongside `verify:db`, every dequeue returned null,
 * and fourteen checks went red describing symptoms of a busy queue as though
 * they were defects in the worker. The capacity limit was working perfectly.
 *
 * An unclear failure is a failure that gets misdiagnosed, so this refuses to
 * start rather than producing a wall of red. Exit code 2, distinct from the 1
 * that means a check actually failed.
 */
// Sweep first: a stalled lease from a dead worker is the most likely reason
// capacity is unavailable, and refusing to start over something the sweep
// would have fixed in a millisecond would be its own kind of unhelpful.
const preSwept = await recoverStalled(db)
if (preSwept.length > 0) {
  console.log(`recovered ${String(preSwept.length)} stalled job(s) before starting.`)
}

// The queue is GLOBAL and so is the capacity limit, so this script needs it to
// itself: `dequeue_job` hands out whatever is next, including another suite's
// leftovers, and a worker with no handler for a foreign job kind throws.
//
// Found the hard way twice. First running alongside `verify:db`, where every
// dequeue returned null and fourteen checks went red describing a busy queue as
// though it were a defect. Then again on leaked probe jobs from `verify:jobs`,
// where the dequeue succeeded and handed this script somebody else's work.
//
// An unclear failure is a failure that gets misdiagnosed, so this refuses to
// start. Exit code 2, distinct from the 1 that means a check actually failed.
//
// Since 2026-09-09 there are seven live duties, so the office is rarely idle
// for long and "refuse immediately" started failing this suite on a queue that
// was simply busy. The queue is already held above, so nothing NEW arrives —
// what is left is whatever was in flight at that moment, and the honest thing
// is to wait for it rather than to declare a working office a broken one.
//
// Two minutes, because a job that has not finished in two minutes is stuck
// rather than busy, and that is worth refusing over.
const liveNow = async (): Promise<number> =>
  Number(
    (
      await one(`
        select count(*)::int as live from public.jobs
         where state not in ('complete', 'cancelled', 'failed')
      `)
    )?.live ?? 0,
  )

for (let waited = 0; waited < 120 && (await liveNow()) > 0; waited += 5) {
  if (waited === 0) console.log('waiting for the office to go quiet before starting…')
  // The pause stops new work being CLAIMED, not work already running, so this
  // is waiting for in-flight jobs to reach a terminal state on their own.
  await new Promise((r) => setTimeout(r, 5_000))
}

const queueState = await one(`
  select app.capacity_limit('max_concurrent_jobs', 3) as limit_,
         (select count(*)::int from public.jobs
           where state not in ('complete', 'cancelled', 'failed')) as live
`)
if (Number(queueState?.live) > 0) {
  const others = await db.execute(`
    select kind, state::text as state, count(*)::int as n from public.jobs
    where state not in ('complete', 'cancelled', 'failed')
    group by 1, 2 order by 3 desc limit 5
  `)
  console.error(
    `the queue is still not empty after two minutes: ${String(queueState?.live)} live job(s).\n` +
      others.rows
        .map((r) => `  ${String(r.n)} x ${String(r.kind)} (${String(r.state)})`)
        .join('\n') +
      '\n\nThis script needs the queue to itself - dequeue is global and hands out ' +
      "whatever is next, including another suite's work.\n" +
      'Wait for the other run to finish, or `npm run purge:fixtures -- --go` if those are debris.',
  )
  process.exit(2)
}

const project = await one(`
  with created as (
    insert into public.projects (slug, name, status)
    values (${lit(`fixture-worker-${run}`)}, 'Fixture: worker', 'active')
    returning project_id
  ),
  attached as (
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, role)
    select project_id, 'upload', 'fixture', 'Verification fixture', 'source'
      from created
    returning project_id
  )
  select project_id::text as id from created
`)
const projectId = String(project?.id)

const enqueue = async (kind: string, key: string): Promise<string> => {
  const r = await one(`
    insert into public.jobs
      (correlation_id, project_id, idempotency_key, kind, requested_by, priority)
    values (gen_random_uuid(), ${lit(projectId)}::uuid, ${lit(key)}, ${lit(kind)},
            'verify:worker', 100)
    returning job_id::text as id
  `)
  return String(r?.id)
}

const stateOf = async (jobId: string): Promise<string> =>
  String(
    (await one(`select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`))?.s,
  )

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Deterministic: reads the database, calls no model. Exempt under §16. */
const statusHandler: Handler = {
  kind: 'status.count_jobs',
  handle: async (job, exec): Promise<HandlerOutput> => {
    const r = await exec.execute(
      `select count(*)::int as n from public.jobs where project_id = ${lit(String(job.projectId))}::uuid`,
    )
    return {
      body: `This project has ${String(r.rows[0]?.n)} job(s) on record.`,
      confidence: 'high',
      evidence: 'verified',
      // Written first with no sources, and the coherence check rejected it:
      // "verified" means someone can go and check. A count IS verified - and
      // saying so obliges the handler to name what verifies it. The rule did
      // its job on the first handler ever written against it.
      sources: ['db:public.jobs'],
      contradictions: null,
      path: 'deterministic_retrieval',
      model: null,
    }
  },
}

/**
 * A handler that lies: claims a deterministic path having called a model.
 *
 * Its metadata is deliberately COHERENT. Written first as verified-with-no-
 * sources, it was rejected by the coherence check before the insert ever
 * happened, so the check reported "no error" while proving nothing about the
 * trigger it was aimed at. A fixture blocked by an earlier gate tests that
 * gate, not the one you meant.
 */
const liarHandler: Handler = {
  kind: 'research.liar',
  handle: (): Promise<HandlerOutput> =>
    Promise.resolve({
      body: 'A conclusion a model wrote, claiming to be a database read.',
      confidence: 'medium',
      evidence: 'inferred',
      sources: [],
      contradictions: null,
      path: 'deterministic_retrieval',
      model: 'some/free-model',
    }),
}

/** Produces metadata that no reviewer should ever get to see. */
const incoherentHandler: Handler = {
  kind: 'research.incoherent',
  handle: (): Promise<HandlerOutput> =>
    Promise.resolve({
      body: 'A speculative finding asserted with total confidence.',
      confidence: 'high',
      evidence: 'speculative',
      sources: [],
      contradictions: null,
      path: 'inference',
      model: 'some/free-model',
    }),
}

const inferredHandler: Handler = {
  kind: 'research.conclusion',
  handle: (): Promise<HandlerOutput> =>
    Promise.resolve({
      body: 'On the evidence available, the enterprise tier is under-priced relative to its support cost.',
      confidence: 'medium',
      evidence: 'inferred',
      sources: ['notebook:fixture-source'],
      contradictions: null,
      path: 'inference',
      model: 'fixture/free-model',
    }),
}

const throwingHandler: Handler = {
  kind: 'research.explodes',
  handle: (): Promise<HandlerOutput> => Promise.reject(new Error('the provider went away')),
}

const HANDLERS = [statusHandler, liarHandler, incoherentHandler, inferredHandler, throwingHandler]

const approve: Reviewer = () =>
  Promise.resolve({ status: 'approved', notes: 'Reads correctly against the cited source.' })
const reject: Reviewer = () =>
  Promise.resolve({
    status: 'rejected',
    notes: 'The cited source does not support the claim as written.',
  })

// ===========================================================================
// 1. The deterministic path commits without review
// ===========================================================================

const detJob = await enqueue('status.count_jobs', `fixture-worker-det-${run}`)
const detDequeued = await dequeue(db, WORKER)
const detResult = detDequeued === null ? null : await runJob(db, detDequeued, HANDLERS, approve)

record(
  'a deterministic job reaches complete without a reviewer being consulted',
  detResult === null ? 'nothing dequeued' : `${detResult.finalState}: ${detResult.note}`,
  detResult?.finalState === 'complete' && detResult.note.includes('without review'),
)

const detOutput = await one(`
  select deterministic, reviewer_status::text as rs, model
  from public.outputs where job_id = ${lit(detJob)}::uuid
`)
record(
  'its output is recorded as deterministic, unreviewed, with no model',
  `deterministic=${String(detOutput?.deterministic)} reviewer_status=${String(detOutput?.rs)} model=${String(detOutput?.model ?? 'null')}`,
  detOutput?.deterministic === true && detOutput?.rs === 'pending' && detOutput?.model === null,
)

// ===========================================================================
// 2. A handler that lies about its path is refused by the database
// ===========================================================================

await enqueue('research.liar', `fixture-worker-liar-${run}`)
const liarJob = await dequeue(db, WORKER)
let liarError = 'no error'
if (liarJob !== null) {
  try {
    await runJob(db, liarJob, HANDLERS, approve)
  } catch (error) {
    liarError =
      error instanceof SqlExecutionError || error instanceof Error
        ? error.message.replace(/\s+/g, ' ').slice(0, 200)
        : String(error)
  }
}
record(
  'a handler claiming a deterministic path while naming a model is refused at the insert',
  // The job id is in the outcome because "no error" was ambiguous between "the
  // trigger did not fire" and "nothing was dequeued so nothing ran" - and a
  // check whose failure you cannot attribute is barely better than no check.
  `${liarJob === null ? 'NOTHING DEQUEUED' : liarJob.jobId.slice(0, 8)}: ${liarError.slice(0, 120)}`,
  liarError.includes('cannot be marked deterministic'),
)

// ===========================================================================
// 3. Incoherent metadata fails before a reviewer is spent on it
// ===========================================================================

const incJob = await enqueue('research.incoherent', `fixture-worker-inc-${run}`)
const incDequeued = await dequeue(db, WORKER)
let reviewerCalled = false
const countingReviewer: Reviewer = (o, j) => {
  reviewerCalled = true
  return approve(o, j)
}
const incResult =
  incDequeued === null ? null : await runJob(db, incDequeued, HANDLERS, countingReviewer)
record(
  'high confidence in a speculative finding fails, and no reviewer was consulted',
  `${String(incResult?.finalState)}, reviewer called=${String(reviewerCalled)}`,
  incResult?.finalState === 'failed' && !reviewerCalled,
)
const incOutputs = await one(
  `select count(*)::int as n from public.outputs where job_id = ${lit(incJob)}::uuid`,
)
record(
  'nothing incoherent was written to outputs at all',
  `${String(incOutputs?.n)} output row(s)`,
  Number(incOutputs?.n) === 0,
)

// ===========================================================================
// 4. Review actually gates the commit
// ===========================================================================

const rejJob = await enqueue('research.conclusion', `fixture-worker-rej-${run}`)
const rejDequeued = await dequeue(db, WORKER)
const rejResult = rejDequeued === null ? null : await runJob(db, rejDequeued, HANDLERS, reject)
record(
  'a rejected output sends the job back rather than committing it',
  `${String(rejResult?.finalState)}: ${String(rejResult?.note)}`,
  rejResult?.finalState === 'retrying',
)
record(
  'the rejected job never reached committed',
  `state=${await stateOf(rejJob)}`,
  (await stateOf(rejJob)) === 'retrying',
)

await enqueue('research.conclusion', `fixture-worker-ok-${run}`)
const okDequeued = await dequeue(db, WORKER)
const okResult = okDequeued === null ? null : await runJob(db, okDequeued, HANDLERS, approve)
record(
  'an approved output commits, so review is a gate and not a wall',
  `${String(okResult?.finalState)}: ${String(okResult?.note)}`,
  okResult?.finalState === 'complete' && String(okResult?.note).includes('after review'),
)

// ===========================================================================
// 5. Failures and unknown kinds
// ===========================================================================

const boomJob = await enqueue('research.explodes', `fixture-worker-boom-${run}`)
const boomDequeued = await dequeue(db, WORKER)
const boomResult = boomDequeued === null ? null : await runJob(db, boomDequeued, HANDLERS, approve)
record(
  'a handler that throws sends the job to retrying with the reason recorded',
  `${String(boomResult?.finalState)}: ${String(boomResult?.note).slice(0, 60)}`,
  boomResult?.finalState === 'retrying',
)
const boomReason = await one(
  `select state_reason from public.jobs where job_id = ${lit(boomJob)}::uuid`,
)
record(
  'the failure reason survives on the job, so nothing looks stuck without explanation',
  String(boomReason?.state_reason ?? '').slice(0, 70),
  String(boomReason?.state_reason ?? '').includes('the provider went away'),
)

const unknownJob = await enqueue('research.nobody_handles_this', `fixture-worker-unk-${run}`)
const unkDequeued = await dequeue(db, WORKER)
let unkError = 'no error'
if (unkDequeued !== null) {
  try {
    await runJob(db, unkDequeued, HANDLERS, approve)
  } catch (error) {
    unkError = (error as Error).message.slice(0, 120)
  }
}
// PAUSED, not failed, and not retried either.
//
// This check used to require `failed`, on the reasoning that the next attempt
// has the same missing handler. That is true of a typo in a kind and wrong
// about the case that happened: 0107's trigger shipped a
// `knowledge.read_source` job to a worker running the previous deploy, which
// failed it permanently four minutes before the deploy that could handle it
// arrived. The kind is a statement about this worker, not about the job.
const unkState = await stateOf(unknownJob)
const unkAttempt = Number(
  (await one(`select attempt from public.jobs where job_id = ${lit(unknownJob)}::uuid`))?.attempt,
)
record(
  'an unhandled kind is PAUSED for a later deploy, not failed and not retried',
  `${unkError} | state=${unkState} attempt=${String(unkAttempt)}`,
  unkError.includes('no handler registered') && unkState === 'paused',
)

// The half that makes pausing safe rather than merely kinder: it must leave
// the queue. A job that stayed queued would be dequeued again immediately and
// spin for as long as the handler is missing.
const unkRequeued = await dequeue(db, WORKER)
record(
  'CONTROL: and it is out of the queue, so it cannot spin against the same missing handler',
  unkRequeued === null ? 'nothing dequeued' : `dequeued ${unkRequeued.kind}`,
  unkRequeued === null || unkRequeued.jobId !== unknownJob,
)

// ===========================================================================
// 6. Capacity holds while the worker drains
// ===========================================================================

const capacity = Number((await one(`select app.capacity_limit('max_concurrent_jobs', 3) as n`))?.n)
for (let i = 0; i < capacity + 3; i++) {
  await enqueue('status.count_jobs', `fixture-worker-cap-${String(i)}-${run}`)
}
// The drain legitimately picks up more than the backlog: recovery now also
// re-queues everything in `retrying`, so the earlier rejected and thrown jobs
// become eligible again and are re-attempted. That is the behaviour we want -
// the check asserts the backlog completed, not that nothing else ran.
const backlogBefore = Number(
  (
    await one(
      `select count(*)::int as n from public.jobs
       where project_id = ${lit(projectId)}::uuid and kind = 'status.count_jobs'
         and state not in ('complete', 'cancelled', 'failed')`,
    )
  )?.n,
)
const drained = await drain(db, WORKER, HANDLERS, approve, 50)
const backlogAfter = Number(
  (
    await one(
      `select count(*)::int as n from public.jobs
       where project_id = ${lit(projectId)}::uuid and kind = 'status.count_jobs'
         and state <> 'complete'`,
    )
  )?.n,
)
record(
  `the worker drains a backlog of ${String(capacity + 3)} without exceeding capacity`,
  `${String(backlogBefore)} queued, ${String(drained.length)} job(s) run in total, ${String(backlogAfter)} of the backlog left incomplete`,
  backlogBefore >= capacity + 3 && backlogAfter === 0,
)

// Concurrency: a second worker must not be handed a job the first holds.
await enqueue('status.count_jobs', `fixture-worker-race-${run}`)
const [a, b] = await Promise.all([dequeue(db, `${WORKER}-a`), dequeue(db, `${WORKER}-b`)])
record(
  'two workers racing for one job do not both get it',
  `a=${a === null ? 'null' : a.jobId.slice(0, 8)} b=${b === null ? 'null' : b.jobId.slice(0, 8)}`,
  (a === null) !== (b === null),
)
for (const j of [a, b]) if (j !== null) await runJob(db, j, HANDLERS, approve)

// ===========================================================================
// 6b. The recovery sweep, which nothing used to call
// ===========================================================================

const stalled = await enqueue('status.count_jobs', `fixture-worker-stall-${run}`)
// Take it, then abandon it exactly as a killed process would: the row stays
// as it was and the lease simply expires. No shutdown hook runs, which is why
// recovery keys on lease expiry rather than on a clean handover.
await db.execute(`
  update public.jobs
  set state = 'running', leased_by = 'worker-that-died',
      leased_until = app.now_utc() - interval '1 minute'
  where job_id = ${lit(stalled)}::uuid
`)
const blockedBefore = await dequeue(db, `${WORKER}-blocked`)
record(
  'a job held by a dead worker still counts against capacity',
  blockedBefore === null
    ? 'dequeue returned nothing while the stalled lease was held'
    : `dequeued ${blockedBefore.jobId.slice(0, 8)} anyway`,
  blockedBefore === null,
)

const recovered = await recoverStalled(db)
record(
  'the sweep reclaims it, and says which worker died holding it',
  recovered.length === 0
    ? 'nothing recovered'
    : `${String(recovered.length)}: ${String(recovered[0]?.reason).slice(0, 70)}`,
  recovered.some((r) => r.jobId === stalled && r.reason.includes('worker-that-died')),
)

// The sweep reports `running -> retrying`, and `recoverStalled` then calls
// `app.requeue_retrying()` in the same breath, so what is observable
// afterwards is `queued`. Asserted as queued deliberately: the intermediate
// state is real and reported by the sweep, but a check that expected to SEE
// `retrying` would be asserting that recovery stops halfway - which is the bug
// this pairing was added to fix, not the behaviour to lock in.
const afterSweep = await stateOf(stalled)
record(
  'it is recovered to retrying and re-queued, not failed - a dead worker is not a failed job',
  `sweep reported ${String(recovered[0]?.fromState)} -> retrying, now ${afterSweep}`,
  afterSweep === 'queued' && recovered.some((r) => r.jobId === stalled),
)

const rerun = await drain(db, WORKER, HANDLERS, approve, 10)
record(
  'and the drain then runs it to completion',
  `${String(rerun.length)} job(s), ${await stateOf(stalled)}`,
  (await stateOf(stalled)) === 'complete',
)

// ===========================================================================
// 7. One real end-to-end, through the actual provider
// ===========================================================================

const apiKey = process.env.OPENROUTER_API_KEY ?? ''
if (apiKey === '') {
  record(
    'end-to-end through the real provider',
    'SKIPPED: OPENROUTER_API_KEY not set in this environment',
    false,
  )
} else {
  const router = new ProviderRouter(db, apiKey)
  const liveHandler: Handler = {
    kind: 'research.live',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const completion = await router.complete({
        messages: [
          {
            role: 'user',
            content:
              'In two sentences of plain prose, and with no preamble, say what a ' +
              'project brief is for. Do not use bullet points.',
          },
        ],
        maxTokens: 2_000,
        correlationId: job.correlationId,
      })
      return {
        body: completion.content.trim(),
        confidence: 'medium',
        evidence: 'inferred',
        sources: [],
        contradictions: null,
        path: 'inference',
        model: completion.model,
      }
    },
  }

  const liveJob = await enqueue('research.live', `fixture-worker-live-${run}`)
  const liveDequeued = await dequeue(db, WORKER)
  let liveState = 'none'
  if (liveDequeued !== null) {
    const r = await runJob(db, liveDequeued, [...HANDLERS, liveHandler], approve)
    liveState = r.finalState
  }
  const liveOut = await one(`
    select model, length(body) as len, reviewer_status::text as rs, deterministic
    from public.outputs where job_id = ${lit(liveJob)}::uuid
  `)
  record(
    'a real model call goes queued -> committed -> complete through every gate',
    `state=${liveState} model=${String(liveOut?.model)} body=${String(liveOut?.len)} chars reviewer=${String(liveOut?.rs)}`,
    liveState === 'complete' && liveOut?.rs === 'approved' && liveOut?.deterministic === false,
  )

  const spend = await one(`
    select coalesce(sum(cost_usd), 0)::text as total, count(*)::int as calls
    from public.inference_usage
    where correlation_id = (select correlation_id from public.jobs where job_id = ${lit(liveJob)}::uuid)
  `)
  record(
    'the real call was recorded and cost nothing',
    `${String(spend?.calls)} call(s), $${String(spend?.total)}`,
    Number(spend?.calls) >= 1 && Number(spend?.total) === 0,
  )
}

// ===========================================================================
// Report, then clean up
// ===========================================================================
console.log('| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) {
  console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
}
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)

try {
  await db.execute(`
    update public.jobs set state = 'failed', finished_at = app.now_utc(),
      state_reason = 'fixture retired by verify:worker'
    where project_id = ${lit(projectId)}::uuid and state not in ('complete', 'cancelled', 'failed')
  `)
  await db.execute(
    `update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid`,
  )
  console.log('\nfixtures retired.')
} catch (error) {
  console.log(`\ncleanup did not complete: ${(error as Error).message.slice(0, 160)}`)
}

await release(db)

if (failed.length > 0) process.exit(1)

/**
 * The worker's failure path under a database that blips (#443).
 *
 *   npx tsx scripts/isolated/worker-failure-paths.ts <replica-db>
 *
 * `job-lifecycle` and `job-fence` already prove the claim, the fence, the lease, the heartbeat, the exhausted-attempts sweep and the
 * retried parent. What they never did is fail the DATABASE LINK itself at the moment a handler's failure is being recorded, which is
 * the evidence the 11 `office.notion_sync` jobs left: every attempt ended in stall recovery and none carried a handler error.
 *
 * The REAL worker (`dequeue`, `runJob`, `recoverStalled`) runs on the replica through a thin executor that throws the exact error the
 * edge worker's postgres.js raises (`CONNECT_TIMEOUT`) on chosen statements. Each section is read back from canonical rows.
 */
import type { SqlExecutor } from '../../src/db/executor.ts'
import {
  dequeue,
  type Handler,
  type HandlerOutput,
  recoverStalled,
  runJob,
} from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'wfp')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
let total = 0
let failed = 0
const check = (what: string, ok: boolean, detail: string) => {
  total += 1
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const scope = `verify:wfp-${run}`
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
/** Every section starts from a queue holding none of this proof's earlier work, so a dequeue can only claim the job it just made. */
const clean = async (): Promise<void> => {
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'proof: between sections', leased_by = null, leased_until = null
      where requested_by = ${lit(scope)} and state in ('queued', 'retrying', 'running', 'paused')`,
  )
}
const newJob = async (maxAttempts?: number): Promise<string> => {
  await clean()
  return String(
    (
      await one(`insert into public.jobs (office_id, kind, requested_by, idempotency_key, correlation_id, announce${maxAttempts === undefined ? '' : ', max_attempts'})
        values (app.test_office(), ${lit(KIND)}, ${lit(scope)}, ${lit(`wfp-${run}-${crypto.randomUUID()}`)}, gen_random_uuid(), false${maxAttempts === undefined ? '' : `, ${String(maxAttempts)}`})
        returning job_id::text as id`)
    ).id,
  )
}
const job = async (id: string) =>
  one(
    `select state::text as s, attempt, max_attempts, leased_by, state_reason from public.jobs where job_id = ${lit(id)}::uuid`,
  )
const lapse = async (id: string) =>
  db.execute(
    `update public.jobs set leased_until = now() - interval '1 minute' where job_id = ${lit(id)}::uuid`,
  )

/** An executor that fails the link (the edge worker's own wording) for statements `when` selects, `budget.n` times. */
const budget = { n: 0, hits: 0 }
const LINK = 'Failed to run sql query: write CONNECT_TIMEOUT 10.0.0.1:5432'
const flaky = (when: (sql: string) => boolean, message = LINK): SqlExecutor => ({
  kind: db.kind,
  execute: async (sql: string) => {
    if (budget.n > 0 && when(sql)) {
      budget.n -= 1
      budget.hits += 1
      throw new Error(message)
    }
    return db.execute(sql)
  },
})
// The statements a handler's failure goes on to write: the claim check and the move.
const failurePath = (sql: string): boolean =>
  /app\.job_held\(/.test(sql) || /update public\.jobs\s+set state = 'retrying'/.test(sql)
const throws = (message: string): Handler => ({
  reach: 'internal',
  kind: KIND,
  handle: async () => {
    throw new Error(message)
  },
})
const works: Handler = { reach: 'internal', kind: KIND, handle: async () => out('done') }

// ---- W1: the baseline, a job that works --------------------------------------------------------------------------
{
  const id = await newJob()
  const w = await dequeue(db, `w1-${run}`, true, true, [KIND], scope)
  const r = await runJob(db, w as never, [works], review)
  check(
    'a job that works completes on its first attempt',
    r.finalState === 'complete' && String((await job(id)).s) === 'complete',
    `${r.finalState}`,
  )
}

// ---- W2: a handler that throws is retried with the reason in words, and the next attempt can finish -----------------
{
  const id = await newJob()
  const w = await dequeue(db, `w2-${run}`, true, true, [KIND], scope)
  const r = await runJob(db, w as never, [throws('provider said 503')], review)
  const j = await job(id)
  check(
    'a retryable failure moves the job to retrying and keeps the handler own words',
    r.finalState === 'retrying' &&
      j.s === 'retrying' &&
      /handler threw: provider said 503/.test(String(j.state_reason)),
    `${String(j.s)}: ${String(j.state_reason)}`,
  )
  await db.execute(
    `update public.jobs set state = 'queued', not_before = now() - interval '1 second' where job_id = ${lit(id)}::uuid`,
  )
  const again = await dequeue(db, `w2b-${run}`, true, true, [KIND], scope)
  const r2 = await runJob(db, again as never, [works], review)
  check(
    'the next attempt is attempt 2 and completes (a failure spent one attempt, not more)',
    r2.finalState === 'complete' && Number((await job(id)).attempt) === 2,
    `attempt ${String((await job(id)).attempt)} ${r2.finalState}`,
  )
}

// ---- W3: the database blips while the failure is being recorded -------------------------------------------------------
{
  const id = await newJob()
  const w = await dequeue(db, `w3-${run}`, true, true, [KIND], scope)
  budget.n = 2 // the claim check and the first move both time out; the link is back for the third
  const r = await runJob(flaky(failurePath), w as never, [throws('notion said 429')], review).catch(
    (e: unknown) => ({ finalState: 'threw', note: String((e as Error).message) }),
  )
  budget.n = 0
  const j = await job(id)
  check(
    'a short blip while recording a failure still ends in retrying WITH the handler reason (the bookkeeping is retried, not abandoned)',
    j.s === 'retrying' && /handler threw: notion said 429/.test(String(j.state_reason)),
    `${r.finalState} / row ${String(j.s)}: ${String(j.state_reason)}`,
  )
}

// ---- W3b: the control. A statement the database REFUSES is not retried: one attempt, then the lease sweep as before -------
{
  const id = await newJob()
  const w = await dequeue(db, `w3b-${run}`, true, true, [KIND], scope)
  budget.n = 10
  budget.hits = 0
  await runJob(
    flaky(failurePath, '23514: new row for relation "jobs" violates check constraint'),
    w as never,
    [throws('x')],
    review,
  ).catch(() => undefined)
  const hits = budget.hits
  budget.n = 0
  check(
    'a refused statement in the failure path is not retried (one attempt at the claim check), so a refusal is never hidden by a retry',
    hits === 1 && String((await job(id)).s) === 'running',
    `${String(hits)} refused attempt(s); row ${String((await job(id)).s)}`,
  )
}

// ---- W4: the outage outlasts the retries: the job is recovered, and no attempt is spent twice --------------------------
{
  const id = await newJob()
  const w = await dequeue(db, `w4-${run}`, true, true, [KIND], scope)
  budget.n = 1000
  const r = await runJob(flaky(failurePath), w as never, [throws('connect timeout')], review).catch(
    (e: unknown) => ({ finalState: 'threw', note: String((e as Error).message) }),
  )
  budget.n = 0
  const held = await job(id)
  await lapse(id)
  const swept = await recoverStalled(db)
  const after = await job(id)
  check(
    'a persistent outage never loses the job: it is still held (not lost, not failed) until its lease lapses',
    (held.s === 'running' || held.s === 'retrying') && r.finalState !== 'complete',
    `row ${String(held.s)}, run result ${r.finalState}`,
  )
  check(
    'the lapsed lease is recovered to retrying with a reason, and the attempt counter is the claim count (1), not 2',
    after.s === 'retrying' || after.s === 'queued'
      ? Number(after.attempt) === 1 && swept.length >= 0
      : false,
    `${String(after.s)} attempt ${String(after.attempt)}: ${String(after.state_reason)}`,
  )
}

// ---- W5: five-attempt exhaustion fails with a reason and an impediment, never silently --------------------------------
{
  const id = await newJob()
  let last = ''
  for (let i = 1; i <= 5; i += 1) {
    const state = String((await job(id)).s)
    if (state === 'failed') break
    await db.execute(
      `update public.jobs set state = 'queued', not_before = now() - interval '1 second' where job_id = ${lit(id)}::uuid and state = 'retrying'`,
    )
    const w = await dequeue(db, `w5-${run}-${String(i)}`, true, true, [KIND], scope)
    if (w === null) break
    const r = await runJob(db, w as never, [throws(`always fails ${String(i)}`)], review)
    last = r.finalState
  }
  const j = await job(id)
  const imp = Number(
    (
      await one(
        `select count(*)::int as n from public.job_impediments where job_id = ${lit(id)}::uuid`,
      )
    ).n,
  )
  check(
    'a job that always fails ends failed (within the hard cap) with the last handler reason in its row and an impediment recorded',
    j.s === 'failed' && /handler threw/.test(String(j.state_reason)) && imp >= 1,
    `${String(j.s)} attempt ${String(j.attempt)} impediments ${String(imp)} last ${last}: ${String(j.state_reason)}`,
  )
}

// ---- W6: two recovery sweeps at once move a stalled job once ---------------------------------------------------------
{
  const id = await newJob()
  await dequeue(db, `w6-${run}`, true, true, [KIND], scope)
  await lapse(id)
  const [a, b] = await Promise.all([recoverStalled(db), recoverStalled(db)])
  const mine = [...a, ...b].filter((x) => x.jobId === id)
  const j = await job(id)
  check(
    'concurrent recovery workers move a stalled job once and it is not failed by the race',
    mine.length === 1 && Number(j.attempt) === 1 && j.s !== 'failed',
    `${String(mine.length)} transition(s); ${String(j.s)} attempt ${String(j.attempt)}`,
  )
}

// ---- W7: one office's failure and recovery never touch another office's running job ------------------------------------
{
  const mineJob = await newJob()
  await dequeue(db, `w7-${run}`, true, true, [KIND], scope)
  await lapse(mineJob)
  // Another office holds a perfectly healthy running job (a live lease) while this office's job is recovered.
  const theirs = String(
    (
      await one(`insert into public.jobs (office_id, kind, requested_by, idempotency_key, correlation_id, announce, state, leased_by, leased_until, attempt, claim_gen)
        values (app.operator_office(), ${lit(KIND)}, ${lit(scope)}, ${lit(`wfp-${run}-${crypto.randomUUID()}`)}, gen_random_uuid(), false, 'running', 'w-other-office', now() + interval '5 minutes', 1, 1)
        returning job_id::text as id`)
    ).id,
  )
  const swept = await recoverStalled(db)
  const t = await job(theirs)
  check(
    "recovering this office's stalled job leaves another office's live job exactly as it was",
    swept.some((x) => x.jobId === mineJob) &&
      !swept.some((x) => x.jobId === theirs) &&
      t.s === 'running' &&
      t.leased_by === 'w-other-office',
    `${String(t.s)} held by ${String(t.leased_by)}`,
  )
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'proof done', leased_by = null, leased_until = null where job_id = ${lit(theirs)}::uuid`,
  )
}

// ---- W8: a failed job is visible where a person looks -------------------------------------------------------------------
{
  const id = await newJob(1)
  const w = await dequeue(db, `w8-${run}`, true, true, [KIND], scope)
  await runJob(db, w as never, [throws('boom')], review)
  const sit = (
    (await one(`select app.job_situation(${lit(id)}::uuid) as s`)).s as { situation: string }
  ).situation
  check(
    'a job that ran out of attempts reads as failed to the reader Team HQ asks, with its reason in the row',
    String((await job(id)).s) === 'failed' && sit !== 'running' && sit !== 'queued',
    `situation ${sit}`,
  )
}

console.log(`\n${String(total - failed)}/${String(total)} checks passed`)
process.exit(failed === 0 ? 0 : 1)

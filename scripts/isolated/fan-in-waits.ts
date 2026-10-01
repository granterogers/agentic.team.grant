/**
 * B4 (architecture audit, run 1): waiting for sibling specialists is not
 * repeated failure, and cannot starve the synthesis of attempts.
 *
 *   npx tsx scripts/isolated/fan-in-waits.ts <replica-db>
 *
 * The REAL worker (`dequeue`, `runJob`) runs the REAL `office.synthesise`
 * handler against the replica. A branch that has not finished makes the
 * synthesis PAUSE (`dependency_wait`); the sweeper wakes it (`app.resume_job`,
 * what `resumable_now` does when the pause's `until` has passed). Every wake is
 * a dequeue, and a dequeue used to spend an attempt, so after `max_attempts`
 * wakes a fan-in whose specialists were merely slow was never claimed again and
 * nothing failed it. Asserted here from canonical state: more wakes than
 * max_attempts, and the synthesis still runs and completes when the branch
 * settles - and a job that genuinely FAILS still exhausts its attempts.
 */
import type { DeliveryService as _D } from '../../src/channels/delivery.ts'
import { synthesiseHandler } from '../../src/handlers/synthesise.ts'
import { dequeue, type Job, type Reviewer, runJob } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

void (null as unknown as _D | null)
const db = await isolated(process.argv[2] ?? 'fanin0609')
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

const router = { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never
const handler = synthesiseHandler({ db, router })
const review: Reviewer = async () => ({ status: 'approved', notes: 'isolated proof' })
const notify = async () => ({ delivered: true, note: 'isolated: nothing is sent' })
const WORKER = 'fanin'

const stateOf = async (id: string) =>
  (await one(
    `select state::text as s, attempt, max_attempts from public.jobs where job_id = ${lit(id)}::uuid`,
  )) as {
    s: string
    attempt: number
    max_attempts: number
  }

/** One fan-in: a real turn, one branch that has not finished, and the synthesis job over it. */
const fanIn = async () => {
  const parent = await realParent(db)
  const branch = String(
    (
      await one(`select app.enqueue_child(p_parent => ${lit(parent)}::uuid, p_kind => 'verify.branch',
          p_payload => '{}'::jsonb, p_announce => false)::text as v`)
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0]
  if (branch === undefined) throw new Error('no branch job')
  const made = json(
    (
      await one(`select app.fan_in_over(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, 'What do the two of you make of the venue?',
        ${lit(JSON.stringify([{ agent: 'research-director', job_id: branch, purpose: 'what research makes of it' }]))}::jsonb,
        'office.synthesise', app.now_utc() + interval '20 minutes') as v`)
    ).v,
  )
  const synth = String((made.synthesis_job ?? made.job_id ?? made.synthesis ?? made.job) as string)
  return { parent, branch, synth, made }
}

const cycle = async (synth: string): Promise<{ ran: boolean; state: string }> => {
  const got = await dequeue(db, WORKER, false, false, ['office.synthesise'])
  if (got === null || got.jobId !== synth) return { ran: false, state: (await stateOf(synth)).s }
  await runJob(db, got as Job, [handler], review, notify)
  return { ran: true, state: (await stateOf(synth)).s }
}

// ---- the wait: many more wakes than the job has attempts ------------------------
const f = await fanIn()
check(
  'precondition: a synthesis job exists over a branch that has not finished',
  /^[0-9a-f-]{36}$/.test(f.synth),
  JSON.stringify(f.made),
)
const before = await stateOf(f.synth)
const WAKES = before.max_attempts + 4
let lastRan = true
for (let i = 1; i <= WAKES; i += 1) {
  const c = await cycle(f.synth)
  lastRan = c.ran
  if (!c.ran) {
    check(
      `wake ${String(i)} of ${String(WAKES)}: the synthesis is still claimed and still waiting`,
      false,
      `not claimable; state ${c.state}, attempt ${String((await stateOf(f.synth)).attempt)}/${String(before.max_attempts)}`,
    )
    break
  }
  if (c.state !== 'paused') {
    check(
      `wake ${String(i)}: the synthesis waits (paused) while a branch is out`,
      false,
      `state ${c.state}`,
    )
    break
  }
  await db.execute(
    `select app.resume_job(${lit(f.synth)}::uuid, 'the branches were checked again')`,
  )
}
const mid = await stateOf(f.synth)
check(
  `the synthesis survived ${String(WAKES)} wakes against a ceiling of ${String(before.max_attempts)} attempts`,
  lastRan && mid.s === 'queued',
  `state ${mid.s}, attempt ${String(mid.attempt)}/${String(mid.max_attempts)}`,
)
check(
  'waiting spent no attempts: the counter still says how many times it was actually RUN to a conclusion',
  mid.attempt < mid.max_attempts,
  `attempt ${String(mid.attempt)}/${String(mid.max_attempts)}`,
)

// ---- and it still finishes when the branch settles ------------------------------
await db.execute(
  `update public.jobs set state = 'cancelled', state_reason = 'isolated proof: the branch was called off' where job_id = ${lit(f.branch)}::uuid`,
)
const done = await cycle(f.synth)
const end = await stateOf(f.synth)
check(
  'the branch settles: the synthesis runs and completes (it was never starved)',
  done.ran && end.s === 'complete',
  `state ${end.s}`,
)

// ---- a job that genuinely fails still runs out of attempts ----------------------
const failing = await realParent(db)
const failer = String(
  (
    await one(
      `select app.enqueue_child(p_parent => ${lit(failing)}::uuid, p_kind => 'verify.fails', p_payload => '{}'::jsonb, p_announce => false)::text as v`,
    )
  ).v,
).match(/[0-9a-f-]{36}/)?.[0]
const failHandler = {
  kind: 'verify.fails',
  reach: 'internal',
  handle: async () => {
    throw new Error('a genuine failure')
  },
} as never
let failedRuns = 0
for (let i = 0; i < 12; i += 1) {
  const got = await dequeue(db, WORKER, false, false, ['verify.fails'])
  if (got === null || got.jobId !== failer) {
    await db.execute(`select app.requeue_retrying()`).catch(() => undefined)
    const s = await stateOf(String(failer))
    if (s.s === 'failed') break
    continue
  }
  failedRuns += 1
  await runJob(db, got as Job, [failHandler], review, notify)
  await db.execute(
    `update public.jobs set not_before = null where job_id = ${lit(String(failer))}::uuid`,
  )
  await db.execute(`select app.requeue_retrying()`).catch(() => undefined)
}
const fs = await stateOf(String(failer))
check(
  'control: a job that genuinely fails still exhausts its attempts and ends failed',
  fs.s === 'failed' && failedRuns >= 1 && failedRuns <= fs.max_attempts,
  `ran ${String(failedRuns)}x, state ${fs.s}`,
)

// ---- and a provider that is DOWN is not refunded: that is what the ceiling is for -------
{
  const pj = await realParent(db)
  const probe = String(
    (
      await one(
        `select app.enqueue_child(p_parent => ${lit(pj)}::uuid, p_kind => 'verify.provider', p_payload => '{}'::jsonb, p_announce => false)::text as v`,
      )
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0]
  const got = await dequeue(db, WORKER, false, false, ['verify.provider'])
  await db.execute(
    `select app.pause_job(${lit(String(probe))}::uuid, 'provider_unavailable', 'isolated', 'when it is back', true, null, null, null)`,
  )
  const paused = await stateOf(String(probe))
  await db.execute(`select app.resume_job(${lit(String(probe))}::uuid, 'the provider answered')`)
  const woke = await stateOf(String(probe))
  check(
    'a provider outage is not refunded: the wake keeps the attempt the failed run spent',
    got?.jobId === probe && paused.s === 'paused' && woke.s === 'queued' && woke.attempt === 1,
    `attempt ${String(woke.attempt)} after the wake`,
  )
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await db.end()
process.exit(failed.length === 0 ? 0 : 1)

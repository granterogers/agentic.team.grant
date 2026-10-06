/**
 * 1024 - every terminal failure of a user-visible turn owes the person who asked a word, however the job died.
 *
 *   npx tsx scripts/isolated/terminal-job-owes-a-word.ts <replica-db>
 *
 * Before 1024 `lastWord` spoke only for a job that failed INSIDE `runJob` (the drain called it after `runJob`
 * returned). A job killed by an expired lease on its final attempt (`app.recover_stalled_jobs`) or left with no
 * attempts (`app.settle_exhausted_jobs`) moved to `failed` with no call to anything, so the person who asked heard
 * nothing - the 8 September voice note's silence, by a second road.
 *
 * Every case drives the REAL `drain` (real sweeps, real `dequeue`, real SQL) with a recording notifier, and asserts
 * canonical rows: how many times the notifier was reached, how many code-composed notices were stored as outputs,
 * and the job's own state. It never asserts the wording of the notice.
 *
 * What must stay silent is a control of equal weight: a duty, a child branch, a test turn, a job that will still be
 * retried, and a turn already told. And the sweep is shown able to fail by a negative control that is evidence of
 * the sweep itself (the SQL function named, with a window that excludes everything, returns nothing).
 */
import { apology } from '../../src/jobs/lastword.ts'
import { dequeue, drain, type Handler, type Job, type Reviewer } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'c1proof')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const review: Reviewer = async () => ({ status: 'approved', notes: 'isolated proof' })
const dormant: Handler = {
  kind: 'office.instruction',
  reach: 'internal',
  handle: async () => {
    throw new Error('isolated: nothing here should be dequeued')
  },
}
const stateOf = async (id: string) =>
  String((await one(`select state::text as s from public.jobs where job_id = ${lit(id)}::uuid`)).s)
/** Code-composed notices stored against the job: the canonical record of a word owed. */
const notices = async (id: string) =>
  Number(
    (
      await one(
        `select count(*)::int as n from public.outputs where job_id = ${lit(id)}::uuid and body = ${lit(apology(false))}`,
      )
    ).n,
  ) +
  Number(
    (
      await one(
        `select count(*)::int as n from public.outputs where job_id = ${lit(id)}::uuid and body = ${lit(apology(true))}`,
      )
    ).n,
  )

/** Quiet the queue so a tick is about ONE job: nothing else live that a sweep could wake or a dequeue could take. */
const clear = () =>
  db.execute(
    `update public.jobs set state = 'cancelled' where state in ('paused', 'queued', 'retrying', 'running')`,
  )

/** One tick of the real worker, `max` dequeues (0 = sweeps and deliveries only), recording what the notifier saw. */
const tick = async (
  told: string[],
  opts: { max?: number; handler?: Handler; throwWhile?: () => boolean } = {},
) => {
  await drain(
    db,
    `terminal-${Date.now().toString(36)}`,
    [opts.handler ?? dormant],
    review,
    opts.max ?? 0,
    {
      canTranscribe: false,
      canSubprocess: false,
      notify: async (job, output) => {
        told.push(job.jobId)
        void output
        if (opts.throwWhile?.() === true) throw new Error('isolated: the notifier is down')
        return { note: 'stub' } as never
      },
    },
  )
}

const claimReal = async (): Promise<Job> => {
  const id = await realParent(db)
  const who = String(
    (await one(`select requested_by as r from public.jobs where job_id = ${lit(id)}::uuid`)).r,
  )
  const j = await dequeue(
    db,
    `term-${Date.now().toString(36)}`,
    true,
    true,
    ['office.instruction'],
    who,
  )
  if (j === null || j.jobId !== id)
    throw new Error(`could not claim the real turn: ${j?.jobId ?? 'nothing'}`)
  return j
}
/** A claimed turn whose lease has run out on its last attempt: the worker that held it is gone. */
const stranded = async (state = 'running'): Promise<Job> => {
  const j = await claimReal()
  if (state !== 'running')
    await db.execute(
      `update public.jobs set state = ${lit(state)}::public.job_state where job_id = ${lit(j.jobId)}::uuid`,
    )
  await db.execute(
    `update public.jobs set attempt = max_attempts, leased_until = now() - interval '1 minute'
      where job_id = ${lit(j.jobId)}::uuid`,
  )
  return j
}
const liveOthers = async () =>
  Number(
    (
      await one(
        `select count(*)::int as n from public.jobs where state in ('running','queued','retrying','paused')`,
      )
    ).n,
  )

await clear()

// ---- (a) lease expiry on the final attempt ------------------------------------------------------------------------
for (const state of ['running', 'output_created']) {
  await clear()
  const j = await stranded(state)
  const told: string[] = []
  await tick(told)
  check(
    `(a) a real turn whose lease expired in ${state} on its final attempt is failed by recovery`,
    (await stateOf(j.jobId)) === 'failed',
    await stateOf(j.jobId),
  )
  check(
    `(a) and the person who asked is told, once (${state})`,
    told.filter((t) => t === j.jobId).length === 1 && (await notices(j.jobId)) === 1,
    `${told.filter((t) => t === j.jobId).length} send(s), ${await notices(j.jobId)} stored notice(s)`,
  )
  // (d) the next ticks add nothing.
  await tick(told)
  await tick(told)
  check(
    `(d) later ticks never repeat it (${state})`,
    told.filter((t) => t === j.jobId).length === 1 && (await notices(j.jobId)) === 1,
    `${told.filter((t) => t === j.jobId).length} send(s)`,
  )
}

// ---- (b) exhausted attempts, settled by settle_exhausted_jobs ---------------------------------------------------------
{
  await clear()
  const j = await claimReal()
  await db.execute(`update public.jobs set state = 'retrying' where job_id = ${lit(j.jobId)}::uuid`)
  await db.execute(`alter table public.jobs disable trigger jobs_touch_updated_at`)
  await db.execute(
    `update public.jobs set attempt = max_attempts, leased_by = null, leased_until = null,
            updated_at = now() - interval '10 minutes' where job_id = ${lit(j.jobId)}::uuid`,
  )
  await db.execute(`alter table public.jobs enable trigger jobs_touch_updated_at`)
  const told: string[] = []
  await tick(told)
  check(
    '(b) a job with no attempts left is failed by the exhausted sweep',
    (await stateOf(j.jobId)) === 'failed',
    await stateOf(j.jobId),
  )
  check(
    '(b) and the person who asked is told, once',
    told.filter((t) => t === j.jobId).length === 1 && (await notices(j.jobId)) === 1,
    `${told.filter((t) => t === j.jobId).length} send(s), ${await notices(j.jobId)} stored notice(s)`,
  )
}

// ---- (c) what must stay silent -----------------------------------------------------------------------------------
{
  await clear()
  // A duty: no inbound command, so nobody asked.
  await db.execute(
    `insert into public.jobs (office_id, kind, requested_by, idempotency_key, correlation_id, announce)
     values (app.operator_office(), 'research.summarise', 'duty:terminal-control', ${lit(`terminal-${Date.now()}`)}, gen_random_uuid(), false)`,
  )
  const d = await dequeue(
    db,
    `term-duty-${Date.now().toString(36)}`,
    true,
    true,
    ['research.summarise'],
    'duty:terminal-control',
  )
  if (d === null) throw new Error('the duty control could not be claimed')
  await db.execute(
    `update public.jobs set attempt = max_attempts, leased_until = now() - interval '1 minute' where job_id = ${lit(d.jobId)}::uuid`,
  )
  // A child branch of a real turn: the parent is who owes the answer, and the child's own death is not his to hear.
  const root = await claimReal()
  const kid = String(
    (
      await one(
        `select app.enqueue_child(app.job_office(${lit(root.jobId)}::uuid), ${lit(root.jobId)}::uuid, 'notebook.generate', '{"kind":"slides","instructions":"x"}'::jsonb)::text as c`,
      )
    ).c,
  ).match(/[0-9a-f-]{36}/)?.[0] as string
  await db.execute(
    `update public.jobs set state = 'running', leased_by = 'kid-proof', leased_until = now() - interval '1 minute', attempt = max_attempts where job_id = ${lit(kid)}::uuid`,
  )
  // A test turn through a production door (declared harness): never reaches anybody, and leaves no notice either.
  const key = `teamhq:verifyterminal:${Date.now().toString(36)}.1`
  const cmd = await one(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (app.operator_office(), app.unnamed_project(app.operator_office()), 'teamhq',${lit(`verify-terminal:${Date.now()}`)}, 'verify-terminal', 'a test turn', ${lit(key)}, 'verify-terminal')
    returning command_id::text as id`)
  const enq = await one(
    `set local application_name = 'PostgREST 14.5'; select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`,
  )
  const hv = (typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id: string }
  const harness = await dequeue(
    db,
    `term-harness-${Date.now().toString(36)}`,
    true,
    true,
    ['office.instruction'],
    String(
      (
        await one(
          `select requested_by as r from public.jobs where job_id = ${lit(hv.job_id)}::uuid`,
        )
      ).r,
    ),
  )
  if (harness === null) throw new Error('the harness control could not be claimed')
  await db.execute(
    `update public.jobs set attempt = max_attempts, leased_until = now() - interval '1 minute' where job_id = ${lit(hv.job_id)}::uuid`,
  )
  // A turn with attempts left: recovery retries it, so nothing has ended.
  const retry = await claimReal()
  await db.execute(
    `update public.jobs set max_attempts = 5, leased_until = now() - interval '1 minute' where job_id = ${lit(retry.jobId)}::uuid`,
  )
  const told: string[] = []
  await tick(told)
  const all = [d.jobId, kid, hv.job_id, retry.jobId]
  check(
    'control: the duty, the child and the test turn all died too (so the silence below is not a missed death)',
    (await stateOf(d.jobId)) === 'failed' &&
      (await stateOf(kid)) === 'failed' &&
      (await stateOf(hv.job_id)) === 'failed',
    `${await stateOf(d.jobId)}, ${await stateOf(kid)}, ${await stateOf(hv.job_id)}`,
  )
  check(
    '(c) a duty, a child branch and a test turn that died tell nobody and store no notice',
    all.slice(0, 3).every((id) => !told.includes(id)) &&
      (await Promise.all(all.slice(0, 3).map(notices))).every((n) => n === 0),
    `told: ${told.length}`,
  )
  check(
    '(c) a turn recovery will RETRY says nothing yet',
    (await stateOf(retry.jobId)) !== 'failed' &&
      !told.includes(retry.jobId) &&
      (await notices(retry.jobId)) === 0,
    await stateOf(retry.jobId),
  )
  void (await liveOthers())
}

// ---- (d) a notifier that is down: bounded retry, then exactly one told -----------------------------------------------
{
  await clear()
  const j = await stranded()
  let down = true
  const told: string[] = []
  await tick(told, { throwWhile: () => down })
  check(
    '(d) a notifier that is down is not a second failure: the turn stays failed, one try recorded',
    (await stateOf(j.jobId)) === 'failed' && told.length === 1,
    `${await stateOf(j.jobId)}; ${told.length} try`,
  )
  await tick(told, { throwWhile: () => down })
  check(
    '(d) an in-flight claim is not taken twice in the same moment (no second try inside the guard window)',
    told.length === 1,
    `${told.length} try`,
  )
  await db.execute(
    `update public.jobs set pinned_config = jsonb_set(pinned_config, '{last_word_at}', to_jsonb('2000-01-01T00:00:00Z'::text)) where job_id = ${lit(j.jobId)}::uuid`,
  )
  down = false
  await tick(told, { throwWhile: () => down })
  check(
    '(d) once the notifier is back it is told, in one more try',
    told.length === 2,
    `${told.length} tries`,
  )
  await db.execute(
    `update public.jobs set pinned_config = jsonb_set(pinned_config, '{last_word_at}', to_jsonb('2000-01-01T00:00:00Z'::text)) where job_id = ${lit(j.jobId)}::uuid`,
  )
  await tick(told)
  await tick(told)
  check(
    '(d) and then never again, however long it is left',
    told.length === 2,
    `${told.length} tries`,
  )
}

// ---- (e) a job that dies through runJob keeps ONE notice across the inline call and the sweep -------------------------
{
  await clear()
  const id = await realParent(db)
  await db.execute(`update public.jobs set max_attempts = 1 where job_id = ${lit(id)}::uuid`)
  const dies: Handler = {
    kind: 'office.instruction',
    reach: 'internal',
    handle: async () => {
      throw new Error('isolated: the handler died')
    },
  }
  const told: string[] = []
  await tick(told, { max: 3, handler: dies })
  await tick(told)
  await tick(told)
  check(
    '(e) a turn that dies INSIDE runJob is told exactly once even though the inline call and the sweep both see it',
    (await stateOf(id)) === 'failed' &&
      told.filter((t) => t === id).length === 1 &&
      (await notices(id)) === 1,
    `${await stateOf(id)}; ${told.filter((t) => t === id).length} send(s), ${await notices(id)} stored`,
  )
}

// ---- the sweep itself can fail: a control on the SQL ----------------------------------------------------------------
{
  await clear()
  const j = await stranded()
  // Recovery only (no notifier): the job fails and is owed, and the sweep names it.
  await db.execute('select * from app.recover_stalled_jobs()')
  const named = await db.execute(
    `select job_id::text from app.jobs_owing_a_word(50, interval '30 minutes')`,
  )
  check(
    'the sweep names a failed, owed, recent turn',
    named.rows.some((r) => String((r as { job_id: string }).job_id) === j.jobId),
    `${named.rows.length} owed`,
  )
  const none = await db.execute(
    `select job_id::text from app.jobs_owing_a_word(50, interval '0 seconds')`,
  )
  check(
    'control: a window that excludes everything names nothing (a long-past death is not announced now)',
    none.rows.length === 0,
    `${none.rows.length} owed`,
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1

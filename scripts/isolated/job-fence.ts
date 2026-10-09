/**
 * #398 (Run 5, 0625) - a child has an author, and an attempt has a name that is never reused.
 *
 *   npx tsx scripts/isolated/job-fence.ts <replica-db>
 *
 * The real `dequeue`, `app.job_held`, `app.renew_lease`, `app.resume_job`, `app.enqueue_child`,
 * `app.enqueue_child_once`. Each case is a way a duplicate, a stale write or a resurrected claim used to be possible.
 */
import { callerArgs, fenceClause } from '../../src/jobs/fence.ts'
import { dequeue, type Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'fence625')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const scope = `verify:fence-${run}`
const KIND = 'research.summarise'
const newJob = async (): Promise<string> =>
  String(
    (
      await one(`insert into public.jobs (office_id, kind, requested_by, idempotency_key, correlation_id, announce)
        values (app.test_office(), ${lit(KIND)}, ${lit(scope)}, ${lit(`fence-${run}-${crypto.randomUUID()}`)}, gen_random_uuid(), false)
        returning job_id::text as id`)
    ).id,
  )
const claim = async (id: string, worker: string): Promise<Job> => {
  const j = await dequeue(db, `${worker}-${run}`, true, true, [KIND], scope)
  if (j === null || j.jobId !== id)
    throw new Error(`could not claim ${id}: got ${j?.jobId ?? 'nothing'}`)
  return j
}
const row = async (id: string) =>
  one(
    `select state::text as s, attempt, claim_gen, leased_by, max_attempts from public.jobs where job_id = ${lit(id)}::uuid`,
  )
const held = async (j: Job) =>
  (
    await one(
      `select app.job_held(${lit(j.jobId)}::uuid, ${lit(j.leasedBy ?? '')}, ${String(j.attempt)}${j.claimGen === undefined ? '' : `, ${String(j.claimGen)}`}) as h`,
    )
  ).h as boolean
/** Let a job go to sleep for a bounded wait and be woken: the path that REFUNDS the attempt number. */
const waitAndWake = async (j: Job) => {
  await db.execute(
    `select app.pause_job(${lit(j.jobId)}::uuid, 'dependency_wait', 'waiting', 'the group', true, null, null, ${lit('d'.repeat(64))})`,
  )
  await db.execute(`select app.resume_job(${lit(j.jobId)}::uuid, 'the group is ready')`)
}
const child = async (parent: string, kind = 'verify.fence', payload = '{}', j?: Job) =>
  String(
    (
      await one(
        `select app.enqueue_child(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, ${lit(kind)}, ${lit(payload)}::jsonb${j === undefined ? '' : `, interval '0', true, null${callerArgs(j)}`})::text as c`,
      )
    ).c,
  )
const childCount = async (parent: string) =>
  Number(
    (
      await one(
        `select count(*)::int as n from public.jobs where parent_job_id = ${lit(parent)}::uuid`,
      )
    ).n,
  )
const refused = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
    return ''
  } catch (e) {
    return String((e as Error).message)
  }
}

// ---- the claim has a number, and it never goes down ---------------------------------------------------------------
{
  const id = await newJob()
  const a = await claim(id, 'wa')
  const g1 = a.claimGen
  await waitAndWake(a) // refunds the attempt number
  const mid = await row(id)
  const b = await claim(id, 'wb')
  check(
    'every claim is numbered, and a wake that refunds the ATTEMPT does not lower the CLAIM',
    g1 !== undefined &&
      b.claimGen !== undefined &&
      b.claimGen > g1 &&
      b.attempt === a.attempt &&
      Number(mid.attempt) === a.attempt - 1,
    `attempt ${String(a.attempt)} -> refunded to ${String(mid.attempt)} -> ${String(b.attempt)}; claim ${String(g1)} -> ${String(b.claimGen)}`,
  )
  check(
    'a zombie of attempt N (same worker or not) is NOT held by the re-claim of attempt N: the claim differs',
    (await held(b)) === true && (await held({ ...a, leasedBy: b.leasedBy ?? '' } as Job)) === false,
    `${String(await held(b))}/${String(await held({ ...a, leasedBy: b.leasedBy ?? '' } as Job))}`,
  )
  const oldQuestion = (
    await one(
      `select app.job_held(${lit(id)}::uuid, ${lit(b.leasedBy ?? '')}, ${String(b.attempt)}) as h`,
    )
  ).h
  check(
    'an old worker asking with three arguments still gets the old question answered (skew)',
    oldQuestion === true,
    String(oldQuestion),
  )
  const renewedWrong = (
    await one(
      `select app.renew_lease(${lit(id)}::uuid, ${lit(b.leasedBy ?? '')}, ${String(b.attempt)}, ${String((b.claimGen ?? 0) - 1)}) as h`,
    )
  ).h
  check('a renewal under the wrong claim is refused', renewedWrong === false, String(renewedWrong))
  check(
    'the fenced write names the claim',
    fenceClause(b).includes(`claim_gen = ${String(b.claimGen)}`),
    fenceClause(b).slice(0, 80),
  )
  await db
    .execute(`update public.jobs set state = 'cancelled' where job_id = ${lit(id)}::uuid`)
    .catch(() => undefined)
}

// ---- a stale worker cannot take a slot in the live attempt ------------------------------------------------------------
{
  const id = await newJob()
  const stale = await claim(id, 'stale')
  await waitAndWake(stale)
  const live = await claim(id, 'live')
  const said = await refused(() => child(id, 'verify.fence', '{"n":1}', stale))
  check(
    "a stale worker's enqueue_child is refused, not honoured",
    /stale caller/.test(said) && (await childCount(id)) === 0,
    `${said.slice(0, 60)} / ${String(await childCount(id))} children`,
  )
  const a = await child(id, 'verify.fence', '{"n":1}', live)
  const again = await child(id, 'verify.fence', '{"n":1}', live)
  check(
    "and the live worker's calls after the stale one take the FIRST slots (the stale call took none): two calls, two children, none from the stale worker",
    a !== '' && (await childCount(id)) === 2 && a !== again,
    `${String(await childCount(id))} children (the same worker asking twice in one run is two requests, as before)`,
  )
  const onceStale = await refused(() =>
    one(
      `select app.enqueue_child_once(app.job_office(${lit(id)}::uuid), ${lit(id)}::uuid, 'verify.fence', 'again', '{}'::jsonb, true, null${callerArgs(stale)})::text`,
    ),
  )
  check(
    'enqueue_child_once fences a stale caller too',
    /stale caller/.test(onceStale),
    onceStale.slice(0, 60),
  )
  const legacy = await child(id, 'verify.other')
  check(
    'a call naming no caller (an older worker) behaves as it always did',
    legacy !== '',
    'accepted',
  )
  await db
    .execute(`update public.jobs set state = 'cancelled' where job_id = ${lit(id)}::uuid`)
    .catch(() => undefined)
}

// ---- a deferral is keyed on its own caller ---------------------------------------------------------------------------------
{
  const parent = await realParent(db)
  const asker = String(
    (
      await one(
        `select app.enqueue_child(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, ${lit(KIND)}, '{}'::jsonb)::text as c`,
      )
    ).c,
  )
  await db
    .execute(
      `update public.jobs set requested_by = ${lit(scope)}, announce = false where job_id = ${lit(asker)}::uuid`,
    )
    .catch(() => undefined)
  const first = await dequeue(db, `def1-${run}`, true, true, [KIND], undefined)
  if (first === null || first.jobId !== asker) {
    check('the deferral fixture could be claimed', false, `got ${first?.jobId ?? 'nothing'}`)
  } else {
    // asker defers a sibling under its own PARENT, exactly as notebook.generate does
    const d1 = await child(parent, 'verify.defer', '{"tick":1}', first)
    await waitAndWake(first)
    const second = await claim(asker, 'def2')
    const d2 = await child(parent, 'verify.defer', '{"tick":1}', second)
    check(
      'a child that retries and defers AGAIN finds the deferral it already made: no duplicate job',
      d1 === d2,
      `${d1.slice(0, 8)} / ${d2.slice(0, 8)}`,
    )
    const other = await realParent(db)
    void other
    const sibling = await child(parent, 'verify.defer', '{"tick":1}') // no caller: the parent's own request
    check(
      'a different caller asking for the same request is a different request',
      sibling !== d1,
      `${sibling.slice(0, 8)} vs ${d1.slice(0, 8)}`,
    )
  }
}

// ---- a job called off is given no more work ---------------------------------------------------------------------------------
{
  const id = await newJob()
  await db.execute(`update public.jobs set state = 'cancelled' where job_id = ${lit(id)}::uuid`)
  const said = await refused(() => child(id))
  check(
    'a cancelled job cannot be given a child, caller or not',
    /cannot be given children/.test(said),
    said.slice(0, 70),
  )
  const done = await newJob()
  const j = await claim(done, 'fin')
  await db.execute(
    `update public.jobs set state = 'output_created' where job_id = ${lit(j.jobId)}::uuid`,
  )
  const late = await refused(() => child(done))
  check(
    'a job that is still finishing may still hand work on (the handoff writes after the output)',
    late === '',
    late.slice(0, 60),
  )
  await db
    .execute(`update public.jobs set state = 'cancelled' where job_id = ${lit(done)}::uuid`)
    .catch(() => undefined)
}

// ---- the output write asks in the same statement -------------------------------------------------------------------------------
{
  const id = await newJob()
  const a = await claim(id, 'out1')
  await waitAndWake(a)
  const b = await claim(id, 'out2')
  const insert = async (j: Job) =>
    (
      await db.execute(`insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic, model)
        select ${lit(id)}::uuid, 'isolated', 'high'::public.confidence_level, 'verified'::public.evidence_type, '[]'::jsonb, true, null
        where app.job_held(${lit(id)}::uuid, ${lit(j.leasedBy ?? '')}, ${String(j.attempt)}, ${String(j.claimGen)}) returning output_id`)
    ).rows.length
  check(
    'an output written by the earlier claim of the same attempt number inserts nothing; the live claim inserts one',
    (await insert({ ...a, leasedBy: b.leasedBy ?? '' } as Job)) === 0 && (await insert(b)) === 1,
    'stale 0 / live 1',
  )
  await db
    .execute(`update public.jobs set state = 'cancelled' where job_id = ${lit(id)}::uuid`)
    .catch(() => undefined)
}

// ---- findings of the second independent review ------------------------------------------------------------------------------
{
  // a job that ran before 0625 has claim_gen 0 and an attempt of 3: its next claim is numbered above both
  const id = await newJob()
  await db.execute(
    `update public.jobs set attempt = 3, max_attempts = 9 where job_id = ${lit(id)}::uuid`,
  )
  const j = await claim(id, 'legacy')
  check(
    'a job claimed for the first time since 0625, with attempts already spent, is numbered above every number it could have held',
    (j.claimGen ?? 0) >= 4,
    `attempt ${String(j.attempt)}, claim ${String(j.claimGen)}`,
  )
  // an incomplete caller is refused, not silently unfenced
  const half = await refused(() =>
    one(
      `select app.enqueue_child(app.job_office(${lit(id)}::uuid), ${lit(id)}::uuid, 'verify.fence', '{}'::jsonb, interval '0', true, null, ${lit(id)}::uuid)::text`,
    ),
  )
  check(
    'a caller that names the job but not the worker and claim is refused',
    /incomplete caller/.test(half),
    half.slice(0, 60),
  )
  // a failed parent may still have live children that defer
  await db
    .execute(`update public.jobs set state = 'failed' where job_id = ${lit(id)}::uuid`)
    .catch(() => undefined)
  const late = await refused(() => child(id, 'verify.fence', '{"late":1}'))
  const st = String(
    (await one(`select state::text as s from public.jobs where job_id = ${lit(id)}::uuid`)).s,
  )
  check(
    'a FAILED parent is not refused a child (a live child deferring under it must be able to)',
    st !== 'failed' || late === '',
    `${st} ${late.slice(0, 50)}`,
  )
  // fan_in_over: a stale caller opens no branch group
  const fid = await newJob()
  const fa = await claim(fid, 'fan-a')
  await waitAndWake(fa)
  const fb = await claim(fid, 'fan-b')
  const staleFan = await refused(() =>
    one(
      `select app.fan_in_over(app.job_office(${lit(fid)}::uuid), ${lit(fid)}::uuid, 'objective', '[]'::jsonb, 'office.synthesise', null${callerArgs({ ...fa, leasedBy: fb.leasedBy ?? '' } as Job)})::text`,
    ),
  )
  const groups = Number(
    (
      await one(
        `select count(*)::int as n from public.branch_groups where parent_job_id = ${lit(fid)}::uuid`,
      )
    ).n,
  )
  check(
    'a stale caller of fan_in_over is refused and opens no group',
    /stale caller/.test(staleFan) && groups === 0,
    `${staleFan.slice(0, 50)} / ${String(groups)} groups`,
  )
}

// ---- final audit: a worker that lost its claim cannot park the job (0628) ----------------------------------------------------
{
  const id = await newJob()
  const a = await claim(id, 'pa')
  await waitAndWake(a)
  const b = await claim(id, 'pb')
  const pause = (j: Job | null) =>
    one(
      `select app.pause_job(${lit(id)}::uuid, 'awaiting_human_action', 'proof', 'a person'${'' /* resumable default */}, true, null, null, null${j === null ? '' : `, ${lit(j.leasedBy ?? '')}, ${String(j.claimGen)}`})::text as r`,
    )
  const said = await refused(() => pause({ ...a, leasedBy: b.leasedBy ?? '' } as Job))
  const held = await row(id)
  check(
    'a superseded worker (same attempt number, earlier claim) cannot park the job its replacement is running',
    /stale caller/.test(said) && held.s === 'running' && held.leased_by === b.leasedBy,
    `${said.slice(0, 50)} / ${String(held.s)}`,
  )
  const pauses = Number(
    (
      await one(
        `select count(*)::int as n from public.job_pauses where job_id = ${lit(id)}::uuid and resumed_at is null`,
      )
    ).n,
  )
  check('and leaves no pause row behind', pauses === 0, String(pauses))
  const half = await refused(() =>
    one(
      `select app.pause_job(${lit(id)}::uuid, 'awaiting_human_action', 'proof', 'a person', true, null, null, null, ${lit(b.leasedBy ?? '')}, null)::text`,
    ),
  )
  check(
    'a worker without its claim is refused, not silently unfenced',
    /incomplete caller/.test(half),
    half.slice(0, 60),
  )
  const old = await one(
    `select app.pause_job(${lit(id)}::uuid, 'awaiting_human_action', 'proof', 'a person')::text as r`,
  )
  check(
    'an old worker (no claim given) is unchanged: it parks the job as it always did',
    String(old.r).includes('"ok": true') || String(old.r).includes('"ok":true'),
    String(old.r).slice(0, 60),
  )
  await db
    .execute(`update public.jobs set state = 'cancelled' where job_id = ${lit(id)}::uuid`)
    .catch(() => undefined)
}
{
  const id = await newJob()
  const j = await claim(id, 'pl')
  const r = await one(
    `select app.pause_job(${lit(id)}::uuid, 'awaiting_human_action', 'proof', 'a person', true, null, null, null, ${lit(j.leasedBy ?? '')}, ${String(j.claimGen)})::text as r`,
  )
  check(
    'the live worker parks its own job under its claim',
    String(r.r).includes('ok') && (await row(id)).s === 'paused',
    String(r.r).slice(0, 60),
  )
  await db
    .execute(`update public.jobs set state = 'cancelled' where job_id = ${lit(id)}::uuid`)
    .catch(() => undefined)
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

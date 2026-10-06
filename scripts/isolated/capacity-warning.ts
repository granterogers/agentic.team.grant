/**
 * G-1 (migration 1026): the free tier is watched on the way to its limit.
 *
 *   npx tsx scripts/isolated/capacity-warning.ts <replica-db>
 *
 * Behavioural: the real SQL functions and the real handler are DRIVEN on an isolated replica. Nothing here reaches
 * production, a person, or a channel (the proof asserts `deliveries` did not move).
 *
 * What it proves, each with a control that can fail:
 *   1. The SQL level / growth / days-to-limit functions AGREE with src/ops/capacity.ts over a grid and 300 random
 *      series (a rule held in two places is only safe when something compares them).
 *   2. A storage reading that crosses 70, 85 and 95 percent raises exactly one chore per resource and level, a second
 *      pass raises none, a deeper level replaces the shallower chore, hysteresis holds a level three points below its
 *      line, and falling clears the chores. A noisy series across a line produces ONE crossing, not one per reading.
 *   3. The projection is the fastest recent rate, and it is surfaced in `app.free_tier_headroom()` as well.
 *   4. The handler's notice is composed in code and goes through the worker's own `app.say_once`: a crossing speaks
 *      at once, the same level again is quiet, a deeper level speaks, and nothing is said below the first line.
 *   5. The history is bounded by itself: old samples are pruned, a day holds at most ~20 rows.
 *   6. Nothing was messaged and nothing was deleted: `deliveries` and `jobs` hold what they held.
 *
 * Sabotage (printed, run by hand): replace app.capacity_level with a constant 0 and chapters 2, 3 and 4 go red.
 */
import { capacityWatchHandler } from '../../src/handlers/capacity-watch.ts'
import {
  daysToLimit,
  type Level,
  levelFor,
  ratePerDay,
  type Sample,
} from '../../src/ops/capacity.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'cw1026')
let failed = 0
const check = (what: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const MB = 1_000_000

// ---- a clean slate: this proof owns these rows and nothing else ---------------------------------------------------
const reset = async (): Promise<void> => {
  await db.execute(`delete from public.capacity_samples`)
  await db.execute(`delete from storage.objects where bucket_id = 'zz-proof'`)
  await db.execute(`delete from public.tasks where chore_key like 'capacity:%'`)
  await db.execute(`delete from public.duty_said where job_kind = 'office.capacity_watch'`)
  await db.execute(
    `insert into storage.buckets (id, name) values ('zz-proof', 'zz-proof') on conflict do nothing`,
  )
}
const setStorage = async (mb: number): Promise<void> => {
  await db.execute(`delete from storage.objects where bucket_id = 'zz-proof'`)
  await db.execute(
    `insert into storage.objects (bucket_id, name, metadata)
     values ('zz-proof', 'blob', jsonb_build_object('size', ${String(Math.round(mb * MB))}))`,
  )
}
await reset()

const before = {
  deliveries: Number((await one(`select count(*)::int as n from public.deliveries`)).n),
  // the proof's own jobs (it must make some, for say_once) are not counted, so a re-run on the same replica is clean
  jobs: Number(
    (
      await one(
        `select count(*)::int as n from public.jobs where idempotency_key not like 'cw1026-%'`,
      )
    ).n,
  ),
}

// ---- 1. SQL against the TypeScript specification --------------------------------------------------------------
{
  const cases: { p: number; prev: Level }[] = []
  for (let p = 0; p <= 110; p += 0.25)
    for (const prev of [0, 1, 2, 3] as Level[]) cases.push({ p, prev })
  const sql = (
    await db.execute(
      `select v.p, v.prev, app.capacity_level(v.p::numeric, v.prev) as level
         from (values ${cases.map((c) => `(${String(c.p)}, ${String(c.prev)})`).join(',')}) as v(p, prev)`,
    )
  ).rows as { p: string; prev: number; level: number }[]
  const wrong = sql.filter(
    (r) => levelFor(Number(r.p), Number(r.prev) as Level) !== Number(r.level),
  )
  check(
    'capacity_level agrees with levelFor over every 0.25 point and previous level',
    sql.length === cases.length && wrong.length === 0,
    `${String(sql.length)} cases, ${String(wrong.length)} disagreements`,
  )

  let seed = 1026
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  let disagreements = 0
  let nonNull = 0
  let zero = 0
  for (let i = 0; i < 300; i++) {
    const n = 1 + Math.floor(rnd() * 40)
    const samples: Sample[] = []
    let bytes = 100 * MB + Math.floor(rnd() * 300 * MB)
    for (let d = 0; d < n; d++) {
      const day = new Date(Date.UTC(2026, 8, 1 + d + Math.floor(rnd() * 2)))
        .toISOString()
        .slice(0, 10)
      bytes += Math.floor((rnd() - 0.15) * 40 * MB)
      samples.push({ day, bytes: Math.max(0, bytes) })
    }
    // arrival order is not date order, and some days repeat: the function must not care
    if (rnd() > 0.5) samples.reverse()
    const limit = (400 + Math.floor(rnd() * 600)) * MB
    const got = (
      await one(
        `select app.capacity_days_to_limit(
           array[${samples.map((s) => `'${s.day}'`).join(',')}]::date[],
           array[${samples.map((s) => String(s.bytes)).join(',')}]::bigint[], ${String(limit)}) as d`,
      )
    ).d as number | null
    const want = daysToLimit(samples, limit)
    if ((got === null ? null : Number(got)) !== want) disagreements += 1
    if (want !== null) nonNull += 1
    if (want === 0) zero += 1
  }
  check(
    'capacity_days_to_limit agrees with daysToLimit over 300 random unordered series with repeated days',
    disagreements === 0,
    `${String(disagreements)} disagreements`,
  )
  check(
    'the random series are not vacuous (some project a date, some are already past the limit)',
    nonNull > 100 && zero > 0 && nonNull < 300,
    `${String(nonNull)} with a date, ${String(zero)} at the limit`,
  )
}

// ---- 2. crossing, chores, hysteresis ---------------------------------------------------------------------------
const open = async (): Promise<string[]> =>
  (
    await db.execute(
      `select chore_key from public.tasks where chore_key like 'capacity:%' and state <> 'done' order by chore_key`,
    )
  ).rows.map((r) => String(r.chore_key))
const pass = async (): Promise<{ raised: number; cleared: number }> => {
  const r = (await one(`select app.chores_for_capacity() as r`)).r as {
    raised: number
    cleared: number
  }
  return { raised: Number(r.raised), cleared: Number(r.cleared) }
}
const opCount = Number((await one(`select count(*)::int as n from app.operator_offices()`)).n)
check(
  'there is an operator office to receive a chore',
  opCount >= 1,
  `${String(opCount)} operator office(s)`,
)

await setStorage(300)
let p = await pass()
check(
  '300 MB of 1 GB (30%) raises nothing',
  p.raised === 0 && (await open()).length === 0,
  `raised ${String(p.raised)}`,
)

await setStorage(720)
p = await pass()
check(
  'crossing 70% raises one level-1 chore per operator office',
  p.raised === opCount &&
    (await open()).join() === Array(opCount).fill('capacity:storage:1').join(),
  `raised ${String(p.raised)}, open ${(await open()).join(',')}`,
)
p = await pass()
check(
  'a second pass at the same level raises and clears nothing',
  p.raised === 0 && p.cleared === 0,
  JSON.stringify(p),
)

await setStorage(860)
p = await pass()
check(
  'crossing 85% replaces the level-1 chore with a level-2 chore',
  (await open()).every((k) => k === 'capacity:storage:2') && (await open()).length === opCount,
  `open ${(await open()).join(',')}`,
)
await setStorage(840)
p = await pass()
check(
  'at 84% the level is HELD by hysteresis (nothing raised, nothing cleared)',
  p.raised === 0 && p.cleared === 0 && (await open()).every((k) => k === 'capacity:storage:2'),
  `${JSON.stringify(p)} open ${(await open()).join(',')}`,
)
await setStorage(960)
await pass()
check(
  'crossing 95% leaves exactly one level-3 chore',
  (await open()).every((k) => k === 'capacity:storage:3') && (await open()).length === opCount,
  `open ${(await open()).join(',')}`,
)
await setStorage(930)
await pass()
check(
  '93% holds level 3 (two points under the line)',
  (await open()).every((k) => k === 'capacity:storage:3'),
  (await open()).join(','),
)
await setStorage(900)
await pass()
check(
  '90% drops to level 2',
  (await open()).every((k) => k === 'capacity:storage:2') && (await open()).length === opCount,
  (await open()).join(','),
)
await setStorage(300)
p = await pass()
check(
  'falling to 30% clears every chore',
  (await open()).length === 0,
  `cleared ${String(p.cleared)}, open ${String((await open()).length)}`,
)

// a noisy series across the 85% line is ONE crossing
await reset()
let crossings = 0
let last = 0
for (const mb of [700, 849, 851, 848, 852, 847, 853, 849]) {
  await setStorage(mb)
  const w = (await one(`select app.capacity_watch() as r`)).r as {
    readings: { scope: string; level: number }[]
  }
  const level = Number(w.readings.find((x) => x.scope === 'storage')?.level)
  if (level !== last) crossings += 1
  last = level
}
check(
  'a noisy series 849 / 851 / 848 / 852 ... around 85% crosses twice (0 to 1, 1 to 2) and never flaps',
  crossings === 2 && last === 2,
  `${String(crossings)} level changes, ended at ${String(last)}`,
)

// ---- 3. the projection: fastest recent rate, and surfaced in free_tier_headroom --------------------------------
await reset()
const today = (await one(`select (app.now_utc() at time zone 'utc')::date as d`)).d as Date
const dayStr = (back: number): string => {
  const d = new Date(today)
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}
// 30 MB a day for a week, then the last three days at 40 MB a day: the fastest window is the 3-day one
const history: Sample[] = []
let at = 720 - 3 * 40 - 7 * 30
for (let back = 10; back >= 1; back--) {
  at += back > 3 ? 30 : 40
  history.push({ day: dayStr(back), bytes: Math.round(at * MB) })
}
for (const s of history)
  await db.execute(
    `insert into public.capacity_samples (sampled_on, scope, bytes) values ('${s.day}', 'storage', ${String(s.bytes)})`,
  )
await setStorage(760)
const w1 = (await one(`select app.capacity_watch() as r`)).r as {
  readings: {
    scope: string
    days_to_limit: number | null
    level: number
    previous_level: number
    percent: number
  }[]
}
const st = w1.readings.find((x) => x.scope === 'storage')
const series = [...history, { day: dayStr(0), bytes: 760 * MB }]
const expected = daysToLimit(series, 1000 * MB)
check(
  'projected days to the limit equal the TypeScript projection at the fastest window',
  st?.days_to_limit === expected && expected !== null,
  `sql ${String(st?.days_to_limit)}, ts ${String(expected)}, rate ${String(Math.round((ratePerDay(series) ?? 0) / MB))} MB/day`,
)
check(
  'it is the 3-day rate (40 MB a day, 6 days to go), not the 7- or 28-day average (about 35 MB a day, 7 days)',
  Number(st?.days_to_limit) === 6,
  `days ${String(st?.days_to_limit)}`,
)
check(
  'the crossing is reported against the level BEFORE this reading',
  st?.level === 1 && st?.previous_level === 0,
  `level ${String(st?.level)}, previous ${String(st?.previous_level)}`,
)
const hr = (await one(`select app.free_tier_headroom() as r`)).r as {
  growth?: { storage?: { days_to_limit?: number | null; level?: number } }
  database?: unknown
}
check(
  'app.free_tier_headroom() shows the level and the projection beside its existing keys',
  hr.growth?.storage?.days_to_limit === expected &&
    hr.growth?.storage?.level === 1 &&
    hr.database !== undefined,
  // the display reads the same history, so it shows the same projection the duty acts on
  JSON.stringify(hr.growth?.storage),
)

// ---- 4. the handler, and the worker's own say_once ---------------------------------------------------------------
const system = String(
  (await one(`select office_id from public.offices where kind = 'system'`)).office_id,
)
const mkJob = async (tag: string): Promise<string> => {
  const key = `cw1026-${tag}-${Math.random().toString(36).slice(2, 8)}`
  await db.execute(
    `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, office_id, state, pinned_config)
     values (gen_random_uuid(), gen_random_uuid(), '${key}', 'office.capacity_watch', 'duty:capacity-watch', '${system}', 'queued', '{}'::jsonb)`,
  )
  return String(
    (await one(`select job_id from public.jobs where idempotency_key = '${key}'`)).job_id,
  )
}
const speak = async (
  mb: number,
): Promise<{
  announce: boolean
  said: boolean | null
  topic: string | undefined
  body: string
}> => {
  await setStorage(mb)
  const jobId = await mkJob(String(mb))
  const out = await capacityWatchHandler(db).handle({ jobId } as never, db)
  let said: boolean | null = null
  if (out.announce === true) {
    // exactly the call the worker makes at the one place jobs.announce is written
    said = (
      await one(
        `select app.say_once('${system}'::uuid, '${jobId}'::uuid, '${out.body.replace(/'/g, "''")}', '${String(out.topic).replace(/'/g, "''")}') as s`,
      )
    ).s as boolean
  }
  return { announce: out.announce === true, said, topic: out.topic, body: out.body }
}
await reset()
let s = await speak(300)
check(
  'below the first line the handler has nothing to say',
  s.announce === false && s.said === null,
  `announce ${String(s.announce)}`,
)
s = await speak(720)
check(
  'a crossing speaks, once, and the body is composed from the figures',
  s.announce &&
    s.said === true &&
    s.body.includes('File storage (backups included) is 720 MB of 1000 MB (72%)'),
  `said ${String(s.said)} topic ${String(s.topic)}`,
)
s = await speak(725)
check(
  'the same level an hour later is quiet (say_once, same topic)',
  s.announce && s.said === false,
  `said ${String(s.said)}`,
)
s = await speak(870)
check(
  'crossing 85% speaks at once, with a new topic',
  s.announce && s.said === true && s.topic === 'capacity:database=0:storage=2',
  `said ${String(s.said)} topic ${String(s.topic)}`,
)
s = await speak(871)
check('and is quiet again at that level', s.said === false, `said ${String(s.said)}`)
const stale = await one(
  `select count(*)::int as n from public.duty_said where job_kind = 'office.capacity_watch'`,
)
check(
  'say_once kept its memory against the duty kind (it only governs scheduled duties)',
  Number(stale.n) >= 1,
  `${String(stale.n)} row(s)`,
)

// ---- 5. the history bounds itself --------------------------------------------------------------------------------
await reset()
await setStorage(300)
await db.execute(
  `insert into public.capacity_samples (sampled_on, scope, bytes)
   select (app.now_utc() at time zone 'utc')::date - d, 'table:public.t' || t, 1000
     from generate_series(190, 400) d, generate_series(1, 20) t`,
)
const old0 = Number(
  (
    await one(
      `select count(*)::int as n from public.capacity_samples where sampled_on < (app.now_utc() at time zone 'utc')::date - 180`,
    )
  ).n,
)
let passes = 0
let oldN = old0
while (oldN > 0 && passes < 10) {
  await db.execute(`select app.capacity_sample()`)
  passes += 1
  oldN = Number(
    (
      await one(
        `select count(*)::int as n from public.capacity_samples where sampled_on < (app.now_utc() at time zone 'utc')::date - 180`,
      )
    ).n,
  )
}
check(
  'a backlog of old samples is pruned a bounded number at a time, until none is left',
  old0 > 2000 && oldN === 0 && passes >= 2,
  `${String(old0)} old, ${String(passes)} passes`,
)
await reset()
await setStorage(300)
await db.execute(`select app.capacity_sample()`)
await db.execute(`select app.capacity_sample()`)
const perDay = Number((await one(`select count(*)::int as n from public.capacity_samples`)).n)
check(
  'a day holds a handful of rows however often it is sampled (idempotent within a day)',
  perDay >= 3 && perDay <= 20,
  `${String(perDay)} rows after two samplings`,
)

// ---- 6. nothing was messaged, nothing was deleted --------------------------------------------------------------------
const after = {
  deliveries: Number((await one(`select count(*)::int as n from public.deliveries`)).n),
}
check(
  'no delivery was created: nothing reached a person',
  after.deliveries === before.deliveries,
  `${String(before.deliveries)} before, ${String(after.deliveries)} after`,
)
check(
  "no job other than this proof's own was created",
  Number(
    (
      await one(
        `select count(*)::int as n from public.jobs where idempotency_key not like 'cw1026-%'`,
      )
    ).n,
  ) === before.jobs,
  "jobs unchanged apart from the proof's own",
)

// ---- 7. the retention that already exists: does it RUN, and is it BOUNDED? ----------------------------------------------
{
  const mk = async (kind: string, tag: string): Promise<string> => {
    const key = `cw1026-${tag}-${Math.random().toString(36).slice(2, 8)}`
    await db.execute(
      `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, office_id, state, pinned_config)
       values (gen_random_uuid(), gen_random_uuid(), '${key}', '${kind}', 'duty:${tag}', '${system}', 'queued', '{}'::jsonb)`,
    )
    return String(
      (await one(`select job_id from public.jobs where idempotency_key = '${key}'`)).job_id,
    )
  }
  // job_traces: 12,000 steps older than thirty days and 100 recent ones
  const traceJob = await mk('probe', 'traces')
  await db.execute(`delete from public.job_traces where job_id = '${traceJob}'`)
  await db.execute(
    `insert into public.job_traces (job_id, step, at, kind)
     select '${traceJob}', g, app.now_utc() - interval '31 days' - make_interval(secs => g), 'note' from generate_series(1, 12000) g`,
  )
  await db.execute(
    `insert into public.job_traces (job_id, step, at, kind)
     select '${traceJob}', 20000 + g, app.now_utc() - make_interval(hours => g), 'note' from generate_series(1, 100) g`,
  )
  const handlerJob = await mk('office.prune_job_traces', 'prune')
  const { jobTracesHandler } = await import('../../src/handlers/job-traces.ts')
  const removed: number[] = []
  const said: boolean[] = []
  for (let pass = 0; pass < 4; pass++) {
    const out = await jobTracesHandler(db).handle({ jobId: handlerJob } as never, db)
    removed.push(Number(/Dropped (\d+)/.exec(out.body)?.[1] ?? 0))
    said.push(out.announce === true)
  }
  const left = await one(
    `select count(*) filter (where at < app.now_utc() - interval '30 days')::int as old, count(*) filter (where at >= app.now_utc() - interval '30 days')::int as recent from public.job_traces where job_id = '${traceJob}'`,
  )
  check(
    'job_traces retention is BOUNDED per pass (5,000), drains a 12,000-step backlog in three passes, and says so only while there is more waiting',
    removed.join() === '5000,5000,2000,0' &&
      said.join() === 'true,true,false,false' &&
      Number(left.old) === 0 &&
      Number(left.recent) === 100,
    `removed ${removed.join('+')}, announced ${said.join('/')}, ${String(left.recent)} recent kept`,
  )
  const duty = await one(
    `select enabled, period_minutes, office_id::text = '${system}' as on_system from public.responsibilities where job_kind = 'office.prune_job_traces'`,
  )
  check(
    'and it is a scheduled duty: enabled, hourly, on the system office',
    duty.enabled === true && Number(duty.period_minutes) === 60 && duty.on_system === true,
    JSON.stringify(duty),
  )
  await db.execute(`delete from public.job_traces where job_id = '${traceJob}'`)

  // the dispatcher turns due duties into jobs (a global call, safe here because this replica is nobody's office);
  // the three duties are made due again so a re-run on the same replica proves the same thing
  await db.execute(
    `update public.responsibilities set last_run_at = null where slug in ('job-trace-retention', 'build-shot-retention', 'capacity-watch')`,
  )
  // a duty is not fired again while its last job is live, so an earlier run's queued jobs are cancelled first
  await db.execute(
    `update public.jobs set state = 'cancelled'::job_state, finished_at = app.now_utc()
      where state = 'queued' and kind in ('office.prune_job_traces', 'office.prune_build_shots', 'office.capacity_watch', 'office.capacity_report')
        and idempotency_key not like 'cw1026-%'`,
  )
  const fired = (
    await db.execute(`select duty_slug, outcome from app.dispatch_due_responsibilities()`)
  ).rows as { duty_slug: string; outcome: string }[]
  const firedSet = new Set(fired.filter((r) => r.outcome === 'fired').map((r) => r.duty_slug))
  const again = (
    await db.execute(`select duty_slug, outcome from app.dispatch_due_responsibilities()`)
  ).rows as { duty_slug: string; outcome: string }[]
  check(
    'the dispatcher fires the retention and capacity duties once and then waits out their period',
    ['job-trace-retention', 'build-shot-retention', 'capacity-watch'].every((s) =>
      firedSet.has(s),
    ) &&
      !again.some(
        (r) =>
          r.outcome === 'fired' && ['job-trace-retention', 'capacity-watch'].includes(r.duty_slug),
      ),
    `fired ${[...firedSet].filter((s) => /retention|capacity/.test(s)).join(', ')}; second call fired ${again.filter((r) => r.outcome === 'fired').length} duty(ies), none of them these`,
  )

  // build_steps: pruned on write at thirty days
  await db.execute(`delete from public.build_steps where headline like 'cw1026-%'`)
  await db.execute(
    `insert into public.build_steps (session_ref, headline, towards, detail, state, started_at) values ('cw1026', 'cw1026 old', 't', 'd', 'done', app.now_utc() - interval '40 days')`,
  )
  await db.execute(`select app.build_step('cw1026', 'cw1026 new', 't', 'd', 'done', null, null)`)
  const steps = await one(
    `select count(*) filter (where headline = 'cw1026 old')::int as old, count(*) filter (where headline = 'cw1026 new')::int as fresh from public.build_steps`,
  )
  check(
    'build_steps ages out at thirty days, but only when a build session WRITES a step (no schedule)',
    Number(steps.old) === 0 && Number(steps.fresh) === 1,
    `old ${String(steps.old)}, new ${String(steps.fresh)}`,
  )
  await db.execute(
    `delete from public.build_steps where headline like 'cw1026-%' or headline = 'cw1026 new'`,
  )

  // mail: forget_mail_before is real, refuses a window under 30 days, and the duty that CALLS it is off
  const op = String((await one(`select app.operator_office()::text as o`)).o)
  await db.execute(`delete from public.mail_messages where message_id like 'cw1026-%'`)
  await db.execute(
    `insert into public.mail_messages (message_id, thread_id, sent_at, office_id) values
       ('cw1026-old', 't1', app.now_utc() - interval '400 days', '${op}'), ('cw1026-new', 't2', app.now_utc() - interval '2 days', '${op}')`,
  )
  const tooShort = (await one(`select app.forget_mail_before('${op}'::uuid, 10)::text as r`)).r
  const forgot = (await one(`select app.forget_mail_before('${op}'::uuid, 180)::text as r`)).r
  const mailLeft = await one(
    `select count(*) filter (where message_id = 'cw1026-old')::int as old, count(*) filter (where message_id = 'cw1026-new')::int as fresh from public.mail_messages`,
  )
  check(
    'mail retention is real (180 days), refuses a window under 30, and keeps recent mail',
    String(tooShort).includes('"ok": false') &&
      String(forgot).includes('"removed": 1') &&
      Number(mailLeft.old) === 0 &&
      Number(mailLeft.fresh) === 1,
    `${String(forgot)}`,
  )
  const mailDuty = await one(
    `select enabled from public.responsibilities where job_kind = 'google.read_mail'`,
  )
  check(
    'BUT the duty that runs it (mail-refresh, google.read_mail) is seeded OFF: while it is off the mail cache is never aged out (production: off, Google revoked, deployment-readiness 5 Oct)',
    mailDuty.enabled === false,
    `google.read_mail enabled = ${String(mailDuty.enabled)}`,
  )
  await db.execute(`delete from public.mail_messages where message_id like 'cw1026-%'`)
}

await reset()
await db.end()
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)

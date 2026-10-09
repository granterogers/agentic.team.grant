/**
 * tk-reminders (R1 / R3 / Z1): reminders, recurring reminders and the office clock, through the REAL instruction
 * handler, the REAL tasks.remind duty and the REAL database triggers, on a replica.
 *
 *   npx tsx scripts/isolated/tk-reminders.ts <replica-db>
 *
 * Needs migration 1027 applied to the replica. Hermetic: the model is degraded to `{}`; what a real model does with these
 * sentences is MODEL-DEPENDENT and not claimed. The operator office's `timezone` is changed on the CLONE to put the same
 * sentence at the same instant in three zones; the database is dropped by the caller.
 */
import { localDay, wallClock, weekdayOf } from '../../src/agents/office-time.ts'
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { remindersHandler } from '../../src/handlers/reminders.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'tk_x')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
let failed = 0
let total = 0
const check = (what: string, ok: boolean, detail: string) => {
  total += 1
  if (!ok) failed += 1
  console.log(`${ok ? 'PROVEN  ' : 'FAILED  '} ${what} - ${detail}`)
}
const section = (s: string) => console.log(`\n== ${s} ==`)
const iso = (v: unknown) =>
  v === null || v === undefined ? 'null' : new Date(String(v)).toISOString()

const op = String((await one(`select app.operator_office()::text as o`)).o)
const O = `${lit(op)}::uuid`
const hasFn = Number(
  (
    await one(
      `select count(*)::int as c from pg_proc where proname = 'office_timezone' and pronamespace = 'app'::regnamespace`,
    )
  ).c,
)
if (hasFn !== 1) {
  console.log('FAILED   migration 1027 (app.office_timezone) is not applied to this replica')
  process.exit(1)
}
const setZone = async (z: string) => {
  await db.execute(`update public.offices set timezone = ${lit(z)} where office_id = ${O}`)
}
const project = json(
  (
    await one(
      `select app.hq_create_project(${O}, ${lit(`Tk Rem ${run}`)}, 'upload', ${lit(`tk-rem-${run}`)}, ${lit(`Tk Rem ${run}`)}, true) as v`,
    )
  ).v,
)
const p1 = String(project.project_id)

let at = new Date()
const handler = instructionHandler({
  db,
  router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never,
  now: () => at,
})
let n = 0
/** A turn's command and job, NOT run. Also how a duty job is made: only its job row is needed. */
const enqueue = async (said: string, chat = 'r'): Promise<Job> => {
  n += 1
  const c = await one(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context)
    values (${O}, ${lit(p1)}::uuid, 'teamhq', ${lit(`tkr${run}${chat}${String(n)}:${String(n)}`)}, 'grant', ${lit(said)}, ${lit(`teamhq:message:tkr${run}${String(n)}`)}, 'grant', '{}'::jsonb)
    returning command_id::text as id`)
  const v = json((await one(`select app.enqueue_inbound(${lit(String(c.id))}::uuid) as v`)).v)
  const jobId = String(v.job_id)
  const j = await one(
    `select job_id::text as id, kind, correlation_id::text as c, project_id::text as p, idempotency_key as k, office_id::text as o from public.jobs where job_id = ${lit(jobId)}::uuid`,
  )
  const job = {
    jobId: String(j.id),
    kind: String(j.kind),
    correlationId: String(j.c),
    projectId: j.p === null ? null : String(j.p),
    idempotencyKey: String(j.k),
    attempt: 1,
    officeId: String(j.o),
  } as Job
  return job
}
const say = async (
  said: string,
  chat = 'r',
): Promise<{ body: string; job: Job; jobId: string }> => {
  const job = await enqueue(said, chat)
  const out = await handler.handle(job, db)
  return { body: String((out as { body?: string }).body ?? ''), job, jobId: job.jobId }
}
/** One run of the tasks.remind duty, as a job of its own. */
const tick = async (job?: Job) => {
  const j = job ?? (await enqueue('tick'))
  const out = await remindersHandler(db).handle({ ...j, kind: 'tasks.remind' }, db)
  return { out, job: j }
}
/** What the delivery layer would have recorded for the message a job owed (1029's table, written as it writes it). */
const deliver = async (jobId: string, state: 'sent' | 'failed' | 'claimed') => {
  await db.execute(
    `insert into public.deliveries (office_id, channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, attempt, lease_expires_at, message_ref, sent_at, error_code)
     values (${O}, 'telegram', ${lit(`tkr${run}:${jobId}:${state}:${String(Math.random())}`)}, '8967954396', '1386648496', 'result', ${lit(jobId)}::uuid, ${lit(state)}::slack_delivery_state, 1, now() + interval '2 minutes',
       ${state === 'sent' ? "'m-1'" : 'null'}, ${state === 'sent' ? 'now()' : 'null'}, ${state === 'failed' ? "'chat_not_found'" : 'null'})`,
  )
}
/** The row, as the duty sees it. */
const stateOf = async (id: string) =>
  (
    await rows(
      `select title, state, remind_at, reminded_at, remind_job_id::text as job, remind_sends as sends, due_on::text as due, repeat_every::text as rep, last_fired_for, last_completed_for, last_completed_at from public.tasks where task_id = ${lit(id)}::uuid`,
    )
  )[0] as Record<string, unknown>
const rowsTitled = async (title: string) =>
  Number(
    (
      await one(
        `select count(*)::int as c from public.tasks where office_id = ${O} and title = ${lit(title)}`,
      )
    ).c,
  )
/** Time passes: the reminder's time arrives (or has long gone). */
const setRemindAt = async (id: string, when: Date) => {
  await db.execute(
    `update public.tasks set remind_at = ${lit(when.toISOString())}::timestamptz, reminded_at = null, remind_job_id = null, remind_sends = 0 where task_id = ${lit(id)}::uuid`,
  )
}
const ATHENS = 'Europe/Athens'
/** The most recent Monday 09:00 in Athens that has already passed (a series' reminder time that is due). */
const lastMonday9 = (now: Date): Date => {
  const t = localDay(now, ATHENS)
  for (let back = 0; back <= 7; back++) {
    const at = wallClock(t.y, t.m, t.d - back, 9, 0, ATHENS)
    if (weekdayOf(t.y, t.m, t.d - back) === 1 && at.getTime() <= now.getTime() - 60_000) return at
  }
  throw new Error('no Monday found')
}
/** The same wall-clock time `days` later in Athens. */
const plusDays = (at: Date, days: number): Date => {
  const t = localDay(at, ATHENS)
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: ATHENS,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(at)
    .split(':')
    .map(Number)
  return wallClock(t.y, t.m, t.d + days, Number(hm[0]), Number(hm[1]), ATHENS)
}
const taskOf = async (jobId: string) =>
  (
    await rows(
      `select task_id::text as id, title, due_on::text as due, remind_at, repeat_every::text as rep, repeat_from, assigned_to_human as mine, state from public.tasks where job_id = ${lit(jobId)}::uuid`,
    )
  )[0] as Record<string, unknown>

// ================================================================================================================
section('R1: a date-only reminder gets a time, in the OFFICE zone; a due date does not')
{
  const NIGHT = new Date('2026-10-07T22:30:00.000Z') // Wed 22:30 UTC = Thu 01:30 Athens = Wed 18:30 New York = Thu 11:30 Auckland
  at = NIGHT
  const expectations: [string, string, string, string][] = [
    ['Europe/Athens', '2026-10-09', '2026-10-09T06:00:00.000Z', '09:00 (Europe/Athens)'],
    ['America/New_York', '2026-10-08', '2026-10-08T13:00:00.000Z', '09:00 (America/New_York)'],
    ['Pacific/Auckland', '2026-10-09', '2026-10-08T20:00:00.000Z', '09:00 (Pacific/Auckland)'],
  ]
  for (const [zone, due, remindAt, say9] of expectations) {
    await setZone(zone)
    const { body, jobId } = await say('Remind me tomorrow to pay the bill.')
    const t = await taskOf(jobId)
    check(
      `"Remind me tomorrow..." at 22:30 UTC in ${zone}: due ${due}, remind_at ${remindAt}`,
      t?.due === due && t.remind_at !== null && iso(t.remind_at) === remindAt,
      `stored due ${String(t?.due)} remind_at ${t?.remind_at === null || t?.remind_at === undefined ? 'null' : iso(t.remind_at)}`,
    )
    check(
      `...and the reply names the time and the zone it used (${say9})`,
      body.includes(say9) && body.includes('did not say a time'),
      body.slice(0, 220),
    )
  }
  await setZone('Europe/Athens')
  at = new Date('2026-10-07T08:00:00.000Z') // Wednesday 11:00 Athens
  for (const [said, due, remindAt] of [
    ['Remind me Friday to call Mum.', '2026-10-09', '2026-10-09T06:00:00.000Z'],
    ['Remind me on 15 October to renew X.', '2026-10-15', '2026-10-15T06:00:00.000Z'],
  ] as const) {
    const { body, jobId } = await say(said)
    const t = await taskOf(jobId)
    check(
      `"${said}" stores due ${due} and remind_at ${remindAt}`,
      t?.due === due && t.remind_at !== null && iso(t.remind_at) === remindAt && t.mine === true,
      JSON.stringify(t),
    )
    check(
      '...with a clean title and a truthful reply',
      !/friday|october/i.test(String(t?.title)) && body.includes('(Europe/Athens)'),
      `${String(t?.title)} / ${body.slice(0, 120)}`,
    )
  }
  const due = await say('Task: renew X by Friday.')
  const dt = await taskOf(due.jobId)
  check(
    'NEGATIVE: "Task: renew X by Friday." is a DUE DATE: a due date, no remind_at, no default time promised',
    dt?.due === '2026-10-09' && dt.remind_at === null && !/remind you/.test(due.body),
    `${JSON.stringify(dt)} / ${due.body.slice(0, 100)}`,
  )
  const bare = await say('Remind me to call Mum.')
  const bt = await taskOf(bare.jobId)
  check(
    'NEGATIVE: "Remind me to call Mum." (no day, no time) stays undated and unreminded',
    bt?.due === null && bt.remind_at === null,
    JSON.stringify(bt),
  )
}

// ================================================================================================================
section('R1: the duty actually fires a date-only reminder, once')
{
  at = new Date()
  await setZone('Europe/Athens')
  const { jobId, job } = await say(`Remind me tomorrow to renew the licence ${run}.`)
  const t = await taskOf(jobId)
  check(
    'the typed date-only reminder has a remind_at (the duty can see it)',
    t?.remind_at !== null,
    JSON.stringify(t),
  )
  // A control that must NOT fire: only a due date, long overdue, no reminder time.
  await one(
    `select app.my_task_add(${O}, ${lit(`Due only control ${run}`)}, '', (now() - interval '3 days')::date) as v`,
  )
  // Time passes: the reminder time arrives.
  await db.execute(
    `update public.tasks set remind_at = now() - interval '1 minute' where task_id = ${lit(String(t?.id))}::uuid`,
  )
  const duty = await remindersHandler(db).handle({ ...job, kind: 'tasks.remind' }, db)
  check(
    'tasks.remind announces it, naming it',
    duty.announce === true && duty.body.toLowerCase().includes(`renew the licence ${run}`),
    duty.body.replace(/\n/g, ' | ').slice(0, 160),
  )
  check(
    'control: a task with only a due date (overdue) is not announced',
    !duty.body.toLowerCase().includes(`due only control ${run}`),
    '',
  )
  const sIn = await stateOf(String(t?.id))
  check(
    '...and marks it IN FLIGHT by the job that said it, not reminded yet (C3: said is not delivered)',
    sIn.job === job.jobId && sIn.reminded_at === null && Number(sIn.sends) === 1,
    JSON.stringify(sIn),
  )
  const again = await tick()
  check(
    'the next tick does not say it again while its delivery is unknown',
    !again.out.body.toLowerCase().includes(`renew the licence ${run}`),
    again.out.body.slice(0, 80),
  )
  await deliver(job.jobId, 'sent')
  const afterSent = await tick()
  const sDone = await stateOf(String(t?.id))
  check(
    'once the delivery is recorded SENT, the next tick marks it reminded, and it is never said again',
    sDone.reminded_at !== null &&
      sDone.job === null &&
      !afterSent.out.body.toLowerCase().includes(`renew the licence ${run}`),
    JSON.stringify(sDone),
  )
}

// ================================================================================================================
section(
  'Z1: Today / Overdue / due-soon bucket on the OFFICE day in my_tasks, my_tasks_counts, reminders_due and studio_tasks',
)
{
  // Kiritimati (UTC+14) and Pago Pago (UTC-11) are 25 hours apart, so their calendar days differ by one or two at any
  // instant and the test does not depend on the hour it runs.
  const K = 'Pacific/Kiritimati'
  const P = 'Pacific/Pago_Pago'
  const kToday = String((await one(`select (now() at time zone ${lit(K)})::date::text as d`)).d)
  const pToday = String((await one(`select (now() at time zone ${lit(P)})::date::text as d`)).d)
  check(
    'the two zones really are on different days right now',
    kToday > pToday,
    `${kToday} vs ${pToday}`,
  )
  const mk = async (title: string, due: string) =>
    json(
      (
        await one(
          `select app.my_task_add(${O}, ${lit(`${title} ${run}`)}, '', ${lit(due)}::date, null, 100, ${lit(String(project.slug))}) as v`,
        )
      ).v,
    )
  await mk('Z1 K-today', kToday)
  const pDay = await mk('Z1 P-today', pToday)
  await mk('Z1 K-plus-seven', String((await one(`select (${lit(kToday)}::date + 7)::text as d`)).d))
  const list = async (b: string) =>
    (
      (await one(`select app.my_tasks(${O}, ${lit(b)}, 500) as v`)).v as {
        title: string
        overdue: boolean
      }[]
    ).map((x) => x.title.replace(` ${run}`, ''))
  const counts = async () =>
    json((await one(`select app.my_tasks_counts(${O}) as v`)).v) as Record<string, number>
  const remDue = async () =>
    (await one(`select app.reminders_due(${O}) as v`)).v as { title: string; overdue: boolean }[]
  const studio = async () =>
    (await one(`select app.studio_tasks(${lit(p1)}::uuid) as v`)).v as {
      title: string
      state: string | null
    }[]
  // (only Pago Pago's day gets a reminder time: a reminder in the past is itself a Today row and would hide the point)
  await db.execute(
    `update public.tasks set remind_at = now() - interval '1 minute' where task_id = ${lit(String(pDay.id))}::uuid`,
  )

  await setZone(K)
  const kToday_ = await list('today')
  const kUp = await list('upcoming')
  const kRem = (await remDue()).find((r) => r.title === `Z1 P-today ${run}`)
  const kStudio = (await studio()).find((s) => s.title === `Z1 K-plus-seven ${run}`)
  check(
    "office in Kiritimati: its own today's task is in Today and not Upcoming",
    kToday_.includes('Z1 K-today') && !kUp.includes('Z1 K-today'),
    JSON.stringify({
      today: kToday_.filter((t) => t.startsWith('Z1')),
      upcoming: kUp.filter((t) => t.startsWith('Z1')),
    }),
  )
  check(
    "...Pago Pago's today is already OVERDUE there (reminders_due flag)",
    kRem?.overdue === true,
    JSON.stringify(kRem),
  )
  check(
    '...a task due in seven local days is "due soon" in studio_tasks',
    kStudio?.state === 'due',
    JSON.stringify(kStudio),
  )
  const kc = await counts()

  await setZone(P)
  const pToday_ = await list('today')
  const pUp = await list('upcoming')
  const pRem = (await remDue()).find((r) => r.title === `Z1 P-today ${run}`)
  const pStudio = (await studio()).find((s) => s.title === `Z1 K-plus-seven ${run}`)
  check(
    "office in Pago Pago: the SAME rows read differently: Kiritimati's today is Upcoming",
    !pToday_.includes('Z1 K-today') && pUp.includes('Z1 K-today'),
    JSON.stringify({
      today: pToday_.filter((t) => t.startsWith('Z1')),
      upcoming: pUp.filter((t) => t.startsWith('Z1')),
    }),
  )
  check('...its own day is not overdue', pRem?.overdue === false, JSON.stringify(pRem))
  check(
    '...and the plus-seven task is NOT due soon yet in studio_tasks',
    pStudio?.state === null,
    JSON.stringify(pStudio),
  )
  const pc = await counts()
  check(
    'my_tasks_counts follows the same clock (the counts differ between the two offices)',
    Number(kc.today) !== Number(pc.today) || Number(kc.upcoming) !== Number(pc.upcoming),
    `K ${JSON.stringify(kc)} / P ${JSON.stringify(pc)}`,
  )
  await setZone('Europe/Athens')
  const unknown = String((await one(`select app.office_timezone(gen_random_uuid()) as z`)).z)
  await db.execute(`update public.offices set timezone = 'Not/AZone' where office_id = ${O}`)
  const bad = String((await one(`select app.office_timezone(${O}) as z`)).z)
  await setZone('Europe/Athens')
  check(
    "an unknown office, and an office holding a name that is not a zone, are UTC (never somebody else's zone)",
    unknown === 'UTC' && bad === 'UTC',
    `unknown ${unknown}, bad ${bad}`,
  )
}

// ================================================================================================================
section('R3: the recurrence is read, and stored as a reminder SERIES (no due date)')
{
  await setZone('Europe/Athens')
  at = new Date()
  const cases: [string, string, string][] = [
    ['Remind me every Monday to review my finances.', '7 days', 'review my finances'],
    ['Remind me every day at 9am to stretch.', '1 day', 'stretch'],
    ['Remind me every Friday at 4pm to send the report.', '7 days', 'send the report'],
    ['Remind me weekly to review this.', '7 days', 'review this'],
    ['Remind me every other Tuesday to water the plants.', '14 days', 'water the plants'],
  ]
  for (const [said, every, title] of cases) {
    const { body, jobId } = await say(said)
    const t = await taskOf(jobId)
    check(
      `"${said}" stores a reminder SERIES: repeat_every ${every}, a remind_at, NO due date, and a clean title`,
      t?.rep !== null &&
        String(t?.rep).replace('00:00:00', '').trim() === every &&
        t?.repeat_from === 'done' &&
        t.due === null &&
        t.remind_at !== null &&
        String(t.title).toLowerCase() === title &&
        !/every|weekly/i.test(String(t.title)),
      JSON.stringify(t),
    )
    check(
      // FLIPPED 7 Oct 2026 (owner decision): ticking one off no longer stops the series; stopping is a separate sentence.
      '...and the reply says it repeats, that ticking one off completes that time only, and how to stop the series',
      /repeats every/.test(body) &&
        /completes that time only/.test(body) &&
        /say .stop the .+ reminder/.test(body) &&
        !/Tick it off to stop/.test(body),
      body.slice(0, 200),
    )
  }
}

section(
  'R3: a series fires, is delivered, moves on IN PLACE without a tick, fires again; ticking it off completes that time only; "stop" ends it',
)
{
  at = new Date()
  await setZone(ATHENS)
  const said = `Remind me every Monday at 9am to review my finances ${run}.`
  const first = await say(said)
  const s0 = await taskOf(first.jobId)
  const id = String(s0?.id)
  const title = String(s0?.title)
  check(
    '"every Monday at 9am" is stored as ONE series row: a reminder time, a repeat, no due date invented',
    s0?.due === null &&
      String(s0?.rep).startsWith('7 days') &&
      s0?.remind_at !== null &&
      new Date(iso(s0?.remind_at)).getTime() > Date.now() &&
      weekdayOf(
        localDay(new Date(iso(s0?.remind_at)), ATHENS).y,
        localDay(new Date(iso(s0?.remind_at)), ATHENS).m,
        localDay(new Date(iso(s0?.remind_at)), ATHENS).d,
      ) === 1,
    JSON.stringify(s0),
  )
  check(
    '...and the reply says ticking one off completes that time only (FLIPPED: it no longer ends the series)',
    /completes that time only/.test(first.body) && !/Tick it off to stop/.test(first.body),
    first.body.slice(0, 220),
  )
  // Monday 09:00 arrives (the most recent one, so the next is exactly a week on).
  const anchor = lastMonday9(new Date())
  const nextMonday = plusDays(anchor, 7)
  // Occurrence 1 is the Monday before `anchor` and occurrence 2 is `anchor` itself: both are in the past (time has passed)
  // and DIFFERENT, because a completed occurrence is never fired again and the test must not re-fire the same one.
  const occ1 = plusDays(anchor, -7)
  await setRemindAt(id, occ1)

  // FIRING 1: announced, in flight, NOT advanced and NOT marked: delivery has not happened.
  const j1 = await enqueue('tick')
  const f1 = await tick(j1)
  const a1 = await stateOf(id)
  check(
    'firing 1: the duty announces it once',
    f1.out.announce === true && f1.out.body.toLowerCase().includes(title.toLowerCase()),
    f1.out.body.replace(/\n/g, ' | ').slice(0, 120),
  )
  check(
    '...and it is only IN FLIGHT: remind_at has not moved, reminded_at is not set (mark-before-delivery is the defect)',
    a1.job === j1.jobId &&
      Number(a1.sends) === 1 &&
      a1.reminded_at === null &&
      iso(a1.remind_at) === occ1.toISOString(),
    JSON.stringify(a1),
  )
  await deliver(j1.jobId, 'claimed')
  const wait = await tick()
  const aWait = await stateOf(id)
  check(
    '...while its delivery is still pending nothing is said again and nothing moves',
    wait.out.announce === false &&
      aWait.job === j1.jobId &&
      iso(aWait.remind_at) === occ1.toISOString(),
    JSON.stringify(aWait),
  )
  await db.execute(
    `update public.deliveries set state = 'sent', message_ref = 'm-1', sent_at = now() where job_id = ${lit(j1.jobId)}::uuid`,
  )
  // SETTLE: the delivery is recorded sent; the series moves to next Monday 09:00 office time IN PLACE, without a tick.
  const settle1 = await tick()
  const a2 = await stateOf(id)
  check(
    'delivered: remind_at is advanced IN PLACE to next Monday 09:00 office time, with nobody ticking it off',
    iso(a2.remind_at) === nextMonday.toISOString() &&
      a2.reminded_at === null &&
      a2.job === null &&
      Number(a2.sends) === 0 &&
      a2.state === 'todo' &&
      a2.due === null,
    `${JSON.stringify(a2)} want ${nextMonday.toISOString()}`,
  )
  check(
    '...exactly ONE row throughout, and that tick did not say it again',
    (await rowsTitled(title)) === 1 && settle1.out.announce === false,
    String(await rowsTitled(title)),
  )

  // FIRING 2: a week later (Monday 09:00 again).
  await setRemindAt(id, anchor)
  const j2 = await enqueue('tick')
  const f2 = await tick(j2)
  check(
    'firing 2: the duty announces it again',
    f2.out.announce === true && f2.out.body.toLowerCase().includes(title.toLowerCase()),
    f2.out.body.replace(/\n/g, ' | ').slice(0, 120),
  )
  await deliver(j2.jobId, 'sent')
  await tick()
  const a3 = await stateOf(id)
  check(
    '...delivered: advanced in place again; still ONE row, still open',
    iso(a3.remind_at) === nextMonday.toISOString() &&
      a3.state === 'todo' &&
      (await rowsTitled(title)) === 1,
    JSON.stringify(a3),
  )

  // TICKING OFF completes THAT TIME only (FLIPPED 7 Oct 2026, owner decision: it used to END the series).
  const ticked = json(
    (await one(`select app.hq_task_state(${O}, ${lit(id)}, 'done', null, 'grant') as v`)).v,
  )
  const c2 = await stateOf(id)
  check(
    'ticking off the delivered occurrence records it and the series STAYS: open, repeat kept, same next time, ONE row, no duplicate',
    c2.state === 'todo' &&
      String(c2.rep).startsWith('7 days') &&
      iso(c2.remind_at) === nextMonday.toISOString() &&
      iso(c2.last_completed_for) === anchor.toISOString() &&
      c2.last_completed_at !== null &&
      (await rowsTitled(title)) === 1,
    JSON.stringify(c2),
  )
  check(
    '...and the door says what it did (series, recorded), offers no undo for it and does not call it an error',
    ticked.series === true &&
      ticked.occurrence === 'recorded' &&
      ticked.error === undefined &&
      ticked.undo === null,
    JSON.stringify(ticked),
  )
  const listed = json(
    (await one(`select app.my_tasks(${O}, 'all', 200, ${lit(title)}, 'smart', true) as v`)).v,
  ) as unknown as { id: string; state: string; repeats: Record<string, unknown> | null }[]
  const doneList = json(
    (await one(`select app.my_tasks(${O}, 'done', 200, ${lit(title)}, 'smart', true) as v`)).v,
  ) as unknown as { id: string }[]
  const mine = listed.find((r) => r.id === id)
  check(
    '...the list still shows it OPEN as a recurring reminder, says when he last completed one, and the Done bucket does not hold it',
    mine?.state === 'todo' &&
      mine.repeats?.series === true &&
      mine.repeats.last_done_at !== null &&
      !doneList.some((r) => r.id === id),
    JSON.stringify(mine),
  )
  // The next occurrence still fires after the completion: a third reminder, delivered once.
  await setRemindAt(id, plusDays(anchor, -14))
  const j3 = await enqueue('tick')
  const f3 = await tick(j3)
  await deliver(j3.jobId, 'sent')
  await tick()
  const a4 = await stateOf(id)
  check(
    'after the completion the next occurrence still FIRES (once) and the series moves on again, still one row',
    f3.out.announce === true &&
      f3.out.body.toLowerCase().includes(title.toLowerCase()) &&
      a4.state === 'todo' &&
      iso(a4.remind_at) === nextMonday.toISOString() &&
      (await rowsTitled(title)) === 1,
    JSON.stringify(a4),
  )
  // STOPPING is a separate, explicit act, through the real handler and in his words.
  const stopped = await say(`Stop the ${title.toLowerCase()} reminder.`)
  const z = await stateOf(id)
  check(
    '"stop the ... reminder" ENDS the series: cancelled, says so, and offers the undo',
    z.state === 'cancelled' && /^Stopped/.test(stopped.body) && /undo/.test(stopped.body),
    `${JSON.stringify(z)} ${stopped.body.slice(0, 160)}`,
  )
  await setRemindAt(id, plusDays(anchor, -21))
  const after = await tick()
  const z2 = await stateOf(id)
  check(
    '...and it never fires again: no third firing even with its time due, still one row, still cancelled',
    z2.state === 'cancelled' &&
      !after.out.body.toLowerCase().includes(title.toLowerCase()) &&
      (await rowsTitled(title)) === 1,
    JSON.stringify(z2),
  )
}

section(
  'R3: a delivery that FAILED is retried, a delivered reminder is not re-sent, the retry is bounded',
)
{
  at = new Date()
  await setZone(ATHENS)
  const mkSeries = async (label: string) => {
    const { jobId } = await say(`Remind me every day at 9am to ${label} ${run}.`)
    const t = await taskOf(jobId)
    const yesterday = plusDays(new Date(), -1)
    const anchor = wallClock(
      localDay(yesterday, ATHENS).y,
      localDay(yesterday, ATHENS).m,
      localDay(yesterday, ATHENS).d,
      9,
      0,
      ATHENS,
    )
    await setRemindAt(String(t?.id), anchor)
    return { id: String(t?.id), title: String(t?.title), anchor }
  }
  // a series whose first message is refused, then goes through
  const s = await mkSeries('stretch')
  const jA = await enqueue('tick')
  const tA = await tick(jA)
  await deliver(jA.jobId, 'failed')
  const jB = await enqueue('tick')
  const tB = await tick(jB)
  const sB = await stateOf(s.id)
  check(
    'a reminder whose delivery FAILED is said again on the next tick (it is not lost)',
    tA.out.announce === true &&
      tB.out.announce === true &&
      tB.out.body.toLowerCase().includes(s.title.toLowerCase()) &&
      sB.job === jB.jobId &&
      Number(sB.sends) === 2,
    JSON.stringify(sB),
  )
  await deliver(jB.jobId, 'sent')
  const tC = await tick()
  const sC = await stateOf(s.id)
  check(
    '...and once that one is delivered the series moves on, once, and is not said a third time',
    tC.out.announce === false &&
      sC.job === null &&
      new Date(iso(sC.remind_at)).getTime() > Date.now() &&
      (await rowsTitled(s.title)) === 1,
    JSON.stringify(sC),
  )

  // bounded: three refused sends, then the office stops (and the delivery rows stay failed, which is what surfaces)
  const one3 = await say(`Remind me tomorrow to renew the passport ${run}.`)
  const o = await taskOf(one3.jobId)
  await db.execute(
    `update public.tasks set remind_at = now() - interval '1 minute' where task_id = ${lit(String(o?.id))}::uuid`,
  )
  let announced = 0
  for (let i = 0; i < 3; i++) {
    const j = await enqueue('tick')
    const r = await tick(j)
    if (r.out.announce === true && r.out.body.toLowerCase().includes(`renew the passport ${run}`)) {
      announced += 1
    }
    await deliver(j.jobId, 'failed')
  }
  const fourth = await tick()
  const oS = await stateOf(String(o?.id))
  check(
    'the retry is BOUNDED: three sends, all refused, and the fourth tick gives up instead of re-firing for ever',
    announced === 3 &&
      fourth.out.announce === false &&
      !fourth.out.body.toLowerCase().includes('renew the passport') &&
      oS.reminded_at !== null &&
      oS.job === null,
    JSON.stringify({ announced, oS }),
  )
  const failedRows = Number(
    (
      await one(
        `select count(*)::int as c from public.deliveries where office_id = ${O} and state = 'failed' and job_id in (select job_id from public.jobs where office_id = ${O}) and error_code = 'chat_not_found'`,
      )
    ).c,
  )
  check(
    '...and the refused deliveries stay failed (that is what app.undelivered lists)',
    failedRows >= 3,
    String(failedRows),
  )

  // a SERIES that is refused three times is not killed: that occurrence is given up and the series moves on
  const sx = await mkSeries('check the post')
  for (let i = 0; i < 3; i++) {
    const j = await enqueue('tick')
    await tick(j)
    await deliver(j.jobId, 'failed')
  }
  await tick()
  const sxS = await stateOf(sx.id)
  check(
    'a series refused three times gives up THAT occurrence and keeps running: next time is in the future, one row',
    new Date(iso(sxS.remind_at)).getTime() > Date.now() &&
      sxS.reminded_at === null &&
      sxS.state === 'todo' &&
      (await rowsTitled(sx.title)) === 1,
    JSON.stringify(sxS),
  )

  // a job that ENDED having claimed no delivery at all (nothing could go anywhere) is a loss, not a pending message
  const sl = await mkSeries('water the plants')
  const jl = await enqueue('tick')
  await tick(jl)
  await db.execute(`set session_replication_role = replica`)
  await db.execute(
    `update public.jobs set state = 'complete', finished_at = now() where job_id = ${lit(jl.jobId)}::uuid`,
  )
  await db.execute(`set session_replication_role = default`)
  const jl2 = await enqueue('tick')
  const rl = await tick(jl2)
  const slS = await stateOf(sl.id)
  check(
    'a job that ended with NO delivery row at all is treated as lost: the reminder is said again',
    rl.out.announce === true &&
      rl.out.body.toLowerCase().includes(sl.title.toLowerCase()) &&
      slS.job === jl2.jobId,
    JSON.stringify(slS),
  )
}

section('R3: a long outage fires ONCE and moves past now (no backlog)')
{
  at = new Date()
  await setZone(ATHENS)
  const { jobId } = await say(`Remind me every day at 9am to feed the cat ${run}.`)
  const t = await taskOf(jobId)
  const id = String(t?.id)
  const today = localDay(new Date(), ATHENS)
  await setRemindAt(id, wallClock(today.y, today.m, today.d - 30, 9, 0, ATHENS))
  const j = await enqueue('tick')
  const f = await tick(j)
  const lines = (f.out.body.match(new RegExp(`feed the cat ${run}`, 'gi')) ?? []).length
  check(
    'thirty missed days are ONE reminder, not thirty',
    f.out.announce === true && lines === 1,
    f.out.body.replace(/\n/g, ' | ').slice(0, 140),
  )
  await deliver(j.jobId, 'sent')
  await tick()
  const s = await stateOf(id)
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: ATHENS,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso(s.remind_at)))
  const ahead = new Date(iso(s.remind_at)).getTime() - Date.now()
  check(
    '...and the next one is the next 09:00 after now (not 30 days of catching up), still one row',
    ahead > 0 &&
      ahead <= 25 * 3_600_000 &&
      clock === '09:00' &&
      (await rowsTitled(String(t?.title))) === 1,
    `${JSON.stringify(s)} clock ${clock}`,
  )
  const quiet = await tick()
  check(
    '...and the next tick says nothing',
    quiet.out.announce === false,
    quiet.out.body.slice(0, 60),
  )
}

section(
  'R3: a repeating TASK (it has a due date) is unchanged: ticking it off makes the next one, delivery does not advance it',
)
{
  at = new Date()
  await setZone(ATHENS)
  const nowD = localDay(new Date(), ATHENS)
  const dueDay = `${String(nowD.y)}-${String(nowD.m + 1).padStart(2, '0')}-${String(nowD.d).padStart(2, '0')}`
  const made = json(
    (
      await one(
        `select app.my_task_add(${O}, ${lit(`Due series ${run}`)}, '', ${lit(dueDay)}::date, now() - interval '1 minute') as v`,
      )
    ).v,
  )
  await one(
    `select app.my_task_set(${O}, ${lit(String(made.id))}, p_repeat_every => interval '7 days', p_repeat_from => 'due') as v`,
  )
  const j = await enqueue('tick')
  const f = await tick(j)
  await deliver(j.jobId, 'sent')
  await tick()
  const s = await stateOf(String(made.id))
  check(
    'delivery of its reminder marks it reminded and does NOT advance it or make another row',
    f.out.announce === true &&
      s.reminded_at !== null &&
      s.due === dueDay &&
      s.state === 'todo' &&
      (await rowsTitled(`Due series ${run}`)) === 1,
    JSON.stringify(s),
  )
  await one(`select app.hq_task_state(${O}, ${lit(String(made.id))}, 'done', null, 'grant') as v`)
  const next = (
    await rows(
      `select due_on::text as due, remind_at, repeat_every::text as rep from public.tasks where office_id = ${O} and title = ${lit(`Due series ${run}`)} and state = 'todo'`,
    )
  )[0]
  check(
    'ticking it off makes exactly ONE next occurrence, a week on, with a reminder, still repeating',
    (await rowsTitled(`Due series ${run}`)) === 2 &&
      next !== undefined &&
      next.remind_at !== null &&
      String(next.rep).startsWith('7 days'),
    JSON.stringify(next),
  )
  // a typed repeating COMMITMENT is that kind: a due date, ticked off to advance
  const commit = await say(`I need to review the books every Monday ${run}.`)
  const ct = await taskOf(commit.jobId)
  check(
    'typed: "I need to ... every Monday" is a repeating TASK (due date, repeat from due), not a reminder series',
    ct?.due !== null && ct?.repeat_from === 'due' && String(ct?.rep).startsWith('7 days'),
    JSON.stringify(ct),
  )
}

section('R3: the unsupported patterns are SAID and stored as one-offs')
at = new Date()
for (const [said, phrase] of [
  ['Remind me every month to pay the rent.', 'every month'],
  ['Remind me every weekday to stand up.', 'every weekday'],
  ['Remind me every first Monday to run the report.', 'every first Monday'],
] as const) {
  const { body, jobId } = await say(said)
  const t = await taskOf(jobId)
  check(
    `"${said}" is a one-off AND the reply says "${phrase}" was not recorded`,
    t?.rep === null &&
      t.due === null &&
      body.includes('did not record') &&
      body.includes(phrase) &&
      body.includes('one-off') &&
      String(t.title).endsWith(`(${phrase})`),
    `${JSON.stringify(t)} / ${body.slice(0, 200)}`,
  )
}

// ================================================================================================================
section(
  'R3: tasks_repeat_on_done across a change of clocks, a year boundary and a catch-up (the SQL half)',
)
{
  const direct = async (
    zone: string,
    title: string,
    dueDay: string,
    remindIso: string,
    every: string,
    from = 'due',
  ) => {
    await setZone(zone)
    const made = json(
      (
        await one(
          `select app.my_task_add(${O}, ${lit(`${title} ${run}`)}, '', ${lit(dueDay)}::date, ${lit(remindIso)}::timestamptz) as v`,
        )
      ).v,
    )
    await one(
      `select app.my_task_set(${O}, ${lit(String(made.id))}, p_repeat_every => ${lit(every)}::interval, p_repeat_from => ${lit(from)}) as v`,
    )
    await one(`select app.hq_task_state(${O}, ${lit(String(made.id))}, 'done', null, 'grant') as v`)
    return (
      await rows(
        `select due_on::text as due, remind_at from public.tasks where office_id = ${O} and title = ${lit(`${title} ${run}`)} and state = 'todo'`,
      )
    )[0]
  }
  const expect = async (
    label: string,
    zone: string,
    dueDay: string,
    remindIso: string,
    every: string,
    wantDue: string,
    wantRemind: string,
  ) => {
    const got = await direct(zone, label, dueDay, remindIso, every)
    check(
      `${label} (${zone}): due ${wantDue}, remind_at ${wantRemind}`,
      got !== undefined &&
        got.due === wantDue &&
        got.remind_at !== null &&
        iso(got.remind_at) === wantRemind,
      JSON.stringify(got),
    )
  }
  // 09:00 local before the change -> 09:00 local after it. A fixed 24 h or 7 x 24 h would be an hour out.
  await expect(
    'Athens spring forward',
    'Europe/Athens',
    '2030-03-25',
    '2030-03-25T07:00:00Z',
    '7 days',
    '2030-04-01',
    '2030-04-01T06:00:00.000Z',
  )
  await expect(
    'Athens fall back',
    'Europe/Athens',
    '2030-10-21',
    '2030-10-21T06:00:00Z',
    '7 days',
    '2030-10-28',
    '2030-10-28T07:00:00.000Z',
  )
  await expect(
    'Athens daily over the fall back',
    'Europe/Athens',
    '2030-10-26',
    '2030-10-26T06:00:00Z',
    '1 day',
    '2030-10-27',
    '2030-10-27T07:00:00.000Z',
  )
  await expect(
    'New York spring forward',
    'America/New_York',
    '2030-03-04',
    '2030-03-04T14:00:00Z',
    '7 days',
    '2030-03-11',
    '2030-03-11T13:00:00.000Z',
  )
  await expect(
    'New York fall back',
    'America/New_York',
    '2030-10-28',
    '2030-10-28T13:00:00Z',
    '7 days',
    '2030-11-04',
    '2030-11-04T14:00:00.000Z',
  )
  await expect(
    'Auckland spring forward',
    'Pacific/Auckland',
    '2030-09-23',
    '2030-09-22T21:00:00Z',
    '7 days',
    '2030-09-30',
    '2030-09-29T20:00:00.000Z',
  )
  await expect(
    'Auckland fall back',
    'Pacific/Auckland',
    '2030-04-01',
    '2030-03-31T20:00:00Z',
    '7 days',
    '2030-04-08',
    '2030-04-07T21:00:00.000Z',
  )
  // week / month / year boundaries
  await expect(
    'weekly over a month end',
    'Europe/Athens',
    '2030-01-28',
    '2030-01-28T07:00:00Z',
    '7 days',
    '2030-02-04',
    '2030-02-04T07:00:00.000Z',
  )
  await expect(
    'weekly over a year end',
    'Europe/Athens',
    '2030-12-30',
    '2030-12-30T07:00:00Z',
    '7 days',
    '2031-01-06',
    '2031-01-06T07:00:00.000Z',
  )
  await expect(
    'fortnightly over February',
    'Europe/Athens',
    '2030-02-20',
    '2030-02-20T07:00:00Z',
    '14 days',
    '2030-03-06',
    '2030-03-06T07:00:00.000Z',
  )

  // A reminder SERIES (no due date) ticked off ENDS: the trigger makes no next occurrence for it (the delivery moves it).
  await setZone('Europe/Athens')
  const rem = json(
    (
      await one(
        `select app.my_task_add(${O}, ${lit(`Reminder only ${run}`)}, '', null, date_trunc('minute', now() - interval '3 days')) as v`,
      )
    ).v,
  )
  await one(
    `select app.my_task_set(${O}, ${lit(String(rem.id))}, p_repeat_every => interval '1 day', p_repeat_from => 'done') as v`,
  )
  await one(`select app.hq_task_state(${O}, ${lit(String(rem.id))}, 'done', null, 'grant') as v`)
  const rEnded = await stateOf(String(rem.id))
  // FLIPPED 7 Oct 2026: it used to end ("no repeat left", state done). Now the time that had not fired is SKIPPED, the
  // series stays open and repeating, and the trigger and the delivery still cannot both advance it: ONE row.
  check(
    'a series ticked off BEFORE it fired skips that time and stays open and repeating: one row, no duplicate occurrence row, next time in the future',
    (await rowsTitled(`Reminder only ${run}`)) === 1 &&
      String(rEnded.rep).startsWith('1 day') &&
      rEnded.state === 'todo' &&
      rEnded.last_completed_for !== null &&
      new Date(iso(rEnded.remind_at)).getTime() > Date.now(),
    JSON.stringify(rEnded),
  )

  // The in-place advance itself, on the wall clock: every case is a series delivered at its reminder time.
  const inPlace = async (
    label: string,
    zone: string,
    remindIso: string,
    every: string,
    wantRemind: string,
  ) => {
    await setZone(zone)
    const made = json(
      (
        await one(
          `select app.my_task_add(${O}, ${lit(`${label} ${run}`)}, '', null, ${lit(remindIso)}::timestamptz) as v`,
        )
      ).v,
    )
    await one(
      `select app.my_task_set(${O}, ${lit(String(made.id))}, p_repeat_every => ${lit(every)}::interval, p_repeat_from => 'done') as v`,
    )
    // delivered: the delivery layer said sent, which is what reminders_sent is told
    await one(`select app.reminders_sent(${O}, array[${lit(String(made.id))}]::uuid[]) as v`)
    const s = await stateOf(String(made.id))
    check(
      `series in place: ${label} (${zone}) -> ${wantRemind}, one row, still open, no due date`,
      s.remind_at !== null &&
        iso(s.remind_at) === wantRemind &&
        s.state === 'todo' &&
        s.due === null &&
        s.reminded_at === null &&
        (await rowsTitled(`${label} ${run}`)) === 1,
      JSON.stringify(s),
    )
  }
  await inPlace(
    'Series Athens spring',
    'Europe/Athens',
    '2030-03-25T07:00:00Z',
    '7 days',
    '2030-04-01T06:00:00.000Z',
  )
  await inPlace(
    'Series Athens fall',
    'Europe/Athens',
    '2030-10-21T06:00:00Z',
    '7 days',
    '2030-10-28T07:00:00.000Z',
  )
  await inPlace(
    'Series Athens daily fall',
    'Europe/Athens',
    '2030-10-26T06:00:00Z',
    '1 day',
    '2030-10-27T07:00:00.000Z',
  )
  await inPlace(
    'Series NY spring',
    'America/New_York',
    '2030-03-04T14:00:00Z',
    '7 days',
    '2030-03-11T13:00:00.000Z',
  )
  await inPlace(
    'Series NY fall',
    'America/New_York',
    '2030-10-28T13:00:00Z',
    '7 days',
    '2030-11-04T14:00:00.000Z',
  )
  await inPlace(
    'Series Auckland spring',
    'Pacific/Auckland',
    '2030-09-22T21:00:00Z',
    '7 days',
    '2030-09-29T20:00:00.000Z',
  )
  await inPlace(
    'Series Auckland fall',
    'Pacific/Auckland',
    '2030-03-31T20:00:00Z',
    '7 days',
    '2030-04-07T21:00:00.000Z',
  )
  await inPlace(
    'Series month end',
    'Europe/Athens',
    '2030-01-28T07:00:00Z',
    '7 days',
    '2030-02-04T07:00:00.000Z',
  )
  await inPlace(
    'Series year end',
    'Europe/Athens',
    '2030-12-30T07:00:00Z',
    '7 days',
    '2031-01-06T07:00:00.000Z',
  )
  await inPlace(
    'Series fortnight Feb',
    'Europe/Athens',
    '2030-02-20T07:00:00Z',
    '14 days',
    '2030-03-06T07:00:00.000Z',
  )

  // a schedule that has fallen behind catches up rather than producing a backlog
  const old = await direct(
    'Europe/Athens',
    'Catch up',
    '2020-01-06',
    '2020-01-06T07:00:00Z',
    '7 days',
  )
  check(
    'a weekly task finished years late schedules its next occurrence in the FUTURE, one row, not a backlog',
    old !== undefined &&
      old.due !== null &&
      new Date(`${String(old.due)}T00:00:00Z`).getTime() >= Date.now() - 86_400_000 &&
      Number(
        (
          await one(
            `select count(*)::int as c from public.tasks where office_id = ${O} and title = ${lit(`Catch up ${run}`)} and state = 'todo'`,
          )
        ).c,
      ) === 1,
    JSON.stringify(old),
  )
  // a zero interval means nothing as a repeat and must not hang the database
  const zero = json(
    (
      await one(
        `select app.my_task_add(${O}, ${lit(`Zero ${run}`)}, '', ${lit('2030-01-01')}::date) as v`,
      )
    ).v,
  )
  await db.execute(
    `update public.tasks set repeat_every = interval '0', repeat_from = 'due' where task_id = ${lit(String(zero.id))}::uuid`,
  )
  const started = Date.now()
  await one(`select app.hq_task_state(${O}, ${lit(String(zero.id))}, 'done', null, 'grant') as v`)
  check(
    'a zero-length repeat is ignored (no infinite loop, no new row)',
    Date.now() - started < 5000 &&
      Number(
        (
          await one(
            `select count(*)::int as c from public.tasks where office_id = ${O} and title = ${lit(`Zero ${run}`)}`,
          )
        ).c,
      ) === 1,
    `${String(Date.now() - started)} ms`,
  )
  await setZone('Europe/Athens')
}

console.log(`\n${String(total - failed)}/${String(total)} PROVEN (${String(failed)} FAILED)`)
await db.end?.()
process.exit(failed === 0 ? 0 : 1)

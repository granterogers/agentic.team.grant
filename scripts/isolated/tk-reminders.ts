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
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { remindersHandler } from '../../src/handlers/reminders.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { localDay, wallClock } from '../../src/agents/office-time.ts'
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
const iso = (v: unknown) => new Date(String(v)).toISOString()

const op = String((await one(`select app.operator_office()::text as o`)).o)
const O = `${lit(op)}::uuid`
const hasFn = Number((await one(`select count(*)::int as c from pg_proc where proname = 'office_timezone' and pronamespace = 'app'::regnamespace`)).c)
if (hasFn !== 1) {
  console.log('FAILED   migration 1027 (app.office_timezone) is not applied to this replica')
  process.exit(1)
}
const setZone = async (z: string) => {
  await db.execute(`update public.offices set timezone = ${lit(z)} where office_id = ${O}`)
}
const project = json((await one(`select app.hq_create_project(${O}, ${lit(`Tk Rem ${run}`)}, 'upload', ${lit(`tk-rem-${run}`)}, ${lit(`Tk Rem ${run}`)}, true) as v`)).v)
const p1 = String(project.project_id)

let at = new Date()
const handler = instructionHandler({
  db,
  router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never,
  now: () => at,
})
let n = 0
const say = async (said: string, chat = 'r'): Promise<{ body: string; job: Job; jobId: string }> => {
  n += 1
  const c = await one(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context)
    values (${O}, ${lit(p1)}::uuid, 'teamhq', ${lit(`tkr${run}${chat}${String(n)}:${String(n)}`)}, 'grant', ${lit(said)}, ${lit(`teamhq:message:tkr${run}${String(n)}`)}, 'grant', '{}'::jsonb)
    returning command_id::text as id`)
  const v = json((await one(`select app.enqueue_inbound(${lit(String(c.id))}::uuid) as v`)).v)
  const jobId = String(v.job_id)
  const j = await one(`select job_id::text as id, kind, correlation_id::text as c, project_id::text as p, idempotency_key as k, office_id::text as o from public.jobs where job_id = ${lit(jobId)}::uuid`)
  const job = { jobId: String(j.id), kind: String(j.kind), correlationId: String(j.c), projectId: j.p === null ? null : String(j.p), idempotencyKey: String(j.k), attempt: 1, officeId: String(j.o) } as Job
  const out = await handler.handle(job, db)
  return { body: String((out as { body?: string }).body ?? ''), job, jobId }
}
const taskOf = async (jobId: string) =>
  (await rows(`select task_id::text as id, title, due_on::text as due, remind_at, repeat_every::text as rep, repeat_from, assigned_to_human as mine, state from public.tasks where job_id = ${lit(jobId)}::uuid`))[0] as Record<string, unknown>

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
    check(`"Remind me tomorrow..." at 22:30 UTC in ${zone}: due ${due}, remind_at ${remindAt}`, t?.due === due && t.remind_at !== null && iso(t.remind_at) === remindAt, `stored due ${String(t?.due)} remind_at ${t?.remind_at === null || t?.remind_at === undefined ? 'null' : iso(t.remind_at)}`)
    check(`...and the reply names the time and the zone it used (${say9})`, body.includes(say9) && body.includes('did not say a time'), body.slice(0, 220))
  }
  await setZone('Europe/Athens')
  at = new Date('2026-10-07T08:00:00.000Z') // Wednesday 11:00 Athens
  for (const [said, due, remindAt] of [
    ['Remind me Friday to call Mum.', '2026-10-09', '2026-10-09T06:00:00.000Z'],
    ['Remind me on 15 October to renew X.', '2026-10-15', '2026-10-15T06:00:00.000Z'],
  ] as const) {
    const { body, jobId } = await say(said)
    const t = await taskOf(jobId)
    check(`"${said}" stores due ${due} and remind_at ${remindAt}`, t?.due === due && t.remind_at !== null && iso(t.remind_at) === remindAt && t.mine === true, JSON.stringify(t))
    check('...with a clean title and a truthful reply', !/friday|october/i.test(String(t?.title)) && body.includes('(Europe/Athens)'), `${String(t?.title)} / ${body.slice(0, 120)}`)
  }
  const due = await say('Task: renew X by Friday.')
  const dt = await taskOf(due.jobId)
  check('NEGATIVE: "Task: renew X by Friday." is a DUE DATE: a due date, no remind_at, no default time promised', dt?.due === '2026-10-09' && dt.remind_at === null && !/remind you/.test(due.body), `${JSON.stringify(dt)} / ${due.body.slice(0, 100)}`)
  const bare = await say('Remind me to call Mum.')
  const bt = await taskOf(bare.jobId)
  check('NEGATIVE: "Remind me to call Mum." (no day, no time) stays undated and unreminded', bt?.due === null && bt.remind_at === null, JSON.stringify(bt))
}

// ================================================================================================================
section('R1: the duty actually fires a date-only reminder, once')
{
  at = new Date()
  await setZone('Europe/Athens')
  const { jobId, job } = await say(`Remind me tomorrow to renew the licence ${run}.`)
  const t = await taskOf(jobId)
  check('the typed date-only reminder has a remind_at (the duty can see it)', t?.remind_at !== null, JSON.stringify(t))
  // Time passes: the reminder time arrives.
  await db.execute(`update public.tasks set remind_at = now() - interval '1 minute' where task_id = ${lit(String(t?.id))}::uuid`)
  const dueOnly = await say(`Task: renew the domain ${run} by yesterday-ish.`)
  void dueOnly
  const duty = await remindersHandler(db).handle({ ...job, kind: 'tasks.remind' }, db)
  check('tasks.remind announces it, naming it', duty.announce === true && duty.body.includes(`renew the licence ${run}`.replace(/^./, (c) => c.toUpperCase())) || duty.body.toLowerCase().includes(`renew the licence ${run}`), duty.body.replace(/\n/g, ' | ').slice(0, 160))
  check('...and marks it reminded', (await one(`select reminded_at is not null as r from public.tasks where task_id = ${lit(String(t?.id))}::uuid`)).r === true, '')
  const again = await remindersHandler(db).handle({ ...job, kind: 'tasks.remind' }, db)
  check('the next tick does not say it again', !again.body.toLowerCase().includes(`renew the licence ${run}`), again.body.slice(0, 80))
}

// ================================================================================================================
section('Z1: Today / Overdue / due-soon bucket on the OFFICE day in my_tasks, my_tasks_counts, reminders_due and studio_tasks')
{
  // Kiritimati (UTC+14) and Pago Pago (UTC-11) are 25 hours apart, so their calendar days differ by one or two at any
  // instant and the test does not depend on the hour it runs.
  const K = 'Pacific/Kiritimati'
  const P = 'Pacific/Pago_Pago'
  const kToday = String((await one(`select (now() at time zone ${lit(K)})::date::text as d`)).d)
  const pToday = String((await one(`select (now() at time zone ${lit(P)})::date::text as d`)).d)
  check('the two zones really are on different days right now', kToday > pToday, `${kToday} vs ${pToday}`)
  const mk = async (title: string, due: string) => json((await one(`select app.my_task_add(${O}, ${lit(`${title} ${run}`)}, '', ${lit(due)}::date, null, 100, ${lit(String(project.slug))}) as v`)).v)
  const todayK = await mk('Z1 K-today', kToday)
  const pDay = await mk('Z1 P-today', pToday)
  const soonK = await mk('Z1 K-plus-seven', String((await one(`select (${lit(kToday)}::date + 7)::text as d`)).d))
  const list = async (b: string) => ((await one(`select app.my_tasks(${O}, ${lit(b)}, 500) as v`)).v as { title: string; overdue: boolean }[]).map((x) => x.title.replace(` ${run}`, ''))
  const counts = async () => json((await one(`select app.my_tasks_counts(${O}) as v`)).v) as Record<string, number>
  const remDue = async () => (await one(`select app.reminders_due(${O}) as v`)).v as { title: string; overdue: boolean }[]
  const studio = async () => ((await one(`select app.studio_tasks(${lit(p1)}::uuid) as v`)).v as { title: string; state: string | null }[])
  // a reminder due now so reminders_due returns the rows with their overdue flag
  // (only Pago Pago's day gets a reminder time: a reminder in the past is itself a Today row and would hide the point)
  await db.execute(`update public.tasks set remind_at = now() - interval '1 minute' where task_id = ${lit(String(pDay.id))}::uuid`)
  void todayK

  await setZone(K)
  const kToday_ = await list('today')
  const kUp = await list('upcoming')
  const kRem = (await remDue()).find((r) => r.title.startsWith('Z1 P-today'))
  const kStudio = (await studio()).find((s) => s.title.startsWith('Z1 K-plus-seven'))
  check('office in Kiritimati: its own today\'s task is in Today and not Upcoming', kToday_.includes('Z1 K-today') && !kUp.includes('Z1 K-today'), JSON.stringify({ today: kToday_.filter((t) => t.startsWith('Z1')), upcoming: kUp.filter((t) => t.startsWith('Z1')) }))
  check('...Pago Pago\'s today is already OVERDUE there (reminders_due flag)', kRem?.overdue === true, JSON.stringify(kRem))
  check('...a task due in seven local days is "due soon" in studio_tasks', kStudio?.state === 'due', JSON.stringify(kStudio))
  const kc = await counts()

  await setZone(P)
  const pToday_ = await list('today')
  const pUp = await list('upcoming')
  const pRem = (await remDue()).find((r) => r.title.startsWith('Z1 P-today'))
  const pStudio = (await studio()).find((s) => s.title.startsWith('Z1 K-plus-seven'))
  check('office in Pago Pago: the SAME rows read differently: Kiritimati\'s today is Upcoming', !pToday_.includes('Z1 K-today') && pUp.includes('Z1 K-today'), JSON.stringify({ today: pToday_.filter((t) => t.startsWith('Z1')), upcoming: pUp.filter((t) => t.startsWith('Z1')) }))
  check('...its own day is not overdue', pRem?.overdue === false, JSON.stringify(pRem))
  check('...and the plus-seven task is NOT due soon yet in studio_tasks', pStudio?.state === null, JSON.stringify(pStudio))
  const pc = await counts()
  check('my_tasks_counts follows the same clock (today count differs between the two offices)', Number(kc.today) !== Number(pc.today) || Number(kc.upcoming) !== Number(pc.upcoming), `K ${JSON.stringify(kc)} / P ${JSON.stringify(pc)}`)
  void soonK
  await setZone('Europe/Athens')
  const unknown = String((await one(`select app.office_timezone(gen_random_uuid()) as z`)).z)
  await db.execute(`update public.offices set timezone = 'Not/AZone' where office_id = ${O}`).catch(() => undefined)
  const bad = String((await one(`select app.office_timezone(${O}) as z`)).z)
  await setZone('Europe/Athens')
  check('an unknown office, and an office holding a name that is not a zone, are UTC (never somebody else\'s zone)', unknown === 'UTC' && bad === 'UTC', `unknown ${unknown}, bad ${bad}`)
}

// ================================================================================================================
section('R3: the recurrence is kept, stored, and survives completion with the RIGHT remind_at')
{
  await setZone('Europe/Athens')
  at = new Date()
  const cases: [string, string, string | null][] = [
    ['Remind me every Monday to review my finances.', '7 days', 'review my finances'],
    ['Remind me every day at 9am to stretch.', '1 day', 'stretch'],
    ['Remind me every Friday at 4pm to send the report.', '7 days', 'send the report'],
    ['Remind me weekly to review this.', '7 days', 'review this'],
    ['Remind me every other Tuesday to water the plants.', '14 days', 'water the plants'],
  ]
  for (const [said, every, title] of cases) {
    const { body, jobId } = await say(said)
    const t = await taskOf(jobId)
    check(`"${said}" stores repeat_every ${every}, repeat_from due, a due date and a remind_at, and a clean title`, t?.rep !== null && String(t?.rep).replace('00:00:00', '').trim() === every && t?.repeat_from === 'due' && t.due !== null && t.remind_at !== null && String(t.title).toLowerCase() === title && !/every|weekly/i.test(String(t.title)), JSON.stringify(t))
    check('...and the reply says it repeats and how the next one comes', /repeats every/.test(body) && /tick/.test(body), body.slice(0, 200))
    // Completing the first occurrence makes the next, exactly one period later on the office wall clock.
    const before = await rows(`select count(*)::int as c from public.tasks where office_id = ${O} and title = ${lit(String(t?.title))}`)
    const done = json((await one(`select app.hq_task_state(${O}, ${lit(String(t?.id))}, 'done', null, 'grant') as v`)).v)
    const next = (await rows(`select task_id::text as id, due_on::text as due, remind_at, repeat_every::text as rep, repeat_from, state from public.tasks where office_id = ${O} and title = ${lit(String(t?.title))} and state = 'todo'`))[0]
    const periodDays = every === '1 day' ? 1 : every === '14 days' ? 14 : 7
    const d0 = String(t?.due).split('-').map(Number)
    const r0 = new Date(iso(t?.remind_at))
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(r0).split(':').map(Number)
    const expected = wallClock(Number(d0[0]), Number(d0[1]) - 1, Number(d0[2]) + periodDays, Number(local[0]), Number(local[1]), 'Europe/Athens')
    check('...completing it makes the next occurrence at remind_at + period on the wall clock', done.state === 'done' && next !== undefined && next.remind_at !== null && iso(next.remind_at) === expected.toISOString(), `next ${JSON.stringify(next)} expected ${expected.toISOString()}; ${String(before[0]?.c)} rows before`)
    check('...which keeps the repeat, and the finished one stops repeating', next?.rep !== null && (await one(`select repeat_every is null as r from public.tasks where task_id = ${lit(String(t?.id))}::uuid`)).r === true, '')
  }
}

section('R3: first occurrence -> the duty fires it -> complete -> next occurrence -> the duty fires that too')
{
  at = new Date()
  const { jobId, job } = await say(`Remind me every day at 9am to stretch ${run}.`)
  const first = await taskOf(jobId)
  // 1. time passes; the first occurrence fires
  await db.execute(`update public.tasks set remind_at = now() - interval '2 minutes' where task_id = ${lit(String(first?.id))}::uuid`)
  const d1 = await remindersHandler(db).handle({ ...job, kind: 'tasks.remind' }, db)
  check('the duty fires the first occurrence', d1.announce === true && d1.body.toLowerCase().includes(`stretch ${run}`), d1.body.replace(/\n/g, ' | ').slice(0, 140))
  // 2. he ticks it off; the next occurrence exists and carries a remind_at
  await one(`select app.hq_task_state(${O}, ${lit(String(first?.id))}, 'done', null, 'grant') as v`)
  const second = (await rows(`select task_id::text as id, remind_at, reminded_at, due_on::text as due from public.tasks where office_id = ${O} and title ilike ${lit(`stretch ${run}`)} and state = 'todo'`))[0]
  check('the next occurrence exists, unreminded, with a remind_at later than now', second !== undefined && second.remind_at !== null && second.reminded_at === null && new Date(iso(second.remind_at)).getTime() > Date.now(), JSON.stringify(second))
  // 3. time passes again; the second occurrence fires
  await db.execute(`update public.tasks set remind_at = now() - interval '1 minute' where task_id = ${lit(String(second?.id))}::uuid`)
  const d2 = await remindersHandler(db).handle({ ...job, kind: 'tasks.remind' }, db)
  check('the duty fires the SECOND occurrence: the recurrence survived', d2.announce === true && d2.body.toLowerCase().includes(`stretch ${run}`), d2.body.replace(/\n/g, ' | ').slice(0, 140))
  const third = await one(`select count(*)::int as c from public.tasks where office_id = ${O} and title ilike ${lit(`stretch ${run}`)}`)
  check('...exactly two occurrences exist so far (no runaway)', Number(third.c) === 2, String(third.c))
}

section('R3: the unsupported patterns are SAID and stored as one-offs')
{
  at = new Date()
  for (const [said, phrase] of [
    ['Remind me every month to pay the rent.', 'every month'],
    ['Remind me every weekday to stand up.', 'every weekday'],
    ['Remind me every first Monday to run the report.', 'every first Monday'],
  ] as const) {
    const { body, jobId } = await say(said)
    const t = await taskOf(jobId)
    check(`"${said}" is a one-off AND the reply says "${phrase}" was not recorded`, t?.rep === null && t.due === null && body.includes('did not record') && body.includes(phrase) && body.includes('one-off') && String(t.title).endsWith(`(${phrase})`), `${JSON.stringify(t)} / ${body.slice(0, 200)}`)
  }
}

// ================================================================================================================
section('R3: tasks_repeat_on_done across a change of clocks, a year boundary and a catch-up (the SQL half)')
{
  const direct = async (zone: string, title: string, dueDay: string, remindIso: string, every: string, from = 'due') => {
    await setZone(zone)
    const made = json((await one(`select app.my_task_add(${O}, ${lit(`${title} ${run}`)}, '', ${lit(dueDay)}::date, ${lit(remindIso)}::timestamptz) as v`)).v)
    await one(`select app.my_task_set(${O}, ${lit(String(made.id))}, p_repeat_every => ${lit(every)}::interval, p_repeat_from => ${lit(from)}) as v`)
    await one(`select app.hq_task_state(${O}, ${lit(String(made.id))}, 'done', null, 'grant') as v`)
    return (await rows(`select due_on::text as due, remind_at from public.tasks where office_id = ${O} and title = ${lit(`${title} ${run}`)} and state = 'todo'`))[0]
  }
  const expect = async (label: string, zone: string, dueDay: string, remindIso: string, every: string, wantDue: string, wantRemind: string) => {
    const got = await direct(zone, label, dueDay, remindIso, every)
    check(`${label} (${zone}): due ${wantDue}, remind_at ${wantRemind}`, got !== undefined && got.due === wantDue && got.remind_at !== null && iso(got.remind_at) === wantRemind, JSON.stringify(got))
  }
  // 09:00 local before the change -> 09:00 local after it. A fixed 24 h or 7 x 24 h would be an hour out.
  await expect('Athens spring forward', 'Europe/Athens', '2030-03-25', '2030-03-25T07:00:00Z', '7 days', '2030-04-01', '2030-04-01T06:00:00.000Z')
  await expect('Athens fall back', 'Europe/Athens', '2030-10-21', '2030-10-21T06:00:00Z', '7 days', '2030-10-28', '2030-10-28T07:00:00.000Z')
  await expect('Athens daily over the fall back', 'Europe/Athens', '2030-10-26', '2030-10-26T06:00:00Z', '1 day', '2030-10-27', '2030-10-27T07:00:00.000Z')
  await expect('New York spring forward', 'America/New_York', '2030-03-04', '2030-03-04T14:00:00Z', '7 days', '2030-03-11', '2030-03-11T13:00:00.000Z')
  await expect('New York fall back', 'America/New_York', '2030-10-28', '2030-10-28T13:00:00Z', '7 days', '2030-11-04', '2030-11-04T14:00:00.000Z')
  await expect('Auckland spring forward', 'Pacific/Auckland', '2030-09-23', '2030-09-22T21:00:00Z', '7 days', '2030-09-30', '2030-09-29T20:00:00.000Z')
  await expect('Auckland fall back', 'Pacific/Auckland', '2030-04-01', '2030-03-31T20:00:00Z', '7 days', '2030-04-08', '2030-04-07T21:00:00.000Z')
  // week / month / year boundaries
  await expect('weekly over a month end', 'Europe/Athens', '2030-01-28', '2030-01-28T07:00:00Z', '7 days', '2030-02-04', '2030-02-04T07:00:00.000Z')
  await expect('weekly over a year end', 'Europe/Athens', '2030-12-30', '2030-12-30T07:00:00Z', '7 days', '2031-01-06', '2031-01-06T07:00:00.000Z')
  await expect('fortnightly over February', 'Europe/Athens', '2030-02-20', '2030-02-20T07:00:00Z', '14 days', '2030-03-06', '2030-03-06T07:00:00.000Z')

  // a reminder with NO due date, from when it was done: the same local time of day, a period after today
  await setZone('Europe/Athens')
  const rem = json((await one(`select app.my_task_add(${O}, ${lit(`Reminder only ${run}`)}, '', null, date_trunc('minute', now() - interval '3 days')) as v`)).v)
  await one(`select app.my_task_set(${O}, ${lit(String(rem.id))}, p_repeat_every => interval '1 day', p_repeat_from => 'done') as v`)
  const rBefore = await one(`select remind_at from public.tasks where task_id = ${lit(String(rem.id))}::uuid`)
  await one(`select app.hq_task_state(${O}, ${lit(String(rem.id))}, 'done', null, 'grant') as v`)
  const rNext = (await rows(`select remind_at, due_on::text as due from public.tasks where office_id = ${O} and title = ${lit(`Reminder only ${run}`)} and state = 'todo'`))[0]
  const nowD = new Date()
  const tomorrow = localDay(new Date(nowD.getTime() + 86_400_000), 'Europe/Athens')
  const tod = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso(rBefore.remind_at))).split(':').map(Number)
  const wantRem = wallClock(tomorrow.y, tomorrow.m, tomorrow.d, Number(tod[0]), Number(tod[1]), 'Europe/Athens')
  check('a reminder with no due date repeating from done keeps its time of day, the local day after today (was: remind_at LOST)', rNext !== undefined && rNext.remind_at !== null && iso(rNext.remind_at) === wantRem.toISOString(), `${JSON.stringify(rNext)} want ${wantRem.toISOString()}`)

  // a schedule that has fallen behind catches up rather than producing a backlog
  const old = await direct('Europe/Athens', 'Catch up', '2020-01-06', '2020-01-06T07:00:00Z', '7 days')
  check('a weekly task finished years late schedules its next occurrence in the FUTURE, one row, not a backlog', old !== undefined && old.due !== null && new Date(`${String(old.due)}T00:00:00Z`).getTime() >= Date.now() - 86_400_000 && Number((await one(`select count(*)::int as c from public.tasks where office_id = ${O} and title = ${lit(`Catch up ${run}`)} and state = 'todo'`)).c) === 1, JSON.stringify(old))
  // a zero interval means nothing as a repeat and must not hang the database
  const zero = json((await one(`select app.my_task_add(${O}, ${lit(`Zero ${run}`)}, '', ${lit('2030-01-01')}::date) as v`)).v)
  await db.execute(`update public.tasks set repeat_every = interval '0', repeat_from = 'due' where task_id = ${lit(String(zero.id))}::uuid`)
  const started = Date.now()
  await one(`select app.hq_task_state(${O}, ${lit(String(zero.id))}, 'done', null, 'grant') as v`)
  check('a zero-length repeat is ignored (no infinite loop, no new row)', Date.now() - started < 5000 && Number((await one(`select count(*)::int as c from public.tasks where office_id = ${O} and title = ${lit(`Zero ${run}`)}`)).c) === 1, `${String(Date.now() - started)} ms`)
  await setZone('Europe/Athens')
}

console.log(`\n${String(total - failed)}/${String(total)} PROVEN (${String(failed)} FAILED)`)
await db.end?.()
process.exit(failed === 0 ? 0 : 1)

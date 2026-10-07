/**
 * rm-series: completing a RECURRING REMINDER completes THAT TIME ONLY; stopping the series is a separate, explicit act
 * (owner decision, 7 October 2026; migration 1034). Through the REAL instruction handler, the REAL tasks.remind duty and
 * the REAL triggers, on a replica, with a controllable clock.
 *
 *   npx tsx scripts/isolated/rm-series.ts <replica-db> [sabotage]
 *
 * Needs migrations 1027 and 1034 on the replica. The CLONE's `app.now_utc()` is replaced by one that reads a one-row table
 * (`public.rm_clock`), so "time passes" is a statement and not a wait; that is a replica-only change and the database is
 * dropped by the caller. Hermetic: the model is degraded to `{}`; what a real model does with these sentences is
 * MODEL-DEPENDENT and not claimed.
 *
 * The optional second argument installs ONE sabotage (a deliberately broken copy of a repaired function) and the run is
 * then expected to go RED; it prints proof that the sabotage landed before running anything. See the SABOTAGES table.
 */
import {
  localClock,
  localDay,
  offsetMinutes,
  wallClock,
  weekdayOf,
} from '../../src/agents/office-time.ts'
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { remindersHandler } from '../../src/handlers/reminders.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'rm_x')
const sabotage = process.argv[3] ?? ''
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
const ATHENS = 'Europe/Athens'
const op = String((await one(`select app.operator_office()::text as o`)).o)
const O = `${lit(op)}::uuid`

if (
  Number(
    (
      await one(
        `select count(*)::int as c from pg_proc where proname = 'reminder_series_stop' and pronamespace = 'app'::regnamespace`,
      )
    ).c,
  ) !== 1
) {
  console.log('FAILED   migration 1034 (app.reminder_series_stop) is not applied to this replica')
  process.exit(1)
}

// ---------------------------------------------------------------------------------------------------------------
// the clock: replica only
// ---------------------------------------------------------------------------------------------------------------
await db.execute(`create table if not exists public.rm_clock (t timestamptz)`)
await db.execute(`delete from public.rm_clock`)
await db.execute(`create or replace function app.now_utc() returns timestamptz language sql stable
  set search_path to 'pg_catalog' as $f$ select coalesce((select t from public.rm_clock limit 1), now()) $f$`)
/** Time is now `d` (or the real time when null). */
const setNow = async (d: Date | null) => {
  await db.execute(`delete from public.rm_clock`)
  if (d !== null) {
    await db.execute(
      `insert into public.rm_clock (t) values (${lit(d.toISOString())}::timestamptz)`,
    )
  }
}
const MIN = 60_000
const DAY = 86_400_000

// ---------------------------------------------------------------------------------------------------------------
// one deliberate sabotage, when asked for, proved to have landed
// ---------------------------------------------------------------------------------------------------------------
const defOf = async (sig: string) =>
  String((await one(`select pg_get_functiondef(${lit(sig)}::regprocedure) as d`)).d)
const SURVIVES = 'app.tasks_series_survives_completion()'
const SABOTAGES: Record<string, () => Promise<string>> = {
  // completion ends the series again: the trigger that holds the row open is gone
  ends: async () => {
    await db.execute(`drop trigger tasks_a_series_survives_completion on public.tasks`)
    const n = Number(
      (
        await one(
          `select count(*)::int as c from pg_trigger where tgname = 'tasks_a_series_survives_completion' and not tgisinternal`,
        )
      ).c,
    )
    return `trigger rows left: ${String(n)} (want 0)`
  },
  // completion creates a duplicate occurrence row
  duplicate: async () => {
    const d = await defOf(SURVIVES)
    const from =
      'new.remind_at := app.reminder_next_at(new.office_id, old.remind_at, new.repeat_every, v_now);'
    if (!d.includes(from)) return 'ANCHOR NOT FOUND'
    await db.execute(
      d.replace(
        from,
        () =>
          `${from} insert into public.tasks (office_id, title, state, assigned_to_human, added_by, repeat_every, remind_at) values (new.office_id, new.title, 'todo', true, new.added_by, new.repeat_every, new.remind_at);`,
      ),
    )
    return `definition now inserts a row: ${String((await defOf(SURVIVES)).includes('insert into public.tasks'))}`
  },
  // the stop action does not end the series
  stopnoop: async () => {
    const sig = 'app.reminder_series_stop(uuid, text, text)'
    const d = await defOf(sig)
    const from = "v := app.hq_task_state(p_office, p_task_id, 'cancelled', null, p_by);"
    if (!d.includes(from)) return 'ANCHOR NOT FOUND'
    await db.execute(d.replace(from, () => "v := jsonb_build_object('undo', null);"))
    return `definition no longer cancels: ${String(!(await defOf(sig)).includes("'cancelled', null, p_by"))}`
  },
  // an occurrence completed before it fired is no longer skipped
  noskip: async () => {
    const d = await defOf(SURVIVES)
    const from =
      'new.remind_at := app.reminder_next_at(new.office_id, old.remind_at, new.repeat_every, v_now);'
    if (!d.includes(from)) return 'ANCHOR NOT FOUND'
    await db.execute(d.replace(from, () => 'new.remind_at := old.remind_at;'))
    return `definition no longer advances: ${String(!(await defOf(SURVIVES)).includes('reminder_next_at(new.office_id, old.remind_at'))}`
  },
  // an occurrence completed while its delivery failed is said again
  refire: async () => {
    const sig = 'app.reminders_settle(uuid)'
    const d = await defOf(sig)
    const from = 'and not r.completed then'
    if (!d.includes(from)) return 'ANCHOR NOT FOUND'
    await db.execute(d.replace(from, () => 'then'))
    return `definition no longer reads completed: ${String(!(await defOf(sig)).includes('not r.completed'))}`
  },
  // a delivered occurrence is no longer recorded as fired, so completing it cannot find it
  nofired: async () => {
    const sig = 'app.reminder_finish(uuid, boolean)'
    const d = await defOf(sig)
    const from =
      'set last_fired_for = case when p_delivered then t.remind_at else last_fired_for end,'
    if (!d.includes(from)) return 'ANCHOR NOT FOUND'
    await db.execute(d.replace(from, () => 'set'))
    return `definition no longer records fired: ${String(!(await defOf(sig)).includes('last_fired_for = case'))}`
  },
}
if (sabotage !== '') {
  const make = SABOTAGES[sabotage]
  if (make === undefined) {
    console.log(`UNKNOWN SABOTAGE ${sabotage}; known: ${Object.keys(SABOTAGES).join(', ')}`)
    process.exit(2)
  }
  const proof = await make()
  console.log(`SABOTAGE ${sabotage}: ${proof}`)
  if (/ANCHOR NOT FOUND/.test(proof)) process.exit(2)
}

// ---------------------------------------------------------------------------------------------------------------
// the harness: the real handler, the real duty, the delivery layer's rows
// ---------------------------------------------------------------------------------------------------------------
const setZone = async (z: string) => {
  await db.execute(`update public.offices set timezone = ${lit(z)} where office_id = ${O}`)
}
await setZone(ATHENS)
const project = json(
  (
    await one(
      `select app.hq_create_project(${O}, ${lit(`Rm Ser ${run}`)}, 'upload', ${lit(`rm-ser-${run}`)}, ${lit(`Rm Ser ${run}`)}, true) as v`,
    )
  ).v,
)
const p1 = String(project.project_id)
const at = new Date()
const handler = instructionHandler({
  db,
  router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never,
  now: () => at,
})
let n = 0
const enqueue = async (said: string, forwarded = false): Promise<Job> => {
  n += 1
  const c = await one(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context)
    values (${O}, ${lit(p1)}::uuid, 'teamhq', ${lit(`rms${run}x${String(n)}:${String(n)}`)}, 'grant', ${lit(said)}, ${lit(`teamhq:message:rms${run}${String(n)}`)}, 'grant', ${lit(forwarded ? '{"forwarded":true}' : '{}')}::jsonb)
    returning command_id::text as id`)
  const v = json((await one(`select app.enqueue_inbound(${lit(String(c.id))}::uuid) as v`)).v)
  const jobId = String(v.job_id)
  const j = await one(
    `select job_id::text as id, kind, correlation_id::text as c, project_id::text as p, idempotency_key as k, office_id::text as o from public.jobs where job_id = ${lit(jobId)}::uuid`,
  )
  return {
    jobId: String(j.id),
    kind: String(j.kind),
    correlationId: String(j.c),
    projectId: j.p === null ? null : String(j.p),
    idempotencyKey: String(j.k),
    attempt: 1,
    officeId: String(j.o),
  } as Job
}
const say = async (said: string, forwarded = false) => {
  const job = await enqueue(said, forwarded)
  const out = await handler.handle(job, db)
  return { body: String((out as { body?: string }).body ?? ''), job, jobId: job.jobId }
}
const tick = async (job?: Job) => {
  const j = job ?? (await enqueue('tick'))
  const out = await remindersHandler(db).handle({ ...j, kind: 'tasks.remind' }, db)
  return { out, job: j }
}
const deliver = async (jobId: string, state: 'sent' | 'failed' | 'claimed') => {
  await db.execute(
    `insert into public.deliveries (office_id, channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, attempt, lease_expires_at, message_ref, sent_at, error_code)
     values (${O}, 'telegram', ${lit(`rms${run}:${jobId}:${state}:${String(Math.random())}`)}, '8967954396', '1386648496', 'result', ${lit(jobId)}::uuid, ${lit(state)}::slack_delivery_state, 1, now() + interval '2 minutes',
       ${state === 'sent' ? "'m-1'" : 'null'}, ${state === 'sent' ? 'now()' : 'null'}, ${state === 'failed' ? "'chat_not_found'" : 'null'})`,
  )
}
/** The duty runs; if it announced `title`, the delivery layer sends it; the NEXT tick settles it. */
const fire = async (title: string, outcome: 'sent' | 'failed' = 'sent') => {
  const j = await enqueue('tick')
  const r = await tick(j)
  const announced =
    r.out.announce === true && r.out.body.toLowerCase().includes(title.toLowerCase())
  if (announced) await deliver(j.jobId, outcome)
  const settled = await tick()
  return { announced, job: j.jobId, settledBody: settled.out.body }
}
const get = async (id: string) =>
  (
    await rows(
      `select title, state, remind_at, reminded_at, remind_job_id::text as job, remind_sends as sends, due_on::text as due, repeat_every::text as rep,
              last_fired_for, last_completed_for, last_completed_at, done_at from public.tasks where task_id = ${lit(id)}::uuid`,
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
const sentCount = async (jobs: string[]) =>
  jobs.length === 0
    ? 0
    : Number(
        (
          await one(
            `select count(*)::int as c from public.deliveries where state = 'sent' and job_id in (${jobs.map((x) => `${lit(x)}::uuid`).join(',')})`,
          )
        ).c,
      )
/** A reminder SERIES made directly: a title, a repeat, a reminder time, no due date. */
const mkSeries = async (title: string, every: string, remindAt: Date): Promise<string> => {
  const made = json(
    (
      await one(
        `select app.my_task_add(${O}, ${lit(title)}, '', null, ${lit(remindAt.toISOString())}::timestamptz) as v`,
      )
    ).v,
  )
  const set = json(
    (
      await one(
        `select app.my_task_set(${O}, ${lit(String(made.id))}, p_repeat_every => interval ${lit(every)}, p_repeat_from => 'done') as v`,
      )
    ).v,
  )
  if (set.ok !== true) throw new Error(`could not make a series: ${JSON.stringify(set)}`)
  return String(made.id)
}
const tickOff = async (id: string) =>
  json((await one(`select app.hq_task_state(${O}, ${lit(id)}, 'done', null, 'grant') as v`)).v)
const hm = (v: unknown, zone: string) => localClock(new Date(iso(v)), zone)

// ================================================================================================================
section('S0: a stop with NOTHING to stop says so and changes nothing (first, on a clean office)')
{
  await setNow(null)
  const before = Number(
    (await one(`select count(*)::int as c from public.tasks where office_id = ${O}`)).c,
  )
  const r = await say('Stop the recurring reminder.')
  const after = Number(
    (await one(`select count(*)::int as c from public.tasks where office_id = ${O}`)).c,
  )
  check(
    'no recurring reminder exists: the answer says there is none, and nothing was created or changed',
    /not stopped anything/.test(r.body) &&
      /no recurring reminders/.test(r.body) &&
      before === after,
    r.body.slice(0, 140),
  )
}

// ================================================================================================================
section('S1: the owner scenario, end to end, through the real handler and duty')
const s1 = { jobs: [] as string[], title: '', id: '' }
{
  await setNow(null)
  await setZone(ATHENS)
  const made = await say(`Remind me every Monday at 9am to review my finances ${run}.`)
  const t = (
    await rows(
      `select task_id::text as id, title, remind_at from public.tasks where job_id = ${lit(made.jobId)}::uuid`,
    )
  )[0] as Record<string, unknown>
  s1.id = String(t.id)
  s1.title = String(t.title)
  const occ1 = new Date(iso(t.remind_at))
  const d1 = localDay(occ1, ATHENS)
  check(
    'created as ONE series: a Monday 09:00 in the office zone, in the future',
    hm(t.remind_at, ATHENS) === '09:00' &&
      weekdayOf(d1.y, d1.m, d1.d) === 1 &&
      occ1.getTime() > Date.now(),
    iso(t.remind_at),
  )
  check(
    '...and the reply tells him how to stop it and that ticking completes that time only',
    /completes that time only/.test(made.body) && /stop the .+ reminder/.test(made.body),
    made.body.slice(0, 200),
  )
  const occ2 = wallClock(d1.y, d1.m, d1.d + 7, 9, 0, ATHENS)
  const occ3 = wallClock(d1.y, d1.m, d1.d + 14, 9, 0, ATHENS)

  // occurrence 1 fires: delivered once
  await setNow(new Date(occ1.getTime() + MIN))
  const f1 = await fire(s1.title)
  s1.jobs.push(f1.job)
  const a1 = await get(s1.id)
  check(
    'occurrence 1 fires and is delivered ONCE; the series advances in place to the next Monday 09:00',
    f1.announced &&
      (await sentCount(s1.jobs)) === 1 &&
      iso(a1.remind_at) === occ2.toISOString() &&
      iso(a1.last_fired_for) === occ1.toISOString() &&
      (await rowsTitled(s1.title)) === 1,
    JSON.stringify(a1),
  )

  // he completes occurrence 1 (typed, through the real handler)
  const done1 = await say(`Tick off the ${s1.title.toLowerCase()} task.`)
  const c1 = await get(s1.id)
  check(
    'completing occurrence 1 records it as done and the series STAYS: open, repeating, ONE row',
    c1.state === 'todo' &&
      c1.done_at === null &&
      String(c1.rep).startsWith('7 days') &&
      iso(c1.last_completed_for) === occ1.toISOString() &&
      c1.last_completed_at !== null &&
      (await rowsTitled(s1.title)) === 1,
    JSON.stringify(c1),
  )
  check(
    '...and says truthfully what it did: done for this time, still repeating, how to stop',
    /Done for this time/.test(done1.body) &&
      /still repeating/.test(done1.body) &&
      /stop the .+ reminder/.test(done1.body),
    done1.body.slice(0, 200),
  )
  check(
    'occurrence 2 REMAINS scheduled at the right office-zone time (Monday 09:00 Athens), unchanged by the completion',
    iso(c1.remind_at) === occ2.toISOString() && hm(c1.remind_at, ATHENS) === '09:00',
    iso(c1.remind_at),
  )
  const again = await fire(s1.title)
  check(
    'the completed occurrence is not fired again, and nothing duplicates',
    !again.announced && (await sentCount(s1.jobs)) === 1,
    again.settledBody.slice(0, 60),
  )

  // occurrence 2 fires
  await setNow(new Date(occ2.getTime() + MIN))
  const f2 = await fire(s1.title)
  s1.jobs.push(f2.job)
  const a2 = await get(s1.id)
  check(
    'occurrence 2 fires and is delivered once (two deliveries in all, never two for one occurrence)',
    f2.announced &&
      (await sentCount(s1.jobs)) === 2 &&
      iso(a2.remind_at) === occ3.toISOString() &&
      (await rowsTitled(s1.title)) === 1,
    JSON.stringify(a2),
  )

  // the explicit stop, in his words
  const stop = await say(`Stop the ${s1.title.toLowerCase()} reminder.`)
  const z = await get(s1.id)
  check(
    '"stop the ... reminder" ends the series: cancelled, says so, and offers the undo',
    z.state === 'cancelled' && /^Stopped/.test(stop.body) && /undo/.test(stop.body),
    `${String(z.state)} ${stop.body.slice(0, 120)}`,
  )
  // undo the stop straight away (an offer lapses with time): the series comes back whole
  const act = await one(
    `select action_id::text as id from public.undoable_actions where office_id = ${O} and kind = 'task.state' and description like ${lit(`${s1.title.slice(0, 40)}%`)} order by performed_at desc limit 1`,
  )
  const undone = json((await one(`select app.hq_undo(${O}, ${lit(String(act?.id ?? ''))}) as v`)).v)
  const back = await get(s1.id)
  check(
    'undoing the stop puts the series back whole: open, repeating, the same next time, one row',
    undone.ok === true &&
      back.state === 'todo' &&
      String(back.rep).startsWith('7 days') &&
      iso(back.remind_at) === occ3.toISOString() &&
      (await rowsTitled(s1.title)) === 1,
    JSON.stringify({ undone, back }),
  )
  await say(`Stop the ${s1.title.toLowerCase()} reminder.`)
  await setNow(new Date(occ3.getTime() + MIN))
  const f3 = await fire(s1.title)
  const z2 = await get(s1.id)
  check(
    'NO third firing: the next time is due and the duty does not say it; the row is no longer active; still one row, two deliveries',
    !f3.announced &&
      z2.state === 'cancelled' &&
      (await sentCount(s1.jobs)) === 2 &&
      (await rowsTitled(s1.title)) === 1,
    JSON.stringify(z2),
  )
  const open = json(
    (await one(`select app.my_tasks(${O}, 'all', 200, ${lit(s1.title)}, 'smart', true) as v`)).v,
  ) as unknown as { id: string }[]
  check(
    '...and the list no longer shows it (cancelled is not on the list)',
    !open.some((r) => r.id === s1.id),
    String(open.length),
  )
}

// ================================================================================================================
section(
  'S2: completing BEFORE the reminder fires SKIPS that time; in flight completes it; no duplicate row or firing',
)
{
  await setZone(ATHENS)
  // (c) not fired yet, time in the future
  const occ = wallClock(2027, 5, 7, 9, 0, ATHENS) // Monday 7 June 2027
  const next = wallClock(2027, 5, 14, 9, 0, ATHENS)
  await setNow(new Date(occ.getTime() - 2 * DAY))
  const title = `Skip before ${run}`
  const id = await mkSeries(title, '7 days', occ)
  const ticked = await tickOff(id)
  const sk = await get(id)
  check(
    'ticked off BEFORE it fires: the unfired time is SKIPPED (recorded as completed) and the series moves to the next time',
    ticked.series === true &&
      ticked.occurrence === 'skipped' &&
      sk.state === 'todo' &&
      iso(sk.remind_at) === next.toISOString() &&
      iso(sk.last_completed_for) === occ.toISOString() &&
      (await rowsTitled(title)) === 1,
    JSON.stringify({ ticked, sk }),
  )
  await setNow(new Date(occ.getTime() + MIN))
  const skipped = await fire(title)
  check('...and the skipped time NEVER fires', !skipped.announced, skipped.settledBody.slice(0, 60))
  await setNow(new Date(next.getTime() + MIN))
  const nextFire = await fire(title)
  check(
    '...while the time after it fires once and is delivered once',
    nextFire.announced &&
      (await sentCount([nextFire.job])) === 1 &&
      (await rowsTitled(title)) === 1,
    '',
  )

  // (c') due now, announced by nobody yet: skipped as well
  const occB = wallClock(2027, 6, 5, 9, 0, ATHENS) // Monday 5 July 2027
  const titleB = `Skip due ${run}`
  await setNow(new Date(occB.getTime() + 30 * MIN))
  const idB = await mkSeries(titleB, '7 days', occB)
  const tB = await tickOff(idB)
  const skB = await get(idB)
  check(
    'ticked off while due but not yet announced: skipped too, next time strictly after now, never fired',
    tB.occurrence === 'skipped' &&
      new Date(iso(skB.remind_at)).getTime() > occB.getTime() + 30 * MIN &&
      hm(skB.remind_at, ATHENS) === '09:00' &&
      !(await fire(titleB)).announced &&
      (await rowsTitled(titleB)) === 1,
    JSON.stringify(skB),
  )

  // (a) in flight: announced, delivery not yet settled
  const occC = wallClock(2027, 6, 12, 9, 0, ATHENS)
  const titleC = `Inflight ${run}`
  await setNow(new Date(occC.getTime() + MIN))
  const idC = await mkSeries(titleC, '7 days', occC)
  const jC = await enqueue('tick')
  const tC = await tick(jC)
  const announcedC = tC.out.announce === true && tC.out.body.includes(titleC)
  const cC = await tickOff(idC)
  const inflight = await get(idC)
  check(
    'completed while its message is in flight: THAT occurrence is the one completed; the series has not skipped a second time',
    announcedC &&
      cC.series === true &&
      cC.occurrence === 'recorded' &&
      iso(inflight.last_completed_for) === occC.toISOString() &&
      iso(inflight.remind_at) === occC.toISOString() &&
      inflight.job === jC.jobId,
    JSON.stringify(inflight),
  )
  await deliver(jC.jobId, 'sent')
  await tick()
  const settledC = await get(idC)
  check(
    '...the delivery then lands and the series advances once: one row, one delivery, next time a week on',
    iso(settledC.remind_at) === wallClock(2027, 6, 19, 9, 0, ATHENS).toISOString() &&
      iso(settledC.last_fired_for) === occC.toISOString() &&
      (await sentCount([jC.jobId])) === 1 &&
      (await rowsTitled(titleC)) === 1,
    JSON.stringify(settledC),
  )

  // (a') in flight, completed, and the delivery FAILS: never said again (he already did it), the series moves on
  const occD = wallClock(2027, 6, 26, 9, 0, ATHENS)
  const titleD = `Inflight failed ${run}`
  await setNow(new Date(occD.getTime() + MIN))
  const idD = await mkSeries(titleD, '7 days', occD)
  const jD = await enqueue('tick')
  await tick(jD)
  await tickOff(idD)
  await deliver(jD.jobId, 'failed')
  await tick()
  const afterD = await tick()
  const dd = await get(idD)
  check(
    'completed in flight and then the delivery FAILED: it is not re-sent (he already did it) and the series moves on',
    !afterD.out.body.includes(titleD) &&
      new Date(iso(dd.remind_at)).getTime() > occD.getTime() &&
      dd.job === null &&
      (await rowsTitled(titleD)) === 1,
    JSON.stringify(dd),
  )

  // (b) delivered, then ticked: records it; a SECOND tick before the next one fires skips that next one
  const occE = wallClock(2027, 8, 6, 9, 0, ATHENS)
  const titleE = `Twice ${run}`
  await setNow(new Date(occE.getTime() + MIN))
  const idE = await mkSeries(titleE, '7 days', occE)
  const fE = await fire(titleE)
  const t1 = await tickOff(idE)
  const afterOne = await get(idE)
  const t2 = await tickOff(idE)
  const afterTwo = await get(idE)
  check(
    'a delivered occurrence is completed (recorded); a second tick then skips the NEXT one (documented), still ONE row',
    fE.announced &&
      t1.occurrence === 'recorded' &&
      iso(afterOne.remind_at) === wallClock(2027, 8, 13, 9, 0, ATHENS).toISOString() &&
      t2.occurrence === 'skipped' &&
      iso(afterTwo.remind_at) === wallClock(2027, 8, 20, 9, 0, ATHENS).toISOString() &&
      (await rowsTitled(titleE)) === 1,
    JSON.stringify({
      t1: t1.occurrence,
      t2: t2.occurrence,
      a: iso(afterOne.remind_at),
      b: iso(afterTwo.remind_at),
    }),
  )
}

// ================================================================================================================
section(
  'S3: the state, not the writer: any writer that sets a series to done is held open; a repeating TASK keeps its meaning',
)
{
  await setNow(null)
  await setZone(ATHENS)
  const title = `Raw writer ${run}`
  const id = await mkSeries(title, '7 days', new Date(Date.now() + 3 * DAY))
  await db.execute(
    `update public.tasks set state = 'done', done_at = now(), completed_by = 'grant' where task_id = ${lit(id)}::uuid`,
  )
  const raw = await get(id)
  check(
    'a raw UPDATE to done (no sanctioned writer) does not end a series either: open, repeating, no done_at, one row',
    raw.state === 'todo' &&
      raw.done_at === null &&
      String(raw.rep).startsWith('7 days') &&
      (await rowsTitled(title)) === 1,
    JSON.stringify(raw),
  )
  // a repeating TASK (a due date) keeps its semantics: ticking it off makes ONE next occurrence
  const day = new Date().toISOString().slice(0, 10)
  const tTitle = `Dated repeat ${run}`
  const made = json(
    (await one(`select app.my_task_add(${O}, ${lit(tTitle)}, '', ${lit(day)}::date, null) as v`)).v,
  )
  await one(
    `select app.my_task_set(${O}, ${lit(String(made.id))}, p_repeat_every => interval '7 days', p_repeat_from => 'due') as v`,
  )
  await tickOff(String(made.id))
  const kids = await rows(
    `select state, due_on::text as due from public.tasks where office_id = ${O} and title = ${lit(tTitle)} order by created_at`,
  )
  check(
    'a repeating TASK with a due date: ticking it off completes it and makes exactly ONE next occurrence (unchanged by decision)',
    kids.length === 2 &&
      kids[0]?.state === 'done' &&
      kids[1]?.state === 'todo' &&
      kids[1]?.due !== kids[0]?.due,
    JSON.stringify(kids),
  )
  // a plain one-off reminder is still ended by ticking it off
  const oneOff = json(
    (
      await one(
        `select app.my_task_add(${O}, ${lit(`One off ${run}`)}, '', null, now() + interval '2 days') as v`,
      )
    ).v,
  )
  await tickOff(String(oneOff.id))
  check(
    'a one-off reminder is still simply done when ticked off',
    (await get(String(oneOff.id))).state === 'done',
    '',
  )
  // a cancelled series that is reopened with its time in the past is moved forward, never fired stale
  const sid = await mkSeries(`Reopen ${run}`, '1 day', new Date(Date.now() - 5 * DAY))
  await db.execute(`update public.tasks set state = 'cancelled' where task_id = ${lit(sid)}::uuid`)
  await db.execute(`update public.tasks set state = 'todo' where task_id = ${lit(sid)}::uuid`)
  const reopened = await get(sid)
  check(
    'a series reopened with its time in the past is moved to the future (no stale reminder at once)',
    new Date(iso(reopened.remind_at)).getTime() > Date.now() &&
      (await rowsTitled(`Reopen ${run}`)) === 1,
    JSON.stringify(reopened),
  )
}

// ================================================================================================================
section(
  'S4: the explicit stop: phrasings in his own words, no guess, no stop from a forwarded message, a gateway wrapper',
)
{
  await setNow(null)
  await setZone(ATHENS)
  const mk = async (title: string) => mkSeries(title, '7 days', new Date(Date.now() + 9 * DAY))
  const ids = {
    fin: await mk(`Review my finances ${run}b`),
    rota: await mk(`Check the rota ${run}`),
    pay: await mk(`Review payroll ${run}`),
    bins: await mk(`Book the plumber ${run}`),
  }
  const states = async () =>
    Object.fromEntries(
      await Promise.all(
        Object.entries(ids).map(async ([k, v]) => [k, String((await get(v)).state)]),
      ),
    ) as Record<string, string>
  const allOpen = (s: Record<string, string>) => Object.values(s).every((v) => v === 'todo')

  const bare = await say('Stop the recurring reminder.')
  check(
    'a bare "stop the recurring reminder" with several on the list asks which and stops NONE',
    /Which recurring reminder/.test(bare.body) && allOpen(await states()),
    bare.body.slice(0, 160),
  )
  const two = await say('Cancel the recurring reminder to review.')
  check(
    'a name that fits TWO series ("review my finances" and "review payroll") asks which and stops NONE',
    /Which recurring reminder/.test(two.body) &&
      /finances/.test(two.body) &&
      /payroll/.test(two.body) &&
      allOpen(await states()),
    two.body.slice(0, 200),
  )
  const none = await say('End the recurring reminder about pottery.')
  check(
    'a name that fits NO series says so, lists what he has, and stops NONE',
    /could not find one recurring reminder/.test(none.body) && allOpen(await states()),
    none.body.slice(0, 200),
  )
  const fwd = await say(`Stop the check the rota ${run} reminder.`, true)
  check(
    'a FORWARDED message never stops a series (nobody asked for anything)',
    !/^Stopped/.test(fwd.body) && allOpen(await states()),
    fwd.body.slice(0, 120),
  )
  const q = await say('Why did you stop the check the rota reminder?')
  const neg = await say(`Do not stop the check the rota ${run} reminder.`)
  check(
    'a question about it, and a prohibition, stop nothing',
    !/^Stopped/.test(q.body) && !/^Stopped/.test(neg.body) && allOpen(await states()),
    `${q.body.slice(0, 60)} | ${neg.body.slice(0, 60)}`,
  )
  const creates = await say(`Remind me every Monday to stop the bins ${run}.`)
  check(
    'a request for a NEW reminder whose words contain "stop" creates one and stops none',
    !/^Stopped/.test(creates.body) && /on your list/.test(creates.body) && allOpen(await states()),
    creates.body.slice(0, 120),
  )
  const phrases: [string, keyof typeof ids][] = [
    [`Stop the check the rota ${run} reminder.`, 'rota'],
    [`Cancel the recurring reminder to review payroll ${run}.`, 'pay'],
    [`Please stop reminding me about the plumber ${run}.`, 'bins'],
    [`End the recurring reminder to review my finances ${run}b.`, 'fin'],
  ]
  for (const [said, key] of phrases) {
    const before = await states()
    const r = await say(said)
    const after = await states()
    check(
      `"${said}" stops exactly that series (${key}) and no other`,
      /^Stopped/.test(r.body) &&
        after[key] === 'cancelled' &&
        Object.entries(after).every(([k, v]) => k === key || v === before[k]),
      r.body.slice(0, 100),
    )
  }
  // a one-off reminder named with "stop" is not a series: nothing is touched
  const oneTitle = `Roofer call ${run}`
  const oo = json(
    (
      await one(
        `select app.my_task_add(${O}, ${lit(oneTitle)}, '', null, now() + interval '2 days') as v`,
      )
    ).v,
  )
  const live = await mk(`Water rota ${run}`)
  const rr = await say(`Stop the roofer call ${run} reminder.`)
  check(
    'a one-off reminder is not a series: "stop the roofer call reminder" touches neither it nor any series',
    !/^Stopped/.test(rr.body) &&
      (await get(String(oo.id))).state === 'todo' &&
      (await get(live)).state === 'todo',
    rr.body.slice(0, 160),
  )
  // the gateway wrapper (the dashboard control presses this)
  const wrapRefuses = json(
    (await one(`select public.reminder_series_stop(${O}, ${lit(String(oo.id))}) as v`)).v,
  )
  const wrapOk = json((await one(`select public.reminder_series_stop(${O}, ${lit(live)}) as v`)).v)
  const wrapAgain = json(
    (await one(`select public.reminder_series_stop(${O}, ${lit(live)}) as v`)).v,
  )
  check(
    'the gateway wrapper: stops a series (with an undo offer), refuses a one-off by name, and refuses a second stop',
    wrapOk.ok === true &&
      typeof wrapOk.undo === 'string' &&
      wrapRefuses.ok === false &&
      /not a recurring reminder/.test(String(wrapRefuses.error)) &&
      wrapAgain.ok === false &&
      /already ended/.test(String(wrapAgain.error)) &&
      (await get(String(oo.id))).state === 'todo',
    JSON.stringify({ wrapOk, wrapRefuses, wrapAgain }),
  )
}

// ================================================================================================================
section(
  'S5: the clock changes (both directions, three zones) and the calendar edges: the same local time every time',
)
{
  // zone, label, year, month (zero-based), day, repeat, days the repeat is
  type Case = [string, string, number, number, number, string, number]
  const cases: Case[] = [
    [ATHENS, 'Athens spring forward (Sat 28 -> Sun 29 March 2026)', 2026, 2, 28, '1 day', 1],
    [ATHENS, 'Athens fall back (Sat 24 -> Sun 25 October 2026)', 2026, 9, 24, '1 day', 1],
    [ATHENS, 'Athens weekly over the spring change (22 -> 29 Mar 2026)', 2026, 2, 22, '7 days', 7],
    ['America/New_York', 'New York spring forward (7 -> 8 Mar 2026)', 2026, 2, 7, '1 day', 1],
    ['America/New_York', 'New York fall back (31 Oct -> 1 Nov 2026)', 2026, 9, 31, '1 day', 1],
    ['Pacific/Auckland', 'Auckland spring forward (26 -> 27 Sep 2026)', 2026, 8, 26, '1 day', 1],
    ['Pacific/Auckland', 'Auckland fall back (Sat 3 -> Sun 4 April 2027)', 2027, 3, 3, '1 day', 1],
    ['Pacific/Auckland', 'Auckland weekly over fall back (28 Mar)', 2027, 2, 28, '7 days', 7],
    [ATHENS, 'month end (Sat 31 Jan -> Sun 1 Feb 2026)', 2026, 0, 31, '1 day', 1],
    [ATHENS, 'year end (Thu 31 Dec 2026 -> Fri 1 Jan 2027)', 2026, 11, 31, '1 day', 1],
    [ATHENS, 'February, non-leap (28 Feb -> 1 March 2027)', 2027, 1, 28, '1 day', 1],
    [ATHENS, 'February, leap year (28 -> 29 Feb 2028)', 2028, 1, 28, '1 day', 1],
    [ATHENS, 'February, leap year (29 Feb -> 1 March 2028)', 2028, 1, 29, '1 day', 1],
    [ATHENS, 'weekly across a month end (30 March -> 6 April 2027)', 2027, 2, 30, '7 days', 7],
  ]
  let i = 0
  for (const [zone, label, y, m, d, every, days] of cases) {
    i += 1
    await setZone(zone)
    const occ = wallClock(y, m, d, 9, 0, zone)
    const want = wallClock(y, m, d + days, 9, 0, zone)
    const crosses = offsetMinutes(occ, zone) !== offsetMinutes(want, zone)
    // by DELIVERY
    const title = `Clock ${String(i)} ${run}`
    await setNow(new Date(occ.getTime() + MIN))
    const id = await mkSeries(title, every, occ)
    const f = await fire(title)
    const adv = await get(id)
    check(
      `${label}: fires once and moves to ${hm(want, zone)} local, ${String(days)} day(s) on${crosses ? ' (the UTC offset changed)' : ''}`,
      f.announced &&
        iso(adv.remind_at) === want.toISOString() &&
        hm(adv.remind_at, zone) === '09:00' &&
        (await sentCount([f.job])) === 1 &&
        (await rowsTitled(title)) === 1,
      `${iso(adv.remind_at)} want ${want.toISOString()}`,
    )
    // by SKIP (ticked off before it fired), on the same boundary
    const sTitle = `Clock skip ${String(i)} ${run}`
    await setNow(new Date(occ.getTime() - 3 * 3_600_000))
    const sid = await mkSeries(sTitle, every, occ)
    const t = await tickOff(sid)
    const sk = await get(sid)
    check(
      `${label}: ticked off before it fired it is SKIPPED to the same local time`,
      t.occurrence === 'skipped' &&
        iso(sk.remind_at) === want.toISOString() &&
        hm(sk.remind_at, zone) === '09:00' &&
        (await rowsTitled(sTitle)) === 1,
      `${iso(sk.remind_at)} want ${want.toISOString()}`,
    )
  }
  await setZone(ATHENS)
}

// ================================================================================================================
section('S6: a long outage fires ONCE, not a backlog, and the next time is the next local 09:00')
{
  await setZone(ATHENS)
  await setNow(null)
  const title = `Outage ${run}`
  const today = localDay(new Date(), ATHENS)
  const id = await mkSeries(title, '1 day', wallClock(today.y, today.m, today.d - 30, 9, 0, ATHENS))
  const f = await fire(title)
  const a = await get(id)
  const ahead = new Date(iso(a.remind_at)).getTime() - Date.now()
  check(
    'thirty missed days are ONE announcement and ONE delivery; the next time is within a day at 09:00 local; one row',
    f.announced &&
      (await sentCount([f.job])) === 1 &&
      ahead > 0 &&
      ahead <= 25 * 3_600_000 &&
      hm(a.remind_at, ATHENS) === '09:00' &&
      (await rowsTitled(title)) === 1,
    JSON.stringify(a),
  )
  const quiet = await fire(title)
  check(
    '...and the next tick does not say it again',
    !quiet.announced,
    quiet.settledBody.slice(0, 60),
  )
}

await setNow(null)
console.log(`\n${String(total - failed)}/${String(total)} PROVEN (${String(failed)} FAILED)`)
await db.end()
process.exit(failed === 0 ? 0 : 1)

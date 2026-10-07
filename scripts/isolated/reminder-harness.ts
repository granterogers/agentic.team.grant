/**
 * A reminder reaches a REAL person's task and never a harness's (critical gate; the sabotage run found no proof said so).
 *
 *   npx tsx scripts/isolated/reminder-harness.ts <replica-db>
 *
 * `app.reminders_due` is what the tasks.remind duty asks every fifteen minutes; what it returns is pinged to a real phone.
 * Migration 0597 made it skip a HARNESS task (one made by a harness job, which `is_fixture` alone cannot see because
 * `app.my_task_add` writes added_by 'grant' whoever asked). The gate's sabotage of exactly that filter turned nothing red:
 * the reminder proofs assert that a reminder FIRES, and none asserted that a test task's does NOT. This does, beside the
 * controls that show the reader still returns what it should (a filter that returns nothing passes a "not listed" check):
 *
 *   - a real person's task, due an hour ago, IS listed (the positive control);
 *   - the same task made by a harness job is NOT listed (the property);
 *   - a done task, a cancelled task, a future reminder and an already-reminded task are not listed (the reader is still a
 *     reader, not a wall);
 *   - another office's due reminder is never in this office's answer (the isolation neighbour).
 *
 * The real writers throughout (app.my_task_add, app.provision_person_office); nothing is sent anywhere.
 */
import { scopeOf } from './fixtures-jobs.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'reminder_harness')
const run = Date.now().toString(36)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const json = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
let failed = 0
const check = (what: string, ok: boolean, detail: string): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

const op = String((await one('select app.operator_office()::text as o')).o)

/** The real writer. A reminder in the past is not accepted by every build, so the time is set after creation if need be. */
const task = async (office: string, title: string, job?: string): Promise<string> => {
  const r = json(
    (
      await one(
        `select app.my_task_add(p_office => ${lit(office)}::uuid, p_title => ${lit(title)}, p_remind_at => now() + interval '1 hour', p_job => ${job === undefined ? 'null' : `${lit(job)}::uuid`}) as r`,
      )
    ).r,
  )
  const id = String(r.id ?? '')
  if (id === '') throw new Error(`my_task_add refused ${title}: ${JSON.stringify(r)}`)
  return id
}
const dueAnHourAgo = (id: string): Promise<unknown> =>
  db.execute(
    `update public.tasks set remind_at = now() - interval '1 hour', reminded_at = null where task_id = ${lit(id)}::uuid`,
  )
const listed = async (office: string): Promise<string[]> => {
  const r = json({ v: (await one(`select app.reminders_due(${lit(office)}::uuid) as v`)).v })
  return (r.v as { title: string }[]).map((x) => x.title)
}

// a harness JOB in the operator's office: harness by its requester's name (is_fixture is generated from it)
const s = scopeOf('real')
const harnessJob = String(
  (
    await one(`insert into public.jobs (${s.cols}, kind, requested_by, idempotency_key, correlation_id)
      values (${s.vals}, 'verify.remind', ${lit(`teamhq:verify-reminder-${run}`)}, ${lit(`rh-${run}-${crypto.randomUUID()}`)}, gen_random_uuid())
      returning job_id::text as id`)
  ).id,
)
const isHarness = (await one(`select app.harness_job(${lit(harnessJob)}::uuid) as h`)).h === true
check(
  'the harness job IS a harness job to the product (the fixture is what it claims to be)',
  isHarness,
  String(isHarness),
)

const real = await task(op, `Real reminder ${run}`)
const fake = await task(op, `Harness reminder ${run}`, harnessJob)
const done = await task(op, `Done reminder ${run}`)
const cancelled = await task(op, `Cancelled reminder ${run}`)
await task(op, `Future reminder ${run}`) // left with its reminder an hour ahead
const spent = await task(op, `Already reminded ${run}`)
for (const id of [real, fake, done, cancelled, spent]) await dueAnHourAgo(id)
await db.execute(`update public.tasks set state = 'done' where task_id = ${lit(done)}::uuid`)
await db.execute(
  `update public.tasks set state = 'cancelled' where task_id = ${lit(cancelled)}::uuid`,
)
await db.execute(`update public.tasks set reminded_at = now() where task_id = ${lit(spent)}::uuid`)

const wasFake = await one(
  `select app.harness_task(is_fixture, job_id) as h from public.tasks where task_id = ${lit(fake)}::uuid`,
)
check(
  'the task the harness job made reads as a harness task, and the real one does not (the two fixtures differ in the one way that matters)',
  wasFake.h === true &&
    (
      await one(
        `select app.harness_task(is_fixture, job_id) as h from public.tasks where task_id = ${lit(real)}::uuid`,
      )
    ).h === false,
  `harness task: ${String(wasFake.h)}`,
)

const titles = await listed(op)
check(
  "POSITIVE CONTROL: a real person's due reminder IS listed",
  titles.includes(`Real reminder ${run}`),
  titles.join(' | ').slice(0, 200),
)
check(
  "a HARNESS task's due reminder is NOT listed (it would be pinged to a real phone)",
  !titles.includes(`Harness reminder ${run}`),
  titles.includes(`Harness reminder ${run}`) ? 'LISTED' : 'not listed',
)
check('a done task is not listed', !titles.includes(`Done reminder ${run}`), 'not listed')
check('a cancelled task is not listed', !titles.includes(`Cancelled reminder ${run}`), 'not listed')
check(
  'a reminder an hour in the future is not listed',
  !titles.includes(`Future reminder ${run}`),
  'not listed',
)
check(
  'a reminder already sent is not listed again',
  !titles.includes(`Already reminded ${run}`),
  'not listed',
)

// the isolation neighbour: another person's due reminder is never in this office's answer
const email = `rh.${run}@example.com`
await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
const other = String(
  json(
    (
      await one(
        `select app.provision_person_office(${lit(`Reminder B ${run}`)}, ${lit(email)}, ${lit(`rh-b-${run}`)}) as r`,
      )
    ).r,
  ).office_id,
)
const theirs = await task(other, `Their reminder ${run}`)
await dueAnHourAgo(theirs)
const mine = await listed(op)
const their = await listed(other)
check(
  "another office's due reminder is not in this office's answer, and is in its own",
  !mine.includes(`Their reminder ${run}`) && their.includes(`Their reminder ${run}`),
  `mine ${String(mine.length)}, theirs ${String(their.length)}`,
)

await db.end()
console.log(
  `\n${failed === 0 ? 'all' : String(failed)} check(s) ${failed === 0 ? 'passed' : 'FAILED'}`,
)
process.exitCode = failed === 0 ? 0 : 1

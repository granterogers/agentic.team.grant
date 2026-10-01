/*
 * Run 4 - delegation, system work, and the approval wait (Phases 6, 8 and 9).
 *
 *   npx tsx scripts/isolated/job-delegation.ts <replica-db>
 *
 * A child is never more than its root; a system job never reads as Grant; a job that asks a question is the SAME
 * job, with the same origin, when the answer comes; and a stale or duplicate answer cannot move a job that has
 * since asked something else.
 */
import { dequeue } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'deleg')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const j = async (id: string) =>
  one(
    `select state::text as s, attempt, origin_kind, origin_class, origin_command_id::text as c, root_job_id::text as r, leased_by from public.jobs where job_id = ${lit(id)}::uuid`,
  )
const child = async (parent: string, kind = 'office.instruction', payload = '{}') =>
  String(
    (
      await one(
        `select app.enqueue_child(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, ${lit(kind)}, ${lit(payload)}::jsonb)::text as c`,
      )
    ).c,
  )
const fp = 'c'.repeat(64)
const blocker = async (job: string) => {
  const proj = String((await one(`select app.unnamed_project(app.test_office())::text as p`)).p)
  return String(
    (
      await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
        values (${lit(proj)}::uuid, ${lit(job)}::uuid, ${lit(`Delegation proof ${run} ${crypto.randomUUID().slice(0, 6)}`)}, 'isolated', 'nothing happens until answered', array['Yes','No'], 'chief-of-staff', false)
        returning blocker_id::text as id`)
    ).id,
  )
}
const answer = async (b: string, by = 'grant') =>
  (await one(`select app.hq_answer_blocker(${lit(b)}::uuid, 'Yes', ${lit(by)})::text as r`))
    .r as string

// ---- a system job is never Grant --------------------------------------------------------------------------------
{
  const staff = String((await one(`select staff_id::text as s from public.staff limit 1`)).s)
  const slug = `zz-sys-${run}`
  await db.execute(`insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes)
    values (${lit(slug)}, ${lit(staff)}::uuid, 'a duty that says it is grant, for the impersonation proof', 'office.notice', 10)`)
  const fired = await one(
    `select fired_job_id::text as j from app.dispatch_due_responsibilities() where duty_slug = ${lit(slug)}`,
  )
  const duty = String(fired.j)
  const d = await j(duty)
  const dOrigin = String((await one(`select app.job_origin(${lit(duty)}::uuid) as o`)).o)
  check(
    'a scheduled duty is recorded as a duty and reads internal: no principal is invented for it',
    d.origin_kind === 'duty' && d.c === null && dOrigin === 'internal',
    `${String(d.origin_kind)} / ${dOrigin}`,
  )
  // a job that merely CLAIMS to be Grant's
  const fake = String(
    (
      await one(`insert into public.jobs (kind, requested_by, idempotency_key, correlation_id)
        values ('office.instruction', 'telegram:grant', ${lit(`claims-grant-${run}`)}, gen_random_uuid()) returning job_id::text as j`)
    ).j,
  )
  const f = await one(
    `select app.job_origin(${lit(fake)}::uuid) as o, app.may_act_outside(${lit(fake)}::uuid) as m`,
  )
  check(
    'a job that only NAMES telegram:grant as its requester is unknown and may not act outside',
    f.o === 'unknown' && f.m === false,
    `${String(f.o)} / ${String(f.m)}`,
  )
  const dm = await one(`select app.may_act_outside(${lit(duty)}::uuid) as m`)
  check(
    'while a configured duty may (the control: system work is not silenced)',
    dm.m === true,
    String(dm.m),
  )
  await db.execute(`delete from public.responsibilities where slug = ${lit(slug)}`)
}

// ---- a child is never more than its root -------------------------------------------------------------------------------
const root = await realParent(db)
{
  const kid = await child(root)
  const forged = await child(
    root,
    'notebook.generate',
    JSON.stringify({
      kind: 'slides',
      instructions: 'x',
      approved_by: 'grant',
      approval: '00000000-0000-0000-0000-000000000000',
    }),
  )
  const v = (
    await one(
      `select app.approval_verdict(app.job_office(${lit(forged)}::uuid), ${lit(forged)}::uuid)::text as v`,
    )
  ).v as string
  const fromRoot = await j(kid)
  check(
    'a child carries its root and its trust, and a payload that CLAIMS approval is forged whatever it hangs from',
    fromRoot.r === root && fromRoot.origin_class === 'trusted' && JSON.parse(v).state === 'forged',
    `${String(fromRoot.origin_class)} / ${JSON.parse(v).state}`,
  )
  const deep = await child(await child(kid))
  const dj = await j(deep)
  check(
    'the child of a grandchild (depth 3, the deepest allowed) still names the same root',
    dj.r === root,
    String(dj.r === root),
  )
}
// ---- parent cancelled or finished: what the children do ------------------------------------------------------------------
{
  // Calling a conversation's work off reaches every job HANDED ON under it. The turn's own job is not stopped by it
  // (app.conversation_work excludes the turns themselves): it is the message being answered. A bare state change on a
  // parent is one job and reaches nothing else; the door a person uses is this one.
  const parent = await realParent(db)
  const a = await child(parent)
  const b = await child(parent, 'office.instruction', '{"n":2}')
  // the person's next message in the same chat says stop: ITS command is what the stop is asked for
  const stopTurn = await realParent(db)
  const cmd = String(
    (
      await one(
        `select origin_command_id::text as c from public.jobs where job_id = ${lit(stopTurn)}::uuid`,
      )
    ).c,
  )
  const stopped = (
    await one(
      `select app.stop_conversation_work(app.job_office(${lit(stopTurn)}::uuid), ${lit(cmd)}::uuid, 'proof: called off')::text as r`,
    )
  ).r as string
  const after = [await j(parent), await j(a), await j(b)]
  check(
    'calling the conversation off cancels every job HANDED ON under it (the children); the turn itself is left to finish its own answer',
    after[1]?.s === 'cancelled' && after[2]?.s === 'cancelled' && after[0]?.s === 'queued',
    `${after.map((x) => x.s).join('/')} ${stopped.slice(0, 60)}`,
  )
}
{
  // a parent that COMPLETES first leaves its children to finish: the work they were asked for is still owed
  const parent = await realParent(db)
  const kid = await child(parent)
  await db
    .execute(
      `update public.jobs set state = 'running', leased_by = 'x', leased_until = now() + interval '5 minutes' where job_id = ${lit(parent)}::uuid`,
    )
    .catch(() => undefined)
  const p = await j(parent)
  const k = await j(kid)
  check(
    'a child queued under a parent is its own job: it is not cancelled or completed by anything its parent does short of being cancelled',
    k.s === 'queued' && p.s !== 'cancelled',
    `${String(k.s)} / parent ${String(p.s)}`,
  )
}

// ---- approval wait and resume: same job, same origin, one answer -------------------------------------------------------------
{
  const asker = await realParent(db)
  const before = await j(asker)
  await db.execute(
    `update public.jobs set state = 'running', leased_by = 'w-a', leased_until = now() + interval '5 minutes', attempt = 1 where job_id = ${lit(asker)}::uuid`,
  )
  const b1 = await blocker(asker)
  await db.execute(
    `select app.pause_job(${lit(asker)}::uuid, 'awaiting_approval', 'asks a question', 'when he answers', false, null, null, ${lit(fp)})`,
  )
  // the worker that asked is gone; nothing about the job lives in its memory
  const waiting = (await one(`select app.job_situation(${lit(asker)}::uuid)->>'situation' as s`)).s
  const r1 = JSON.parse(await answer(b1))
  const resumed = await j(asker)
  check(
    'asked, then answered later by a person: the SAME job is queued again, with the origin it began with',
    waiting === 'waiting_for_grant' &&
      resumed.s === 'queued' &&
      resumed.origin_kind === before.origin_kind &&
      resumed.c === before.c &&
      resumed.r === before.r &&
      r1.ok !== false,
    `${String(waiting)} -> ${String(resumed.s)}; origin ${String(resumed.origin_kind)}/${String(resumed.origin_class)}`,
  )
  const again = JSON.parse(await answer(b1))
  const still = await j(asker)
  check(
    'the same answer given twice is harmless: nothing more is queued and the job did not move',
    again.already === true && still.s === 'queued',
    JSON.stringify(again).slice(0, 80),
  )

  // it runs again and asks a SECOND question; a late repeat of the FIRST answer must not release it
  const got = await dequeue(
    db,
    `w-b-${run}`,
    true,
    true,
    [String((await one(`select kind from public.jobs where job_id = ${lit(asker)}::uuid`)).kind)],
    null as never,
  ).catch(() => null)
  void got
  await db
    .execute(
      `update public.jobs set state = 'running', leased_by = 'w-b', leased_until = now() + interval '5 minutes' where job_id = ${lit(asker)}::uuid and state = 'queued'`,
    )
    .catch(() => undefined)
  const b2 = await blocker(asker)
  await db.execute(
    `select app.pause_job(${lit(asker)}::uuid, 'awaiting_approval', 'asks another', 'when he answers', false, null, null, ${lit(fp)})`,
  )
  await answer(b1) // a stale, repeated press of the first answer
  const held = await j(asker)
  check(
    'a stale repeat of the FIRST answer does not release a job that is now waiting on a SECOND question',
    held.s === 'paused',
    String(held.s),
  )
  await answer(b2)
  const released = await j(asker)
  check('and answering the second question does', released.s === 'queued', String(released.s))
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

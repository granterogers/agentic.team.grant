/**
 * #379 / #380 (0604) — a task harness work created never becomes an event in
 * Grant's real calendar or a line in his briefing.
 *
 *   npx tsx scripts/isolated/task-content-containment.ts <replica-db>
 *
 * The duties that carry task CONTENT outward are trusted work, so the origin
 * boundary (0603) rightly lets them run. What they carry must be filtered by
 * the same canonical question the reminders already ask: app.harness_task.
 *
 * Each task is made by the real writer, app.task_add, under a real job: one
 * started by a harness voice-door session (harness by the canonical predicate,
 * real by tasks.is_fixture), one by a real Telegram turn.
 */
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'task379')
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const jsonOf = (v: unknown) =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

const project = String(
  jsonOf(
    (
      await one(`select app.hq_create_project(app.test_office(), ${lit(`Tasks ${run}`)}, 'upload', ${lit(`tasks-${run}`)},
        ${lit(`Tasks ${run}`)}, true) as v`)
    ).v,
  ).project_id,
)
const cmd = await one(`set local application_name = 'PostgREST 14.5';
  insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
  values ('voice', ${lit(`verify-379t-${run}/x:1`)}, 'grant', 'harness asks for a task', ${lit(`voice:turn:verify-379t-${run}.1`)}, 'grant')
  returning command_id::text as id`)
const harnessJob = String(
  jsonOf((await one(`select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)).v).job_id,
)
const realJob = await realParent(db)

/*
  The writer that lets harness work through: app.blocker_makes_a_task (a
  trigger) files a task for a blocker that stops a job, with added_by the
  originating agent -- so tasks.is_fixture says real whatever the job was. It
  sets no due date and assigns it to him; a date given later, and the task
  handed to nobody (the dashboard's edit does both), is what puts it in the
  calendar plan and in the briefing's unowned-deadline line.
  app.task_add, by contrast, already relabels a harness job's task.
*/
const blockerTask = async (title: string, job: string) => {
  await db.execute(`insert into public.blockers (job_id, project_id, requested_action, why_needed, consequences_of_delay,
      approval_options, originating_agent, work_can_continue)
    values (${lit(job)}::uuid, ${lit(project)}::uuid, ${lit(title)}, 'An isolated proof needs an answer before it can go on.', 'The isolated proof stays paused until somebody answers it.',
            array['Go ahead'], 'chief-of-staff', false)`)
  await db.execute(
    `update public.tasks set due_on = current_date + 2, assigned_to_human = false where title = ${lit(title)}`,
  )
}
await blockerTask(`Harness task ${run}`, harnessJob)
await blockerTask(`Real task ${run}`, realJob)
const pre = await one(`select count(*)::int as n,
    bool_and(app.harness_task(t.is_fixture, t.job_id) = (t.title like 'Harness%')) and bool_and(not t.is_fixture) as ok
  from public.tasks t where t.title like ${lit(`% task ${run}`)} and t.due_on is not null`)
check(
  'precondition: harness by app.harness_task, real by tasks.is_fixture',
  pre.ok === true && pre.n === 2,
  `${String(pre.n)} tasks, ${String(pre.ok)}`,
)

const plan = jsonOf((await one('select app.calendar_task_plan() as p')).p) as {
  create: { title: string }[]
}
const planned = (t: string) => plan.create.some((r) => r.title === t)
check(
  "a harness task is not planned for Grant's calendar",
  !planned(`Harness task ${run}`),
  JSON.stringify(plan.create.map((r) => r.title)),
)
check('control: a real task is', planned(`Real task ${run}`), 'planned')

const notices = (await db.execute('select body from app.notice(50)')).rows.map((r) =>
  String(r.body),
)
check(
  'a harness task is not in his briefing',
  !notices.some((b) => b.includes(`Harness task ${run}`)),
  `${String(notices.length)} notices`,
)
check(
  'control: a real unowned deadline is',
  notices.some((b) => b.includes(`Real task ${run}`)),
  notices.find((b) => b.includes(run)) ?? 'none',
)

const failed = results.filter((x) => !x.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)

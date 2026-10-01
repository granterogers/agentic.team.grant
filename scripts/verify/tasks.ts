/**
 * Does the task system actually work?
 *
 *   npm run verify:tasks
 *
 * Exercises the LIVE task API against the real database — creating, reading,
 * moving and constraining real rows — rather than reading the SQL back and
 * concluding it looks right.
 *
 * ## Which API, and why this file was rewritten
 *
 * There were two families. `app.add_task`, `app.project_tasks` and
 * `app.set_task_state` came first; `app.task_add`, `app.hq_task_state` and
 * `app.studio_tasks` superseded them and are what the gateway exposes and the
 * studio's Tasks tab presses. Migrations 0454-0456 removed the superseded
 * family after `check:callers` proved each half dead, and this suite was the
 * only thing still driving it — which is precisely the shape #272 exists to
 * remove: a capability whose only caller is the test of that capability.
 *
 * So the checks below press what Grant presses. Two of them changed meaning in
 * the move and the comments say so, because the new API answers with a JSONB
 * `error` where the old one raised.
 *
 * ## The two halves, and why they use different subjects
 *
 * `app.studio_tasks` filters `not is_fixture` — so a suite whose tasks are all
 * fixtures cannot assert that the reader finds them (#45), and a suite whose
 * tasks are all real cannot assert that fixtures stay out of Grant's view.
 * Both halves are needed, so there are two subjects: a fixture project for the
 * writer, the constraints and the triggers, and a real, paused, torn-down one
 * for the reader.
 *
 * The checks that matter are the NEGATIVE ones. Anyone can insert a row; the
 * question is whether the constraints refuse the things Grant's IA says are
 * impossible — a blocked task with no stated reason, a completed task with no
 * completion time, an assignee who does not exist.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}

/** A statement that is SUPPOSED to fail. Returns true when it did. */
const refuses = async (what: string, sql: string) => {
  try {
    await db.execute(sql)
    ok(what, false, 'it was allowed')
  } catch {
    ok(what, true)
  }
}

const one = async (sql: string): Promise<Record<string, unknown>> => {
  const { rows } = await db.execute(sql)
  return (rows as Record<string, unknown>[])[0] ?? {}
}

const asJson = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

/*
  A refusal the new API expresses as an answer rather than an exception.

  `app.task_add` and `app.hq_task_state` return `{"error": "..."}` — deliberately,
  because the gateway hands that straight to a person and an exception would
  reach them as "something went wrong". A check that merely asserted "something
  came back" would pass on a SUCCESS, so this asserts the sentence: CLAUDE.md
  records a refusal for the wrong reason looking exactly like the rule working.
*/
const answersWithError = async (what: string, sql: string, phrase: string) => {
  const got = asJson((await one(sql)).v)
  const said = String(got.error ?? '')
  ok(what, said.toLowerCase().includes(phrase.toLowerCase()), `said ${JSON.stringify(got)}`)
}

console.log('tasks —')

/*
  A fixture project to hang the writer and the constraints off.

  `status: 'paused'`, not 'active'. ADR-0014 refuses an active project with no
  enabled attachment — *"a project reads from and writes to somewhere real"* —
  and it is enforced by a trigger, not a convention. A verification fixture has
  nothing real attached and should not pretend otherwise, so it stays paused.
  That invariant catching this script is the invariant working.
*/
const proj = await one(`
  insert into public.projects (slug, name, purpose, status)
  values ('verify-tasks-fixture', 'Task verification', 'Thrown away', 'paused')
  on conflict (office_id, slug) do update set name = excluded.name
  returning project_id
`)
const pid = String(proj.project_id)

// --- the happy path ---------------------------------------------------------
const made = asJson(
  (
    await one(`
  select public.task_add(
    p_project := '${pid}'::uuid,
    p_title := 'Conduct first five interviews',
    p_detail := 'From the corpus',
    p_due_on := '2026-09-16'::date,
    p_assignee := 'chief-of-staff',
    p_milestone := false,
    p_added_by := 'verify:tasks') as v
`)
  ).v,
)
ok('task_add returns an id', typeof made.id === 'string' && made.id !== '')
const tid = String(made.id)
ok('and says the row it wrote is harness traffic', made.fixture === true)

const row = await one(`
  select t.state, t.done_at, t.title, s.slug as who
    from public.tasks t left join public.staff s on s.staff_id = t.assignee_staff
   where t.task_id = '${tid}'::uuid
`)
ok('the assignee is resolved to a person', row.who === 'chief-of-staff', `got ${String(row.who)}`)
ok('a new task starts as todo', row.state === 'todo')
ok('done_at is null until it is done', row.done_at === null)

// --- state, and the trigger that keeps done_at honest -----------------------
await db.execute(`select public.hq_task_state('${tid}', 'done', null)`)
const done = await one(`select state, done_at from public.tasks where task_id = '${tid}'::uuid`)
ok('hq_task_state moves it', done.state === 'done')
ok('done_at is filled by the RPC, not the caller', done.done_at !== null)

await db.execute(`select public.hq_task_state('${tid}', 'todo', null)`)
const undone = await one(`select done_at from public.tasks where task_id = '${tid}'::uuid`)
ok('reopening clears done_at', undone.done_at === null)

// --- the refusals, which are the point --------------------------------------
await answersWithError(
  'a blocked task with no reason is refused by the RPC',
  `select public.hq_task_state('${tid}', 'blocked', '') as v`,
  'say what it is blocked on',
)

await refuses(
  'a blocked task with no reason is refused by the TABLE too',
  `update public.tasks set state = 'blocked', blocked_on = '' where task_id = '${tid}'::uuid`,
)

/*
  This one asserts a REPAIR, not a refusal, and the distinction is the finding.

  The first version expected the write to be rejected. It is not: the
  before-update trigger fills `done_at` in, so the constraint is already
  satisfied by the time it is evaluated and the statement succeeds. That is
  better behaviour than refusing — the caller gets what they meant rather than
  an error — but it means the CHECK constraint is not what keeps the column
  honest, the trigger is. A test asserting a refusal would have been asserting
  something untrue about how this actually works.
*/
await db.execute(
  `update public.tasks set state = 'done', done_at = null where task_id = '${tid}'::uuid`,
)
const repaired = await one(`select done_at from public.tasks where task_id = '${tid}'::uuid`)
ok('a done task with a nulled completion time is repaired, not rejected', repaired.done_at !== null)
await db.execute(`select public.hq_task_state('${tid}', 'todo', null)`)

await answersWithError(
  'an assignee who does not exist is named, not silently dropped',
  `select public.task_add(p_project := '${pid}'::uuid, p_title := 'Nobody can do this',
     p_assignee := 'nobody-at-all', p_added_by := 'verify:tasks') as v`,
  'nobody here is called',
)

await answersWithError(
  'an empty title is refused',
  `select public.task_add(p_project := '${pid}'::uuid, p_title := '   ',
     p_added_by := 'verify:tasks') as v`,
  'a task needs a title',
)

await refuses(
  'an unknown state is refused',
  `update public.tasks set state = 'maybe' where task_id = '${tid}'::uuid`,
)

// --- fixtures are excluded from what the office reports ---------------------
await db.execute(`
  select public.task_add(p_project := '${pid}'::uuid, p_title := 'Later, unassigned',
    p_added_by := 'verify:tasks');
  select public.task_add(p_project := '${pid}'::uuid, p_title := 'Stuck one',
    p_assignee := 'operations-director', p_added_by := 'verify:tasks');
`)

const counted = await one(`
  select count(*)::int as n from public.tasks where project_id = '${pid}'::uuid
`)
ok('the fixture project holds its tasks', Number(counted.n) >= 3)

// The flag is DERIVED, so a test cannot forget it — the defect that once had
// 264 harness jobs reported to Grant as the office collapsing.
const flagged = await one(`
  select count(*) filter (where is_fixture)::int as marked, count(*)::int as all_of_them
    from public.tasks where project_id = '${pid}'::uuid
`)
ok(
  'every task a verify script wrote is a fixture, without being told',
  Number(flagged.marked) === Number(flagged.all_of_them),
  `${String(flagged.marked)} of ${String(flagged.all_of_them)}`,
)

await refuses(
  'is_fixture cannot be set by hand',
  `update public.tasks set is_fixture = false where project_id = '${pid}'::uuid`,
)

const hidden = asJson((await one(`select app.studio_tasks('${pid}'::uuid) as v`)).v)
ok(
  'and the page Grant reads shows none of them',
  Array.isArray(hidden) && (hidden as unknown as unknown[]).length === 0,
  `${String((hidden as unknown as unknown[]).length)} fixture task(s) reached the studio`,
)

await db.execute(`delete from public.projects where slug = 'verify-tasks-fixture'`)
const left = await one(`
  select count(*)::int as n from public.tasks where project_id = '${pid}'::uuid
`)
ok('deleting the project cascades its tasks away', Number(left.n) === 0)

/*
  --- the reader, which needs a subject the reader can see -------------------

  Everything above is harness traffic and `app.studio_tasks` is right to hide
  it. So the reader gets a REAL project, named so no fixture prefix applies,
  paused so ADR-0014 is satisfied, inserted directly rather than through
  `hq_create_project` so 0416's channel provisioning has nothing to fire on,
  and deleted at the end — it gathers tasks, which cascade, and no job, which
  would make it undeletable for ever (ADR-0022).
*/
const readerSlug = `task-reader-${Math.random().toString(36).slice(2, 10)}`
const rp = await one(`
  insert into public.projects (slug, name, purpose, status)
  values ('${readerSlug}', 'Task reader proof', 'Removed at the end of the run', 'paused')
  returning project_id
`)
const rid = String(rp.project_id)

try {
  await db.execute(`
    select public.task_add(p_project := '${rid}'::uuid, p_title := 'Conduct first five interviews',
      p_detail := 'From the corpus', p_assignee := 'chief-of-staff', p_added_by := 'grant');
    select public.task_add(p_project := '${rid}'::uuid, p_title := 'Stuck one',
      p_assignee := 'operations-director', p_added_by := 'grant');
  `)
  const stuck = await one(`
    select task_id from public.tasks
     where project_id = '${rid}'::uuid and title = 'Stuck one'
  `)
  await db.execute(
    `select public.hq_task_state('${String(stuck.task_id)}', 'blocked', 'Notion not shared')`,
  )

  const seen = asJson((await one(`select app.studio_tasks('${rid}'::uuid) as v`)).v)
  const list = seen as unknown as { title: string; state_raw: string; who: string }[]
  ok('the reader the studio calls is reachable', Array.isArray(list) && list.length === 2)
  ok(
    'blocked sorts first, as the IA orders it',
    list[0]?.state_raw === 'blocked',
    `first was ${String(list[0]?.state_raw)}`,
  )
  ok(
    'and it carries who the task belongs to',
    list.some((t) => t.who === 'chief-of-staff'),
    `got ${list.map((t) => String(t.who)).join(', ')}`,
  )
  ok(
    'the title survives the round trip',
    list.some((t) => t.title === 'Conduct first five interviews'),
  )
} finally {
  /*
    A teardown that matches nothing looks exactly like a teardown that worked,
    so it is asserted rather than assumed.
  */
  await db.execute(`delete from public.projects where project_id = '${rid}'::uuid`)
}

const swept = await one(`
  select count(*)::int as n from public.projects where slug = '${readerSlug}'
`)
ok('the reader subject is gone', Number(swept.n) === 0)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)

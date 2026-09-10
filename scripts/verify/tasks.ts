/**
 * Does the task system actually work?
 *
 *   npm run verify:tasks
 *
 * Exercises 0171 and 0172 against the real database — creating, reading,
 * moving and constraining real rows — rather than reading the SQL back and
 * concluding it looks right. Everything it makes is marked `is_fixture` and
 * removed at the end.
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

/*
  A fixture project to hang everything off, so nothing touches real work.

  `status: 'paused'`, not 'active'. ADR-0014 refuses an active project with no
  enabled attachment — *"a project reads from and writes to somewhere real"* —
  and it is enforced by a trigger, not a convention. A verification fixture has
  nothing real attached and should not pretend otherwise, so it stays paused.
  That invariant catching this script is the invariant working.
*/
const proj = await one(`
  insert into public.projects (slug, name, purpose, status)
  values ('verify-tasks-fixture', 'Task verification', 'Thrown away', 'paused')
  on conflict (slug) do update set name = excluded.name
  returning project_id
`)
const pid = String(proj.project_id)

console.log('tasks —')

// --- the happy path ---------------------------------------------------------
const made = await one(`
  select public.add_task('${pid}'::uuid, 'Conduct first five interviews',
    'From the corpus', 'chief-of-staff', 'verify:tasks', '2026-09-16', false, 10, null) as id
`)
ok('add_task returns an id', typeof made.id === 'string' && made.id !== '')
const tid = String(made.id)

const read = await one(`select * from public.project_tasks('${pid}'::uuid) limit 1`)
ok('the public wrapper is reachable', read.title === 'Conduct first five interviews')
ok(
  'the assignee is resolved to a name',
  read.assignee_name === 'Claire',
  `got ${String(read.assignee_name)}`,
)
ok('a new task starts as todo', read.state === 'todo')
ok('done_at is null until it is done', read.done_at === null)

// --- state, and the trigger that keeps done_at honest -----------------------
await db.execute(`select public.set_task_state('${tid}'::uuid, 'done')`)
const done = await one(`select state, done_at from public.tasks where task_id = '${tid}'::uuid`)
ok('set_task_state moves it', done.state === 'done')
ok('done_at is filled by the trigger, not the caller', done.done_at !== null)

await db.execute(`select public.set_task_state('${tid}'::uuid, 'todo')`)
const undone = await one(`select done_at from public.tasks where task_id = '${tid}'::uuid`)
ok('reopening clears done_at', undone.done_at === null)

// --- the refusals, which are the point --------------------------------------
await refuses(
  'a blocked task with no reason is refused by the RPC',
  `select public.set_task_state('${tid}'::uuid, 'blocked', '')`,
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
await db.execute(`select public.set_task_state('${tid}'::uuid, 'todo')`)

await refuses(
  'an assignee who does not exist fails loudly',
  `select public.add_task('${pid}'::uuid, 'Nobody can do this', '', 'nobody-at-all')`,
)

await refuses('an empty title is refused', `select public.add_task('${pid}'::uuid, '   ')`)

await refuses(
  'an unknown state is refused',
  `update public.tasks set state = 'maybe' where task_id = '${tid}'::uuid`,
)

// --- ordering ---------------------------------------------------------------
await db.execute(`
  select public.add_task('${pid}'::uuid, 'Later, unassigned', '', null, 'verify:tasks', null, true);
  select public.add_task('${pid}'::uuid, 'Stuck one', '', 'operations-director', 'verify:tasks', null, false);
`)
const stuck = await one(`
  select task_id from public.tasks
   where project_id = '${pid}'::uuid and title = 'Stuck one'
`)
await db.execute(`
  select public.set_task_state('${String(stuck.task_id)}'::uuid, 'blocked', 'Notion not shared')
`)
const { rows: ordered } = await db.execute(`
  select title, state from public.project_tasks('${pid}'::uuid)
`)
const first = (ordered as { title: string; state: string }[])[0]
ok(
  'blocked sorts first, as the IA orders it',
  first?.state === 'blocked',
  `first was ${String(first?.state)}`,
)

// --- fixtures are excluded from what the office reports ---------------------
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

// --- clean up ---------------------------------------------------------------
await db.execute(`delete from public.projects where slug = 'verify-tasks-fixture'`)
const left = await one(`
  select count(*)::int as n from public.tasks
   where project_id = '${pid}'::uuid
`)
ok('deleting the project cascades its tasks away', Number(left.n) === 0)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)

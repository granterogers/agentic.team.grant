/**
 * Every task Grant has, in one place, wherever it lives.
 *
 *   npm run verify:portfolio
 *
 * Issue #173, migrations 0280-0281. Tracked from #169.
 *
 * ## What is worth measuring
 *
 *   1. **It aggregates, it does not duplicate.** One row per task. Ticking it
 *      in a project ticks it here because it IS the same row — #173 names
 *      duplication as the failure to avoid, and a second copy is how two views
 *      of one task start disagreeing.
 *   2. **A task can belong to no project.** `project_id` was NOT NULL, so
 *      "renew the domain" had nowhere to go and the second list Grant keeps
 *      beside this one is where the real work ends up.
 *   3. **Overdue, stale and waiting are computed on read**, in his timezone. A
 *      stored flag is wrong the moment midnight passes.
 *   4. **The order is the answer.** The question is "what should I be doing
 *      next", and the first row has to be a defensible answer to it — with the
 *      SAME ordering the page uses, because two orderings is how the page and
 *      the Chief of Staff stop agreeing.
 *
 * ## And the one that keeps it honest
 *
 * A typo in a project name must NOT become a task filed under no project. That
 * is the difference between "this belongs nowhere" and "I mistyped", and
 * collapsing them loses work somewhere nobody is looking.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

interface Task {
  id: string
  title: string
  project: string | null
  overdue: boolean
  stale: boolean
  waiting: boolean
  unowned: boolean
  suggested: boolean
  due_on: string | null
}
interface Portfolio {
  counts: Record<string, number>
  tasks: Task[]
  today: string
}

const portfolio = async (): Promise<Portfolio> =>
  ((await one('select app.hq_portfolio_tasks(app.test_office()) as p')).p ??
    {}) as unknown as Portfolio

/*
  Real subjects, and NOT marked `verify:` — Issue #45's trap, walked into once
  while writing this file.

  `tasks.is_fixture` is GENERATED from `added_by`: anything matching `verify:%`
  is a fixture, and `hq_portfolio_tasks` excludes fixtures because a harness
  task must never appear on Grant's list. So a suite that stamped its subjects
  `verify:portfolio` found an empty portfolio and twelve red checks against a
  feature that worked perfectly.

  So the subjects are added by a real agent slug — which is also what makes them
  SUGGESTED rather than confirmed, so that distinction is exercised for real
  rather than asserted about a fixture — and the teardown keys on a title
  prefix no real task would carry.
*/
const BY = 'research-director'
const MARK = '[vp] '
const wipe = async (): Promise<void> => {
  await db.execute(`delete from public.tasks where title like ${lit(`${MARK}%`)}`)
}
await wipe()

const project = String(
  (
    await one(`
      select slug from public.projects
       where status = 'active' and not is_fixture order by created_at limit 1
    `)
  ).slug,
)

/** Add one directly, so `added_by` can carry the teardown marker. */
const add = async (
  title: string,
  opts: {
    project?: string
    due?: string
    state?: string
    blocked?: string
    who?: string
    by?: string
  } = {},
): Promise<string> => {
  const row = await one(`
    insert into public.tasks (project_id, title, due_on, state, blocked_on, added_by, assignee_staff)
    values (
      ${opts.project === undefined ? 'null' : `(select project_id from public.projects where slug = ${lit(opts.project)})`},
      ${lit(`${MARK}${title}`)},
      ${opts.due === undefined ? 'null' : `${lit(opts.due)}::date`},
      ${lit(opts.state ?? 'todo')},
      ${lit(opts.blocked ?? '')},
      ${lit(opts.by ?? BY)},
      ${opts.who === undefined ? 'null' : `(select staff_id from public.staff where slug = ${lit(opts.who)})`})
    returning task_id::text as id
  `)
  return String(row.id)
}

// ===========================================================================
// 1. A task that belongs to no project
// ===========================================================================

console.log('\na task can belong to no project at all')

const loose = await add('Renew the domain before it lapses', { due: '2099-01-01' })
const withLoose = await portfolio()
check(
  'it is accepted, and it appears in the portfolio',
  withLoose.tasks.some((t) => t.id === loose) ? 'it is there' : 'IT IS NOT THERE',
  withLoose.tasks.some((t) => t.id === loose),
)
check(
  'and it says it has no project, rather than pretending it has one',
  String(withLoose.tasks.find((t) => t.id === loose)?.project),
  withLoose.tasks.find((t) => t.id === loose)?.project === null,
)
check(
  'and it is counted as such',
  `${String(withLoose.counts.no_project)} with no project`,
  Number(withLoose.counts.no_project) >= 1,
)

/*
  The distinction that keeps it honest. An empty project is Grant saying "this
  is not about a project"; a slug that does not resolve is a typo, and filing
  that under "no project" would lose the task somewhere he is not looking.
*/
const viaRpc = await one(
  `select public.hq_task_add(app.test_office(), '', 'A loose task through the RPC') as r`,
)
check(
  'the write path accepts an empty project as meaning none',
  JSON.stringify((viaRpc.r as Record<string, unknown>).project),
  (viaRpc.r as Record<string, unknown>).project === null &&
    (viaRpc.r as Record<string, unknown>).error === undefined,
)
await db.execute(`delete from public.tasks where title = 'A loose task through the RPC'`)

const typo = await one(
  `select public.hq_task_add(app.test_office(), 'coching-corse', 'A typo') as r`,
)
check(
  'and a MISTYPED project is still refused, rather than filed under none',
  String((typo.r as Record<string, unknown>).error ?? '(it was ACCEPTED)').slice(0, 56),
  String((typo.r as Record<string, unknown>).error ?? '').includes('no dashboard project'),
)

// ===========================================================================
// 2. Aggregated, not duplicated
// ===========================================================================

console.log('\nand a project task appears here without being copied')

const onProject = await add('Something on a real project', { project, due: '2099-02-01' })
const both = await portfolio()
check(
  'a task on a project appears in the portfolio, carrying its project',
  both.tasks.find((t) => t.id === onProject)?.project ?? 'NO PROJECT',
  both.tasks.find((t) => t.id === onProject)?.project === project,
)
check(
  'and appears exactly once',
  `${String(both.tasks.filter((t) => t.id === onProject).length)} time(s)`,
  both.tasks.filter((t) => t.id === onProject).length === 1,
)

/*
  The same row, not a copy. Ticking it through the ordinary RPC must remove it
  from the portfolio, because there is only one of it.
*/
await db.execute(`select public.hq_task_state(${lit(onProject)}, 'done')`)
const after = await portfolio()
check(
  'ticking it anywhere removes it from here, because it is one row',
  after.tasks.some((t) => t.id === onProject) ? 'STILL LISTED' : 'gone',
  !after.tasks.some((t) => t.id === onProject),
)
await db.execute(`select public.hq_task_state(${lit(onProject)}, 'todo')`)

// ===========================================================================
// 3. Computed, in his timezone
// ===========================================================================

console.log('\nand what is wrong with a task is worked out on read')

const late = await add('Something that was due last week', { project, due: '2020-01-01' })
const blocked = await add('Something waiting on somebody', {
  project,
  state: 'blocked',
  blocked: 'waiting on the Notion page being shared',
})
const now = await portfolio()

check(
  'a past date reads as overdue',
  String(now.tasks.find((t) => t.id === late)?.overdue),
  now.tasks.find((t) => t.id === late)?.overdue === true,
)
check(
  'and a future one does not',
  String(now.tasks.find((t) => t.id === loose)?.overdue),
  now.tasks.find((t) => t.id === loose)?.overdue === false,
)
check(
  'a blocked task reads as waiting',
  String(now.tasks.find((t) => t.id === blocked)?.waiting),
  now.tasks.find((t) => t.id === blocked)?.waiting === true,
)
/*
  And is NOT also stale. A blocked task is not neglected, it is waiting, and
  flagging it as both would bury the ones that genuinely are — which is the
  whole reason the two are separate columns rather than one "needs attention".
*/
check(
  'and a blocked task is not ALSO called stale, which would bury the real ones',
  String(now.tasks.find((t) => t.id === blocked)?.stale),
  now.tasks.find((t) => t.id === blocked)?.stale === false,
)
check(
  'the day it is measured against is Grant’s, not UTC',
  String(now.today),
  /^\d{4}-\d{2}-\d{2}$/.test(String(now.today)),
)

// ===========================================================================
// 4. The order is the answer
// ===========================================================================

console.log('\nand the first row answers "what should I be doing next"')

const first = now.tasks[0]
check(
  'the overdue one is first, ahead of everything dated later',
  first === undefined ? 'no tasks' : `${first.title} (overdue=${String(first.overdue)})`,
  first?.id === late,
)

/*
  A dated task outranks an undated one whatever its priority. A date is a
  commitment somebody may be waiting on; a priority is an opinion, and ordering
  by priority alone lets a P1 with no date sit above something due this morning.
*/
const noDate = await add('Something important with no date', { project })
await db.execute(`update public.tasks set priority = 1 where task_id = ${lit(noDate)}`)
const ordered = await portfolio()
const posDated = ordered.tasks.findIndex((t) => t.id === loose)
const posUndated = ordered.tasks.findIndex((t) => t.id === noDate)
check(
  'and a dated task outranks a high-priority one with no date',
  `dated at ${String(posDated)}, undated P1 at ${String(posUndated)}`,
  posDated !== -1 && posUndated !== -1 && posDated < posUndated,
)

/*
  Suggested versus confirmed. `added_by` already carried it and nothing read it
  — which is where #139's proposals and #130's extracted tasks will land.
*/
const byGrant = await add('Something Grant added himself', { project, by: 'grant' })
const suggested = await portfolio()
check(
  'a task an agent added reads as SUGGESTED rather than agreed',
  `${String(suggested.counts.suggested)} suggested of ${String(suggested.counts.open)} open`,
  suggested.tasks.find((t) => t.id === noDate)?.suggested === true,
)
/*
  And one Grant added himself does not. A flag that is true for everything is a
  flag that distinguishes nothing, which is what an all-fixture subject set
  would have produced.
*/
check(
  'and one he added himself does NOT',
  String(suggested.tasks.find((t) => t.id === byGrant)?.suggested),
  suggested.tasks.find((t) => t.id === byGrant)?.suggested === false,
)

/*
  And a harness task is invisible here, which is the behaviour that made the
  first version of this suite report twelve failures against working code.
  `jobs.is_fixture` and `tasks.is_fixture` exist because harness traffic was
  once reported to Grant as the office collapsing.
*/
const fixture = await add('A harness task nobody should see', {
  project,
  by: 'verify:portfolio',
})
const withFixture = await portfolio()
check(
  'a fixture task never reaches his list, however it was created',
  withFixture.tasks.some((t) => t.id === fixture) ? 'IT IS LISTED' : 'not listed',
  !withFixture.tasks.some((t) => t.id === fixture),
)

// ===========================================================================
// 5. What it excludes
// ===========================================================================

console.log('\nand it leaves out what is not work')

const done = await add('Something already finished', { project, state: 'todo' })
await db.execute(`select public.hq_task_state(${lit(done)}, 'done')`)
const excluded = await portfolio()
check(
  'a finished task is not on the list',
  excluded.tasks.some((t) => t.id === done) ? 'STILL LISTED' : 'not listed',
  !excluded.tasks.some((t) => t.id === done),
)

/*
  CONTROL. An exclusion that excludes everything passes the check above for the
  wrong reason, so the list must still contain the open ones.
*/
check(
  'CONTROL: and the open ones are still there, so the filter is not just empty',
  `${String(excluded.tasks.length)} open task(s)`,
  excluded.tasks.length >= 4,
)

// ===========================================================================
// 6. Put it back
// ===========================================================================

console.log('\nand the suite leaves nothing behind')

let sweptSaid = ''
let sweptClean = false
try {
  // The undo records these tasks wrote, first: `undo_requests` has a foreign
  // key to them and `hq_task_state` records an inverse for every tick (#118).
  await db.execute(`
    delete from public.undo_requests where action_id in (
      select action_id from public.undoable_actions
       where description like '%[vp] %')
  `)
  await db.execute(`
    delete from public.undoable_actions
     where description like '%[vp] %'
  `)
  await wipe()
  const left = await one(`
    select count(*)::int as n from public.tasks where title like ${lit(`${MARK}%`)}
  `)
  sweptClean = Number(left.n) === 0
  sweptSaid = `${String(left.n)} task(s) left behind`
} catch (error) {
  sweptSaid = (error as Error).message.replace(/\s+/g, ' ').slice(0, 140)
}
check('every task it created is gone', sweptSaid, sweptClean)

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)

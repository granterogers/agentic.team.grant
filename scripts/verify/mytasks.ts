/**
 * My Tasks — Grant's own list, and the boundary that keeps it his (#259).
 *
 *   npm run verify:mytasks
 *
 * ADR-0041 decided that a Personal Task is a `public.tasks` row with
 * `assigned_to_human` true, rather than a second table. The audit that led
 * there found the column modelled since #11, **never once set**, and read by
 * nothing in `src/`, `scripts/` or `web/` — the same shape as the autonomy dial
 * that had a table, a function and a Settings control and no reader.
 *
 * ## What this suite is really about
 *
 * One table means one filter to get wrong, and ADR-0041 names the failure as
 * asymmetric: a personal task missing from My Tasks is an annoyance, and **the
 * office's own work appearing in Grant's personal list is what stops him
 * trusting the list.** So every reader is asserted in BOTH directions — the
 * personal one appears and the agent one does not. A suite of positives passes
 * against a reader that returns everything, which is exactly the reader this
 * change could accidentally produce.
 *
 * ## And through the deployed gateway
 *
 * The presses go over HTTP, because the defect this repository keeps finding
 * is never in the RPC. Twice today: a gateway action nothing could press, and
 * a field the composing code never received. Both were green in SQL.
 */

import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, token)
const ENDPOINT = `https://${ref}.supabase.co/functions/v1/hq-api`

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const checks: { what: string; outcome: string; passed: boolean }[] = []
const check = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what} — ${outcome}`)
}

const run = Math.random().toString(36).slice(2, 10)
console.log('my tasks, and the boundary that keeps them mine (#259) —\n')

const bearer = String(
  (
    await one(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).v ?? '',
)
if (bearer === '') {
  console.error('no hq.api_token in the vault — run `npm run deploy:hq` first')
  process.exit(2)
}

const press = async (action: string, args: Record<string, unknown>): Promise<unknown> => {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
  const body = (await r.json()) as { result?: unknown; error?: string }
  if (!r.ok) throw new Error(body.error ?? `http ${String(r.status)}`)
  return body.result
}
const ask = async (section: string, id?: string): Promise<unknown> => {
  const r = await fetch(
    `${ENDPOINT}?section=${section}${id === undefined ? '' : `&id=${encodeURIComponent(id)}`}`,
    { headers: { Authorization: `Bearer ${bearer}` } },
  )
  const body = (await r.json()) as { data?: unknown; error?: string }
  if (!r.ok) throw new Error(body.error ?? `http ${String(r.status)}`)
  return body.data
}

interface Row {
  id?: string
  title?: string
  labels?: string[]
  repeats?: { every?: string; from?: string } | null
  overdue?: boolean
  project?: { slug?: string; name?: string } | null
  state?: string
}
const bucket = async (name: string): Promise<Row[]> => {
  const rows = await ask('my_tasks', name)
  return Array.isArray(rows) ? (rows as Row[]) : []
}
const has = (rows: Row[], id: string): boolean => rows.some((r) => r.id === id)

/*
  A real-looking project, because `my_task_add` resolves one by SLUG and
  refuses an archived one — #45's question asked about the specific writer.
  Paused at creation so 0419's channel provisioning cannot see it: six real
  Slack channels appeared in Grant's workspace the last time a suite's project
  was both real-looking and active, and Slack cannot delete a channel.
*/
const slug = `mytasks-proof-${run}`
const projectId = String(
  (
    await one(`
      insert into public.projects (slug, name, purpose, status)
      values (${lit(slug)}, ${lit(`My tasks proof ${run}`)},
              'Removed at the end of this run', 'paused')
      returning project_id::text as id`)
  ).id,
)

// --- adding one -------------------------------------------------------------

/*
  ON the project, because the check below asserts that the project's own Tasks
  tab shows it marked as Grant's. The first run of this suite added it with no
  project and then asked the project tab about it — the test was wrong, not the
  product, which is the rule this file has now proved four times in one day.
  A paused project is fine: `my_task_add` refuses an ARCHIVED one.
*/
const added = (await press('my_task_add', {
  p_title: `Ring the venue ${run}`,
  p_detail: 'Removed at the end of this run',
  p_due_on: '2020-01-02',
  p_priority: 10,
  p_project: slug,
})) as Record<string, unknown> | undefined
check(
  'Add does what it offers, through the deployed gateway',
  added?.ok === true ? String(added.id ?? '') : `REFUSED: ${JSON.stringify(added)}`,
  added?.ok === true,
)
const mineId = String(added?.id ?? '')

let refusedBlank = ''
try {
  refusedBlank = JSON.stringify(await press('my_task_add', { p_title: '   ' }))
} catch (e) {
  refusedBlank = String((e as Error).message)
}
check(
  'CONTROL: a task with no title is refused rather than filed as an empty row',
  refusedBlank,
  refusedBlank.includes('missing: p_title') || refusedBlank.includes('a task needs a title'),
)
let refusedProject = ''
try {
  refusedProject = JSON.stringify(
    await press('my_task_add', { p_title: `Nowhere ${run}`, p_project: `no-such-${run}` }),
  )
} catch (e) {
  refusedProject = String((e as Error).message)
}
check(
  'CONTROL: and a project that does not exist is named, not silently dropped into the inbox',
  refusedProject,
  refusedProject.includes('no active project called'),
)

// --- the boundary, in both directions ---------------------------------------

/*
  The office's own task, on the same project, inserted directly because there
  is no gateway action that makes one — which is itself the point: the office
  creates these, Grant does not.
*/
const theirsId = String(
  (
    await one(`
      insert into public.tasks (project_id, title, state, assigned_to_human, added_by)
      values (${lit(projectId)}::uuid, ${lit(`The office drafts the note ${run}`)},
              'todo', false, 'chief-of-staff')
      returning task_id::text as id`)
  ).id,
)

const all = await bucket('all')
check('my task is in My Tasks', has(all, mineId) ? 'present' : 'MISSING', has(all, mineId))
check(
  'CONTROL: and the office’s own work is NOT — the failure ADR-0041 calls asymmetric',
  has(all, theirsId) ? 'THE TEAM’S WORK IS IN GRANT’S LIST' : 'absent',
  !has(all, theirsId),
)

const portfolio = (await ask('portfolio_tasks')) as { tasks?: { id?: string }[] } | undefined
const team = Array.isArray(portfolio?.tasks) ? portfolio.tasks : []
check(
  'CONTROL: and my task is not in the team’s cross-project list either',
  team.some((t) => t.id === mineId) ? 'IT IS IN BOTH LISTS' : 'absent',
  !team.some((t) => t.id === mineId),
)

/*
  The project's own tab shows BOTH, marked. #259 asks for that in as many
  words, and a list that mixes them without saying which is which is the same
  defect as showing them twice.
*/
const onProject = JSON.parse(
  String(
    (
      await one(
        `select coalesce(app.studio_tasks(${lit(projectId)}::uuid), '[]'::jsonb)::text as v`,
      )
    ).v,
  ),
) as { id?: string; mine?: boolean }[]
check(
  'the project’s Tasks tab shows my task, marked as mine',
  JSON.stringify(onProject.find((t) => t.id === mineId)?.mine),
  onProject.find((t) => t.id === mineId)?.mine === true,
)
check(
  'and the team’s task there, marked as theirs',
  JSON.stringify(onProject.find((t) => t.id === theirsId)?.mine),
  onProject.find((t) => t.id === theirsId)?.mine === false,
)

// --- the buckets ------------------------------------------------------------

check(
  'a task due in 2020 is overdue',
  has(await bucket('overdue'), mineId) ? 'in Overdue' : 'NOT IN OVERDUE',
  has(await bucket('overdue'), mineId),
)
check(
  'and is therefore in Today, which is "due by now"',
  has(await bucket('today'), mineId) ? 'in Today' : 'NOT IN TODAY',
  has(await bucket('today'), mineId),
)
check(
  'CONTROL: and NOT in Upcoming, which is the other side of the same line',
  has(await bucket('upcoming'), mineId) ? 'IN BOTH' : 'absent',
  !has(await bucket('upcoming'), mineId),
)
check(
  'CONTROL: nor in Unscheduled, which is the pile with no date at all',
  has(await bucket('unscheduled'), mineId) ? 'IN BOTH' : 'absent',
  !has(await bucket('unscheduled'), mineId),
)
check(
  'CONTROL: nor in Inbox, which is no date AND no project',
  has(await bucket('inbox'), mineId) ? 'IN BOTH' : 'absent',
  !has(await bucket('inbox'), mineId),
)

const counts = (await ask('my_task_counts')) as Record<string, number> | undefined
check(
  'the counts come back in one call and agree with the list',
  `overdue=${String(counts?.overdue)} vs ${String((await bucket('overdue')).length)} listed`,
  Number(counts?.overdue) === (await bucket('overdue')).length,
)

// --- labels, reminders and recurrence ---------------------------------------

const set = (await press('my_task_set', {
  p_task_id: mineId,
  p_labels: ['Errand', 'errand', '  ', 'admin'],
  p_repeat_every: '7 days',
  p_repeat_from: 'due',
})) as Record<string, unknown> | undefined
check(
  'Save does what it offers, and labels come back lower-cased and de-duplicated',
  JSON.stringify(set?.labels),
  set?.ok === true && JSON.stringify(set.labels) === '["admin","errand"]',
)
check(
  'and the repeat is stored with what it counts from',
  JSON.stringify(set?.repeats),
  (set?.repeats as { from?: string } | null)?.from === 'due',
)
let refusedFrom = ''
try {
  refusedFrom = JSON.stringify(
    await press('my_task_set', { p_task_id: mineId, p_repeat_from: 'whenever' }),
  )
} catch (e) {
  refusedFrom = String((e as Error).message)
}
check(
  'CONTROL: a repeat can only count from the due date or from when it was done',
  refusedFrom,
  refusedFrom.includes('runs from its due date'),
)

/*
  And finishing a repeating task makes the next one.

  The behaviour no reading can confirm, and the reason it is a trigger rather
  than a step in a writer: `hq_task_state` is not the only door — the
  human-action bridge and, later, an inbound Vikunja completion also finish a
  task, and CLAUDE.md records what two doors writing one field costs when only
  one of them does the bookkeeping.
*/
const before = (await bucket('all')).length
await press('task_state', { p_task_id: mineId, p_state: 'done' })
const after = await bucket('all')
const next = after.find((t) => t.title === `Ring the venue ${run}` && t.state !== 'done')
check(
  'finishing a repeating task leaves the done one and makes the next',
  `${String(before)} before, ${String(after.length)} after`,
  after.length === before + 1 && next !== undefined,
)
check(
  'the finished occurrence stops repeating, or every completion makes another',
  JSON.stringify(after.find((t) => t.id === mineId)?.repeats),
  after.find((t) => t.id === mineId)?.repeats === null,
)
check('and the next one is not in the past', String(next?.overdue), next?.overdue === false)
check(
  'the done one is in Done and out of Today',
  `${has(await bucket('done'), mineId) ? 'in Done' : 'NOT IN DONE'}, ${
    has(await bucket('today'), mineId) ? 'STILL IN TODAY' : 'out of Today'
  }`,
  has(await bucket('done'), mineId) && !has(await bucket('today'), mineId),
)

const reopened = (await press('task_state', { p_task_id: mineId, p_state: 'todo' })) as
  | Record<string, unknown>
  | undefined
check(
  'and a tick pressed by mistake can be put back',
  reopened === undefined ? 'no answer' : 'reopened',
  !has(await bucket('done'), mineId),
)

// --- the controls the page has to have --------------------------------------

{
  const page = readFileSync('web/studio/app.js', 'utf8')
  const gateway = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
  /*
    Attribute AND call, for each. The composer and the editor are drawn only
    for a writer and the editor only for the row that is open, so
    `verify:wired` walks this screen with neither — the blind spot CLAUDE.md
    records twice.
  */
  const pair = (attr: string, action: string): boolean =>
    new RegExp(attr).test(page) && new RegExp(`'${action}'`).test(page)
  check(
    'the studio draws an Add control and calls my_task_add',
    pair('data-my-add', 'my_task_add') ? 'present' : 'MISSING',
    pair('data-my-add', 'my_task_add'),
  )
  check(
    'and a Details editor that calls my_task_set',
    pair('data-my-save=', 'my_task_set') ? 'present' : 'MISSING',
    pair('data-my-save=', 'my_task_set'),
  )
  check(
    'and a tick that can go both ways',
    /data-my-tick=/.test(page) && /was \? 'todo' : 'done'/.test(page) ? 'present' : 'ONE WAY ONLY',
    /data-my-tick=/.test(page) && /was \? 'todo' : 'done'/.test(page),
  )
  check(
    'and the buckets are read as sections, not rebuilt in the page',
    // The binding is a multi-line object because the bucket is a one-of rather
    // than a uuid, so the check asks for the two things that matter on their
    // own lines rather than for a shape that a formatter can change.
    /my_tasks: \{/.test(gateway) &&
      /values: \['today'/.test(gateway) &&
      /read\('my_tasks', bucket\)/.test(page)
      ? 'bound and read'
      : 'NOT REACHABLE',
    /my_tasks: \{/.test(gateway) &&
      /values: \['today'/.test(gateway) &&
      /read\('my_tasks', bucket\)/.test(page),
  )
}

// --- teardown ---------------------------------------------------------------

console.log('')
await db.execute(`
  delete from public.tasks
   where project_id = ${lit(projectId)}::uuid
      or title like ${lit(`%${run}`)};
  delete from public.events where project_id = ${lit(projectId)}::uuid;`)
let gone = 'not attempted'
try {
  await db.execute(`select app.project_delete(${lit(slug)})`)
  gone = 'deleted'
} catch (e) {
  gone = `REFUSED: ${String(e).slice(0, 80)}`
}
const left = await one(`
  select (select count(*)::int from public.projects where slug = ${lit(slug)}) as projects,
         (select count(*)::int from public.tasks where title like ${lit(`%${run}`)}) as tasks`)
check(
  'teardown — no project and no task of this run is left',
  `${gone}, ${String(left.projects)} project(s), ${String(left.tasks)} task(s)`,
  Number(left.projects) === 0 && Number(left.tasks) === 0,
)

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

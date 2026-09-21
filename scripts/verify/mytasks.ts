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
import { dequeue, runJob } from '../../src/jobs/worker.ts'
import { buildPass } from '../../src/office/pass.ts'

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
const WORKER = `verify-mytasks-${run}`
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
const ask = async (
  section: string,
  id?: string,
  extra: Record<string, string> = {},
): Promise<unknown> => {
  /*
    `extra` is the search and the sort (#259, migration 0504), and it goes
    through the DEPLOYED gateway rather than straight to the RPC on purpose.
    `also` is a new descriptor field and the half most likely to be wrong is
    the gateway's, not the function's: the RPC is driven inside 0504 itself.
  */
  const more = Object.entries(extra)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `&${k}=${encodeURIComponent(v)}`)
    .join('')
  const r = await fetch(
    `${ENDPOINT}?section=${section}${id === undefined ? '' : `&id=${encodeURIComponent(id)}`}${more}`,
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

// --- and the office knows whose work it is ----------------------------------

/*
  #259's definition of success, driven through the REAL inbound path.

  > A user can say "Remind me tomorrow to review the new dashboard." One
  > canonical Personal Task is created and appears in My Tasks.

  The negative control is the half that matters: the same office, the same
  path, a sentence that is plainly the office's work, and NO task. A false
  positive costs Grant the work — he asked for something, it went on his own
  list, and nothing happened — which is why the recogniser is grammatical and
  narrow and why this asserts both directions rather than one.

  Run in process with the real handler set, because the deployed worker takes
  a minute a tick and this is a routing decision rather than a delivery.
*/
{
  const pass = await buildPass(db, WORKER, {
    max: 1,
    canTranscribe: false,
    canSubprocess: false,
    projectRef: ref,
  })

  /*
    The dedupe key has a SHAPE — `channel:kind:ref`, with lower-case letters
    and underscores in the middle segment. `inbound_dedupe_key_shaped` refuses
    a hyphen there, which the first run of this section met; and a slash-slash
    comment INSIDE the SQL template literal is SQL, which the second run met.
  */
  const ask = async (what: string, tag: string): Promise<string> => {
    const command = await one(`
      insert into public.inbound_commands
        (origin_channel, origin_ref, actor, instruction, dedupe_key)
      values ('teamhq', ${lit(`mytasks-${run}-${tag}`)}, ${lit(`verify-mytasks-${run}`)},
              ${lit(what)}, ${lit(`teamhq:my_tasks:${run}-${tag}`)})
      returning command_id::text as id`)
    const got = await one(
      `select app.enqueue_inbound(${lit(String(command.id))}::uuid) ->> 'job_id' as id`,
    )
    return String(got.id ?? '')
  }

  /** Take a NAMED job and settle anything else that arrives (#273). */
  const work = async (jobId: string): Promise<void> => {
    for (let i = 0; i < 8; i += 1) {
      const got = await dequeue(db, WORKER, false, false, undefined, `teamhq:verify-mytasks-${run}`)
      if (got === null) {
        await new Promise((r) => setTimeout(r, 1_000))
        continue
      }
      if (got.jobId !== jobId) {
        await db.execute(`
          update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
            state_reason = 'not this suite''s job' where job_id = ${lit(got.jobId)}::uuid`)
        continue
      }
      await runJob(db, got, pass.handlers, pass.review)
      return
    }
  }

  const reminder = await ask(`Remind me tomorrow to ring the printers ${run}`, 'mine')
  await work(reminder)
  /*
    Scoped to THIS sentence, not to the run.

    The earlier sections of this suite already made two personal tasks carrying
    the run token — one of them the recurrence follow-up — so counting by run
    counted them and reported 3. The test was wrong, not the router: sixth time
    today, and the rule holds every time.
  */
  const madeMine = await one(`
    select count(*)::int as n, coalesce(max(title), '') as title
      from public.tasks
     where assigned_to_human and title ilike ${lit(`%printers ${run}%`)}`)
  check(
    '"Remind me tomorrow to…" becomes a task on Grant’s own list',
    `${String(madeMine.n)} · ${String(madeMine.title)}`,
    Number(madeMine.n) === 1 && String(madeMine.title).includes('printers'),
  )
  check(
    'and the framing is out of the title, so the list is scannable',
    String(madeMine.title),
    !/remind me/i.test(String(madeMine.title)),
  )
  const dated = await one(`
    select coalesce(due_on::text, '') as d from public.tasks
     where assigned_to_human and title ilike ${lit(`%printers ${run}%`)} limit 1`)
  check(
    'and tomorrow is a date, not a word left in the sentence',
    String(dated.d),
    String(dated.d) === new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  )

  const theirsJob = await ask(`I need you to look into the ${run} rollout numbers`, 'theirs')
  await work(theirsJob)
  const madeTheirs = await one(`
    select count(*)::int as n from public.tasks
     where assigned_to_human and title ilike ${lit(`%rollout numbers%`)}`)
  check(
    'CONTROL: "I need YOU to…" is a delegation and makes no personal task',
    `${String(madeTheirs.n)} personal task(s) from a delegation`,
    Number(madeTheirs.n) === 0,
  )
}

// --- the human-action bridge ------------------------------------------------

/*
  #259's bridge, with the source the Issue's example implies.

  > An Agent Job blocked on human action may create a LINKED but SEPARATE
  > Personal Task… `Authorize Google Drive` for the user.

  Not `blockers`: all five open ones today are APPROVALS (`Go ahead / Not
  now`), which are decisions on the Governance page rather than errands, and
  building the bridge there would be a mechanism with nothing feeding it.
  `connection_health` already records what the bridge needs — that the office
  cannot do a thing, WHO has to, and WHAT they have to do — and two of its rows
  need Grant today while appearing nowhere he looks.

  Driven in both directions. Raising is the visible half; CLEARING is the one
  that quietly never works, and a to-do list that fills up and never empties is
  one he stops reading.
*/
{
  const probe = `Chore probe ${run}`
  const key = `credential:${probe.toLowerCase()}:token`
  await db.execute(`
    insert into public.connection_health
      (service, credential, state, detail, owner, action, checked_at)
    values (${lit(probe)}, 'token', 'dead', 'refused, by this suite',
            '✅ grant', 'Settings → somewhere on the web front end', app.now_utc())`)

  const raised = JSON.parse(
    String((await one(`select app.chores_for_credentials()::text as v`)).v),
  ) as { raised?: number }
  const open = await one(`
    select count(*)::int as n, coalesce(max(title), '') as title,
           coalesce(max(detail), '') as detail
      from public.tasks where chore_key = ${lit(key)} and state <> 'done'`)
  check(
    'a credential the office cannot fix lands on Grant’s own list',
    `raised ${String(raised.raised)} · ${String(open.title)}`,
    Number(open.n) === 1 && String(open.title).includes(probe),
  )
  check(
    'and it says what to do, in the office’s own words rather than "fix it"',
    String(open.detail).slice(0, 70),
    String(open.detail).includes('Settings'),
  )
  check(
    'and it is on MY list, not in the team’s work',
    has(
      await bucket('all'),
      String(
        (
          await one(`
      select task_id::text as id from public.tasks
       where chore_key = ${lit(key)} and state <> 'done'`)
        ).id,
      ),
    )
      ? 'in My Tasks'
      : 'NOT IN MY TASKS',
    has(
      await bucket('all'),
      String(
        (
          await one(`select task_id::text as id from public.tasks
                      where chore_key = ${lit(key)} and state <> 'done'`)
        ).id,
      ),
    ),
  )

  await db.execute(`select app.chores_for_credentials()`)
  const twice = await one(`
    select count(*)::int as n from public.tasks
     where chore_key = ${lit(key)} and state <> 'done'`)
  check(
    'CONTROL: an hourly pass raises it once, not once an hour',
    `${String(twice.n)} open after two passes`,
    Number(twice.n) === 1,
  )

  /*
    Parked is a decision, not a chore. Grant asked on 6 September for Groq,
    OpenAI and OpenRouter to be left alone, and a chore he has already declined
    is the fastest way to make him stop reading the list.

    The probe's ACTION is a real instruction on purpose. The first version said
    "parked at Grant's request" in both the owner and the action, so either
    guard alone excluded it and the check could pass without the owner rule
    working at all — a control that can pass for the wrong reason, which this
    file has several entries about. Only the owner can exclude this one.
  */
  await db.execute(`
    insert into public.connection_health
      (service, credential, state, detail, owner, action, checked_at)
    values (${lit(`Parked probe ${run}`)}, 'token', 'dead', 'refused, by this suite',
            '⏸ parked', 'Settings → somewhere on the web front end', app.now_utc())`)
  await db.execute(`select app.chores_for_credentials()`)
  const parked = await one(`
    select count(*)::int as n from public.tasks
     where chore_key = ${lit(`credential:parked probe ${run}:token`)}`)
  check(
    'CONTROL: a credential he has parked is not a chore',
    `${String(parked.n)} chore(s) for a parked credential`,
    Number(parked.n) === 0,
  )

  await db.execute(`
    update public.connection_health set state = 'ok'
     where service = ${lit(probe)} and credential = 'token'`)
  await db.execute(`select app.chores_for_credentials()`)
  const cleared = await one(`
    select count(*)::int as n from public.tasks
     where chore_key = ${lit(key)} and state <> 'done'`)
  check(
    'and it takes itself off the list when the credential works again',
    `${String(cleared.n)} still open`,
    Number(cleared.n) === 0,
  )

  await db.execute(`
    delete from public.tasks where chore_key like ${lit(`credential:%probe ${run}:%`)};
    delete from public.connection_health
     where service in (${lit(probe)}, ${lit(`Parked probe ${run}`)})`)
}

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
  /*
    The binding is a multi-line object because the bucket is a one-of rather
    than a uuid, so this asks for the things that matter on their own lines
    rather than for a shape a formatter can change.

    The page half was `read\('my_tasks', bucket\)` — an exact call, and a
    wording lock. #259's search passes a third argument, so the call became
    `read('my_tasks', bucket, { q, sort })` and this went red over a correct
    change: the sixth instance of that class in this repository. The property
    is that the page asks the SECTION for the bucket, whatever else it also
    passes.

    And each part is reported on its own, because "NOT REACHABLE" about three
    conditions points somewhere and two thirds of the time somewhere is wrong.
  */
  const bound = /my_tasks: \{/.test(gateway)
  const buckets = /values: \['today'/.test(gateway)
  const readsIt = /read\(\s*'my_tasks',\s*bucket\b/.test(page)
  check(
    'and the buckets are read as sections, not rebuilt in the page',
    `section ${bound ? 'bound' : 'MISSING'} · list ${buckets ? 'present' : 'MISSING'} · page ${
      readsIt ? 'reads it' : 'DOES NOT READ IT'
    }`,
    bound && buckets && readsIt,
  )
  check(
    'and the search and the sort reach the same section rather than a second one',
    /also: \[/.test(gateway) && /p_query/.test(gateway) && /q: mine.query/.test(page)
      ? 'one section, three parameters'
      : 'MISSING',
    /also: \[/.test(gateway) && /p_query/.test(gateway) && /q: mine\.query/.test(page),
  )
}

/*
  ------------------------------------------------- the human-action bridge ---

  #259's remaining acceptance criterion: a blocked Agent Job creates a linked
  but SEPARATE Personal Task, and completing it satisfies the dependency so the
  job can resume.

  0496 drives this in both directions inside the migration, which proves it
  once, on the day it was written. A migration runs once; this runs on every
  gate, which is the difference between "it worked" and "it works".

  Everything here is a REAL blocker on a REAL job, because the bridge's whole
  point is the row reaching the list Grant actually looks at, and
  `app.my_tasks` excludes fixtures by design — a fixture subject would pass
  every check below by being unseeable, which is #45's question asked about
  the specific reader.
*/
console.log('\nthe human-action bridge (#259)')

const blocked = await one(`
  insert into public.jobs (kind, state, project_id, requested_by, correlation_id,
                           idempotency_key, pinned_config)
  values ('office.instruction', 'waiting_user', ${lit(projectId)}::uuid,
          ${lit(`teamhq:verify-mytasks-${run}`)}, gen_random_uuid(),
          ${lit(`mytasks-bridge-${run}`)}, '{}'::jsonb)
  returning job_id::text as id`)

const blocker = await one(`
  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (${lit(projectId)}::uuid, ${lit(String(blocked.id))}::uuid,
          ${lit(`Authorize Google Drive ${run}`)},
          'The office cannot read the folder until you sign in once.',
          'The weekly digest will have nothing in it.',
          array['I have done it', 'Not now']::text[], 'marcus', false)
  returning blocker_id::text as id`)

const made = await one(`
  select task_id::text as id, title, assigned_to_human as human, satisfies_answer as answer,
         job_id::text as job
    from public.tasks where satisfies_blocker = ${lit(String(blocker.id))}::uuid`)
check(
  'a job blocked on a human action puts that action on HIS list',
  made.id === undefined ? 'NOTHING REACHED THE LIST' : String(made.title),
  made.human === true && String(made.title).includes(run),
)
check(
  'and the task is linked to the job rather than being a loose note',
  String(made.job ?? '(none)').slice(0, 8),
  String(made.job) === String(blocked.id),
)
/*
  The answer completing it will send, stored rather than decided at the moment
  he ticks the box — so the choice is visible and arguable. `hq_answer_blocker`
  refuses an answer outside `approval_options`, so a wrong one here would be a
  task that can never clear its own blocker.
*/
check(
  'and it says which answer ticking it will send',
  String(made.answer ?? '(none)'),
  String(made.answer) === 'I have done it',
)

/*
  It must be SEPARATE, which invariant 2 turns on: the personal task is a
  human action, and the agent job is still the agent's. Two rows, one link.
*/
const separate = await one(`
  select (select count(*)::int from public.jobs where job_id = ${lit(String(blocked.id))}::uuid) as jobs,
         (select count(*)::int from public.tasks where satisfies_blocker = ${lit(String(blocker.id))}::uuid) as tasks`)
check(
  'the job and the task are separate rows, linked rather than merged',
  `${String(separate.jobs)} job, ${String(separate.tasks)} task`,
  Number(separate.jobs) === 1 && Number(separate.tasks) === 1,
)

/*
  `p_include_harness` (0533), and the suite must say why it is entitled to it.

  This task carries THIS SUITE'S job, and 0530 hides a task whose job is a
  harness job — correctly: two tasks reading "draft.create — report outdated
  items" sat on Grant's real list for a day because nothing did. #45 says a
  suite testing a filter should use a real subject, and here it cannot: the
  subject is made by the suite's own job, and giving that job a real-looking
  requester would manufacture the debris 0531 swept.

  So the flag is asked for, and the NEGATIVE is asserted immediately below it.
  A reader parameter with only the positive check is an untested filter.
*/
const onList = await one(`
  select count(*)::int as n
    from jsonb_array_elements(app.my_tasks('all', 200, null, 'smart', true)) x
   where x ->> 'title' = ${lit(`Authorize Google Drive ${run}`)}
     and x ->> 'for_job' is not null`)
check(
  'it appears in My Tasks, saying the team is waiting on it',
  `${String(onList.n)} row(s) with for_job set`,
  Number(onList.n) === 1,
)

/*
  THE NEGATIVE, and the reason the parameter above is not a hole. The same row,
  asked for the way Grant's dashboard asks, is not there — because the job that
  raised it is a verification job and he is owed no question by it.
*/
const notOnHisList = await one(`
  select count(*)::int as n from jsonb_array_elements(app.my_tasks('all', 200)) x
   where x ->> 'title' = ${lit(`Authorize Google Drive ${run}`)}`)
check(
  'and it does NOT reach his list, because the job that raised it is a harness job',
  `${String(notOnHisList.n)} row(s) without the flag`,
  Number(notOnHisList.n) === 0,
)

// Ticking it.
await db.execute(`
  update public.tasks set state = 'done', done_at = app.now_utc()
   where task_id = ${lit(String(made.id))}::uuid`)
const afterTick = await one(`
  select (select state::text from public.blockers where blocker_id = ${lit(String(blocker.id))}::uuid) as blocker,
         (select state::text from public.jobs where job_id = ${lit(String(blocked.id))}::uuid) as job`)
check(
  'ticking it resolves the blocker',
  String(afterTick.blocker ?? '(none)'),
  String(afterTick.blocker) === 'resolved',
)
check(
  'and the agent job is let go, so it can resume',
  String(afterTick.job ?? '(none)'),
  String(afterTick.job) === 'queued',
)

/*
  The other direction. Answering in the office must clear his list, or
  "Authorize Google Drive" sits there for ever with nothing left to do — a
  task that cannot be completed by doing anything, which teaches him to stop
  reading the list.
*/
const second = await one(`
  insert into public.jobs (kind, state, project_id, requested_by, correlation_id,
                           idempotency_key, pinned_config)
  values ('office.instruction', 'waiting_user', ${lit(projectId)}::uuid,
          ${lit(`teamhq:verify-mytasks-${run}`)}, gen_random_uuid(),
          ${lit(`mytasks-bridge-2-${run}`)}, '{}'::jsonb)
  returning job_id::text as id`)
const secondBlocker = await one(`
  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (${lit(projectId)}::uuid, ${lit(String(second.id))}::uuid,
          ${lit(`Rotate the key ${run}`)}, 'The stored key expired.', 'Nothing runs.',
          array['Done', 'Not now']::text[], 'marcus', false)
  returning blocker_id::text as id`)
await db.execute(`select app.hq_answer_blocker(${lit(String(secondBlocker.id))}::uuid, 'Done')`)
const cleared = await one(`
  select state from public.tasks where satisfies_blocker = ${lit(String(secondBlocker.id))}::uuid`)
check(
  'answering it anywhere else clears it off his list too',
  String(cleared.state ?? '(no task)'),
  String(cleared.state) === 'done',
)

/*
  THE CONTROL. A blocker raised while work CONTINUES is a question, not an
  action — it belongs on the Governance page. Putting every question on his
  to-do list is how a to-do list stops being read, and without this check the
  suite would pass against a version that does exactly that.
*/
const question = await one(`
  insert into public.blockers
    (project_id, job_id, requested_action, why_needed, consequences_of_delay,
     approval_options, originating_agent, work_can_continue)
  values (${lit(projectId)}::uuid, ${lit(String(second.id))}::uuid,
          ${lit(`A question that stops nothing ${run}`)}, 'Curiosity.', 'None.',
          array['Go ahead', 'Not now']::text[], 'marcus', true)
  returning blocker_id::text as id`)
const noTask = await one(`
  select count(*)::int as n from public.tasks
   where satisfies_blocker = ${lit(String(question.id))}::uuid`)
check(
  'CONTROL: a question that stops nothing does NOT reach his to-do list',
  `${String(noTask.n)} task(s)`,
  Number(noTask.n) === 0,
)

// --- teardown ---------------------------------------------------------------

console.log('')
/*
  SWEPT BY CLASS, not by this run's token.

  A teardown keyed to its own token can never collect an earlier run's, and a
  crashed run leaves exactly the rows a tidy one would have removed. Five of
  this suite's tasks — two "Ring the venue", one "Ring the printers" and two
  reminders — were on Grant's personal list for days, and nothing counted them
  because tasks.is_fixture is generated from added_by and app.my_task_add
  writes 'grant' (0530, and 0532 swept them).

  The titles below are this suite's own vocabulary, so it owns them and may
  sweep them whatever token they carry. This suite cannot label its subjects as
  fixtures instead: it exists to prove that my_tasks SHOWS them, and #45's rule
  is that a suite testing a filter may not name its subjects the way the filter
  matches.
*/
await db.execute(`
  delete from public.tasks
   where project_id = ${lit(projectId)}::uuid
      or title like ${lit(`%${run}%`)}
      or title ilike '%rollout numbers%'
      or title ~ '^(Ring the venue|Ring the printers|Projected|Kept) [a-z0-9]{6,12}$';
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:mytasks teardown'
   where requested_by = ${lit(`teamhq:verify-mytasks-${run}`)}
     and state not in ('complete', 'cancelled', 'failed', 'committing', 'committed', 'notifying');
  delete from public.blockers where project_id = ${lit(projectId)}::uuid;
  delete from public.events where project_id = ${lit(projectId)}::uuid;`)
/*
  `app.project_delete` REFUSES rather than throwing, and this teardown called
  that success.

  It reported "deleted, 1 project(s)" — the claim and the count in the same
  line, disagreeing. A refusal for the wrong reason looks exactly like the rule
  working, and here the rule was working: the bridge section above leaves two
  jobs on the project, a job can never be deleted (ADR-0022), so the project
  cannot be either.

  So: read what the function SAID, and archive when it will not go. Out of
  Grant's project list either way, which is what a teardown is for.
*/
let gone = 'not attempted'
try {
  const said = await one(`select app.project_delete(${lit(slug)}) as r`)
  const r = (typeof said.r === 'string' ? JSON.parse(said.r) : (said.r ?? {})) as {
    error?: string
    ok?: boolean
  }
  gone = r.error === undefined ? 'deleted' : `refused (${r.error.slice(0, 60)})`
} catch (e) {
  gone = `THREW: ${String(e).slice(0, 80)}`
}
if (gone !== 'deleted') {
  await db.execute(`update public.projects set status = 'archived' where slug = ${lit(slug)}`)
  gone = `${gone} — archived`
}
const left = await one(`
  select (select count(*)::int from public.projects
           where slug = ${lit(slug)} and status <> 'archived') as projects,
         (select count(*)::int from public.tasks
           where title like ${lit(`%${run}%`)}) as tasks`)
check(
  'teardown — no project and no task of this run is left',
  `${gone}, ${String(left.projects)} project(s), ${String(left.tasks)} task(s)`,
  Number(left.projects) === 0 && Number(left.tasks) === 0,
)

/*
  -------------------------------------- finding one, and changing your mind

  #259 asks for search/filter/sort and for priority, notes and due dates as
  first-class. Migration 0504 found that most of it existed and could not be
  reached: `my_task_add` already took detail, priority, project and labels and
  the quick-add sent three of seven, `my_tasks` already RETURNED detail and
  priority, and `my_task_set` took labels, reminder and repeat and nothing
  else. So a task's title, notes, importance, due date and project were
  write-once — the U of CRUD, half absent.

  Driven through the DEPLOYED gateway, because the new half most likely to be
  wrong is the section descriptor rather than the function. The RPC is already
  driven inside 0504, which raises rather than returning false.
*/
{
  const made = (await press('my_task_add', {
    p_title: `Chase the pricing sheet ${run}`,
    p_detail: 'Ask about the tiering.',
  })) as { ok?: boolean; id?: string }
  const id = String(made.id ?? '')
  check(
    'a task to change our mind about exists',
    `ok=${String(made.ok)}`,
    made.ok === true && id !== '',
  )

  const changed = (await press('my_task_set', {
    p_task_id: id,
    p_title: `Chase the RENAMED sheet ${run}`,
    p_detail: 'Ask about the tiering and the onboarding.',
    p_priority: 20,
  })) as { ok?: boolean; title?: string; priority?: number; detail?: string }
  check(
    'the title, the notes and the importance can all be changed afterwards',
    `${String(changed.title)} / p${String(changed.priority)}`,
    changed.ok === true &&
      String(changed.title).includes('RENAMED') &&
      Number(changed.priority) === 20 &&
      String(changed.detail).includes('onboarding'),
  )

  const blank = (await press('my_task_set', { p_task_id: id, p_title: '   ' })) as {
    ok?: boolean
    error?: string
  }
  check(
    'and a title cannot be emptied, which is said rather than silently ignored',
    String(blank.error ?? '(accepted!)'),
    blank.ok === false && String(blank.error ?? '').includes('needs a title'),
  )

  const nowhere = (await press('my_task_set', {
    p_task_id: id,
    p_project: `no-such-${run}`,
  })) as { ok?: boolean; error?: string }
  check(
    'an unknown project is refused by NAME, not silently left where it was',
    String(nowhere.error ?? '(accepted!)').slice(0, 60),
    nowhere.ok === false && String(nowhere.error ?? '').includes('no active project'),
  )

  const found = (await ask('my_tasks', 'all', { q: 'RENAMED sheet' })) as Row[]
  check(
    'the search finds it by title, through the gateway',
    `${String(found.length)} found`,
    found.some((r) => String(r.id) === id),
  )
  const byNotes = (await ask('my_tasks', 'all', { q: 'onboarding' })) as Row[]
  check(
    'and by what is in its NOTES, which is where half of what you wrote lives',
    `${String(byNotes.length)} found`,
    byNotes.some((r) => String(r.id) === id),
  )
  /*
    The control. A search that matched everything would pass both checks above
    and would be the "found-nothing check that cannot report anything" with the
    sign flipped — it looks like a working search and narrows nothing.
  */
  const nothing = (await ask('my_tasks', 'all', { q: `zzz-nothing-${run}` })) as Row[]
  check(
    'CONTROL: a query nothing matches returns nothing, so the search narrows',
    `${String(nothing.length)} found`,
    nothing.length === 0,
  )
  /*
    And the other control, which is the one a search bolted onto a bucketed
    list gets wrong: it must NARROW the bucket rather than replace it.
  */
  const inDone = (await ask('my_tasks', 'done', { q: 'RENAMED sheet' })) as Row[]
  check(
    'CONTROL: the search narrows the bucket rather than ignoring it',
    `${String(inDone.length)} in Done`,
    inDone.every((r) => String(r.id) !== id),
  )

  const sorted = (await ask('my_tasks', 'all', { sort: 'title' })) as Row[]
  const titles = sorted.map((r) => String(r.title).toLowerCase())
  check(
    'sorting by name really reorders the list',
    `${String(titles.length)} row(s)`,
    titles.length < 2 || titles.every((t, i) => i === 0 || (titles[i - 1] ?? '') <= t),
  )
  let badSort = ''
  try {
    await ask('my_tasks', 'all', { sort: 'sideways' })
    badSort = '(accepted!)'
  } catch (error) {
    badSort = String((error as Error).message)
  }
  check(
    'an order nobody defined is refused by name rather than quietly ignored',
    badSort.slice(0, 60),
    badSort.includes('must be one of'),
  )

  await db.execute(`delete from public.tasks where task_id = ${lit(id)}::uuid`)
}

// ===========================================================================
// Subtasks (#259, migrations 0514/0515)
// ===========================================================================

console.log('\nsubtasks')
{
  const parent = (await press('my_task_add', { p_title: `Parent ${run}` })) as {
    ok?: boolean
    id?: string
  }
  const parentId = String(parent.id ?? '')
  const kid = (await press('my_task_add', {
    p_title: `Child ${run}`,
    p_parent: parentId,
  })) as { ok?: boolean; id?: string; parent?: string }
  check(
    'a subtask is created through the deployed gateway and remembers its parent',
    `ok=${String(kid.ok)} parent=${String(kid.parent ?? '')}`,
    kid.ok === true && String(kid.parent ?? '') === parentId,
  )

  const withKid = ((await ask('my_tasks', 'all', { q: `Parent ${run}` })) as Row[])[0] as
    | (Row & { subtasks?: { id?: string; title?: string; done?: boolean }[] })
    | undefined
  check(
    'and the parent carries it, so the list can show it rather than only count it',
    `${String(withKid?.subtasks?.length ?? 0)} carried`,
    (withKid?.subtasks ?? []).some((k) => String(k.id) === String(kid.id)),
  )

  /*
    The refusal that keeps the depth at one. Asserted on the SENTENCE, because
    a refusal for the wrong reason looks exactly like the rule working — this
    file's own neighbours have been caught by that twice.
  */
  const nested = (await press('my_task_add', {
    p_title: `Grandchild ${run}`,
    p_parent: String(kid.id),
  })) as { ok?: boolean; error?: string }
  check(
    'a subtask of a subtask is refused, and says why',
    String(nested.error ?? '(accepted!)').slice(0, 70),
    nested.ok === false && String(nested.error ?? '').includes('do not nest'),
  )

  /*
    And the boundary #259's second invariant draws. The team's own work is not
    a parent for one of Grant's tasks — a canonical task on both sides of that
    line is the one thing the whole separation exists to prevent.
  */
  const theirs = String(
    (
      await one(`
        insert into public.tasks (title, assigned_to_human, added_by, state, project_id)
        values (${lit(`Theirs ${run}`)}, false, 'verify:mytasks', 'todo',
                ${lit(projectId)}::uuid)
        returning task_id::text as id`)
    ).id ?? '',
  )
  const across = (await press('my_task_add', {
    p_title: `Across ${run}`,
    p_parent: theirs,
  })) as { ok?: boolean; error?: string }
  check(
    'CONTROL: a personal subtask cannot be hung off the team’s own work',
    String(across.error ?? '(accepted!)').slice(0, 70),
    across.ok === false && String(across.error ?? '').includes('team'),
  )

  // ==========================================================================
  // Deleting one, which was not possible at all before 0513
  // ==========================================================================

  console.log('\ndeleting one (#259, migration 0513)')

  const refusedTheirs = (await press('my_task_delete', { p_task_id: theirs })) as {
    ok?: boolean
    error?: string
  }
  check(
    'Delete refuses the team’s own work, from the door that is Grant’s',
    String(refusedTheirs.error ?? '(deleted it!)').slice(0, 70),
    refusedTheirs.ok === false,
  )
  check(
    'and it is still there afterwards',
    `${String((await one(`select count(*)::int as n from public.tasks where task_id = ${lit(theirs)}::uuid`)).n)} row(s)`,
    Number(
      (
        await one(
          `select count(*)::int as n from public.tasks where task_id = ${lit(theirs)}::uuid`,
        )
      ).n,
    ) === 1,
  )
  await db.execute(`delete from public.tasks where task_id = ${lit(theirs)}::uuid`)

  const gone = (await press('my_task_delete', { p_task_id: parentId })) as {
    ok?: boolean
    children_deleted?: number
  }
  check(
    'deleting a parent takes its subtask, and SAYS how many it took',
    `ok=${String(gone.ok)} children=${String(gone.children_deleted ?? '?')}`,
    gone.ok === true && Number(gone.children_deleted) === 1,
  )
  check(
    'and both rows are really gone',
    `${String((await one(`select count(*)::int as n from public.tasks where task_id in (${lit(parentId)}::uuid, ${lit(String(kid.id))}::uuid)`)).n)} left`,
    Number(
      (
        await one(
          `select count(*)::int as n from public.tasks
            where task_id in (${lit(parentId)}::uuid, ${lit(String(kid.id))}::uuid)`,
        )
      ).n,
    ) === 0,
  )
}

// ===========================================================================
// Reminders that actually arrive (#259, migration 0512)
// ===========================================================================

console.log('\nreminders (#259, migration 0512)')
{
  const made = (await press('my_task_add', {
    p_title: `Remind me ${run}`,
    p_remind_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  })) as { id?: string }
  const id = String(made.id ?? '')

  // Read it the way the handler does, through the same function.
  const readDue = async (): Promise<{ id: string }[]> => {
    const raw = (await one(`select app.reminders_due() as r`)).r
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? [])
    return (Array.isArray(parsed) ? parsed : []) as { id: string }[]
  }

  check(
    'a reminder whose moment has passed is reported as due',
    `${String((await readDue()).length)} due`,
    (await readDue()).some((d) => d.id === id),
  )

  /*
    The whole point, end to end: the DEPLOYED worker runs the duty's handler
    and the office says something. Driven through `tasks.remind` rather than by
    calling the SQL, because the defect this closes was not in the SQL — the
    column was complete and nothing in src/ had ever read it.
  */
  const jobId = String(
    (
      await one(`
        insert into public.jobs
          (correlation_id, project_id, idempotency_key, kind, requested_by, state, announce)
        values (extensions.gen_random_uuid(), null, ${lit(`verify-mytasks-remind-${run}`)},
                'tasks.remind', ${lit(`verify:mytasks-${run}`)}, 'queued', false)
        returning job_id::text as id`)
    ).id ?? '',
  )
  let body = ''
  for (let i = 0; i < 40; i += 1) {
    const row = await one(`
      select j.state, coalesce(o.body, '') as body
        from public.jobs j
        left join public.outputs o on o.job_id = j.job_id
       where j.job_id = ${lit(jobId)}::uuid`)
    if (['complete', 'failed', 'cancelled'].includes(String(row.state))) {
      body = String(row.body ?? '')
      break
    }
    await new Promise((r) => setTimeout(r, 3_000))
  }
  check(
    'and the office actually says it — the handler that did not exist until 0512',
    body === '' ? 'NOTHING WAS SAID' : body.slice(0, 80),
    body.includes(`Remind me ${run}`),
  )
  check(
    'saying it marks it, so the next quarter-hour does not say it again',
    `${String((await readDue()).filter((d) => d.id === id).length)} still due`,
    !(await readDue()).some((d) => d.id === id),
  )

  /*
    And the half that makes a reminder usable rather than single-use: moving it
    re-arms it. Without this, re-scheduling a reminder that had already fired
    would never fire again — a feature that works exactly once per task, which
    looks fine in any test that only fires it once.
  */
  await press('my_task_set', {
    p_task_id: id,
    p_remind_at: new Date(Date.now() - 60_000).toISOString(),
  })
  check(
    'moving a reminder that already fired arms it again',
    `${String((await readDue()).filter((d) => d.id === id).length)} due`,
    (await readDue()).some((d) => d.id === id),
  )

  /*
    The editor's half, as source. The input had NO value attribute, so it
    rendered blank on a task that had a reminder — and the save handler reads a
    blank reminder as "clear it". Opening Details and changing the title
    silently deleted the reminder. The browser proof is in the QA pass; this is
    the witness that stops it coming back.
  */
  const page = readFileSync('web/studio/app.js', 'utf8')
  const carries = /data-my-remind type="datetime-local" value="\$\{esc\(localStamp\(/.test(page)
  check(
    'the editor renders the reminder it already has, so saving cannot wipe it',
    carries ? 'the value is rendered' : 'THE INPUT IS BLANK — saving clears the reminder',
    carries,
  )

  await db.execute(`delete from public.tasks where task_id = ${lit(id)}::uuid`)
  await db.execute(`update public.jobs set project_id = null where job_id = ${lit(jobId)}::uuid`)
}

// ===========================================================================
// Changing one by talking (#259, migration 0516)
// ===========================================================================

console.log('\n"actually make that Monday" (#259, migration 0516)')
{
  /*
    End to end through the DEPLOYED worker, because the defect was that the
    conversation had no path to a change at all — the RPC was fine and nothing
    called it. A test that called `my_task_set` would have proved the half that
    was never in doubt.
  */
  const first = (await press('my_task_add', {
    p_title: `Ring the caterers ${run}`,
    p_due_on: new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10),
  })) as { id?: string }
  const subject = String(first.id ?? '')

  const say = async (text: string): Promise<string> => {
    const jobId = String(
      (
        await one(`
          insert into public.jobs
            (correlation_id, project_id, idempotency_key, kind, requested_by, state, announce,
             pinned_config)
          values (extensions.gen_random_uuid(), null,
                  ${lit(`verify-mytasks-chg-${run}-${Math.random().toString(36).slice(2, 8)}`)},
                  'office.instruction', ${lit(`teamhq:verify-${run}`)}, 'queued', false,
                  jsonb_build_object('instruction', ${lit(text)}))
          returning job_id::text as id`)
      ).id ?? '',
    )
    for (let i = 0; i < 40; i += 1) {
      const row = await one(`
        select j.state, coalesce(o.body, '') as body
          from public.jobs j left join public.outputs o on o.job_id = j.job_id
         where j.job_id = ${lit(jobId)}::uuid`)
      if (['complete', 'failed', 'cancelled'].includes(String(row.state))) {
        await db.execute(
          `update public.jobs set project_id = null where job_id = ${lit(jobId)}::uuid`,
        )
        return String(row.body ?? '')
      }
      await new Promise((r) => setTimeout(r, 3_000))
    }
    return ''
  }

  const monday = await say('Actually make that Monday')
  const moved = await one(`
    select due_on::text as due, title from public.tasks where task_id = ${lit(subject)}::uuid`)
  check(
    'a follow-up moves the task the office just made',
    `${String(moved.due ?? 'no date')} — the office said: ${monday.slice(0, 60)}`,
    String(moved.due ?? '') !== new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10) &&
      String(moved.due ?? '') !== '',
  )
  check(
    'and it says WHICH task it changed, rather than "done"',
    monday.slice(0, 80) || 'IT SAID NOTHING',
    monday.includes(`Ring the caterers ${run}`),
  )

  const urgent = await say('Make that urgent')
  const now = await one(`
    select priority from public.tasks where task_id = ${lit(subject)}::uuid`)
  check(
    'and a second follow-up changes how important it is',
    `priority ${String(now.priority)} — ${urgent.slice(0, 50)}`,
    Number(now.priority) === 10,
  )

  /*
    CONTROL: the same words with a SUBJECT in them are the office's work and
    must not touch his list. This is the direction that costs — a delegation
    captured as a change to a personal task is work that never happens AND a
    row he did not ask to move.
  */
  const before = String(
    (await one(`select title from public.tasks where task_id = ${lit(subject)}::uuid`)).title ?? '',
  )
  await say('Make that pricing document urgent')
  const unchanged = await one(`
    select title, priority from public.tasks where task_id = ${lit(subject)}::uuid`)
  check(
    'CONTROL: "make that PRICING DOCUMENT urgent" leaves his task alone',
    `${String(unchanged.title)} — priority ${String(unchanged.priority)}`,
    String(unchanged.title) === before,
  )

  await db.execute(`delete from public.tasks where task_id = ${lit(subject)}::uuid`)
}

// ===========================================================================
// "Call it X" is an ANSWER, not a rename (#259, the acceptance pass)
// ===========================================================================

console.log('\n"call it X" answers the question rather than renaming something else')
{
  /*
    Two readings of one sentence, and the office had been taking both.

    `RENAME` recognises "Call it X" as a follow-up change, and `titleReply`
    recognises it as the answer to "what should I call it?" — a question the
    office asks whenever a task request arrives with no title. The change path
    ran first and unconditionally, so that single reply created the new task
    AND renamed whatever personal task happened to be the most recent one.

    It has to be driven over the REAL inbound path, twice, in one thread:
    `namedLater` looks the previous turn up in `public.inbound_commands` by the
    first segment of `origin_ref`, so a raw job insert — which is how the
    section above talks to the office — cannot reach this branch at all. A
    check that could not reach the code it is about would pass for the reason
    CLAUDE.md keeps recording.
  */
  const THREAD = `verify-ans-${run}`
  const bystander = (await press('my_task_add', {
    p_title: `Chase the printers ${run}`,
  })) as { id?: string }
  const other = String(bystander.id ?? '')

  const turn = async (n: number, text: string): Promise<string> => {
    const commandId = String(
      (
        await one(`
          insert into public.inbound_commands
            (origin_channel, origin_ref, actor, instruction, dedupe_key)
          values ('teamhq', ${lit(`${THREAD}:${String(n)}`)},
                  ${lit(`verify-mytasks-${run}`)}, ${lit(text)},
                  ${lit(`teamhq:message:${THREAD}-${String(n)}`)})
          returning command_id::text as v`)
      ).v ?? '',
    )
    const enq = (await one(`select app.enqueue_inbound(${lit(commandId)}::uuid) as v`)).v as
      | { job_id?: string }
      | string
    const parsed = (typeof enq === 'string' ? JSON.parse(enq) : enq) as { job_id?: string }
    const jobId = String(parsed.job_id ?? '')
    for (let i = 0; i < 40; i += 1) {
      const row = await one(`
        select j.state, coalesce(o.body, '') as body
          from public.jobs j left join public.outputs o on o.job_id = j.job_id
         where j.job_id = ${lit(jobId)}::uuid`)
      if (['complete', 'failed', 'cancelled'].includes(String(row.state))) {
        return String(row.body ?? '')
      }
      await new Promise((r) => setTimeout(r, 3_000))
    }
    return ''
  }

  const question = await turn(1, 'Add a task')
  check(
    'a task request with no title makes the office ASK for one',
    question.slice(0, 70) || 'IT SAID NOTHING',
    /call|name|title/i.test(question),
  )

  const titleBefore = String(
    (await one(`select title from public.tasks where task_id = ${lit(other)}::uuid`)).title ?? '',
  )
  const answered = await turn(2, `Call it Review the onboarding copy ${run}`)
  const made = await one(`
    select count(*)::int as n from public.tasks
     where title = ${lit(`Review the onboarding copy ${run}`)}`)
  check(
    'and the answer CREATES the task it was asked about',
    `${String(made.n)} task(s) — the office said: ${answered.slice(0, 50)}`,
    Number(made.n) === 1,
  )
  const after = await one(`
    select title from public.tasks where task_id = ${lit(other)}::uuid`)
  check(
    'CONTROL: it does NOT rename the task he made twenty minutes ago',
    `"${String(after.title)}"` +
      (String(after.title) === titleBefore ? '' : ` — WAS "${titleBefore}"`),
    String(after.title) === titleBefore,
  )

  await db.execute(`
    delete from public.tasks
     where task_id = ${lit(other)}::uuid
        or title = ${lit(`Review the onboarding copy ${run}`)}`)
  await db.execute(
    `delete from public.inbound_commands where origin_ref like ${lit(`${THREAD}:%`)}`,
  )
  const leftover = await one(`
    select count(*)::int as n from public.tasks
     where title in (${lit(`Chase the printers ${run}`)},
                     ${lit(`Review the onboarding copy ${run}`)})`)
  check(
    'teardown — neither task of this section is left behind',
    `${String(leftover.n)} left`,
    Number(leftover.n) === 0,
  )
}

// ===========================================================================
// The provider seam, driven as a fake provider (#259, migration 0513)
// ===========================================================================

console.log('\nthe seam a provider plugs into (#259, migration 0513)')
{
  /*
    A FAKE provider, and that is the point. #259 asks for Vikunja behind an
    abstraction; the way to know an abstraction is provider-neutral is to drive
    it with a provider that is not Vikunja. This one is a name and a few RPC
    calls, it ships nothing, and it exercises every seam a real one would use.
  */
  const PROVIDER = `probe-${run}`
  const made = (await press('my_task_add', { p_title: `Projected ${run}` })) as { id?: string }
  const id = String(made.id ?? '')
  const revOf = async (): Promise<number> =>
    Number(
      (await one(`select revision from public.tasks where task_id = ${lit(id)}::uuid`)).revision,
    )

  const offered = async (): Promise<{ upserts: { id: string }[]; deletes: { id: string }[] }> => {
    const raw = (await one(`select app.tasks_to_push(${lit(PROVIDER)}) as r`)).r
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      upserts?: { id: string }[]
      deletes?: { id: string }[]
    }
    return { upserts: parsed.upserts ?? [], deletes: parsed.deletes ?? [] }
  }

  check(
    'a task no provider has seen is offered for projection',
    `${String((await offered()).upserts.length)} offered`,
    (await offered()).upserts.some((u) => u.id === id),
  )

  await db.execute(
    `select app.task_pushed(${lit(id)}::uuid, ${lit(PROVIDER)}, 'ext-1', ${String(await revOf())})`,
  )
  check(
    'once projected it is not offered again — the watermark holds',
    `${String((await offered()).upserts.filter((u) => u.id === id).length)} offered`,
    !(await offered()).upserts.some((u) => u.id === id),
  )

  await press('my_task_set', { p_task_id: id, p_title: `Projected ${run} edited` })
  check(
    'and an edit here makes it pushable again, which is what keeps them in step',
    `revision ${String(await revOf())}`,
    (await offered()).upserts.some((u) => u.id === id),
  )

  /*
    Sync status lives in `task_links` and never on the task — #259's fourth
    invariant, asserted rather than assumed, because the cheap way to build
    this is a column on `tasks` and that is what makes a canonical model
    provider-shaped.
  */
  const taskCols = (
    await db.execute(`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'tasks'
         and column_name in ('sync_state', 'sync_error', 'external_id', 'vikunja_id')`)
  ).rows as { column_name: string }[]
  check(
    'CONTROL: no provider field has leaked onto the canonical task',
    taskCols.length === 0
      ? 'the task row is clean'
      : `LEAKED: ${taskCols.map((c) => c.column_name).join(', ')}`,
    taskCols.length === 0,
  )

  await db.execute(
    `select app.task_push_failed(${lit(id)}::uuid, ${lit(PROVIDER)}, 'the provider was unreachable')`,
  )
  const health = await one(`
    select sync_state, sync_error from public.task_links
     where task_id = ${lit(id)}::uuid and provider = ${lit(PROVIDER)}`)
  check(
    'a provider that fails is recorded where it can be diagnosed, and says what happened',
    `${String(health.sync_state)} — ${String(health.sync_error ?? '')}`.slice(0, 70),
    health.sync_state === 'error' && String(health.sync_error ?? '').includes('unreachable'),
  )
  check(
    'and the task itself is untouched by the failure — #259: never unavailable',
    `${String(((await ask('my_tasks', 'all', { q: `Projected ${run}` })) as Row[]).length)} in the list`,
    ((await ask('my_tasks', 'all', { q: `Projected ${run}` })) as Row[]).some(
      (r) => String(r.id) === id,
    ),
  )

  // Deleting it leaves the provider something to act on.
  await press('my_task_delete', { p_task_id: id })
  check(
    'deleting a projected task tells the provider to remove its copy',
    `${String((await offered()).deletes.length)} deletion(s) owed`,
    (await offered()).deletes.some((d) => d.id === id),
  )
  await db.execute(`select app.task_delete_pushed(${lit(id)}::uuid, ${lit(PROVIDER)})`)
  check(
    'and once the provider has applied it, nothing is owed',
    `${String((await offered()).deletes.length)} still owed`,
    !(await offered()).deletes.some((d) => d.id === id),
  )

  /*
    Disconnecting. #259 is explicit: this must never lose a native task, and it
    is the last proof that a provider is optional rather than a hidden
    dependency.
  */
  const keeper = (await press('my_task_add', { p_title: `Kept ${run}` })) as { id?: string }
  await db.execute(`
    select app.task_pushed(${lit(String(keeper.id))}::uuid, ${lit(PROVIDER)}, 'ext-keep', 1)`)
  const forgot = (await one(`select app.task_provider_forget(${lit(PROVIDER)}) as r`)).r as
    | string
    | { links_removed?: number }
  const said = (typeof forgot === 'string' ? JSON.parse(forgot) : forgot) as {
    links_removed?: number
  }
  check(
    'disconnecting a provider removes its mappings',
    `${String(said.links_removed ?? 0)} mapping(s) removed`,
    Number(said.links_removed ?? 0) >= 1,
  )
  check(
    'and every native task is still there and still in the list',
    `${String(((await ask('my_tasks', 'all', { q: `Kept ${run}` })) as Row[]).length)} found`,
    ((await ask('my_tasks', 'all', { q: `Kept ${run}` })) as Row[]).some(
      (r) => String(r.id) === String(keeper.id),
    ),
  )

  await db.execute(`delete from public.tasks where task_id = ${lit(String(keeper.id))}::uuid`)
  await db.execute(`delete from public.task_tombstones where title like ${lit(`%${run}%`)}`)
}

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

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

const onList = await one(`
  select count(*)::int as n from jsonb_array_elements(app.my_tasks('all', 200)) x
   where x ->> 'title' = ${lit(`Authorize Google Drive ${run}`)}
     and x ->> 'for_job' is not null`)
check(
  'it appears in My Tasks, saying the team is waiting on it',
  `${String(onList.n)} row(s) with for_job set`,
  Number(onList.n) === 1,
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
await db.execute(`
  delete from public.tasks
   where project_id = ${lit(projectId)}::uuid
      or title like ${lit(`%${run}%`)}
      or title ilike '%rollout numbers%';
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

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

/**
 * The action-capability audit: every advertised action, end to end.
 *
 *   npm run verify:capabilities
 *
 * #249 proved the INTERPRETER — 37/37 recall, 21/21 held out, 21/21 controls.
 * That is not the same as proving the ACTIONS. An advertised capability only
 * counts as acceptance-proven when the canonical operation actually happens and
 * the office says truthfully what happened, and the interpreter sits at the
 * front of a chain with eight more links in it:
 *
 *   natural request -> semantic recognition -> clause decomposition ->
 *   project resolution -> argument extraction -> handler -> permission ->
 *   canonical execution -> canonical verification -> truthful confirmation
 *
 * ## Two parts, because they answer different questions
 *
 * PART A is deterministic and exhaustive. Every user-invokable action gets
 * several natural paraphrases — imperative, conversational, indirect,
 * shorthand, project-qualified, multi-clause, correction — driven through
 * recognition, decomposition and argument extraction with no model and no
 * writes. It answers "would the office UNDERSTAND this", for many forms.
 *
 * PART B is real. It answers "does the canonical operation HAPPEN", for the
 * actions that can be executed without doing something to Grant's real world.
 *
 * ## What is deliberately NOT executed
 *
 * Several advertised mutations reach outside this database: a calendar entry,
 * a Notion page, a NotebookLM artifact, a Slack message. The standing test
 * rules forbid uncontrolled calendar events, real mail, external publication
 * and notification storms — so those are classified honestly in Part C rather
 * than executed to fill a row. An audit that manufactures execution to look
 * complete is worth less than one that says where the evidence stops.
 */

import { notebookRequest } from '../../src/agents/actions.ts'
import { clauses } from '../../src/agents/clauses.ts'
import { classifyIntent } from '../../src/agents/intent.ts'
import { readRequest } from '../../src/agents/request.ts'
import { taskRequest } from '../../src/agents/tasks.ts'
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

const checks: { what: string; outcome: string; passed: boolean }[] = []
const add = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
}

/** Did the office understand that it is being asked to act? */
const recognised = (say: string): boolean => {
  const c = classifyIntent(say)
  return c.recognised && c.confident && ['assignment', 'direct_command'].includes(c.intent)
}

// ===========================================================================
// PART A — recognition, decomposition and arguments, per action, per form
// ===========================================================================

interface Form {
  readonly form: string
  readonly say: string
  /** The action the office should resolve, or null for a negative control. */
  readonly resolves: 'task' | 'notebook' | null
  /** The title or subject that must survive argument extraction, if any. */
  readonly keeps?: string
}

const TASK_FORMS: readonly Form[] = [
  {
    form: 'imperative',
    say: 'Create a task to chase the roofing quote.',
    resolves: 'task',
    keeps: 'chase the roofing quote',
  },
  {
    form: 'conversational',
    say: 'Could you add a task to chase the roofing quote?',
    resolves: 'task',
    keeps: 'chase the roofing quote',
  },
  { form: 'indirect', say: 'I need a task adding to chase the roofing quote.', resolves: 'task' },
  {
    form: 'shorthand',
    say: 'Task: chase the roofing quote.',
    resolves: 'task',
    keeps: 'chase the roofing quote',
  },
  {
    form: 'project-qualified',
    say: 'Put a task on alpha to chase the roofing quote.',
    resolves: 'task',
    keeps: 'chase the roofing quote',
  },
  {
    form: 'indirect object',
    say: 'Make me a task to chase the roofing quote.',
    resolves: 'task',
    keeps: 'chase the roofing quote',
  },
  {
    form: 'with a deadline',
    say: 'Add a task to chase the roofing quote by Friday.',
    resolves: 'task',
    keeps: 'chase the roofing quote by Friday',
  },
  {
    form: 'named explicitly',
    say: 'Create a task called Chase the roofing quote.',
    resolves: 'task',
    keeps: 'Chase the roofing quote',
  },
  { form: 'pronoun reference', say: 'Add a task for that.', resolves: 'task' },
  {
    form: 'correction',
    say: 'Actually do not email the roofer; make a task to chase them instead.',
    resolves: 'task',
  },
  { form: 'CONTROL question', say: 'Do we have a task for the roofing quote?', resolves: null },
  {
    form: 'CONTROL prohibition',
    say: 'Do not make a task for the roofing quote yet.',
    resolves: null,
  },
  {
    form: 'CONTROL musing',
    say: 'I wonder whether a task for the roofing quote would help.',
    resolves: null,
  },
  {
    form: 'CONTROL past',
    say: 'I made a task for the roofing quote myself yesterday.',
    resolves: null,
  },
]

const NOTEBOOK_FORMS: readonly Form[] = [
  { form: 'imperative', say: 'Generate an audio overview of the notebook.', resolves: 'notebook' },
  {
    form: 'conversational',
    say: 'Could you make a slide deck from the notebook?',
    resolves: 'notebook',
  },
  { form: 'indirect', say: 'I need a video overview put together.', resolves: 'notebook' },
  { form: 'idiomatic', say: 'Knock up a mind map for me.', resolves: 'notebook' },
  { form: 'CONTROL question', say: 'What is an audio overview?', resolves: null },
  {
    form: 'CONTROL example',
    say: 'Pull the files it has generated (audio overviews and the like).',
    resolves: null,
  },
]

/** The deadline Grant states must survive somewhere Grant can see it. */
const taskTitleKeepsDeadline = (): boolean => {
  const say = 'Add a task to chase the roofing quote by Friday.'
  return (taskRequest(say, classifyIntent(say))?.title ?? '').includes('by Friday')
}

const runForms = (label: string, forms: readonly Form[]): void => {
  const rows: string[] = []
  let good = 0
  for (const f of forms) {
    const understood = recognised(f.say)
    const task = taskRequest(f.say, classifyIntent(f.say))
    const nb = notebookRequest(f.say)
    const got: 'task' | 'notebook' | null = task !== null ? 'task' : nb !== null ? 'notebook' : null
    const titleOk = f.keeps === undefined || task?.title === f.keeps
    /*
      A control passes by resolving NO action. It is allowed to be understood
      as a request — "do we have a task for X" is a question the office should
      answer — what it must not do is reach a writer.
    */
    /*
      The ACTION resolving is the acceptance criterion, not the intent class.

      "Could you add a task to chase the roofing quote?" is classified a
      question — a question rule matches, question is cheaper than assignment,
      and §6 resolves downward — and the task is still created, because the
      writer is reached by mood and object noun rather than by class. So the
      class is REPORTED and not gated: promoting every polite request to an
      assignment would turn "could you tell me the cost" into work, which is
      the precision hazard this whole design is built around.
    */
    const ok = f.resolves === null ? got === null : got === f.resolves && titleOk
    if (ok) good++
    rows.push(
      `  ${ok ? 'ok  ' : 'MISS'}  ${f.form.padEnd(22)} understood=${String(understood).padEnd(5)} resolved=${String(got).padEnd(9)}${
        f.keeps === undefined ? '' : ` title=${JSON.stringify(task?.title ?? null)}`
      }`,
    )
  }
  console.log(`\n${label}`)
  for (const r of rows) console.log(r)
  add(
    `${label} — every natural form resolves the right action`,
    `${String(good)}/${String(forms.length)}`,
    good === forms.length,
  )
}

runForms('task.create — natural forms', TASK_FORMS)
runForms('notebook artifacts — natural forms', NOTEBOOK_FORMS)

// ===========================================================================
// PART A2 — multi-clause accounting: requested -> interpreted, no silent loss
// ===========================================================================

interface MultiCase {
  readonly say: string
  /** How many clauses a reasonable person would say are being asked for. */
  readonly asks: number
}

const MULTI: readonly MultiCase[] = [
  {
    say: 'Check where we stand, make a task for the follow-up, and draft what I should send.',
    asks: 3,
  },
  { say: 'Work out where we stand on the policy and then draft what I send them.', asks: 2 },
  { say: 'Pull the numbers on last quarter and put a task on alpha to review them.', asks: 2 },
  {
    say: 'Look at the lease, flag anything nasty, and tell me what it would cost to break it.',
    asks: 3,
  },
  { say: 'Chase the roofer.', asks: 1 },
]

console.log('\nmulti-clause accounting — requested vs interpreted')
let accounted = 0
for (const m of MULTI) {
  const readings = readRequest(m.say, clauses)
  const asked = readings.filter((r) => r.mood === 'ask' || r.mood === 'question').length
  const ok = asked >= m.asks
  if (ok) accounted++
  console.log(
    `  ${ok ? 'ok  ' : 'MISS'}  ${String(m.asks)} asked / ${String(asked)} interpreted  ${JSON.stringify(m.say.slice(0, 62))}`,
  )
  for (const r of readings)
    console.log(`          ${r.mood.padEnd(8)} ${JSON.stringify(r.text.slice(0, 54))}`)
}
add(
  'no clause is silently lost in a multi-clause request',
  `${String(accounted)}/${String(MULTI.length)} messages fully accounted for`,
  accounted === MULTI.length,
)

// ===========================================================================
// PART B — canonical execution, for what can be executed safely
// ===========================================================================
//
// task.create is the one advertised mutation whose whole path lives in this
// database, so it is the one that can be driven end to end without touching
// Grant's real world. Everything else is classified in Part C.

const run = `cap-${Math.random().toString(36).slice(2, 10)}`
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/*
  `hq_create_project` returns JSONB, not a row — a shape worth reading rather
  than assuming, which is the rule this repository keeps relearning about
  column names.
*/
const created = (
  await db.execute(`
    select public.hq_create_project(
      ${lit(`fixture-${run}`)}, 'upload', ${lit(`fixture-ref-${run}`)}, null, true) as result
  `)
).rows[0] as { result?: Record<string, unknown> } | undefined
const project = {
  id: created?.result?.project_id === undefined ? undefined : String(created.result.project_id),
  slug: created?.result?.slug === undefined ? undefined : String(created.result.slug),
}

if (project.id === undefined) {
  add(
    'a fixture project for the execution proof',
    `refused: ${JSON.stringify(created?.result ?? null).slice(0, 120)}`,
    false,
  )
} else {
  const before = (
    await db.execute(
      `select count(*)::int as n from public.tasks where project_id = ${lit(project.id)}::uuid`,
    )
  ).rows[0] as { n: number }

  const title = `chase the ${run} quote`
  const written = await db
    .execute(
      `select app.task_add(${lit(project.id)}::uuid, ${lit(title)}, null, null, null, null, ${lit(run)}, null) as id`,
    )
    .then(() => true)
    .catch(() => false)

  const after = (
    await db.execute(
      `select count(*)::int as n from public.tasks where project_id = ${lit(project.id)}::uuid`,
    )
  ).rows[0] as { n: number }

  add(
    'task.create — the canonical mutation actually happens',
    `${String(before.n)} -> ${String(after.n)} task(s), writer ${written ? 'returned' : 'threw'}`,
    written && after.n === before.n + 1,
  )

  const back = (
    await db.execute(
      `select title from public.tasks where project_id = ${lit(project.id)}::uuid limit 1`,
    )
  ).rows[0] as { title?: string } | undefined
  add(
    'task.create — and what comes back is what was asked for',
    JSON.stringify(back?.title ?? null),
    back?.title === title,
  )

  // Teardown, through the sanctioned path. ADR-0014's order is inside it.
  await db
    .execute(`delete from public.tasks where project_id = ${lit(project.id)}::uuid`)
    .catch(() => undefined)
  await db.execute(`select app.project_delete(${lit(String(project.slug))})`).catch(() => undefined)
  const gone = (
    await db.execute(
      `select count(*)::int as n from public.projects where project_id = ${lit(project.id)}::uuid`,
    )
  ).rows[0] as { n: number }
  add('and the audit leaves nothing behind', `${String(gone.n)} project(s) remain`, gone.n === 0)
}

// ===========================================================================
// PART C — the honest classification of everything advertised
// ===========================================================================

const tools = (
  await db.execute(`
    select tool, enabled, coalesce(delivered_by, '') as delivered_by
      from public.tool_permissions order by tool
  `)
).rows as { tool: string; enabled: boolean; delivered_by: string }[]

/**
 * Why each advertised capability is or is not acceptance-proven here.
 *
 * Written down rather than inferred, because "no evidence" and "not
 * applicable" look identical in a matrix and are completely different facts.
 */
const VERDICT: Readonly<Record<string, string>> = {
  'task.create':
    'PROVEN — natural forms, arguments, canonical mutation, truthful confirmation (#248)',
  /*
    #130's headline unlock. Proven by its own suite rather than here, because
    what matters about it is not the recognition — that is nine unit tests in
    `tests/agents/extract.test.ts` — but that the tasks really land and the
    undo really takes them back, which needs a transaction this audit does not
    open.
  */
  'task.extract':
    'PROVEN ELSEWHERE — npm run verify:extract 11/11: the shape is accepted and a ' +
    'malformed one refused, three tasks really created, the undo pressed through ' +
    'app.hq_undo for real, and a task Grant had started left alone',
  'draft.create':
    'PROVEN implicitly — every turn writes public.outputs and #246/#248 gate what it says',
  'db.read': 'READ-ONLY — not a user-invokable mutation; every handler reads its own database',
  'gmail.read': 'READ-ONLY — job kind google.read_calendar/read_mail, no mutation to prove',
  'gmail.search': 'READ-ONLY — same path',
  'calendar.read': 'READ-ONLY — same path',
  'notebook.read': 'READ-ONLY — notebook.ask / notebook.collect',
  'calendar.write':
    'NOT EXECUTED HERE — a real calendar entry in Grant’s diary; the standing test rules forbid uncontrolled events',
  'notebook.write':
    'NOT EXECUTED HERE — creates a real NotebookLM artifact; recognition proven in Part A',
  'notion.write': 'NOT EXECUTED HERE — mutates Grant’s real Notion workspace',
  'slack.post':
    'NOT EXECUTED HERE — posts to a real channel; also adapter-only, not reachable from the instruction path',
  'preference.update':
    'PARTIAL — canonical writer exists (preference_instructions) and is exercised by the conversation suites, not by this audit',
  'gmail.send': 'DISABLED BY POLICY — the scope is granted and the switch is off, deliberately',
  'gmail.draft': 'DISABLED — drafting only, and off; gmail.send is off separately and deliberately',
  'note.create': 'DISABLED',
  'db.delete': 'DISABLED',
  'github.read': 'DISABLED',
  'github.write': 'DISABLED',
  'production.write': 'DISABLED',
  'spend.money': 'DISABLED',
  'web.search': 'DISABLED — nothing implements it (0298)',
}

console.log('\nadvertised capability surface\n')
console.log('| tool | enabled | acceptance status |')
console.log('|---|---|---|')
const unclassified: string[] = []
for (const t of tools) {
  const v = VERDICT[t.tool]
  if (v === undefined) unclassified.push(t.tool)
  console.log(`| \`${t.tool}\` | ${t.enabled ? 'yes' : 'no'} | ${v ?? '**UNCLASSIFIED**'} |`)
}
add(
  'every advertised capability has an explicit acceptance status',
  unclassified.length === 0
    ? `${String(tools.length)} classified`
    : `unclassified: ${unclassified.join(', ')}`,
  unclassified.length === 0,
)

/*
  A capability claimed with nothing behind it. 0298 added `delivered_by` so the
  claim is checkable; this asserts it stayed checkable, because an enabled tool
  with no deliverer is printed into all eight agents' capability briefs.
*/
const hollow = tools.filter((t) => t.enabled && t.delivered_by.trim() === '')
add(
  'no enabled capability is advertised with nothing behind it',
  hollow.length === 0 ? 'none' : hollow.map((t) => t.tool).join(', '),
  hollow.length === 0,
)

// ===========================================================================
// PART D — structured parameters the canonical model has and nothing fills
// ===========================================================================
//
// Grant's instruction: do not silently discard user information, and record
// unsupported structured parameters explicitly rather than pretending the
// title is equivalent to them.
//
// `app.task_add` takes a due date, a detail, an assignee and a milestone. The
// interpreter extracts NONE of them — it produces a title and nothing else. So
// "add a task to chase the roofer by Friday" becomes a task named "chase the
// roofer by Friday" with `due_on` null.
//
// That is a gap and not a loss, and the difference matters: the deadline is
// still in front of Grant, it is simply not data. An earlier draft of
// `taskTitle` subtracted it for tidiness, which WOULD have been a loss, and
// that is why it no longer does.

const taskParams = (
  await db.execute(`
    select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'task_add' limit 1
  `)
).rows[0] as { args?: string } | undefined
const supported = String(taskParams?.args ?? '')
  .split(',')
  .map((a) => a.trim().split(/\s+/)[0] ?? '')
  .filter((a) => a.startsWith('p_'))
const EXTRACTED = new Set(['p_project', 'p_title', 'p_added_by', 'p_job'])
const unextracted = supported.filter((a) => !EXTRACTED.has(a))

console.log('\nstructured parameters the writer accepts and the interpreter does not fill\n')
for (const a of unextracted) console.log(`  ${a} — representable, never extracted`)

add(
  'the unfilled structured parameters are named rather than left implicit',
  unextracted.length === 0 ? 'none' : unextracted.join(', '),
  // Reported, not gated. The gap is real and filed; failing the audit on it
  // would make a known, recorded, non-blocking limitation look like a defect
  // that appeared today.
  true,
)
add(
  'and the information is kept rather than discarded',
  'a stated deadline stays in the title, because nothing extracts it into a column',
  taskTitleKeepsDeadline(),
)

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const passed = checks.filter((c) => c.passed).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length ? 0 : 1)

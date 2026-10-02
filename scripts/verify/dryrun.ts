/**
 * A dry run that writes anything is not a dry run.
 *
 *   npm run verify:dryrun
 *
 * Issue #131, migrations 0267-0268.
 *
 * ## What is worth measuring here, and what is not
 *
 * "The handler has a `plan` method" is visible in the source and is not the
 * thing that breaks. Three properties are, and each of them is the difference
 * between an approval screen that means something and one that lies.
 *
 *   1. **Planning touches nothing.** The whole promise of a dry run is that you
 *      can ask before you commit. A planning phase that quietly performs a
 *      write has already done the thing the person had not yet agreed to. This
 *      is driven by handing the planner a `fetch` that THROWS on any request
 *      that is not a plain read — so a violation is impossible to miss rather
 *      than merely unlikely.
 *
 *   2. **The plan matches the work.** #131's rule is that the plan and the
 *      action share a code path, differing only at the final call. That is a
 *      claim about structure and cannot be asserted directly, so what is
 *      asserted is the observable consequence: executing must not make MORE
 *      outward calls than the plan accounted for. A handler that plans one
 *      thing and does four has drifted, whatever the code looks like.
 *
 *   3. **It is written down.** A plan that exists only inside one function call
 *      cannot be put in front of a person, which was the entire complaint.
 *      `job_plans` is read back through the same RPC an approval screen would
 *      use.
 *
 * ## The control
 *
 * #131 asks for *"a test that makes them disagree and fails"*, and this file
 * has two: a handler whose plan promises one write and whose execution makes
 * three, and a handler whose PLANNING makes a write. Both must be caught. If
 * they are not, every other check here is decoration — the same reasoning as
 * `verify:inverse`'s deliberately wrong reversal.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../../src/jobs/worker.ts'
import { detail, type Plan, plannedWrites, summarise } from '../../src/tools/plan.ts'

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

/**
 * A `fetch` that counts what goes OUT OF THE OFFICE, and can be made to refuse.
 *
 * A GET is a read and is allowed through in both modes; anything with a method
 * that changes something is what this is about.
 *
 * Supabase is excluded, and it is not a loophole. In production nothing reaches
 * the database over `fetch` at all — it is PostgREST and pg — but this harness
 * drives it through `ManagementApiExecutor`, which POSTs SQL to the management
 * API. Counting that would make every planner look like it wrote something, and
 * the first run of this file did exactly that.
 *
 * "Outward" here means a third party: Google, Notion, Slack. Reading and
 * writing our own rows is what a planner is FOR.
 */
const OURS = /(^|\.)supabase\.(com|co|net)$/
/** The real one, captured before anything is swapped in. */
const REAL_FETCH: typeof fetch = globalThis.fetch.bind(globalThis)
const watcher = (
  mode: 'count' | 'refuse',
): { impl: typeof fetch; writes: () => number; seen: () => string[] } => {
  let writes = 0
  const seen: string[] = []
  const impl = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const url = String(input instanceof Request ? input.url : input)
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      host = ''
    }
    /*
      Our own database goes through to the real network. It has to: the planner
      READS through it, and answering its SQL with a stub made the first fixed
      version fail with "expected a JSON array of rows, got object" -- a harness
      breaking the thing it was measuring.
    */
    if (OURS.test(host)) return REAL_FETCH(input, init)
    if (method !== 'GET') {
      writes += 1
      seen.push(`${method} ${url.slice(0, 70)}`)
      if (mode === 'refuse') {
        throw new Error(`A DRY RUN MADE AN OUTWARD WRITE: ${method} ${url.slice(0, 90)}`)
      }
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { impl, writes: () => writes, seen: () => seen }
}

// ===========================================================================
// 1. The contract itself
// ===========================================================================

console.log('\nthe plan says what a person needs to decide')

const sample: Plan = {
  tool: 'notion.write',
  reaches: ['notion'],
  steps: [
    { verb: 'create', what: 'Module 1 — Finding your first client', where: 'Notion', writes: 1 },
    { verb: 'create', what: 'Module 2 — Pricing without flinching', where: 'Notion', writes: 3 },
    { verb: 'update', what: 'Course overview', where: 'Notion', writes: 1 },
  ],
}
check(
  'the summary counts by verb rather than listing, and names where',
  summarise(sample),
  summarise(sample) === '2 to add, 1 to change in Notion',
)
check(
  'a plan that would do nothing says WHY, rather than saying nothing',
  summarise({ tool: 'calendar.write', reaches: [], steps: [], note: 'the diary already matches' }),
  summarise({
    tool: 'calendar.write',
    reaches: [],
    steps: [],
    note: 'the diary already matches',
  }) === 'the diary already matches',
)
/*
  A step is one outward EFFECT, not one HTTP call, and the two counts are
  deliberately different numbers. Conflating them is how a plan saying "three
  pages" gets checked against five requests and reported as drift.
*/
check(
  'and the cost in outward calls is counted apart from the number of effects',
  `${String(sample.steps.length)} effects, ${String(plannedWrites(sample))} calls`,
  sample.steps.length === 3 && plannedWrites(sample) === 5,
)
check(
  'the full detail names every step',
  detail(sample).split('\n').length === 3 ? '3 lines' : detail(sample),
  detail(sample).includes('Pricing without flinching'),
)
const many: Plan = {
  tool: 'notion.write',
  reaches: ['notion'],
  steps: Array.from({ length: 40 }, (_, i) => ({
    verb: 'create' as const,
    what: `page ${String(i)}`,
    where: 'Notion',
    writes: 1,
  })),
}
check(
  'and a long plan says how many it is hiding rather than trailing off',
  detail(many).split('\n').at(-1) ?? '',
  (detail(many).split('\n').at(-1) ?? '').includes('and 28 more'),
)

// ===========================================================================
// 2. What is recorded, and how it comes back
// ===========================================================================

console.log('\nand it is written down where an approval can read it')

/*
  A real job of our own, requested by `verify:dryrun` -- which makes
  `jobs.is_fixture` true, so this never counts as office traffic. The subject
  has to be a real row because `job_plans` has a foreign key to it.
*/
const jobRow = await one(`
  insert into public.jobs (office_id, correlation_id, idempotency_key, kind, requested_by, priority)
  values (app.test_office(), gen_random_uuid(), ${lit(`dryrun-${String(Date.now())}`)},
          'verification.dryrun', 'verify:dryrun', 900)
  returning job_id::text as id
`)
const JOB = String(jobRow.id)

const wrote = await one(`
  select app.job_plan_set(app.job_office(${lit(JOB)}::uuid), ${lit(JOB)}::uuid, 'notion.write', array['notion'],
    ${lit(JSON.stringify(sample.steps))}::jsonb, ${lit(summarise(sample))},
    ${String(plannedWrites(sample))}) as r
`)
check(
  'a plan can be recorded against a job',
  JSON.stringify((wrote.r as Record<string, unknown>) ?? {}),
  (wrote.r as Record<string, unknown>).ok === true,
)

const readBack = (await one(`select public.hq_job_plan(${lit(JOB)}) as r`)).r as Record<
  string,
  unknown
>
check(
  'and comes back through the RPC an approval screen would call',
  `${String(readBack.summary)} · ${String(readBack.writes)} call(s)`,
  readBack.summary === summarise(sample) && Number(readBack.writes) === 5,
)

/*
  A job is retried, and a retry re-plans against a world that has moved. Two
  rows would mean an approval screen showing two answers with no way to tell
  which is live.
*/
await db.execute(`
  select app.job_plan_set(app.job_office(${lit(JOB)}::uuid), ${lit(JOB)}::uuid, 'calendar.write', array['google:calendar'],
    '[{"verb":"remove","what":"one event","where":"Google Calendar","writes":1}]'::jsonb,
    '1 to take away in Google Calendar', 1)
`)
const afterRetry = await one(
  `select count(*)::int as n from public.job_plans where job_id = ${lit(JOB)}::uuid`,
)
const nowSays = (await one(`select public.hq_job_plan(${lit(JOB)}) as r`)).r as Record<
  string,
  unknown
>
check(
  're-planning replaces rather than appends, so there is one live answer',
  `${String(afterRetry.n)} row(s), saying "${String(nowSays.summary)}"`,
  Number(afterRetry.n) === 1 && nowSays.summary === '1 to take away in Google Calendar',
)

// A malformed step must refuse the WHOLE plan. A half-recorded plan is exactly
// the shape that makes an approval screen lie.
const malformed = await one(`
  select app.job_plan_set(app.job_office(${lit(JOB)}::uuid), ${lit(JOB)}::uuid, 'notion.write', array['notion'],
    '[{"verb":"create","what":"fine","where":"Notion","writes":1},
      {"verb":"create","what":"no writes key","where":"Notion"}]'::jsonb, 'x', 2) as r
`)
check(
  'a single malformed step refuses the whole plan rather than recording half of it',
  String((malformed.r as Record<string, unknown>).error ?? '(it was ACCEPTED)').slice(0, 70),
  String((malformed.r as Record<string, unknown>).error ?? '').includes('nothing was recorded'),
)
const unchanged = (await one(`select public.hq_job_plan(${lit(JOB)}) as r`)).r as Record<
  string,
  unknown
>
check(
  'and the plan that was there is untouched',
  String(unchanged.summary),
  unchanged.summary === '1 to take away in Google Calendar',
)

const bogusVerb = await one(`
  select app.job_plan_set(app.job_office(${lit(JOB)}::uuid), ${lit(JOB)}::uuid, 'notion.write', array['notion'],
    '[{"verb":"obliterate","what":"x","where":"Notion","writes":1}]'::jsonb, 'x', 1) as r
`)
check(
  'and a verb nobody can render is refused too',
  String((bogusVerb.r as Record<string, unknown>).error ?? '(it was ACCEPTED)').slice(0, 60),
  (bogusVerb.r as Record<string, unknown>).error !== undefined,
)

// ===========================================================================
// 2b. And the approval actually shows it
// ===========================================================================

console.log('\nand the person being asked can see what they are agreeing to')

/*
  The half that makes the rest matter. An approval that names a category is
  consent to a category; one carrying the list is an approval.

  Driven through `app.request_approval`, which is the only way a blocker is
  raised, rather than by reading `job_plan_text` on its own -- the question is
  whether the plan REACHES the person, and a renderer nobody calls is #72's
  shape all over again.
*/
await db.execute(`
  select app.job_plan_set(app.job_office(${lit(JOB)}::uuid), ${lit(JOB)}::uuid, 'notion.write', array['notion'],
    ${lit(JSON.stringify(sample.steps))}::jsonb, ${lit(summarise(sample))},
    ${String(plannedWrites(sample))})
`)
await db.execute(`
  select app.request_approval(app.job_office(${lit(JOB)}::uuid), ${lit(JOB)}::uuid, 'write the course modules into Notion',
    'you asked for the curriculum to live where the team can edit it',
    'office.execute_plan')
`)
const asked = await one(`
  select why_needed as why from public.blockers
   where job_id = ${lit(JOB)}::uuid and state = 'open' limit 1
`)
const why = String(asked.why ?? '')
check(
  'the approval still says why it is being asked',
  why.split('\n')[0] ?? '',
  why.startsWith('you asked for the curriculum'),
)
check(
  'and carries the plan under it, counted',
  (why.split('\n').find((l) => l.startsWith('What it would do')) ?? '(no plan shown)').slice(0, 60),
  why.includes(`What it would do — ${summarise(sample)}`),
)
check(
  'and names each thing rather than only counting them',
  why.includes('Pricing without flinching') ? 'every step is named' : 'the steps are missing',
  why.includes('Module 1 — Finding your first client') &&
    why.includes('Pricing without flinching') &&
    why.includes('Course overview'),
)

/*
  A long plan must say how many it is hiding. A reader shown twelve of forty
  and no count is being shown a smaller job than the one they are agreeing to.
*/
const longText = String(
  (
    await one(`
      select app.job_plan_text(${lit(JOB)}::uuid, 2) as t
    `)
  ).t ?? '',
)
check(
  'and a plan longer than the cap says how many it is hiding',
  (longText.split('\n').at(-1) ?? '').slice(0, 40),
  longText.includes('and 1 more'),
)

/*
  And a job with NO plan gains nothing -- not a blank heading, not an empty
  list. Most jobs only read, and an approval that says "What it would do —"
  followed by nothing reads as a bug in the office.
*/
const noPlanJob = await one(`
  insert into public.jobs (office_id, correlation_id, idempotency_key, kind, requested_by, priority)
  values (app.test_office(), gen_random_uuid(), ${lit(`dryrun-noplan-${String(Date.now())}`)},
          'verification.dryrun', 'verify:dryrun', 900)
  returning job_id::text as id
`)
const NO_PLAN_JOB = String(noPlanJob.id)
const empty = String(
  (await one(`select app.job_plan_text(${lit(NO_PLAN_JOB)}::uuid) as t`)).t ?? 'null',
)
check(
  'a job with no plan adds nothing at all, not a blank heading',
  empty === '' ? '(empty, as it should be)' : `"${empty.slice(0, 40)}"`,
  empty === '',
)

// ===========================================================================
// 3. The properties that make a dry run worth having
// ===========================================================================

console.log('\nand a dry run does not do the thing')

/**
 * Run a handler's plan with a fetch that refuses every write, then run the
 * handler with one that counts them, and hold the two against each other.
 */
const holdToAccount = async (
  name: string,
  handler: Handler,
  job: Job,
): Promise<{ planned: number; actually: number; blew: string | null; plan: Plan | null }> => {
  let plan: Plan | null = null
  let blew: string | null = null
  const strict = watcher('refuse')
  const previous = globalThis.fetch
  globalThis.fetch = strict.impl
  try {
    plan = handler.plan === undefined ? null : await handler.plan(job, db)
  } catch (error) {
    blew = (error as Error).message
  } finally {
    globalThis.fetch = previous
  }
  if (blew !== null || plan === null) {
    return { planned: 0, actually: 0, blew, plan }
  }

  const counting = watcher('count')
  globalThis.fetch = counting.impl
  try {
    await handler.handle(job, db)
  } catch {
    // A handler that throws still had its chance to make calls, and the count
    // is what is under test. A throw is not a pass and not a failure here.
  } finally {
    globalThis.fetch = previous
  }
  console.log(
    `       ${name}: planned ${String(plannedWrites(plan))}, made ${String(counting.writes())}`,
  )
  return { planned: plannedWrites(plan), actually: counting.writes(), blew: null, plan }
}

const jobFor = (kind: string): Job => ({
  jobId: JOB,
  kind,
  correlationId: JOB,
  projectId: null,
  idempotencyKey: `dryrun-${kind}`,
  attempt: 1,
})

/*
  The controls first, because if these do not fail the rest proves nothing.
*/
const liar: Handler = {
  kind: 'verification.liar',
  plan: async (): Promise<Plan> => ({
    tool: 'notion.write',
    reaches: ['notion'],
    steps: [{ verb: 'create', what: 'one page', where: 'Notion', writes: 1 }],
  }),
  handle: async (): Promise<HandlerOutput> => {
    // Three writes for a plan that promised one. This is drift, made concrete.
    for (const n of [1, 2, 3]) {
      await fetch(`https://api.notion.com/v1/pages/${String(n)}`, { method: 'POST' })
    }
    return {
      body: 'wrote three',
      confidence: 'high',
      evidence: 'verified',
      sources: ['notion'],
      contradictions: null,
      path: 'deterministic_retrieval',
      model: null,
    }
  },
}
const caughtLiar = await holdToAccount('CONTROL liar', liar, jobFor('verification.liar'))
check(
  'CONTROL: a handler that does more than it planned is caught',
  `planned ${String(caughtLiar.planned)}, made ${String(caughtLiar.actually)}`,
  caughtLiar.actually > caughtLiar.planned,
)

const eager: Handler = {
  kind: 'verification.eager',
  // A planning phase that writes. The thing a dry run exists to make impossible.
  plan: async (): Promise<Plan> => {
    await fetch('https://api.notion.com/v1/pages', { method: 'POST' })
    return { tool: 'notion.write', reaches: ['notion'], steps: [] }
  },
  handle: async (): Promise<HandlerOutput> => ({
    body: 'x',
    confidence: 'high',
    evidence: 'verified',
    sources: ['notion'],
    contradictions: null,
    path: 'deterministic_retrieval',
    model: null,
  }),
}
const caughtEager = await holdToAccount('CONTROL eager', eager, jobFor('verification.eager'))
check(
  'CONTROL: a planning phase that writes anything is caught',
  caughtEager.blew === null ? '(it went unnoticed)' : caughtEager.blew.slice(0, 62),
  caughtEager.blew?.includes('A DRY RUN MADE AN OUTWARD WRITE') === true,
)

// ===========================================================================
// 4. The real ones
// ===========================================================================

console.log('\nand the handlers that actually write outward')

const { calendarTasksHandler } = await import('../../src/handlers/calendar-tasks.ts')
const calendar = calendarTasksHandler(db)
check(
  'the calendar duty can say what it would do',
  calendar.plan === undefined ? 'it cannot' : 'it can',
  calendar.plan !== undefined,
)

const calendarPlan = await holdToAccount(
  'calendar',
  calendar,
  jobFor('google.write_calendar_tasks'),
)
check(
  'and planning the diary makes no outward write of its own',
  calendarPlan.blew === null ? 'nothing went out' : calendarPlan.blew.slice(0, 80),
  calendarPlan.blew === null,
)
check(
  'and it does not do more than it said it would',
  `planned ${String(calendarPlan.planned)}, made ${String(calendarPlan.actually)}`,
  calendarPlan.actually <= calendarPlan.planned,
)
check(
  'and the plan it gives is about the calendar',
  calendarPlan.plan === null
    ? 'no plan'
    : `${calendarPlan.plan.tool} · ${summarise(calendarPlan.plan)}`,
  calendarPlan.plan?.tool === 'calendar.write',
)

/*
  Which branch that just exercised, said out loud.

  `calendar.sync_tasks` is off on this system, so the planner above returned its
  "switched off" answer -- a correct answer, and a trivial one. A check that
  cannot tell that apart from a working planner is a check that passes for the
  wrong reason, which is the failure this repository keeps rediscovering. So the
  branch is reported, and the DECISION the planner delegates to is exercised
  directly instead.

  Not by turning the setting on. That is Grant's switch, it writes into a real
  diary, and a suite that flips it for a moment is a suite that leaves it on the
  day the process dies mid-run.
*/
const syncOn = Boolean(
  (
    await one(`
      select coalesce((select value::text::boolean from public.system_config
                        where key = 'calendar.sync_tasks'), false) as on
    `)
  ).on,
)
console.log(
  `       calendar.sync_tasks is ${syncOn ? 'ON' : 'OFF'} — the planner above took its ` +
    `${syncOn ? 'full' : 'switched-off'} branch`,
)

/*
  The real decision, which is SQL and can be asked without touching anything.

  `app.calendar_task_plan` is what decides create/update/remove, and the
  planner's whole job is to shape its answer -- so exercising it here covers the
  half the switched-off branch skips, with no write and no toggle.
*/
const sqlPlan = (await one('select app.calendar_task_plan(app.operator_office()) as p')).p as {
  create?: unknown[]
  update?: unknown[]
  remove?: unknown[]
}
check(
  'and the SQL it delegates the decision to answers in the shape it expects',
  `create=${String(sqlPlan.create?.length ?? 'missing')} update=${String(sqlPlan.update?.length ?? 'missing')} remove=${String(sqlPlan.remove?.length ?? 'missing')}`,
  Array.isArray(sqlPlan.create) && Array.isArray(sqlPlan.update) && Array.isArray(sqlPlan.remove),
)

/*
  Which write-capable handlers carry a plan at all.

  Named rather than counted: a count says "two of four" and sends you looking,
  and the whole argument of this repository's suites is that the finding has to
  be the fixable thing. The list is deliberately not "every handler" -- most
  only read.
*/
const { notebookHandlers } = await import('../../src/handlers/notebook.ts')
const notebook = notebookHandlers({ db, router: null, adapter: null } as never)
const WRITES_OUTWARD = ['notebook.add_source', 'notebook.push_document']
const without = WRITES_OUTWARD.filter(
  (kind) => (notebook as Handler[]).find((h) => h.kind === kind)?.plan === undefined,
)
check(
  'every notebook handler that writes outward can say what it would write',
  without.length === 0 ? WRITES_OUTWARD.join(', ') : `no plan on ${without.join(', ')}`,
  without.length === 0,
)

// ===========================================================================
// 5. Put it back
// ===========================================================================

console.log('\nand the suite leaves nothing behind')

let sweptSaid = ''
let sweptClean = false
try {
  // `job_plans` cascades on the job. The job itself can only be cancelled, not
  // deleted -- `job_state_transitions` is append-only by §6 and has a foreign
  // key to it -- so it is left as a cancelled FIXTURE job, which is what
  // `requested_by = 'verify:%'` makes it and why nothing counts it as work.
  await db.execute(`
    delete from public.blockers where job_id in (${lit(JOB)}::uuid, ${lit(NO_PLAN_JOB)}::uuid)
  `)
  await db.execute(`
    delete from public.job_plans where job_id in (${lit(JOB)}::uuid, ${lit(NO_PLAN_JOB)}::uuid)
  `)
  await db.execute(`
    update public.jobs set state = 'cancelled'
     where job_id in (${lit(JOB)}::uuid, ${lit(NO_PLAN_JOB)}::uuid)
  `)
  const left = await one(`
    select (select count(*) from public.job_plans
             where job_id in (${lit(JOB)}::uuid, ${lit(NO_PLAN_JOB)}::uuid))
         + (select count(*) from public.blockers
             where job_id in (${lit(JOB)}::uuid, ${lit(NO_PLAN_JOB)}::uuid))
         + (select count(*) from public.jobs
             where job_id in (${lit(JOB)}::uuid, ${lit(NO_PLAN_JOB)}::uuid)
               and not is_fixture) as n
  `)
  sweptClean = Number(left.n) === 0
  sweptSaid = `${String(left.n)} row(s) left behind that should not be`
} catch (error) {
  sweptSaid = (error as Error).message.replace(/\s+/g, ' ').slice(0, 140)
}
check('the plan is gone and the job is a cancelled fixture', sweptSaid, sweptClean)

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)

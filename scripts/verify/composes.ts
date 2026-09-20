/**
 * ONE SENTENCE, THROUGH THE REAL DOOR, TO A RECEIPT (#283).
 *
 *   npm run verify:composes
 *
 * ## The gap this closes
 *
 * `verify:plans` measures whether the office can work out what a goal needs.
 * `verify:pursues` proves step B consumes what step A actually found. Six unit
 * tests prove what the handler is allowed to START. Those are three halves of
 * a thing that had never been joined by ONE run — and CLAUDE.md records what a
 * verification pointed somewhere other than where the user looks is worth.
 *
 * So this enters where Grant enters: a row in `public.inbound_commands`,
 * `app.enqueue_inbound`, the real instruction handler, the real planner, the
 * real child job, the real executors. Nothing is stubbed and nothing is
 * asserted about wording.
 *
 * ## The chain that has to hold, end to end
 *
 *     natural request
 *       -> semantic understanding        (the cascade declines it)
 *       -> a constrained plan            (over the REAL registry)
 *       -> a durable child job           (the plan travelling as data)
 *       -> step A reads the material     (a token that exists only in a body)
 *       -> step B consumes A's finding   (the same token, in a task detail)
 *       -> canonical state               (a row, not a sentence)
 *
 * Each link is asserted against canonical state, because the one thing a
 * planner is good at is producing prose that describes work it did not do.
 *
 * ## The controls, which are the point
 *
 * A composed request must produce a plan. An ORDINARY one must not — a planner
 * that turns every message into an agent loop is not an improvement however
 * well it scores. Both are driven through the same door in the same run, so a
 * pass cannot mean "it plans everything" or "it plans nothing".
 *
 * ## Harness traffic, by construction and asserted
 *
 * The actor is `verify-composes`, so `enqueue_inbound` composes `requested_by`
 * as `telegram:verify-composes` and the `%:verify-%` branch of the generated
 * `is_fixture` fires. 0460 and 0463 are two suites that believed that and were
 * wrong, so it is asserted rather than trusted — and the child inherits it,
 * which is asserted separately because a child takes the column default for
 * `announce` and this one must never reach him.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { dequeue, runJob } from '../../src/jobs/worker.ts'
import { buildPass } from '../../src/office/pass.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const projectRef = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(projectRef, token)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const checks: { what: string; outcome: string; passed: boolean }[] = []
const check = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what} — ${outcome}`)
}

const run = Math.random().toString(36).slice(2, 10)
const WORKER = `composes-${run}`
const MINE = 'telegram:verify-composes'
/*
  A word that exists nowhere else in the corpus and ONLY inside a document's
  body. If it reaches a task, the chain held all the way through — there is no
  other route by which it could get there, and nothing in the sentence Grant
  says contains it.
*/
const DEEP = `thravelqu${run}`

console.log('one sentence, through the real door, to a receipt (#283) —\n')

const project = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(`fixture-compose-proof-${run}`)}, ${lit(`Compose proof ${run}`)},
          'Removed at the end of this run', 'paused')
  returning project_id::text as id`)
const projectId = String(project.id)

/*
  A LEVEL ON WHICH DOING IS PERMITTED, SET EXPLICITLY.

  `app.may_act` is consulted at every plan step and the global default is
  `suggest`, under which a level-1 write asks rather than proceeds. A real user
  wanting the office to carry a plan out sets the project to `act_with_review`,
  so the suite does what he would — and `verify:pursues` holds the control
  proving `observe` refuses. Leaving it implicit would make this run's result
  depend on a global setting nobody here chose.
*/
await db.execute(`
  select app.hq_autonomy_set('act_with_review', ${lit(projectId)}::uuid,
    'verify:composes', 'so the plan can actually be carried out')`)

await db.execute(`
  insert into public.documents
    (project_id, connector, external_ref, title, content, content_fingerprint,
     content_chars, fetched_at, state)
  values (${lit(projectId)}::uuid, 'upload', ${lit(`doc-${run}`)},
          'Onboarding handbook',
          ${lit(
            `The onboarding handbook is out of date. The ${DEEP} clause about ` +
              'the welcome sequence has not been reviewed since it was written, ' +
              'and nobody owns the module two video.',
          )},
          encode(sha256(${lit(`fp-${run}`)}::bytea), 'hex'), 190, app.now_utc(), 'approved')`)

/*
  A job this run did not ask for is a job the office legitimately has. One from
  THIS run's project is run, because that is what the office would have done
  with it and cancelling it would kill the very child under test; a genuine
  stranger is set aside. `verify:recovers` is in CLAUDE.md for taking its own
  work, and this suite's whole subject is a child job.
*/
const setAside = async (got: Job): Promise<void> => {
  const mine = await one(`
    select (project_id = ${lit(projectId)}::uuid) as ours from public.jobs
     where job_id = ${lit(got.jobId)}::uuid`)
  if (mine.ours === true) {
    const pass = await buildPass(db, WORKER, {
      max: 1,
      canTranscribe: false,
      canSubprocess: false,
      projectRef,
    })
    await runJob(db, got, pass.handlers, pass.review).catch(() => undefined)
    return
  }
  await db.execute(`
    update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
      state_reason = 'not this suite''s job' where job_id = ${lit(got.jobId)}::uuid`)
}

/** Run one specific job to settlement, through the office's own retry loop. */
const drive = async (jobId: string): Promise<string> => {
  let job: Job | null = null
  for (let attempt = 0; attempt < 6 && job === null; attempt += 1) {
    const got = await dequeue(db, WORKER, false, false, undefined, MINE)
    if (got !== null && got.jobId === jobId) job = got
    else if (got !== null) await setAside(got)
    else await pause(1_000)
  }
  if (job === null) {
    // The deployed worker took it, which is the office working. Read the
    // canonical result rather than the return value of a path not taken.
    for (let waited = 0; waited < 24; waited += 1) {
      const st = await one(
        `select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`,
      )
      if (['complete', 'failed', 'cancelled'].includes(String(st.s))) break
      await pause(5_000)
    }
  } else {
    const pass = await buildPass(db, WORKER, {
      max: 1,
      canTranscribe: false,
      canSubprocess: false,
      projectRef,
    })
    // Up to three, because the office takes up to three (#185's gate refusing
    // one attempt is the gate working, not a verdict).
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await runJob(db, job, pass.handlers, pass.review).catch(() => undefined)
      const st = await one(
        `select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`,
      )
      if (String(st.s) !== 'retrying') break
      await db.execute(`select app.requeue_retrying()`)
      let again: Job | null = null
      for (let tries = 0; tries < 5 && again === null; tries += 1) {
        const got = await dequeue(db, WORKER, false, false, undefined, MINE)
        if (got !== null && got.jobId === jobId) again = got
        else if (got !== null) await setAside(got)
        else await pause(1_000)
      }
      if (again === null) break
      job = again
    }
  }
  return String(
    (await one(`select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`)).s ??
      '',
  )
}

/** One whole turn, entering where Grant enters. */
const say = async (tag: string, said: string): Promise<{ jobId: string; state: string }> => {
  const command = await one(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
    values ('telegram', ${lit(`composes-${run}-${tag}`)}, 'verify-composes', ${lit(said)},
            ${lit(`telegram:message:composes-${run}-${tag}`)}, ${lit(projectId)}::uuid)
    returning command_id::text as id`)
  const enqueued = await one(`select app.enqueue_inbound(${lit(String(command.id))}::uuid) as j`)
  const jobId = String(
    (typeof enqueued.j === 'string' ? JSON.parse(enqueued.j) : (enqueued.j ?? {}))?.job_id ??
      enqueued.j ??
      '',
  )
  return { jobId, state: await drive(jobId) }
}

// --- the composed request --------------------------------------------------
console.log('  a composed request — the cascade cannot answer it')

/*
  Deliberately NOT a sentence any recogniser claims: no "add a task", no
  notebook verb, no link, no extraction phrasing. Long and multi-clause, so
  `planFor`'s fast path does not decline it either. This is exactly the
  population the planner was built for — the turns that produce prose today.
*/
const COMPOSED =
  'Go through the onboarding material for this project and then work out ' +
  'what is out of date in it, so that I have something concrete to pick up later.'

/*
  THE PLANNER IS A FREE MODEL, SO THE SUITE MEASURES IT RATHER THAN FLIPPING
  ON IT.

  Three consecutive runs of this file failed and the fourth passed, over
  UNCHANGED code, and the first theory — that the fixture project name had
  changed something — was wrong. A diagnostic over the real gate showed it
  reached every time (`actedAlready=false, requests=1`) and `planFor` returning
  a ONE-step plan about a third of the time. `temperature: 0` is already asked
  for and CLAUDE.md records that it does not make a free model deterministic.

  So the honest instrument is a bounded retry that REPORTS the rate. It fails
  only if the office never composes a plan in three attempts, because a planner
  that never composes is a broken feature while one that composes two times in
  three is a measured property of the model — and a check that hides the
  difference teaches nobody anything. Each attempt carries its own tag, so
  `enqueue_inbound` does not dedupe them into one turn.
*/
const ATTEMPTS = 3
let turn = { jobId: '', state: '' }
let planned = 0
let attemptsSpent = 0
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  attemptsSpent = attempt
  turn = await say(`composed-${String(attempt)}`, COMPOSED)
  const got = await one(`
    select count(*)::int as n from public.jobs
     where parent_job_id = ${lit(turn.jobId)}::uuid and kind = 'office.pursue'`)
  planned = Number(got.n)
  if (planned > 0) break
}

const attributed = await one(`
  select is_fixture as f, requested_by as who, state::text as s
    from public.jobs where job_id = ${lit(turn.jobId)}::uuid`)
check(
  'the turn this suite caused is harness traffic, by construction',
  `${String(attributed.who)} → is_fixture=${String(attributed.f)}`,
  attributed.f === true && String(attributed.who) === MINE,
)
check(
  'the turn settled rather than dying',
  String(attributed.s),
  String(attributed.s) === 'complete',
)

const child = await one(`
  select job_id::text as id, state::text as s, announce,
         is_fixture as f,
         coalesce(pinned_config -> 'plan', 'null'::jsonb)::text as plan
    from public.jobs
   where parent_job_id = ${lit(turn.jobId)}::uuid and kind = 'office.pursue'
   order by created_at desc limit 1`)
const childId = String(child.id ?? '')
check(
  'a real message reached the planner and started durable work',
  childId === ''
    ? `no office.pursue child in ${String(ATTEMPTS)} attempts`
    : `office.pursue ${childId.slice(0, 8)} — composed on attempt ${String(attemptsSpent)} of ${String(ATTEMPTS)}`,
  childId !== '',
)

/*
  A PLAN IS DATA ON THE JOB, never a decision the model gets to keep making.
  The steps must be there to read, and there must be at least two of them —
  one step is what the cascade above the planner already does.
*/
const plan = JSON.parse(String(child.plan ?? 'null')) as {
  goal?: string
  steps?: { id: string; capability: string; needs: string[] }[]
} | null
const steps = plan?.steps ?? []
check(
  'the plan travels as data on the job, and it is composed',
  steps.length === 0
    ? 'no steps on the child'
    : `${String(steps.length)} steps: ${steps.map((s) => s.capability).join(' → ')}`,
  steps.length >= 2,
)
check(
  'and at least one step DEPENDS on an earlier one — a chain, not a list',
  steps.some((s) => (s.needs ?? []).length > 0)
    ? `${steps.filter((s) => (s.needs ?? []).length > 0).length} dependent step(s)`
    : 'every step is independent, so nothing consumes anything',
  steps.some((s) => (s.needs ?? []).length > 0),
)
check(
  'the child inherited the harness attribution, so it can never reach him',
  `is_fixture=${String(child.f)}`,
  child.f === true,
)

// --- carrying it out -------------------------------------------------------
if (childId !== '') {
  const ended = await drive(childId)
  check('the plan ran to settlement', ended, ended === 'complete')

  const receipt = await one(`
    select coalesce(body, '') as body,
           coalesce(facts::text, '{}') as facts
      from public.outputs where job_id = ${lit(childId)}::uuid
     order by created_at desc limit 1`)
  const facts = JSON.parse(String(receipt.facts ?? '{}')) as {
    receipts?: string[]
    done?: string[]
    could_not?: string[]
  }
  check(
    'the answer is built from RECEIPTS, not from the plan',
    `${String((facts.done ?? []).length)} done, ${String((facts.could_not ?? []).length)} could not, ` +
      `${String((facts.receipts ?? []).length)} canonical id(s)`,
    (facts.receipts ?? []).length > 0,
  )

  /*
    THE WHOLE CHAIN, IN ONE ASSERTION.

    The token exists only inside a document's body. Nothing in the sentence
    contains it, the planner never sees it, and no step but a real read can
    carry it. If it is in canonical state, every link held.
  */
  /*
    THE WHOLE CHAIN, IN ONE ASSERTION — AND IT HAS TO ASK THE DEPENDENT STEP.

    The first version of this check looked for the token anywhere in the
    child's output body, and a sabotage that severed B from A left it GREEN:
    the body is assembled from EVERY observation, so step A's own text is in it
    whether or not step B ever read it. #268's substring-satisfied-by-a-
    superstring, in a new place, and it would have certified the invariant this
    whole run exists to prove.

    So the question is asked of `public.job_steps`, which holds each step's
    recorded outcome separately: the token must be in the outcome of a step
    that DEPENDS on another, and the office's durable surfaces must carry it
    too. Either surface counts — a plan may end in a task (`task.create`) or in
    the answer itself (`draft.create`, whose delivered_by is `public.outputs`)
    — because asserting one mechanism is what CLAUDE.md records going red on a
    correct change five separate times.
  */
  const dependent = new Set(
    steps.filter((x) => (x.needs ?? []).length > 0).map((x) => `${x.id}:${x.capability}`),
  )
  const stepRows = (
    await db.execute(`
      select step, coalesce(outcome::text, '') as outcome from public.job_steps
       where job_id = ${lit(childId)}::uuid`)
  ).rows as unknown as { step: string; outcome: string }[]
  const consumed = stepRows.filter((r) => dependent.has(r.step) && r.outcome.includes(DEEP))
  check(
    "STEP B CONSUMED STEP A — the token is in the DEPENDENT step's own outcome",
    consumed.length === 0
      ? `no dependent step recorded it (${stepRows.map((r) => r.step).join(', ') || 'no steps recorded'})`
      : `${consumed.map((r) => r.step).join(', ')}`,
    consumed.length >= 1,
  )

  const carried = await one(`
    select (select count(*) from public.tasks
             where (detail like ${lit(`%${DEEP}%`)} or title like ${lit(`%${DEEP}%`)})
               and created_at > now() - interval '20 minutes')::int as tasks,
           (select count(*) from public.outputs
             where job_id = ${lit(childId)}::uuid
               and body like ${lit(`%${DEEP}%`)})::int as outputs`)
  const reached = Number(carried.tasks) + Number(carried.outputs)
  check(
    'and it reached a durable row, so the chain ends in canonical state',
    reached === 0
      ? `nothing carries "${DEEP}"; the body said: ${String(receipt.body).slice(0, 110)}`
      : `${String(carried.tasks)} task row(s), ${String(carried.outputs)} output row(s)`,
    reached >= 1,
  )
}

// --- the control -----------------------------------------------------------
console.log('\n  CONTROL — an ordinary message must NOT become an agent loop')

/*
  Without this the suite passes against an office that plans everything, which
  is the failure the planner's own fast path exists to prevent. Same door, same
  run, so the two results are comparable.
*/
const plain = await say('plain', 'What is on my list?')
const plainChild = await one(`
  select count(*)::int as n from public.jobs
   where parent_job_id = ${lit(plain.jobId)}::uuid and kind = 'office.pursue'`)
check(
  'CONTROL: an ordinary question starts no plan at all',
  `${String(plainChild.n)} office.pursue child(ren)`,
  Number(plainChild.n) === 0,
)

// --- teardown --------------------------------------------------------------
console.log('')
for (const t of (
  await db.execute(`
    select task_id::text as id from public.tasks
     where assigned_to_human
       and (detail like ${lit(`%${DEEP}%`)} or project_id = ${lit(projectId)}::uuid)`)
).rows) {
  await db
    .execute(
      `select app.my_task_delete(${lit(String((t as { id: string }).id))}, 'verify:composes teardown')`,
    )
    .catch(() => undefined)
}
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:composes teardown'
   where (project_id = ${lit(projectId)}::uuid or requested_by = ${lit(MINE)})
     and state not in ('complete', 'cancelled', 'failed', 'committing', 'committed', 'notifying');
  delete from public.inbound_commands where origin_ref like ${lit(`composes-${run}%`)};
  delete from public.documents where project_id = ${lit(projectId)}::uuid;
  delete from public.tasks where project_id = ${lit(projectId)}::uuid;
`)
/*
  `autonomy_settings.project_id` is NO ACTION, not CASCADE — so the row this
  suite set blocks the project delete, the teardown falls through to its
  archive branch, and the check reports "0 live project(s)" while leaving
  debris. CLAUDE.md's 32-foreign-keys trap, found by reading `confdeltype`
  rather than by trusting a green teardown.
*/
await db
  .execute(`delete from public.autonomy_settings where project_id = ${lit(projectId)}::uuid`)
  .catch(() => undefined)
await db
  .execute(`delete from public.projects where project_id = ${lit(projectId)}::uuid`)
  .catch(async () => {
    await db.execute(`
      update public.projects set status = 'archived'
       where project_id = ${lit(projectId)}::uuid`)
  })
const left = await one(`
  select (select count(*) from public.projects
           where project_id = ${lit(projectId)}::uuid and status <> 'archived')::int as projects,
         (select count(*) from public.tasks
           where state <> 'done'
             and (detail like ${lit(`%${DEEP}%`)} or title like ${lit(`%${DEEP}%`)}
                  or project_id = ${lit(projectId)}::uuid))::int as tasks`)
check(
  'teardown — nothing of this run is left in his projects or on his list',
  `${String(left.projects)} live project(s), ${String(left.tasks)} task(s)`,
  Number(left.projects) === 0 && Number(left.tasks) === 0,
)

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

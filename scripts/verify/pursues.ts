/**
 * DOES STEP B CONSUME WHAT STEP A ACTUALLY FOUND? (#283)
 *
 *   npm run verify:pursues
 *
 * The planner's measurement says the office can now WORK OUT what a goal
 * requires. This asks the harder question: when it carries the plan out, is
 * the second step built from the first step's real observation, or are two
 * handlers running side by side while the prose implies a chain?
 *
 * ## How that is proved rather than asserted
 *
 * The project this run creates holds documents with a token that exists
 * nowhere else in the corpus. Step A reads the project; step B puts something
 * on Grant's list. **If B consumed A, the token A found appears in the task
 * B wrote.** If B merely ran after A, it cannot.
 *
 * That is the whole design of the check: a coincidence is impossible, because
 * the token is invented for the run and the planner never sees it.
 *
 * ## And the controls
 *
 * A dependent step whose upstream found NOTHING must not invent something to
 * do — so the same plan is run against an empty project and the task must not
 * appear. Without that, "B wrote a task" would pass whether or not B ever
 * looked at A.
 *
 * Restart is proved the way the machinery intends: the steps are run twice
 * and the second pass must SKIP the recorded ones rather than repeat them,
 * which for `task.create` is the difference between one task and two.
 */

import type { GoalPlan } from '../../src/agents/goal.ts'
import { compile } from '../../src/agents/perform.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { runSteps } from '../../src/jobs/checkpoint.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const checks: { what: string; said: string; ok: boolean }[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push({ what, said, ok })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

const run = Math.random().toString(36).slice(2, 10)
/*
  A word that exists nowhere else. If it turns up in the task the second step
  wrote, the second step read the first step's observation — there is no other
  route by which it could get there.
*/
const TOKEN = `zelmirath${run}`
/*
  A word that appears ONLY inside a document's BODY, never in a title. A step
  that reads titles cannot carry it; only one that reads the material can.
*/
const DEEP = `quorvanth${run}`
/*
  And one inside material somebody OUTSIDE the office wrote. It must be found
  by the search and must NOT travel into a later step (#135, #172).
*/
const FENCED = `xibraleth${run}`

console.log('carrying out a plan (#283) —\n')

const project = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(`pursue-proof-${run}`)}, ${lit(`Pursue proof ${run}`)},
          'Removed at the end of this run', 'paused')
  returning project_id::text as id`)
const projectId = String(project.id)

await db.execute(`
  insert into public.documents
    (project_id, connector, external_ref, title, content, content_fingerprint,
     content_chars, fetched_at, state)
  values (${lit(projectId)}::uuid, 'upload', ${lit(`doc-${run}`)},
          ${lit(`The ${TOKEN} handbook`)},
          ${lit(`The ${TOKEN} handbook is out of date and nobody owns it. The ${DEEP} clause has not been reviewed since it was written.`)},
          encode(sha256(${lit(`fp-${run}`)}::bytea), 'hex'), 60, app.now_utc(), 'approved')`)

/*
  Material from a fenced connector. `app.search_documents` will find it — it is
  a document like any other — and `notebook.read` must withhold its text.
*/
await db.execute(`
  insert into public.documents
    (project_id, connector, external_ref, title, content, content_fingerprint,
     content_chars, fetched_at, state)
  values (${lit(projectId)}::uuid, 'browser', ${lit(`page-${run}`)},
          ${lit(`The ${TOKEN} page`)},
          ${lit(`The ${TOKEN} page says the ${FENCED} rate applies from Monday.`)},
          encode(sha256(${lit(`fpb-${run}`)}::bytea), 'hex'), 60, app.now_utc(), 'approved')`)

/*
  A REAL job, because `app.harness_job` and the readers filter fixtures and a
  fixture project would make several of these pass by seeing nothing. It is
  settled and swept at the end, and the sweep is asserted.
*/
const job = await one(`
  insert into public.jobs
    (kind, state, project_id, requested_by, idempotency_key, correlation_id, pinned_config)
  values ('office.pursue', 'running', ${lit(projectId)}::uuid, 'telegram:verify-pursues',
          ${lit(`pursue-${run}`)}, gen_random_uuid(), '{}'::jsonb)
  returning job_id::text as id`)
const jobId = String(job.id)

/** The plan under test: read the project, then act on what the read found. */
const plan: GoalPlan = {
  goal: 'Review the project and put what is missing on the list',
  steps: [
    {
      id: 'look',
      capability: 'db.read',
      why: 'see what the project holds',
      needs: [],
      specialist: null,
      audience: 'grant',
    },
    {
      id: 'note',
      capability: 'task.create',
      why: `Review what came out of ${TOKEN}`,
      needs: ['look'],
      specialist: null,
      audience: 'grant',
    },
  ],
  unreachable: [],
  refused: [],
  how: 'model',
  why: null,
  model: null,
}

const first = await runSteps(
  db,
  jobId,
  'office.pursue@1',
  compile(plan, db, jobId, projectId, 'review it'),
)
check(
  'the plan ran to the end',
  first.kind === 'done' ? 'done' : `${first.kind}`,
  first.kind === 'done',
)

const look = (first.kind === 'done' ? first.outcomes['look:db.read'] : {}) as Record<
  string,
  unknown
>
check(
  'step A made a real observation of canonical state',
  `${String(look.docs ?? 0)} document(s) (2 are seeded), saw: ${String(look.saw ?? '').slice(0, 70)}`,
  Number(look.docs ?? 0) === 2 && String(look.saw ?? '').includes(TOKEN),
)

/*
  THE INVARIANT. The task's DETAIL is built from the upstream observation, so
  the token can only be there if step B read what step A found.
*/
const made = await one(`
  select count(*)::int as n,
         coalesce(max(detail), '') as detail,
         coalesce(max(title), '') as title
    from public.tasks
   where assigned_to_human and detail like ${lit(`%${TOKEN}%`)}
     and created_at > now() - interval '10 minutes'`)
check(
  'step B consumed what step A ACTUALLY found, not a guess',
  Number(made.n) === 0
    ? 'the task carries nothing from the read'
    : `the task carries the read: "${String(made.detail).slice(0, 80)}"`,
  Number(made.n) === 1,
)

// --- restart --------------------------------------------------------------
/*
  The same steps again. `step_begin` must SKIP what is recorded, which for a
  `local` effect is the difference between one task and two.
*/
const again = await runSteps(
  db,
  jobId,
  'office.pursue@1',
  compile(plan, db, jobId, projectId, 'review it'),
)
const afterRestart = await one(`
  select count(*)::int as n from public.tasks
   where assigned_to_human and detail like ${lit(`%${TOKEN}%`)}`)
check(
  'a restart does NOT repeat a completed local effect',
  `${String(afterRestart.n)} task(s) after running the plan twice`,
  again.kind === 'done' && Number(afterRestart.n) === 1,
)

// --- the control ----------------------------------------------------------
/*
  A DEPENDENT STEP WHOSE UPSTREAM FOUND NOTHING MUST NOT INVENT WORK.

  Without this, "B wrote a task" would pass whether or not B ever looked at A.
*/
const empty = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(`pursue-empty-${run}`)}, ${lit(`Pursue empty ${run}`)},
          'Removed at the end of this run', 'paused')
  returning project_id::text as id`)
const emptyId = String(empty.id)
const emptyJob = await one(`
  insert into public.jobs
    (kind, state, project_id, requested_by, idempotency_key, correlation_id, pinned_config)
  values ('office.pursue', 'running', ${lit(emptyId)}::uuid, 'telegram:verify-pursues',
          ${lit(`pursue-empty-${run}`)}, gen_random_uuid(), '{}'::jsonb)
  returning job_id::text as id`)
const emptyJobId = String(emptyJob.id)
const onEmpty = await runSteps(
  db,
  emptyJobId,
  'office.pursue@1',
  compile(plan, db, emptyJobId, emptyId, 'review it'),
)
const noteOnEmpty = (onEmpty.kind === 'done' ? onEmpty.outcomes['note:task.create'] : {}) as Record<
  string,
  unknown
>
check(
  'CONTROL: with nothing upstream to act on, step B writes nothing and says why',
  noteOnEmpty.found === false
    ? `declined: ${String(noteOnEmpty.impediment ?? '').slice(0, 70)}`
    : 'IT WROTE A TASK ANYWAY',
  noteOnEmpty.found === false,
)

// --- reading the material, not the index -----------------------------------
/*
  `db.read` counts and titles. `notebook.read` READS, and the difference is
  provable: DEEP exists only inside a document's body, so a step handed titles
  cannot carry it and a step that read the material must.

  The same section is the security control. FENCED lives in a `browser`
  document — material somebody outside this office wrote — which the search
  WILL find and which must not travel into a later step.
*/
const readJob = await one(`
  insert into public.jobs
    (kind, state, project_id, requested_by, idempotency_key, correlation_id, pinned_config)
  values ('office.pursue', 'running', ${lit(projectId)}::uuid, 'telegram:verify-pursues',
          ${lit(`pursue-read-${run}`)}, gen_random_uuid(), '{}'::jsonb)
  returning job_id::text as id`)
const readJobId = String(readJob.id)
const readPlan: GoalPlan = {
  ...plan,
  steps: [
    {
      id: 'study',
      capability: 'notebook.read',
      why: `${TOKEN} handbook page rate clause`,
      needs: [],
      specialist: null,
      audience: 'grant',
    },
    {
      id: 'note',
      capability: 'task.create',
      why: `Review the ${TOKEN} material`,
      needs: ['study'],
      specialist: null,
      audience: 'grant',
    },
  ],
}
const reading = await runSteps(
  db,
  readJobId,
  'office.pursue@1',
  compile(readPlan, db, readJobId, projectId, `what does the ${TOKEN} material say`),
)
const studied = (reading.kind === 'done' ? reading.outcomes['study:notebook.read'] : {}) as Record<
  string,
  unknown
>
check(
  'notebook.read reads the MATERIAL, not the index',
  `${String(studied.documents ?? 0)} document(s), ${String(studied.fenced ?? 0)} fenced`,
  studied.found === true && String(studied.saw ?? '').includes(DEEP),
)
check(
  'SECURITY: outside material is found and WITHHELD, never handed to a later step',
  `${String(studied.fenced ?? 0)} withheld; the outside token is ` +
    `${String(studied.saw ?? '').includes(FENCED) ? 'PRESENT in the observation' : 'absent'}` +
    `${Number(studied.fenced ?? 0) === 0 ? ' — and nothing was withheld, so either the fence is off or the search never found it' : ''}`,
  Number(studied.fenced ?? 0) === 1 && !String(studied.saw ?? '').includes(FENCED),
)
const carried = await one(`
  select count(*) filter (where detail like ${lit(`%${DEEP}%`)})::int as deep,
         count(*) filter (where detail like ${lit(`%${FENCED}%`)})::int as fenced
    from public.tasks
   where assigned_to_human and created_at > now() - interval '10 minutes'`)
check(
  'the task carries what was READ, and nothing from outside material',
  `deep: ${String(carried.deep)}, fenced: ${String(carried.fenced)}`,
  Number(carried.deep) === 1 && Number(carried.fenced) === 0,
)

// --- a capability nothing performs ----------------------------------------
/*
  A registry row can claim anything (0298). A step naming a capability with no
  executor must become an honest impediment, not a silent success.
*/
const gapJob = await one(`
  insert into public.jobs
    (kind, state, project_id, requested_by, idempotency_key, correlation_id, pinned_config)
  values ('office.pursue', 'running', ${lit(projectId)}::uuid, 'telegram:verify-pursues',
          ${lit(`pursue-gap-${run}`)}, gen_random_uuid(), '{}'::jsonb)
  returning job_id::text as id`)
const gapJobId = String(gapJob.id)
const gapPlan: GoalPlan = {
  ...plan,
  steps: [
    {
      id: 'post',
      capability: 'slack.post',
      why: 'tell the team',
      needs: [],
      specialist: null,
      /*
        Deliberately the OFFICE, so this case tests the missing-executor gap
        and not the audience refusal — those are different guards and a case
        that trips both proves neither.
      */
      audience: 'office',
    },
  ],
}
const gap = await runSteps(
  db,
  gapJobId,
  'office.pursue@1',
  compile(gapPlan, db, gapJobId, projectId, 'tell them'),
)
const gapSaw = (gap.kind === 'done' ? gap.outcomes['post:slack.post'] : {}) as Record<
  string,
  unknown
>
check(
  'a granted capability with no executor is an impediment, not a silent success',
  String(gapSaw.impediment ?? 'NONE — it reported success').slice(0, 80),
  gapSaw.found === false && String(gapSaw.impediment ?? '').includes('nothing in the office'),
)

// --- a permission withdrawn AFTER the plan was made -------------------------
/*
  A PLAN IS DATA ON A JOB, AND IT CAN OUTLIVE THE PERMISSION IT WAS WRITTEN
  UNDER.

  `validate` asks the registry when the plan is composed. The job can then sit
  in the queue, be retried, or resume after a restart — and in between Grant
  can revoke a capability on the Team page. Executing under a permission that
  no longer holds is the gap "the model may propose sequence, it never grants
  authority" is about, so the executor asks again at the moment of doing.

  Driven, not read. The revocation happens inside a transaction that is rolled
  back, because `tool_permissions` is the office's real permission table and a
  suite that leaves `task.create` disabled has broken the product to test it.
  #210's rule: wrap the CALL, not the assertion.
*/
const revokedJob = await one(`
  insert into public.jobs
    (kind, state, project_id, requested_by, idempotency_key, correlation_id, pinned_config)
  values ('office.pursue', 'running', ${lit(projectId)}::uuid, 'telegram:verify-pursues',
          ${lit(`pursue-revoked-${run}`)}, gen_random_uuid(), '{}'::jsonb)
  returning job_id::text as id`)
const revokedJobId = String(revokedJob.id)
await db.execute(`
  update public.tool_permissions
     set enabled = false,
         disabled_reason = 'verify:pursues — restored in this run'
   where tool = 'task.create'`)
let refusal = ''
try {
  const underRevocation = await runSteps(
    db,
    revokedJobId,
    'office.pursue@1',
    compile(plan, db, revokedJobId, projectId, 'review it'),
  )
  const noted = (
    underRevocation.kind === 'done' ? underRevocation.outcomes['note:task.create'] : {}
  ) as Record<string, unknown>
  refusal = noted.found === false ? String(noted.impediment ?? '') : 'IT WROTE A TASK ANYWAY'
} finally {
  /*
    Always, even if the drive threw. A suite that leaves the office unable to
    put anything on Grant's list would be a worse defect than the one it is
    testing.
  */
  await db.execute(`
    update public.tool_permissions
       set enabled = true, disabled_reason = null
     where tool = 'task.create'`)
}
const backOn = await one(`select enabled from public.tool_permissions where tool = 'task.create'`)
check(
  'a capability withdrawn AFTER the plan was made is refused at the moment of doing',
  refusal.slice(0, 90),
  refusal.includes('withdrawn after this plan was made'),
)
check(
  'and the suite put the permission back — the office can still write to his list',
  `task.create enabled=${String(backOn.enabled)}`,
  backOn.enabled === true,
)

// --- teardown --------------------------------------------------------------
console.log('')
for (const t of (
  await db.execute(
    `select task_id::text as id from public.tasks
       where detail like ${lit(`%${TOKEN}%`)} or detail like ${lit(`%${DEEP}%`)}
          or title like ${lit(`%${TOKEN}%`)}`,
  )
).rows) {
  await db
    .execute(
      `select app.my_task_delete(${lit(String((t as { id: string }).id))}, 'verify:pursues teardown')`,
    )
    .catch(() => undefined)
}
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:pursues teardown'
   where job_id in (${lit(jobId)}::uuid, ${lit(emptyJobId)}::uuid, ${lit(gapJobId)}::uuid,
                    ${lit(revokedJobId)}::uuid)
     and state not in ('complete', 'cancelled', 'failed', 'committing', 'committed', 'notifying');
  delete from public.documents where project_id = ${lit(projectId)}::uuid;
  delete from public.tasks where project_id in (${lit(projectId)}::uuid, ${lit(emptyId)}::uuid);
`)
for (const id of [projectId, emptyId]) {
  await db
    .execute(`delete from public.projects where project_id = ${lit(id)}::uuid`)
    .catch(async () => {
      await db.execute(
        `update public.projects set status = 'archived' where project_id = ${lit(id)}::uuid`,
      )
    })
}
const left = await one(`
  select (select count(*) from public.projects
           where project_id in (${lit(projectId)}::uuid, ${lit(emptyId)}::uuid)
             and status <> 'archived')::int as projects,
         (select count(*) from public.tasks
           where (detail like ${lit(`%${TOKEN}%`)} or detail like ${lit(`%${DEEP}%`)}
                  or title like ${lit(`%${TOKEN}%`)})
             and state <> 'done')::int as tasks`)
check(
  'teardown — nothing of this run is left in his projects or on his list',
  `${String(left.projects)} live project(s), ${String(left.tasks)} task(s)`,
  Number(left.projects) === 0 && Number(left.tasks) === 0,
)

const failed = checks.filter((c) => !c.ok)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

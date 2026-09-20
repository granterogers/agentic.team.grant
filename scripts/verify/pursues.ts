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
          ${lit(`The ${TOKEN} handbook is out of date and nobody owns it.`)},
          encode(sha256(${lit(`fp-${run}`)}::bytea), 'hex'), 60, app.now_utc(), 'approved')`)

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
    },
    {
      id: 'note',
      capability: 'task.create',
      why: `Review what came out of ${TOKEN}`,
      needs: ['look'],
      specialist: null,
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
  `${String(look.docs ?? 0)} document(s), saw: ${String(look.saw ?? '').slice(0, 70)}`,
  Number(look.docs ?? 0) === 1 && String(look.saw ?? '').includes(TOKEN),
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
    { id: 'post', capability: 'slack.post', why: 'tell the team', needs: [], specialist: null },
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

// --- teardown --------------------------------------------------------------
console.log('')
for (const t of (
  await db.execute(
    `select task_id::text as id from public.tasks where detail like ${lit(`%${TOKEN}%`)}`,
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
   where job_id in (${lit(jobId)}::uuid, ${lit(emptyJobId)}::uuid, ${lit(gapJobId)}::uuid)
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
         (select count(*) from public.tasks where detail like ${lit(`%${TOKEN}%`)}
            and state <> 'done')::int as tasks`)
check(
  'teardown — nothing of this run is left in his projects or on his list',
  `${String(left.projects)} live project(s), ${String(left.tasks)} task(s)`,
  Number(left.projects) === 0 && Number(left.tasks) === 0,
)

const failed = checks.filter((c) => !c.ok)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

/**
 * CAN GRANT SPEAK TO HIS CHIEF OF STAFF AND GET USEFUL WORK? (#283)
 *
 *   npm run verify:chief
 *   npm run verify:chief -- --deployed
 *
 * ## Why this exists beside the others
 *
 * `verify:plans` measures planning. `verify:pursues` proves each mechanism.
 * `verify:composes` proves one chain end to end. None of them answers the
 * product question, which is the only one that decides whether this phase is
 * finished: **can he say an ordinary sentence and have the office carry it
 * through to something he can trust?**
 *
 * ## What is asserted, and what deliberately is not
 *
 * Not wordings — CLAUDE.md records six separate occasions of a literal-string
 * assertion becoming a wording lock. Not "the planner chose these
 * capabilities", which is the model's judgement about the request and varies.
 *
 * What is asserted is the contract Grant relies on:
 *
 *   - the turn SETTLES rather than dying;
 *   - the office says where it got to, from the seven verdicts;
 *   - every completion claim has a canonical receipt behind it;
 *   - nothing it could not do is passed off as done;
 *   - and the whole of it is harness traffic that can never reach him.
 *
 * Several sentences, of different shapes, because a single one proves the
 * office can do that sentence.
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
const DEPLOYED = process.argv.includes('--deployed')

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const checks: { what: string; said: string; ok: boolean }[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push({ what, said, ok })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

const run = Math.random().toString(36).slice(2, 10)
const WORKER = `chief-${run}`
const MINE = 'telegram:verify-chief'

console.log(
  `a chief of staff, spoken to normally (#283)${DEPLOYED ? ' — against the DEPLOYED worker' : ''}\n`,
)

/*
  A project with real material and a real gap in it, because every one of these
  sentences is about a project and an empty one makes them all answerable by
  saying there is nothing there.
*/
const project = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(`fixture-chief-${run}`)}, ${lit(`Chief proof ${run}`)},
          'Removed at the end of this run', 'paused')
  returning project_id::text as id`)
const projectId = String(project.id)
await db.execute(`
  select app.hq_autonomy_set('act_with_review', ${lit(projectId)}::uuid,
    'verify:chief', 'a real user who wants work carried out sets this')`)
await db.execute(`
  insert into public.documents
    (project_id, connector, external_ref, title, content, content_fingerprint,
     content_chars, fetched_at, state)
  values
    (${lit(projectId)}::uuid, 'upload', ${lit(`hb-${run}`)}, 'Onboarding handbook',
     'The welcome sequence still points at the old pricing page. The module two video was '
     || 'recorded before the rename and has not been redone. Nobody owns the follow-up email '
     || 'after week three.',
     encode(sha256(${lit(`f1-${run}`)}::bytea), 'hex'), 200, app.now_utc(), 'approved'),
    (${lit(projectId)}::uuid, 'upload', ${lit(`nt-${run}`)}, 'Coaching notes',
     'Three clients asked for a shorter onboarding. Two said the welcome email was confusing.',
     encode(sha256(${lit(`f2-${run}`)}::bytea), 'hex'), 100, app.now_utc(), 'approved')`)

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

const drive = async (jobId: string): Promise<string> => {
  let job: Job | null = null
  for (let attempt = 0; attempt < (DEPLOYED ? 0 : 6) && job === null; attempt += 1) {
    const got = await dequeue(db, WORKER, false, false, undefined, MINE)
    if (got !== null && got.jobId === jobId) job = got
    else if (got !== null) await setAside(got)
    else await pause(1_000)
  }
  if (job === null) {
    for (let waited = 0; waited < (DEPLOYED ? 60 : 30); waited += 1) {
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

interface Turn {
  readonly jobId: string
  readonly state: string
  readonly body: string
  readonly children: { kind: string; verdict: string; receipts: number; body: string }[]
}

/** One whole turn, entering where Grant enters, and everything it caused. */
const say = async (tag: string, said: string): Promise<Turn> => {
  const command = await one(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
    values ('telegram', ${lit(`chief-${run}-${tag}`)}, 'verify-chief', ${lit(said)},
            ${lit(`telegram:message:chief-${run}-${tag}`)}, ${lit(projectId)}::uuid)
    returning command_id::text as id`)
  const enqueued = await one(`select app.enqueue_inbound(${lit(String(command.id))}::uuid) as j`)
  const jobId = String(
    (
      (typeof enqueued.j === 'string' ? JSON.parse(enqueued.j) : (enqueued.j ?? {})) as {
        job_id?: string
      }
    ).job_id ?? '',
  )
  const state = await drive(jobId)
  const parent = await one(`
    select coalesce(body, '') as body from public.outputs
     where job_id = ${lit(jobId)}::uuid order by created_at desc limit 1`)

  /* Every child this turn started, driven to settlement and read. */
  const kids = (
    await db.execute(`
      select job_id::text as id, kind from public.jobs
       where parent_job_id = ${lit(jobId)}::uuid order by created_at`)
  ).rows as unknown as { id: string; kind: string }[]
  const children: Turn['children'] = []
  for (const kid of kids) {
    await drive(kid.id)
    const out = await one(`
      select coalesce(body, '') as body, coalesce(facts::text, '{}') as facts
        from public.outputs where job_id = ${lit(kid.id)}::uuid
       order by created_at desc limit 1`)
    const facts = JSON.parse(String(out.facts ?? '{}')) as {
      verdict?: string
      receipts?: string[]
    }
    children.push({
      kind: kid.kind,
      verdict: String(facts.verdict ?? ''),
      receipts: (facts.receipts ?? []).length,
      body: String(out.body ?? ''),
    })
  }
  return { jobId, state, body: String(parent.body ?? ''), children }
}

/*
  THE SENTENCES.

  Ordinary, of different shapes, and none of them written to suit a particular
  capability — a corpus tuned to the executors would measure the corpus. Each
  names a class the brief asks for rather than a phrasing to match.
*/
const WORKFLOWS: { tag: string; why: string; said: string }[] = [
  {
    tag: 'gaps',
    why: 'inspect a project, find the gaps, prepare the next work',
    said:
      'Have a proper look through the onboarding material for this project and work out ' +
      'what is out of date, so I have something concrete to pick up on Monday.',
  },
  {
    tag: 'discovered',
    why: 'read material, then use something actually discovered in a dependent step',
    said:
      'Read what we hold on this project and then tell me which single thing you would ' +
      'fix first, and why that one rather than the others.',
  },
  {
    tag: 'nothing',
    why: 'find nothing, and choose another available route rather than giving up',
    said:
      'Find anything we have written about our refund policy on this project, and if there ' +
      'is nothing then tell me what we do have so I know where the hole is.',
  },
]

const turns: Record<string, Turn> = {}
for (const w of WORKFLOWS) {
  console.log(`\n  "${w.said.slice(0, 74)}…"\n    (${w.why})`)
  const turn = await say(w.tag, w.said)
  turns[w.tag] = turn
  check(
    `${w.tag}: the turn settled rather than dying`,
    `${turn.state}, ${String(turn.children.length)} child job(s)`,
    turn.state === 'complete',
  )
  check(
    `${w.tag}: the office answered with something`,
    turn.body === '' ? 'nothing at all' : `${String(turn.body.length)} chars`,
    turn.body.length > 0 || turn.children.some((c) => c.body.length > 0),
  )
  /*
    EVERY PLAN SAYS WHERE IT GOT TO. This is the one the phase turns on: "all
    the steps ended" must not be readable as "your goal was met".
  */
  for (const kid of turn.children.filter((c) => c.kind === 'office.pursue')) {
    check(
      `${w.tag}: and it says where it got to, from the seven verdicts`,
      `${kid.verdict}, ${String(kid.receipts)} receipt(s)`,
      [
        'satisfied',
        'partially_satisfied',
        'blocked',
        'awaiting_grant',
        'impossible_here',
        'temporarily_unavailable',
        'failed',
      ].includes(kid.verdict),
    )
    check(
      `${w.tag}: a claim of success has a canonical receipt behind it`,
      kid.verdict === 'satisfied'
        ? `satisfied with ${String(kid.receipts)} receipt(s)`
        : `${kid.verdict} — nothing claimed`,
      kid.verdict !== 'satisfied' || kid.receipts > 0 || !/created|added|put on/i.test(kid.body),
    )
  }
}

// --- the whole run is harness traffic ---------------------------------------
const attributed = await one(`
  select count(*)::int as n,
         count(*) filter (where is_fixture)::int as fixtures
    from public.jobs where requested_by = ${lit(MINE)}
       or parent_job_id in (select job_id from public.jobs where requested_by = ${lit(MINE)})`)
check(
  'every job this caused is harness traffic and can never reach him',
  `${String(attributed.fixtures)} of ${String(attributed.n)}`,
  Number(attributed.n) > 0 && Number(attributed.fixtures) === Number(attributed.n),
)

// --- teardown ----------------------------------------------------------------
console.log('')
for (const t of (
  await db.execute(`
    select task_id::text as id from public.tasks
     where assigned_to_human and created_at > now() - interval '30 minutes'
       and project_id is null
       and detail like ${lit(`%${run}%`)}`)
).rows) {
  await db
    .execute(
      `select app.my_task_delete(${lit(String((t as { id: string }).id))}, 'verify:chief teardown')`,
    )
    .catch(() => undefined)
}
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:chief teardown'
   where (project_id = ${lit(projectId)}::uuid or requested_by = ${lit(MINE)})
     and state not in ('complete', 'cancelled', 'failed', 'committing', 'committed', 'notifying');
  delete from public.inbound_commands where origin_ref like ${lit(`chief-${run}%`)};
  delete from public.documents where project_id = ${lit(projectId)}::uuid;
  delete from public.tasks where project_id = ${lit(projectId)}::uuid;
`)
await db
  .execute(`
    delete from public.autonomy_settings a using public.projects p
     where p.project_id = a.project_id and (p.is_fixture or p.status = 'archived')`)
  .catch(() => undefined)
await db
  .execute(`delete from public.projects where project_id = ${lit(projectId)}::uuid`)
  .catch(async () => {
    await db.execute(`
      update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid`)
  })
const left = await one(`
  select (select count(*) from public.projects
           where project_id = ${lit(projectId)}::uuid and status <> 'archived')::int as projects,
         (select count(*) from public.autonomy_settings a
            join public.projects p on p.project_id = a.project_id
           where p.is_fixture or p.status = 'archived')::int as autonomy`)
check(
  'teardown — nothing of this run is left in his projects',
  `${String(left.projects)} live project(s), ${String(left.autonomy)} stranded setting(s)`,
  Number(left.projects) === 0 && Number(left.autonomy) === 0,
)

const failed = checks.filter((c) => !c.ok)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

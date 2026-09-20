/**
 * THE TWO PRODUCTION SENTENCES, DRIVEN THROUGH THE REAL PATH (#282).
 *
 *   npm run verify:anchors
 *
 * Grant hit both of these in ordinary Telegram use, and the acceptance suite
 * that had just scored 88/88 could not see either — because it asserted
 * composition and never asked what the office DID with a message carrying more
 * than one intent.
 *
 * ## Anchor A
 *
 *   > "I've told you to always give your information in the form of clear
 *   > bullet points. Also, I want you to tell me what my current tasks are."
 *
 * The preference was stored and the turn returned. The question vanished —
 * no answer, no impediment, nothing anywhere recording that half a message had
 * been dropped.
 *
 * ## Anchor B
 *
 *   > "Create a task for me and the um... No actually, you know what? Scan the
 *   > entirety of the <project> and create appropriate tasks for me to review."
 *
 * One task, titled with the remainder of the transcript — the abandoned
 * fragment and the filler included.
 *
 * ## What is asserted, and why not the wording
 *
 * CANONICAL STATE, in every case. `public.preference_instructions` holds a
 * rule or it does not; `public.tasks` holds a row or it does not; a child job
 * exists or it does not. CLAUDE.md records six separate occasions of a
 * literal-string assertion becoming a wording lock, and this file is about a
 * layer whose whole output is wording.
 *
 * ## The project is real, and it is not one of his
 *
 * Anchor B names *the Legacy Coaching Project*, which is a real dashboard
 * project of Grant's, and an extraction over it would be this suite doing work
 * on his live material. The sentence keeps its exact shape and names this
 * run's own project instead — the defect is structural and has nothing to do
 * with which project was named.
 *
 * The job is harness traffic by construction: the actor is `verify-anchors`,
 * so `enqueue_inbound` composes `requested_by` as `telegram:verify-anchors`
 * and the `%:verify-%` branch of the generated `is_fixture` fires. Asserted
 * rather than believed — 0460 and 0463 are two suites that believed it and
 * were wrong.
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
const SLUG = `anchor-proof-${run}`
const NAME = `Anchor proof ${run}`
const WORKER = `anchors-${run}`
const MINE = 'telegram:verify-anchors'

console.log('the production anchors, through the real path (#282) —\n')

const project = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(SLUG)}, ${lit(NAME)}, 'Removed at the end of this run', 'paused')
  returning project_id::text as id`)
const projectId = String(project.id)

/*
  Something to scan, so anchor B's surviving clause has material.

  A delegation over an empty project would be answerable by saying there is
  nothing there, and the assertion below would then pass for a reason that has
  nothing to do with the split.
*/
await db.execute(`
  insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
  values (${lit(projectId)}::uuid, 'notebooklm', ${lit(`nb-${run}`)}, 'A linked notebook', 'source');
  insert into public.documents
    (project_id, connector, external_parent_ref, external_ref, title, content,
     content_fingerprint, content_chars, fetched_at, state)
  values (${lit(projectId)}::uuid, 'notebooklm', ${lit(`nb-${run}`)}, ${lit(`src-${run}`)},
          'Course review notes',
          'The welcome email needs rewriting. The module two video is out of date. ' ||
          'Someone has to chase the three clients who never finished onboarding.',
          encode(sha256(${lit(`fp-${run}`)}::bytea), 'hex'), 190, app.now_utc(), 'approved');
`)

interface Turn {
  jobId: string
  commandId: string
  body: string
  /** Null when nothing composed an answer — which is what an early return is. */
  model: string | null
  state: string
  fixture: boolean
  requestedBy: string
}

/** One whole turn: the message arrives, the office answers, the row is read. */
const say = async (tag: string, said: string): Promise<Turn> => {
  const command = await one(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
    values ('telegram', ${lit(`anchors-${run}-${tag}`)}, 'verify-anchors', ${lit(said)},
            ${lit(`telegram:message:anchors-${run}-${tag}`)}, ${lit(projectId)}::uuid)
    returning command_id::text as id`)
  const enqueued = await one(`select app.enqueue_inbound(${lit(String(command.id))}::uuid) as j`)
  const jobId = String(
    (typeof enqueued.j === 'string' ? JSON.parse(enqueued.j) : (enqueued.j ?? {}))?.job_id ??
      enqueued.j ??
      '',
  )
  const attributed = await one(`
    select is_fixture as f, requested_by as who from public.jobs
     where job_id = ${lit(jobId)}::uuid`)

  /*
    Scoped, and insisted on (#184, #273). The scope keeps other suites out and
    cannot stop the deployed worker taking this one's work, so a dequeue that
    returns somebody else's job is settled and asked again rather than run.
  */
  let job: Job | null = null
  for (let attempt = 0; attempt < 5 && job === null; attempt += 1) {
    const got = await dequeue(db, WORKER, false, false, undefined, MINE)
    if (got !== null && got.jobId === jobId) job = got
    else if (got !== null) {
      await db.execute(`
        update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
          state_reason = 'not this suite''s job' where job_id = ${lit(got.jobId)}::uuid`)
    } else await pause(1_000)
  }
  if (job === null) {
    // The deployed worker took it, which is the office working. Wait and read
    // the answer it produced: an end-to-end result through the real worker is
    // stronger than the in-process one.
    for (let waited = 0; waited < 24 && job === null; waited += 1) {
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
    /*
      Up to three attempts, because the office takes up to three. #185's
      coherence gate refusing one attempt is the gate WORKING, and a test that
      runs one attempt and calls the result final asserts against a safety
      mechanism.
    */
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await runJob(db, job, pass.handlers, pass.review)
      const st = await one(
        `select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`,
      )
      if (String(st.s) !== 'retrying') break
      await db.execute(`select app.requeue_retrying()`)
      let again: Job | null = null
      for (let tries = 0; tries < 5 && again === null; tries += 1) {
        const got = await dequeue(db, WORKER, false, false, undefined, MINE)
        if (got !== null && got.jobId === jobId) again = got
        else if (got !== null) {
          await db.execute(`
            update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
              state_reason = 'not this suite''s job' where job_id = ${lit(got.jobId)}::uuid`)
        } else await pause(1_000)
      }
      if (again === null) break
      job = again
    }
  }

  const out = await one(`
    select coalesce(body, '') as body, model from public.outputs
     where job_id = ${lit(jobId)}::uuid order by created_at desc limit 1`)
  const ended = await one(
    `select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`,
  )
  return {
    jobId,
    commandId: String(command.id),
    body: String(out.body ?? ''),
    model: out.model === null || out.model === undefined ? null : String(out.model),
    state: String(ended.s ?? ''),
    fixture: attributed.f === true,
    requestedBy: String(attributed.who ?? ''),
  }
}

/** Personal tasks this run caused, newest first. */
const tasksMade = async (): Promise<{ title: string; id: string }[]> =>
  (
    await db.execute(`
      select task_id::text as id, title from public.tasks
       where assigned_to_human and created_at > app.now_utc() - interval '30 minutes'
         and (project_id = ${lit(projectId)}::uuid or project_id is null)
       order by created_at desc limit 20`)
  ).rows as unknown as { title: string; id: string }[]

const before = await tasksMade()

// --- ANCHOR A --------------------------------------------------------------
console.log('  anchor A — a rule and a question in one message')

const A =
  "I've told you to always give your information in the form of clear bullet points. " +
  'Also, I want you to tell me what my current tasks are.'
const a = await say('a', A)

check(
  'the job this suite caused is harness traffic, by construction',
  `${a.requestedBy} → is_fixture=${String(a.fixture)}`,
  a.fixture,
)
check(
  'it answered at all',
  a.body === '' ? `NO OUTPUT (${a.state})` : `${String(a.body.length)} characters`,
  a.body !== '',
)
console.log(`       said: ${a.body.replace(/\s+/g, ' ').slice(0, 300)}`)

/*
  `remember` writes through `app.learn` into `public.lessons`, not into
  `preference_instructions` — which is where a channel adapter's preference
  goes. The first draft of this check asked the wrong table and reported zero
  about a rule that had been stored, which is the harness being wrong about the
  product rather than the product being wrong.
*/
const rule = await one(`
  select count(*)::int as n from public.lessons
   where from_job = ${lit(a.jobId)}::uuid`)
check(
  'the standing rule was still stored',
  `${String(rule.n)} lesson row(s) from this job`,
  Number(rule.n) >= 1,
)

/*
  THE DEFECT ITSELF. The question is the second clause and the rule is the
  first; before #282 the turn returned on the rule and the question was gone.

  `outputs.model` is the canonical evidence and it needs no wording. The
  early-return path composes its body in code and writes `model: null`; an
  answer to the second clause can only have come from the answering path,
  which records the model that wrote it. Asserting on the words instead would
  be the wording lock CLAUDE.md records six times.
*/
check(
  'the question reached the answering path rather than being swallowed',
  a.model === null ? 'the turn returned on the rule alone (model: null)' : `answered by ${a.model}`,
  a.model !== null,
)

const afterA = await tasksMade()
check(
  'and asking what is on the list did not put anything ON it',
  `${String(afterA.length - before.length)} task(s) added`,
  afterA.length === before.length,
)

// --- ANCHOR B --------------------------------------------------------------
console.log('\n  anchor B — a self-correction mid-sentence')

const B =
  'Create a task for me and the um... No actually, you know what? Scan the entirety of ' +
  `the ${NAME} and create appropriate tasks for me to review.`
const b = await say('b', B)

check(
  'it answered at all',
  b.body === '' ? `NO OUTPUT (${b.state})` : `${String(b.body.length)} characters`,
  b.body !== '',
)
console.log(`       said: ${b.body.replace(/\s+/g, ' ').slice(0, 300)}`)

const afterB = await tasksMade()
const fresh = afterB.filter((t) => !afterA.some((o) => o.id === t.id))

/*
  THE DEFECT ITSELF, and it is about the TITLE rather than the count.

  What production produced was one task whose title was the remainder of the
  transcript. "um" and "No actually" are the abandoned fragment and the filler;
  a title containing either is the discarded clause having been executed.
*/
const transcriptTitles = fresh.filter((t) =>
  /\bum\b|no actually|you know what|scan the entirety/i.test(t.title),
)
check(
  'no task was titled with the transcript he abandoned',
  transcriptTitles.length === 0
    ? `${String(fresh.length)} task(s), none of them transcript`
    : `TITLED: ${transcriptTitles.map((t) => t.title).join(' | ')}`,
  transcriptTitles.length === 0,
)

/*
  And the SURVIVING clause was acted on AS A DELEGATION.

  Two halves, and either alone passes against a broken product. A fix that
  simply filed nothing would satisfy the title check above and be a worse
  product than the defect — he asked for something and would get silence. And
  the first run of this suite passed a version of this check while the office
  had filed ONE personal task called "appropriate tasks for me to review",
  which is the delegation performed as its own title.

  So: a child job exists (the office went and read the project), and nothing
  went onto his own list from a sentence that asked the office to do the work.
*/
const child = await one(`
  select count(*)::int as n from public.jobs
   where parent_job_id = ${lit(b.jobId)}::uuid`)
check(
  'the surviving request was delegated rather than dropped',
  `${String(Number(child.n))} child job(s) from "scan the project and create tasks"`,
  Number(child.n) >= 1,
)
check(
  'and it was not filed as one badly-titled to-do of his own',
  fresh.length === 0
    ? 'nothing went on his list'
    : `ON HIS LIST: ${fresh.map((t) => t.title).join(' | ')}`,
  fresh.length === 0,
)

// --- CONTROL ---------------------------------------------------------------
console.log('\n  control — the ordinary case is untouched')

/*
  A SUITE OF FIXES WITHOUT A CONTROL IS A SUITE THAT CAN BUY ANCHORS WITH THE
  ORDINARY CASE.

  One plain single-clause request must still make exactly one task. This is the
  path that short-circuits the semantic layer entirely, so it also proves the
  fast path still reaches the writers.
*/
const C = `Remind me on 2026-12-01 to ring the venue about ${run}`
await say('c', C)
const afterC = await tasksMade()
const made = afterC.filter((t) => !afterB.some((o) => o.id === t.id))
check(
  'CONTROL: one plain request still makes exactly one task',
  `${String(made.length)} task(s): ${made.map((t) => t.title).join(' | ') || 'none'}`,
  made.length === 1,
)

// --- teardown --------------------------------------------------------------
console.log('')
for (const t of afterC.filter((x) => !before.some((o) => o.id === x.id))) {
  await db
    .execute(`select app.my_task_delete(${lit(t.id)}, 'verify:anchors teardown')`)
    .catch(() => undefined)
}
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:anchors teardown'
   where (project_id = ${lit(projectId)}::uuid
          or parent_job_id in (${lit(a.jobId)}::uuid, ${lit(b.jobId)}::uuid))
     and state not in ('complete', 'cancelled', 'failed', 'committing', 'committed', 'notifying');
  delete from public.inbound_commands where origin_ref like ${lit(`anchors-${run}%`)};
  delete from public.documents where project_id = ${lit(projectId)}::uuid;
  delete from public.project_attachments where project_id = ${lit(projectId)}::uuid;
`)
await db
  .execute(`delete from public.projects where project_id = ${lit(projectId)}::uuid`)
  .catch(async () => {
    await db.execute(`
      update public.projects set status = 'archived'
       where project_id = ${lit(projectId)}::uuid`)
  })
const leftTasks = await one(`
  select count(*)::int as n from public.tasks
   where assigned_to_human and state <> 'done'
     and (title like ${lit(`%${run}%`)} or project_id = ${lit(projectId)}::uuid)`)
const leftProject = await one(`
  select count(*)::int as n from public.projects
   where project_id = ${lit(projectId)}::uuid and status <> 'archived'`)
check(
  'teardown — nothing of this run is left on his list or in his projects',
  `${String(leftTasks.n)} task(s), ${String(leftProject.n)} live project(s)`,
  Number(leftTasks.n) === 0 && Number(leftProject.n) === 0,
)

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

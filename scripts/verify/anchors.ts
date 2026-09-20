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
const mineOn = (surface: string): string => `${surface}:verify-anchors`

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

/*
  WHAT TO DO WITH A JOB THIS RUN DID NOT ASK FOR.

  #184's scope keeps other suites out; nothing stops this suite taking its OWN
  later work, and CLAUDE.md records `verify:recovers` doing exactly that. Here
  it is sharper than a race: anchor B's whole point is that the office enqueues
  a CHILD, the child inherits `requested_by`, and the dequeue loop looking for
  the NEXT parent takes it — so the first version cancelled the delegation it
  had just proved the office started, and then asserted the delegation had
  happened. Green, over work the harness had killed.

  So a job from this run's own project is RUN, which is what the office would
  have done with it, and only a genuine stranger is set aside.
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

/** One whole turn: the message arrives, the office answers, the row is read. */
const say = async (tag: string, said: string, surface = 'telegram'): Promise<Turn> => {
  const command = await one(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
    values (${lit(surface)}, ${lit(`anchors-${run}-${tag}`)}, 'verify-anchors', ${lit(said)},
            ${lit(`${surface}:message:anchors-${run}-${tag}`)}, ${lit(projectId)}::uuid)
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
    const got = await dequeue(db, WORKER, false, false, undefined, mineOn(surface))
    if (got !== null && got.jobId === jobId) job = got
    else if (got !== null) await setAside(got)
    else await pause(1_000)
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
        const got = await dequeue(db, WORKER, false, false, undefined, mineOn(surface))
        if (got !== null && got.jobId === jobId) again = got
        else if (got !== null) await setAside(got)
        else await pause(1_000)
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
  AND IT IS THIS SUITE'S RULE, NOT ONE OF HIS.

  `public.lessons` refuses DELETE and UPDATE by trigger, so a lesson this suite
  stores as real is permanently on Grant's Governance page. Before the handler
  recorded who actually taught it — it passed the literal `'grant'` — thirteen
  copies of "always give your information in clear bullet points" accumulated
  there in one afternoon, from the suite written to prove the office behaves.

  `lessons.is_fixture` is GENERATED from `learned_by`, so this is asserted
  rather than believed. 0460 and 0463 are two suites that believed an
  attribution and were wrong.
*/
const mine = await one(`
  select count(*)::int as n from public.lessons
   where from_job = ${lit(a.jobId)}::uuid and is_fixture`)
check(
  'and it is attributed to the harness, so it never reaches his Governance page',
  `${String(mine.n)} of ${String(rule.n)} marked as harness traffic`,
  Number(mine.n) === Number(rule.n) && Number(rule.n) >= 1,
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
/*
  DRIVE THE CHILD BEFORE ASKING WHETHER IT WORKED.

  The delegation is a child job, and a child that is still QUEUED has not
  failed — so a check written without this would pass over work that had not
  happened yet, which is the harness reporting a turn it never saw. The suite
  runs it the way the deployed worker would, then reads the row.
*/
for (let sweep = 0; sweep < 6; sweep += 1) {
  const waiting = await one(`
    select count(*)::int as n from public.jobs
     where parent_job_id = ${lit(b.jobId)}::uuid
       and state in ('queued', 'retrying')`)
  if (Number(waiting.n) === 0) break
  await db.execute(`select app.requeue_retrying()`)
  const got = await dequeue(db, WORKER, false, false, undefined, mineOn('telegram'))
  if (got === null) await pause(2_000)
  else await setAside(got)
}

const child = await one(`
  select count(*)::int as n,
         count(*) filter (where state = 'failed')::int as dead,
         coalesce(string_agg(left(coalesce(state_reason, ''), 70), ' | ')
                    filter (where state = 'failed'), '') as why
    from public.jobs where parent_job_id = ${lit(b.jobId)}::uuid`)
check(
  'the surviving request was delegated rather than dropped',
  `${String(Number(child.n))} child job(s) from "scan the project and create tasks"`,
  Number(child.n) >= 1,
)
/*
  AND THE CHILD DID NOT DIE.

  The first version counted children and stopped there, and it passed green
  over a delegation that FAILED every time: `extract-tasks.ts` claimed
  `deterministic_retrieval` on a branch below its model call, the output insert
  was refused, and Grant got nothing for work he had asked for. CLAUDE.md
  records the same shape as `settled(state)` including `failed` — a check
  satisfied by the subject having died is worse than no check, because the
  report says the question was asked.
*/
check(
  'and the child did the work rather than dying',
  Number(child.dead) === 0
    ? 'none failed'
    : `${String(Number(child.dead))} FAILED: ${String(child.why)}`,
  Number(child.dead) === 0,
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

// --- ONE OFFICE, THREE DOORS ----------------------------------------------
console.log('\n  cross-channel — the same sentence, every surface')

/*
  THE SEMANTIC RESULT MUST BE CHANNEL-INDEPENDENT.

  `verify:equivalence` proves the same words reach the canonical layer on every
  surface, and that four surfaces produce the same kind of job in the same
  project attributed to the same person. What it does NOT do is RUN them, so
  nothing anywhere asserted that the same sentence DOES the same thing
  whichever door Grant used.

  `check:one-brain` is the structural half — no adapter may read what he meant.
  This is the behavioural half, and the two answer different questions: the
  check would stay green if a door started passing subtly different TEXT to a
  shared interpreter, and this would go red.

  Anchor A is the sentence, because it is the one with the most to get wrong:
  a rule to store, a question to answer, and nothing to put on his list.

  Asserted as AGREEMENT between the surfaces rather than against an expected
  value. A constant would be a wording lock in a different costume; agreement
  survives every rewording and fails on every real divergence.
*/
const DOORS = ['slack', 'teamhq', 'voice'] as const
interface Door {
  surface: string
  storedARule: boolean
  answered: boolean
  addedToHisList: number
}
const doors: Door[] = [
  {
    surface: 'telegram',
    storedARule: Number(rule.n) >= 1,
    answered: a.model !== null,
    addedToHisList: afterA.length - before.length,
  },
]
for (const surface of DOORS) {
  const seen = await tasksMade()
  const turn = await say(`x-${surface}`, A, surface)
  const lesson = await one(`
    select count(*)::int as n from public.lessons
     where from_job = ${lit(turn.jobId)}::uuid`)
  const now = await tasksMade()
  doors.push({
    surface,
    storedARule: Number(lesson.n) >= 1,
    answered: turn.model !== null,
    addedToHisList: now.length - seen.length,
  })
}

const shape = (d: Door): string =>
  `rule=${String(d.storedARule)} answered=${String(d.answered)} added=${String(d.addedToHisList)}`
const shapes = new Set(doors.map(shape))
check(
  'every door does the same thing with the same sentence',
  doors.map((d) => `${d.surface}: ${shape(d)}`).join(' · '),
  shapes.size === 1,
)
/*
  And the agreement is on the RIGHT thing. Four doors agreeing to do nothing
  would satisfy the check above — which is the found-nothing shape CLAUDE.md
  records three times, and the reason this second line exists.
*/
check(
  'and what they agree on is: rule stored, question answered, list untouched',
  `${String(doors.filter((d) => d.storedARule && d.answered && d.addedToHisList === 0).length)} of ${String(doors.length)} doors`,
  doors.every((d) => d.storedARule && d.answered && d.addedToHisList === 0),
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

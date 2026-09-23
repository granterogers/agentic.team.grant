/**
 * A deliberate second attempt is authorised by what Grant said, not by what
 * the resolver made of it (#316's clause, and the class #322/#327 name).
 *
 *   npm run verify:another-go
 *
 * `wantsAnotherGo` is the only thing in this office that turns off
 * `enqueue_child_once`. It was reading `instruction`, which
 * `resolveAgainstThread` replaces eighty lines above the gate, and every
 * pattern in again.ts is anchored to a whole short sentence -- the shape an
 * elliptical follow-up has, and exactly the shape the resolver expands.
 *
 * Driven against the live resolver on a real thread, both directions happen:
 *
 *     he said : try it again
 *     resolved: try the view on what the venue change does to the budget again
 *     -> DECLINED. The referent is fifty characters; the pattern caps at forty.
 *
 *     he said : give it another go
 *     resolved: Ask them again.
 *     -> 'retry', which he never authorised.
 *
 * ## What this gates, and what it reports
 *
 * The deterministic halves are gated: a repeated request starts nothing, and
 * the authorisation is read from the sentence he actually sent. Whether the
 * authorised turn then reaches the planner is reported, because three drives
 * of the neighbouring suite produced three different second turns and
 * CLAUDE.md is explicit about what an intermittent gate reads as.
 *
 * ## Containment
 *
 * The actor is `verify-another-go`, so `enqueue_inbound` composes
 * `requested_by` as `telegram:verify-another-go` and the `%:verify-%` branch
 * of the generated `is_fixture` fires -- asserted rather than believed. The
 * project is created and removed inside one run, so 0419's fifteen-minute rule
 * means no Slack channel is provisioned for it, and every child is cancelled
 * rather than run.
 */

import { wantsAnotherGo } from '../../src/agents/again.ts'
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
const SLUG = `fixture-anothergo-${run}`
const WORKER = `anothergo-${run}`
const MINE = 'telegram:verify-another-go'

console.log('a deliberate second attempt is authorised by his words (#316) —\n')

/*
  CONTROL: the recogniser can fail, and does so on the shapes that must not
  authorise duplication. A suite made only of positives passes against a
  recogniser that says yes to everything -- CLAUDE.md's judge that marks every
  answer poor and scores perfectly on a corpus of poor answers.
*/
check(
  'CONTROL: the plainest authorisation is recognised',
  String(wantsAnotherGo('give it another go')),
  wantsAnotherGo('give it another go') === 'retry',
)
check(
  'CONTROL: a question about one is not one',
  String(wantsAnotherGo('should we give it another go')),
  wantsAnotherGo('should we give it another go') === null,
)
check(
  'CONTROL: and neither is a report of one already made',
  String(wantsAnotherGo('I gave it another go yesterday')),
  wantsAnotherGo('I gave it another go yesterday') === null,
)

const project = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(SLUG)}, ${lit(`Another go proof ${run}`)},
          'Removed at the end of this run', 'paused')
  returning project_id::text as id`)
const projectId = String(project.id)

// ADR-0014: an active project needs an enabled attachment.
await db.execute(`
  insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
  values (${lit(projectId)}::uuid, 'notebooklm', ${lit(`nb-${run}`)},
          'A linked Google Notebook', 'source');
  update public.projects set status = 'active' where project_id = ${lit(projectId)}::uuid;
`)

/*
  And something to write ABOUT, because #320's project had documents.

  Without material the office answers, quite correctly, "I have no indexed
  documents for this project, so I lack source material" — which this checker
  classifies as `needs_something` rather than a denial, and which is the right
  answer to the wrong scenario. A suite that accepted it would be asserting
  that the office can refuse, not that it can produce. The three fixed points
  travel together: `content` with a `content_fingerprint`, the fingerprint a
  sha256, and `fetched_at` iff content.
*/
await db.execute(`
  insert into public.documents
    (project_id, connector, external_parent_ref, external_ref, title, content,
     content_fingerprint, content_chars, fetched_at, state)
  values (${lit(projectId)}::uuid, 'notebooklm', ${lit(`nb-${run}`)}, ${lit(`src-${run}`)},
          ${lit(`Where the Another go proof ${run} has got to`)},
          ${lit(
            `The project is in its second phase. Phase one delivered the intake form and ` +
              `the pricing band. Phase two is the pilot with three clients, running now. ` +
              `Phase three is the review, due at the end of the quarter. Two risks are ` +
              `open: the pilot cohort is smaller than planned, and the review date sits ` +
              `inside the holiday period.`,
          )},
          encode(sha256(${lit(`fingerprint-${run}`)}::bytea), 'hex'), 320, app.now_utc(), 'approved');
`)

/*
  One whole turn, through the real handler.

  `origin_ref` is `chat:message`, because `app.conversation_before` threads on
  `split_part(origin_ref, ':', 1)` -- so both turns must share the part before
  the colon or they are two separate conversations. The first run of this
  suite used a hyphen, the follow-up arrived with no antecedent, and the office
  answered, correctly, *"this is the first thing you have said to me here"*.
  The harness was wrong, not the product; that is the third time in this run.
*/
const ask = async (tag: string, say: string): Promise<{ jobId: string; body: string }> => {
  const command = await one(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
    values ('telegram', ${lit(`ago-${run}:${tag}`)}, 'verify-another-go', ${lit(say)},
            ${lit(`telegram:message:ago-${run}-${tag}`)}, ${lit(projectId)}::uuid)
    returning command_id::text as id`)
  const enqueued = await one(`select app.enqueue_inbound(${lit(String(command.id))}::uuid) as j`)
  const jobId = String(
    (typeof enqueued.j === 'string' ? JSON.parse(enqueued.j) : (enqueued.j ?? {}))?.job_id ??
      enqueued.j ??
      '',
  )

  const pass = await buildPass(db, WORKER, {
    max: 1,
    canTranscribe: false,
    canSubprocess: false,
    projectRef,
  })
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
  // The deployed worker may have taken it first, which is the office working
  // rather than a failure (#273). Wait for it and read what it produced.
  if (job === null) {
    for (let waited = 0; waited < 24; waited += 1) {
      const st = await one(
        `select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`,
      )
      if (['complete', 'failed', 'cancelled'].includes(String(st.s))) break
      await pause(5_000)
    }
  } else {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const out = await runJob(db, job, pass.handlers, pass.review)
      if (out.finalState !== 'retrying') break
      const again = await dequeue(db, WORKER, false, false, undefined, MINE)
      if (again === null || again.jobId !== jobId) break
      job = again
    }
  }
  const answer = await one(`
    select coalesce((select o.body from public.outputs o
                      where o.job_id = ${lit(jobId)}::uuid
                      order by o.created_at desc limit 1), '') as body`)
  return { jobId, body: String(answer.body) }
}

const childrenOf = async (jobId: string): Promise<number> =>
  Number(
    (
      await one(`select count(*)::int as n from public.jobs
                  where parent_job_id = ${lit(jobId)}::uuid`)
    ).n,
  )

/*
  A request that reliably HANDS WORK ON, which a status question does not.

  The first version asked for "a view on where this has got to" and the office
  answered it outright from the project's own documents -- correctly, and with
  nothing for a second attempt to be a second attempt AT. Both the negative
  control and the authorised turn were then vacuous: zero children either way
  proves nothing about a gate that decides whether to start a second child.

  This is the sentence #316 was measured on, twice in Grant's real Telegram
  chat three minutes apart.
*/
const REQUEST = `Write me a PDF report on where the Another go proof ${run} has got to.`

const first = await ask('one', REQUEST)

const attributed = await one(`
  select is_fixture as f, requested_by as who from public.jobs
   where job_id = ${lit(first.jobId)}::uuid`)
check(
  'this suite’s traffic is harness traffic, asserted rather than assumed',
  `${String(attributed.who)} is_fixture=${String(attributed.f)}`,
  attributed.f === true,
)
const startedFirst = await childrenOf(first.jobId)
check('the first ask starts work', `${String(startedFirst)} child job(s)`, startedFirst >= 1)

/*
  THE NEGATIVE CONTROL, and #316's whole invariant: saying it again is not
  asking for it twice. Run FIRST, because it must hold while the first attempt
  is still in flight -- which is the state Grant is actually in when he repeats
  himself, measured at 57 near-duplicate pairs in 290 real messages.
*/
const repeated = await ask('two', REQUEST)
const afterRepeat = await childrenOf(repeated.jobId)
check(
  'repeating the request starts nothing',
  `${String(afterRepeat)} child job(s) — “${repeated.body.slice(0, 90)}”`,
  afterRepeat === 0,
)

/*
  AND THE AUTHORISED ONE. Elliptical, because that is the only shape this
  sentence has -- and therefore the only shape the resolver will expand.
*/
const another = await ask('three', 'give it another go')
const authorised = await childrenOf(another.jobId)

/*
  Gated on his own words rather than on the turn's outcome. The sentence as
  STORED is what the gate reads, so a suite that asserted a rewrite of it would
  be asserting the defect. What the authorised turn then produced is reported
  below, because three drives of the neighbouring suite produced three
  different second turns and an intermittent gate reads as a suite that failed,
  got fixed, and passes.
*/
const asSent = String(
  (
    await one(`select instruction as i from public.inbound_commands
                where origin_ref = ${lit(`ago-${run}:three`)}`)
  ).i ?? '',
)
check(
  'the authorisation is read from the sentence he sent',
  `“${asSent}” → ${String(wantsAnotherGo(asSent))}`,
  wantsAnotherGo(asSent) === 'retry',
)

/*
  A TURN THAT HAS NOT ANSWERED YET IS NOT A TURN THAT ANSWERED NOTHING.

  The first version of this line printed "nothing further started" on a run
  where the job was still running when the wait loop expired -- and one run
  earlier the same turn had started a report. CLAUDE.md records exactly this
  about the session runner, and the report line repeated it. There are three
  outcomes here, not two.
*/
const settledThen = String(
  (await one(`select state::text as s from public.jobs where job_id = ${lit(another.jobId)}::uuid`))
    .s ?? '',
)
console.log(
  `\n  the authorised turn: ${
    authorised >= 1
      ? `${String(authorised)} further job(s) started`
      : ['complete', 'failed', 'cancelled'].includes(settledThen)
        ? 'nothing further started — reported, not gated'
        : `still ${settledThen} when the suite stopped waiting — no verdict`
  }`,
)
console.log(`  it said: ${another.body.slice(0, 200)}`)

console.log('\nand the suite leaves nothing behind')
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
      state_reason = 'verify:another-go teardown'
   where parent_job_id in (${lit(first.jobId)}::uuid, ${lit(repeated.jobId)}::uuid,
                           ${lit(another.jobId)}::uuid)
     and state not in ('complete', 'cancelled', 'failed')`)
const stillGoing = await one(`
  select count(*)::int as n from public.jobs
   where parent_job_id in (${lit(first.jobId)}::uuid, ${lit(repeated.jobId)}::uuid,
                           ${lit(another.jobId)}::uuid)
     and state not in ('complete', 'cancelled', 'failed')`)
check(
  'no child of this run is left running',
  `${String(stillGoing.n)} still going`,
  Number(stillGoing.n) === 0,
)

const produced = Number(
  (
    await one(`select count(*)::int as n from public.documents
               where project_id = ${lit(projectId)}::uuid`)
  ).n,
)
await db.execute(`delete from public.documents where project_id = ${lit(projectId)}::uuid`)
const strays = await one(`
  select count(*)::int as n from public.documents where project_id = ${lit(projectId)}::uuid`)
check(
  'every document this run touched is swept',
  `${String(produced)} found (1 seeded), ${String(strays.n)} left`,
  Number(strays.n) === 0 && produced >= 1,
)

await db
  .execute(`delete from public.projects where project_id = ${lit(projectId)}::uuid`)
  .catch(async () => {
    await db.execute(`
      update public.projects set status = 'archived'
       where project_id = ${lit(projectId)}::uuid`)
  })
const left = await one(`
  select count(*)::int as n from public.projects
   where project_id = ${lit(projectId)}::uuid and status <> 'archived'`)
check('nothing of this run is left in Grant’s project list', `${String(left.n)} live`, left.n === 0)

const failed = checks.filter((c) => !c.passed).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)

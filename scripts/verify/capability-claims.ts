/**
 * The office does not say it cannot do something it can (#320).
 *
 *   npm run verify:capability-claims
 *
 * ## The turn this is written against
 *
 *   Grant : Write me a PDF report on where the Legacy Coaching Course is
 *   office: (makes one)
 *   Grant : Okay, that's pretty good. But what I asked for was a proper
 *           beautifully illustrated PDF with details on that, not just a
 *           couple of small paragraphs.
 *   office: I can't create a PDF directly in Telegram, but I'll build a
 *           Notion page you can export as a PDF.
 *
 * `artifact.report` had produced 139 PDFs by then. Two defects met in that
 * sentence: no `tool_permissions` row named the handler, so no agent's brief
 * mentioned the capability; and every verb in the artifact recogniser is a
 * present-tense imperative, so the follow-up was recognised by nothing and the
 * turn fell through to prose.
 *
 * ## What this drives, and what it deliberately does not
 *
 * The property is that a restated request MAKES something rather than denying
 * the capability — so this asserts the child is ENQUEUED and then cancels it.
 * Whether `artifact.report` produces a good PDF is `verify:artifact`'s
 * question, and letting it run here would spend a model on a second report and
 * leave a document behind. CLAUDE.md records what a harness that causes real
 * work and does not sweep it costs: three near-duplicate PDFs in Grant's real
 * Legacy Coaching project, retrievable, citable as separate sources.
 *
 * ## Containment
 *
 * The actor is `verify-capability`, so `enqueue_inbound` composes
 * `requested_by` as `telegram:verify-capability` and the `%:verify-%` branch of
 * the generated `is_fixture` fires — asserted rather than believed, because
 * 0460 and 0463 are two suites that believed it and were wrong. The project is
 * created and removed inside one run, so 0419's fifteen-minute rule means no
 * Slack channel is ever provisioned for it.
 */

import { capabilityNow } from '../../src/agents/capability.ts'
import { capabilityClaims, capabilityLies } from '../../src/agents/capability-claims.ts'
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
/*
  A FIXTURE name, because nothing here tests a reader that filters fixtures.

  #45's rule is to ask the question about the column the reader actually
  filters, not about the suite: `capabilityNow` reads `tool_permissions` and
  never looks at `projects.is_fixture`, so a fixture subject proves exactly as
  much and stays sweepable. Named otherwise, the first three runs of this
  suite left three archived projects that can never be deleted, because each
  had gathered a job — CLAUDE.md's own pile, rebuilt.
*/
const SLUG = `fixture-capability-${run}`
const WORKER = `capability-${run}`
const MINE = 'telegram:verify-capability'

console.log('a capability denied must be a capability absent (#320) —\n')

/*
  The registry first, because everything below depends on it being true.

  A suite that drove the conversation without asserting this would pass or fail
  for a reason it could not name: the whole defect was that canonical
  capability state did not mention the handler.
*/
const cap = await capabilityNow(db, 'chief-of-staff')
const makesDocuments = cap.can.find((a) => a.tool === 'document.create') ?? null
check(
  'the office knows it can produce a document',
  makesDocuments === null ? 'document.create is not held' : `${makesDocuments.tool}, in a reply`,
  makesDocuments !== null && makesDocuments.inReply,
)

/*
  CONTROL: the detector can fail.

  A suite whose only capability assertions are "nothing was found" passes
  against a detector that cannot find anything — CLAUDE.md's found-nothing
  shape, recorded three times. So the sentence Grant was actually given is put
  through it first, and must come back as a defect.
*/
const theSentenceHeGot = "I can't create a PDF directly in Telegram, but I'll build a Notion page."
const caught = capabilityLies(theSentenceHeGot, cap)
check(
  'CONTROL: the exact sentence Grant was given is caught',
  caught.length === 0 ? 'not caught' : `${caught[0]?.verdict} on ${caught[0]?.tool}`,
  caught.length === 1 && caught[0]?.verdict === 'false_denial',
)

/*
  CONTROL: and it does not fire on a true one.

  A gate that refuses every sentence mentioning a document would be worse than
  none, because the office would stop saying true things about what it holds.
*/
check(
  'CONTROL: a true statement about an empty search is left alone',
  'no finding',
  capabilityLies("I don't have any record of a PDF for that project.", cap).length === 0,
)

const project = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(SLUG)}, ${lit(`Capability proof ${run}`)},
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
          ${lit(`Where the Capability proof ${run} has got to`)},
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
    values ('telegram', ${lit(`cap-${run}:${tag}`)}, 'verify-capability', ${lit(say)},
            ${lit(`telegram:message:cap-${run}-${tag}`)}, ${lit(projectId)}::uuid)
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

const first = await ask('one', `Write me a PDF report on where the Capability proof ${run} is.`)

const attributed = await one(`
  select is_fixture as f, requested_by as who from public.jobs
   where job_id = ${lit(first.jobId)}::uuid`)
check(
  'this suite’s traffic is harness traffic, asserted rather than assumed',
  `${String(attributed.who)} is_fixture=${String(attributed.f)}`,
  attributed.f === true,
)

/*
  Counted over the CONVERSATION, not under one job id.

  An obligation is not a job. `enqueue_child_once` may attach the restated
  request's work to the obligation the first turn opened, so counting children
  of the second job reported ZERO on a run where the office had just delivered
  the report and said so — "2 pages, from 1 source(s), it is in the project's
  documents as well". Measuring jobs instead of obligations is the mistake
  #312 exists to stop, made by the person who made #312.
*/
const reportsStarted = async (): Promise<number> =>
  Number(
    (
      await one(`
    select count(*)::int as n from public.jobs
     where project_id = ${lit(projectId)}::uuid and kind = 'artifact.report'`)
    ).n,
  )

const afterFirst = await reportsStarted()
check(
  'a fresh request for a PDF starts one',
  `${String(afterFirst)} report job(s)`,
  afterFirst >= 1,
)

/*
  The first attempt is SETTLED before he complains, because that is the
  sequence (#316's regression invariant, from the other side).

  Left in flight, the follow-up is correctly deduped: `enqueue_child_once`
  refuses to start a second report while the first is still running, which is
  #316 working exactly as designed — *"repeating or rephrasing a request must
  not duplicate work that is already in flight"*. The first run of this suite
  asserted otherwise and failed, and the TEST was wrong rather than the
  product.

  In the real turn Grant had already been given a PDF and was rejecting it.
  Cancelling the first child reproduces that, and doubles as the #315 invariant
  in the same breath: duplicate prevention must not make cancelled work appear
  active, nor prevent an explicit restart.
*/
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
      state_reason = 'he saw it and it was not what he meant'
   where parent_job_id = ${lit(first.jobId)}::uuid
     and state not in ('complete', 'cancelled', 'failed')`)

/*
  THE FOLLOW-UP, which is the whole Issue.

  Not "does it say something nice" — two properties, both canonical: it must
  not deny a capability it holds, and it must START one rather than offering a
  Notion page to export by hand.
*/
const second = await ask(
  'two',
  "Okay, that's pretty good. But what I asked for was a proper beautifully " +
    'illustrated PDF with details on that, not just a couple of small paragraphs.',
)

const lied = capabilityLies(second.body, cap)
check(
  'the follow-up does not deny a capability the office holds',
  lied.length === 0 ? 'no false denial' : `${lied[0]?.verdict}: ${lied[0]?.quote}`,
  lied.length === 0,
)

/*
  WHAT HAPPENED NEXT IS REPORTED, NOT GATED — and that is a measurement, not a
  shrug.

  Driven three times against the deployed worker, the follow-up produced three
  different second turns: the report made and delivered ("2 pages, from 1
  source"), a question about what "where" meant for the project, and
  `blocked_needs_user`'s "I understood what you want and could not carry it
  out". None of the three denied the capability, which is the #320 invariant
  and is gated above.

  Gating on "a report was started" would make this suite fail one run in three
  — and CLAUDE.md is explicit about what that looks like: a suite failing
  intermittently reads as a suite that failed, got fixed, and passes. The
  deterministic half of the recognition is asserted where it IS deterministic,
  in `tests/agents/a-restated-request-is-still-a-request.test.ts`, and proved
  by sabotage there.
*/
const restarted = (await reportsStarted()) - afterFirst
console.log(
  `\n  the restated request: ${
    restarted >= 1
      ? `${String(restarted)} further report job(s) started`
      : 'no further report started'
  }`,
)

const seen = capabilityClaims(second.body, cap)
// Every verdict the turn produced, for the report. A gate that prints only a
// boolean teaches the reader nothing about which of the four states it saw.
console.log(
  `\n  capability claims in the answer: ${
    seen.length === 0 ? 'none' : seen.map((s) => `${s.verdict}(${s.tool})`).join(', ')
  }`,
)

/*
  Teardown. The artifact children are cancelled rather than run, so no PDF and
  no document row is produced by this suite at all — and the cancellation is
  counted, because a teardown that matched nothing looks exactly like one that
  worked.
*/
console.log('\nand the suite leaves nothing behind')
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
      state_reason = 'verify:capability-claims teardown'
   where parent_job_id in (${lit(first.jobId)}::uuid, ${lit(second.jobId)}::uuid)
     and state not in ('complete', 'cancelled', 'failed')`)
/*
  Counted by asking, not by trusting the UPDATE's own report.

  The first version printed `rows.length` from an `update ... returning`, which
  this executor does not populate — so it said "cancelled 0 child job(s)" on a
  run that had a live child, which is a report line stating an impossibility.
  The deployed worker may legitimately have finished one first; what matters is
  that none is left running.
*/
const stillGoing = await one(`
  select count(*)::int as n from public.jobs
   where parent_job_id in (${lit(first.jobId)}::uuid, ${lit(second.jobId)}::uuid)
     and state not in ('complete', 'cancelled', 'failed')`)
check(
  'no child of this run is left running',
  `${String(stillGoing.n)} still going`,
  Number(stillGoing.n) === 0,
)

/*
  Sweep what the work produced, and assert the sweep (CLAUDE.md, twice).

  The deployed worker ticks every minute, so between the assertion above and
  this teardown it can legitimately finish a report — and it does, most runs.
  A document the harness caused is debris exactly as a project is: 0169 says an
  answer citing two copies of one thing is the provenance defect this
  repository keeps paying for, and three near-duplicate PDFs in Grant's real
  Legacy Coaching project is how that was learned.

  So the count is taken BEFORE the sweep and reported, because a sweep that
  matched nothing looks exactly like a sweep that worked.
*/
const produced = Number(
  (
    await one(`
  select count(*)::int as n from public.documents where project_id = ${lit(projectId)}::uuid`)
  ).n,
)
await db.execute(`delete from public.documents where project_id = ${lit(projectId)}::uuid`)
const strays = await one(`
  select count(*)::int as n from public.documents where project_id = ${lit(projectId)}::uuid`)
check(
  'every document this run touched is swept',
  `${String(produced)} found (1 seeded, ${String(produced - 1)} produced), ${String(strays.n)} left`,
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

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

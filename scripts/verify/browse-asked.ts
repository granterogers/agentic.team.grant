/**
 * ASKING THE OFFICE TO READ A PAGE, END TO END (#135, #16).
 *
 *   npm run verify:browse-asked
 *
 * ## The defect this exists about
 *
 * `browser.gather` was a registered handler with an adapter behind it, an
 * append-only ledger, a project surface, sessions in the Vault, a ten-minute
 * budget and a Stop — and **nothing ever enqueued one**. Five migrations, two
 * runtimes and a tab, unreachable from any sentence Grant could say.
 *
 * #72's defect at the top of the stack, and invisible to the check written for
 * #72: `check:callers` walks database functions, and a job kind nobody
 * enqueues is not a function. It was found by asking a different question —
 * not "does this work" but "how would he ever start it".
 *
 * So this drives the whole path: a message arrives on a real channel, the real
 * instruction handler runs, the child it enqueues is dequeued and run for
 * real, the real internet is read, and the page lands as a project document
 * with a ledger row behind it.
 *
 * ## The controls
 *
 * A suite of positives would pass against an office that gathers every link it
 * ever sees, which would be a worse product than one that gathers none: it
 * would spend browser-minutes on remarks and fill a project's knowledge with
 * pages nobody chose. So the negative control asks the same office, in the
 * same project, about a link merely MENTIONED, and demands that nothing is
 * enqueued at all.
 *
 * ## The subject is real, and it is removed
 *
 * #45's question, asked about the specific readers here: `browser_now`,
 * `browser_lately` and the Browser tab all filter harness traffic through
 * `app.harness_browsing`, and a fixture project is invisible to every one of
 * them — so a fixture subject would pass every check by being unseeable. The
 * project is therefore real, paused, inserted directly so 0416's channel
 * provisioning has nothing to fire on, and removed at the end with the removal
 * asserted.
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
  checks.push({ outcome, passed, what })
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what} — ${outcome}`)
}

const run = Math.random().toString(36).slice(2, 10)
const SLUG = `browse-asked-${run}`
const WORKER = `browse-asked-${run}`
const MINE = 'telegram:verify-browse-asked'

/*
  example.com, deliberately.

  It is the address IANA maintains for exactly this, it is server-rendered, it
  is 144 characters, and it is the page that broke the first version of the
  thin-page guard — so a run that reads it proves the guard still lets a short
  honest page through, which is the expensive direction to get wrong.
*/
const PAGE = 'https://example.com/'

console.log('asking the office to read a page (#135, #16) —\n')

const project = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(SLUG)}, ${lit(`Browse asked proof ${run}`)},
          'Removed at the end of this run', 'paused')
  returning project_id::text as id`)
const projectId = String(project.id)

const pass = await buildPass(db, WORKER, {
  canSubprocess: false,
  canTranscribe: false,
  max: 1,
  projectRef,
})

/** One whole turn, from the message to the job settling. */
const say = async (tag: string, instruction: string): Promise<string> => {
  const command = await one(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
    values ('telegram', ${lit(`browse-${run}-${tag}`)}, 'verify-browse-asked',
            ${lit(instruction)},
            ${lit(`telegram:message:browse-${run}-${tag}`)}, ${lit(projectId)}::uuid)
    returning command_id::text as id`)
  const enqueued = await one(`select app.enqueue_inbound(${lit(String(command.id))}::uuid) as j`)
  const raw = typeof enqueued.j === 'string' ? JSON.parse(enqueued.j) : (enqueued.j ?? {})
  const jobId = String((raw as { job_id?: string })?.job_id ?? enqueued.j ?? '')

  let job: Job | null = null
  for (let attempt = 0; attempt < 6 && job === null; attempt += 1) {
    const got = await dequeue(db, WORKER, false, false, undefined, MINE)
    if (got !== null && got.jobId === jobId) job = got
    else if (got !== null) {
      await db.execute(`
        update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
          state_reason = 'not this suite''s job' where job_id = ${lit(got.jobId)}::uuid`)
    } else await pause(1_000)
  }
  /*
    Up to three attempts, because the office takes up to three. A suite that
    runs one and calls the result final is asserting against #185's coherence
    gate, which refuses an attempt and writes the refusal into pinned_config so
    the NEXT attempt can see it. That closed loop is the design.
  */
  if (job !== null) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await runJob(db, job, pass.handlers, pass.review).catch(() => undefined)
      const st = await one(
        `select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`,
      )
      if (String(st.s) !== 'retrying') break
      await db.execute('select app.requeue_retrying()')
      const again = await dequeue(db, WORKER, false, false, undefined, MINE)
      if (again === null || again.jobId !== jobId) break
      job = again
    }
  } else {
    // The deployed worker took it, which is the office working. Wait for it.
    for (let n = 0; n < 40; n += 1) {
      const s = await one(
        `select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`,
      )
      if (['complete', 'failed', 'cancelled'].includes(String(s.s))) break
      await pause(3_000)
    }
  }
  return jobId
}

// ---------------------------------------------------------------- the ask ---

const asked = await say('read', `Read ${PAGE} and tell me what it says.`)

const child = await one(`
  select job_id::text as id, pinned_config ->> 'url' as url, state::text as state
    from public.jobs
   where parent_job_id = ${lit(asked)}::uuid and kind = 'browser.gather'
   limit 1`)

check(
  'asking for a page to be read enqueues a browser.gather',
  child.id === undefined ? 'NOTHING WAS ENQUEUED' : `job ${String(child.id).slice(0, 8)}`,
  child.id !== undefined,
)
check(
  'and it carries the address he named',
  String(child.url ?? '(none)'),
  String(child.url ?? '') === PAGE,
)

const answer = await one(`
  select body from public.outputs where job_id = ${lit(asked)}::uuid order by created_at desc limit 1`)
const said = String(answer.body ?? '')
check(
  'the office says it is opening the page rather than claiming to have read it',
  said === '' ? '(no output)' : said.slice(0, 110),
  /example\.com/i.test(said),
)
/*
  The provenance rule, at the moment it is easiest to break. The page has NOT
  been read when this sentence is written, so a past tense here would be the
  office claiming a read it has not performed — the defect `provenance.ts`
  exists about, in a new place.
*/
check(
  'and it does not use the past tense about a page it has not opened yet',
  said.slice(0, 160),
  !/\bI\s+(read|opened|checked|looked at)\b/i.test(said),
)

// -------------------------------------------------------------- the child ---

if (child.id !== undefined) {
  let gather: Job | null = null
  for (let attempt = 0; attempt < 8 && gather === null; attempt += 1) {
    const got = await dequeue(db, WORKER, false, false, undefined, MINE)
    if (got !== null && got.jobId === String(child.id)) gather = got
    else if (got !== null) {
      await db.execute(`
        update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
          state_reason = 'not this suite''s job' where job_id = ${lit(got.jobId)}::uuid`)
    } else await pause(1_500)
  }
  if (gather !== null) await runJob(db, gather, pass.handlers, pass.review).catch(() => undefined)
  else {
    for (let n = 0; n < 40; n += 1) {
      const s = await one(`
        select state::text as s from public.jobs where job_id = ${lit(String(child.id))}::uuid`)
      if (['complete', 'failed', 'cancelled'].includes(String(s.s))) break
      await pause(3_000)
    }
  }

  const noted = await one(`
    select verb, ok, left(detail, 60) as detail, url from public.browser_actions
     where job_id = ${lit(String(child.id))}::uuid and verb = 'read' limit 1`)
  check(
    'the gather really opened it, and said so in the ledger',
    noted.verb === undefined
      ? 'NO LEDGER ROW'
      : `${String(noted.verb)} ok=${String(noted.ok)} ${String(noted.detail)}`,
    noted.ok === true,
  )

  const doc = await one(`
    select title, left(content, 400) as content, origin, connector
      from public.documents
     where project_id = ${lit(projectId)}::uuid and connector = 'browser' limit 1`)
  check(
    'and the page is a document on the project',
    doc.title === undefined ? 'NO DOCUMENT' : `${String(doc.title)} · ${String(doc.origin)}`,
    doc.title !== undefined,
  )
  /*
    A phrase from the page's own body, not its title. The first version of this
    check read only 80 characters of content and looked for a phrase that
    appears after them — it reported a perfectly good document as a
    placeholder. Validate the test before believing the finding.
  */
  check(
    'whose words are the real page rather than a placeholder',
    String(doc.content ?? '(none)').slice(0, 70),
    /for use in (illustrative )?(examples|documentation)/i.test(String(doc.content ?? '')),
  )
  check(
    'and whose origin says the office LOOKED at it rather than wrote it',
    String(doc.origin ?? '(none)'),
    String(doc.origin) === 'source',
  )
}

// ------------------------------------------------------------- the control ---

/*
  The same office, the same project, a link MENTIONED rather than asked about.

  Without this the suite would pass against a version that gathers every link
  it sees — which spends browser-minutes on remarks and puts pages nobody
  chose into the project's knowledge, where retrieval will cite them.
*/
const mentioned = await say(
  'mention',
  'We should probably move off https://example.com/pricing eventually, but not this quarter.',
)
const none = await one(`
  select count(*)::int as n from public.jobs
   where parent_job_id = ${lit(mentioned)}::uuid and kind = 'browser.gather'`)
check(
  'CONTROL: a link merely mentioned opens nothing',
  `${String(none.n)} gather(s) enqueued`,
  Number(none.n) === 0,
)

// --------------------------------------------------------------- teardown ---

console.log('')
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:browse-asked teardown'
   where project_id = ${lit(projectId)}::uuid
     and state not in ('complete', 'cancelled', 'failed', 'committing', 'committed', 'notifying');
  delete from public.inbound_commands where origin_ref like ${lit(`browse-${run}%`)};
  delete from public.documents where project_id = ${lit(projectId)}::uuid;
  delete from public.project_attachments where project_id = ${lit(projectId)}::uuid;
`)
/*
  A job can never be deleted (ADR-0022) and it holds the project, so the
  project is archived when it cannot be removed — out of Grant's list either
  way, which is what the teardown is for. The browsing ledger rows stay: the
  table is append-only, and they are invisible to every reader because the
  project they belong to is gone from the tab.
*/
await db
  .execute(`delete from public.projects where project_id = ${lit(projectId)}::uuid`)
  .catch(async () => {
    await db.execute(`
      update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid`)
  })
const left = await one(`
  select count(*)::int as n from public.projects
   where project_id = ${lit(projectId)}::uuid and status <> 'archived'`)
check(
  'teardown — nothing of this run is in Grant’s project list',
  `${String(left.n)} live`,
  Number(left.n) === 0,
)

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

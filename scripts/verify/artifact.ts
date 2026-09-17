/**
 * The whole chain, for one request (#258, #41).
 *
 *   npm run verify:artifact
 *
 * request → retrieve → generate → validate → store → deliver
 *
 * #258 asks for exactly that, and for the thing it is not: *"A request for a
 * PDF should result in an actual validated PDF/project artifact and a usable
 * channel delivery — not prose claiming one was produced."* Every link is
 * asserted against canonical evidence rather than against the office's own
 * description of what it did, because the failure this Issue exists for is a
 * confident sentence with no file behind it.
 *
 * ## What each link has to show
 *
 * | link | the evidence, not the claim |
 * |---|---|
 * | request | an `artifact.report` CHILD job exists, enqueued by the parent |
 * | retrieve | the report cites the project's own document |
 * | generate + validate | a PDF that `validatePdf` accepted, with pages |
 * | store | a `documents` row with `origin = 'made'` AND an object really in Storage |
 * | deliver | `attachFile.storagePath` on the output, and a signed URL that mints |
 *
 * The storage check reads the object back over HTTP. A path in a row is a
 * claim; bytes coming back are the fact, and this repository has already
 * shipped a discard function that wrote a state the constraint forbade and a
 * delete keyed on a name nothing matched.
 *
 * ## The negative control is the point
 *
 * A project with nothing in it must NOT produce a report. An office that
 * writes four pages from no sources is the fabrication #258 is about, and a
 * suite that only checked the happy path would call that a pass.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { signedUrl } from '../../src/files/store.ts'
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
const WORKER = `artifact-${run}`
const MINE = 'slack:verify-artifact'
const TOKEN = `vandrellic${run}`

console.log('the artifact chain, end to end (#258) —\n')

/*
  A real project with real material, and a second with none.

  Real because #45: the reader under test filters fixtures. Paused because
  ADR-0014 refuses an active project with nothing enabled attached. Inserted
  directly rather than through `hq_create_project`, so 0416's Slack
  provisioning has nothing to fire on — 0419 made that a question of age, and
  a project seconds old is not a dashboard project.
*/
const mk = async (slug: string): Promise<string> =>
  String(
    (
      await one(`
        insert into public.projects (slug, name, purpose, status)
        values (${lit(slug)}, ${lit(`Artifact chain ${run}`)},
                'Removed at the end of this run', 'paused')
        returning project_id::text as id`)
    ).id,
  )

const projectId = await mk(`artifact-proof-${run}`)
const emptyId = await mk(`artifact-empty-${run}`)

await db.execute(`
  insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
  values (${lit(projectId)}::uuid, 'notebooklm', ${lit(`nb-${run}`)}, 'A linked notebook', 'source');
  insert into public.documents
    (project_id, connector, external_parent_ref, external_ref, title, content,
     content_fingerprint, content_chars, fetched_at, state)
  values (${lit(projectId)}::uuid, 'notebooklm', ${lit(`nb-${run}`)}, ${lit(`src-${run}`)},
          ${lit(`The ${TOKEN} programme`)},
          ${lit(
            `The ${TOKEN} programme runs in three phases. Phase one is discovery and takes ` +
              `two weeks. Phase two is the build and takes six weeks. Phase three is handover ` +
              `and takes one week. The ${TOKEN} programme has delivered four times so far, and ` +
              `the recurring risk is that discovery overruns because clients supply material late.`,
          )},
          encode(sha256(${lit(`fp-${run}`)}::bytea), 'hex'), 380, app.now_utc(), 'approved');
`)

/** Ask, through the canonical path, and run the job the request makes. */
const ask = async (project: string, what: string, tag: string): Promise<string> => {
  const command = await one(`
    insert into public.inbound_commands
      (origin_channel, origin_ref, actor, instruction, dedupe_key, project_id)
    values ('slack', ${lit(`artifact-${run}-${tag}`)}, 'verify-artifact', ${lit(what)},
            ${lit(`slack:message:artifact-${run}-${tag}`)}, ${lit(project)}::uuid)
    returning command_id::text as id`)
  const enqueued = await one(`select app.enqueue_inbound(${lit(String(command.id))}::uuid) as j`)
  const parsed = typeof enqueued.j === 'string' ? JSON.parse(enqueued.j) : (enqueued.j ?? {})
  return String((parsed as { job_id?: string })?.job_id ?? enqueued.j ?? '')
}

const pass = await buildPass(db, WORKER, {
  max: 1,
  canTranscribe: false,
  canSubprocess: false,
  projectRef,
})

/** Take a NAMED job and run it, settling anything else that arrives (#273). */
const work = async (jobId: string): Promise<boolean> => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let job: Job | null = null
    for (let tries = 0; tries < 6 && job === null; tries += 1) {
      const got = await dequeue(db, WORKER, false, false, undefined, MINE)
      if (got !== null && got.jobId === jobId) job = got
      else if (got !== null) {
        await db.execute(`
          update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
            state_reason = 'not this suite''s job' where job_id = ${lit(got.jobId)}::uuid`)
      } else await pause(1_000)
    }
    if (job === null) {
      /*
        Somebody else has it, and almost certainly the deployed worker: #184's
        scope keeps other SUITES out and nothing keeps the live worker out,
        and it ticks every minute.

        The gate caught this the honest way. The worker took the child, this
        returned false, the suite carried on, and six checks reported
        "NOTHING MADE" about a report the office was in the middle of writing.
        `verify:unified` already had the fix and the lesson did not travel.

        Waiting is also the better result: an end-to-end pass through the real
        worker is stronger evidence than the in-process run, not weaker.
      */
      for (let waited = 0; waited < 30; waited += 1) {
        const settled = await one(
          `select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`,
        )
        if (['complete', 'failed', 'cancelled'].includes(String(settled.s))) return true
        await pause(5_000)
      }
      return false
    }
    await runJob(db, job, pass.handlers, pass.review)
    const st = await one(
      `select state::text as s from public.jobs where job_id = ${lit(jobId)}::uuid`,
    )
    // The office takes up to three attempts; a suite that stopped at one would
    // report #185's coherence gate doing its job as a product failure.
    if (String(st.s) !== 'retrying') return true
    await db.execute(`select app.requeue_retrying()`)
  }
  return true
}

// --- the request ------------------------------------------------------------
const parentId = await ask(
  projectId,
  `Write me a PDF report on the ${TOKEN} programme — the phases, how long each takes, and the risks.`,
  'ask',
)
await work(parentId)

const child = await one(`
  select job_id::text as id, kind, state::text as s from public.jobs
   where parent_job_id = ${lit(parentId)}::uuid and kind = 'artifact.report'
   order by created_at desc limit 1`)
check(
  'the request made an artifact job rather than an answer about one',
  child.id === undefined ? 'NO CHILD JOB' : `artifact.report ${String(child.s)}`,
  child.id !== undefined,
)

const saidSo = await one(`
  select coalesce(body, '') as body from public.outputs
   where job_id = ${lit(parentId)}::uuid order by created_at desc limit 1`)
check(
  'and said it was writing one rather than claiming it had',
  String(saidSo.body).slice(0, 70),
  /writing|write|will send|on it/i.test(String(saidSo.body)),
)

// --- generate, validate, store ----------------------------------------------
/*
  And say so if it never settled, rather than asserting over work in progress.

  The gate caught this the honest way: the deployed worker took the child, the
  suite could not dequeue it, and six checks reported "NOTHING MADE" about a
  report the office was in the middle of writing. `work` waits for the real
  worker now — but a timeout is still possible, and a run that timed out must
  say that rather than letting the checks below read as findings about the
  product.
*/
const childFinished = child.id === undefined ? false : await work(String(child.id))
check(
  'the artifact job finished, so the checks below describe a job that ran',
  childFinished ? 'settled' : 'STILL RUNNING — everything below is about work in progress',
  childFinished,
)

const made = await one(`
  select d.document_id::text as id, d.title, d.origin, coalesce(d.external_ref, '') as ref
    from public.documents d
   where d.project_id = ${lit(projectId)}::uuid and d.origin = 'made'
   order by d.created_at desc limit 1`)
check(
  'a document the office MADE is in the project',
  made.id === undefined ? 'NOTHING MADE' : String(made.title).slice(0, 60),
  made.id !== undefined,
)

const artifactOut = await one(`
  select coalesce(body, '') as body, coalesce(sources, '[]'::jsonb) as sources
    from public.outputs where job_id = ${lit(String(child.id ?? ''))}::uuid
   order by created_at desc limit 1`)
const rawSources =
  typeof artifactOut.sources === 'string' ? JSON.parse(artifactOut.sources) : artifactOut.sources
const cited: string[] = Array.isArray(rawSources) ? rawSources.map((x) => String(x)) : []
check(
  'the report was written FROM the project, not from the air',
  cited.length === 0 ? 'no sources cited' : cited.join(' · ').slice(0, 80),
  cited.some((c) => c.includes(TOKEN) || c.startsWith('notebooklm:')),
)
check(
  'and the answer says how many pages it made',
  String(artifactOut.body).slice(0, 70),
  /page/i.test(String(artifactOut.body)),
)

/*
  The bytes, read back over HTTP.

  A path in a row is a claim and bytes coming back are the fact. The key is
  read from the vault in this process and never printed — the standing rule,
  and the reason this suite reads it here rather than taking it from the
  environment.
*/
const keyRow = await one(`
  select coalesce(decrypted_secret, '') as v from vault.decrypted_secrets
   where name = 'supabase.service_role_key'`)
const serviceKey = String(keyRow.v ?? '')
const storagePath = `${projectId}/made/${String(child.id ?? '')}.pdf`
let bytes = 0
let mintable = false
let header = ''
if (serviceKey !== '') {
  const url = await signedUrl(projectRef, serviceKey, storagePath, 120)
  mintable = url !== null
  if (url !== null) {
    const got = await fetch(url).catch(() => null)
    if (got !== null && got.ok) {
      const buf = new Uint8Array(await got.arrayBuffer())
      bytes = buf.byteLength
      header = new TextDecoder().decode(buf.slice(0, 5))
    }
  }
}
check(
  'the file is really in Storage, not merely recorded as being there',
  serviceKey === '' ? 'NO SERVICE KEY — not checked' : `${String(bytes)} bytes read back`,
  bytes > 1_000,
)
check(
  'and a signed link can be minted for it, which is how Slack delivers it (#258)',
  mintable ? 'minted' : 'COULD NOT MINT',
  mintable,
)

/*
  A PDF is a PDF, checked at the only layer that cannot be fooled by metadata.

  `validatePdf` ran inside the handler; this reads the first five bytes of the
  STORED object, because "it validated and then something else was written" is
  a real shape and a byte COUNT cannot tell the difference. The first draft of
  this check said it inspected the header and asserted the count — a report
  line that describes something other than what it tested, which CLAUDE.md
  records as its own defect.
*/
check(
  'and what came back is a PDF, not something that merely has the name of one',
  header === '' ? 'nothing read' : JSON.stringify(header),
  header === '%PDF-',
)

// --- the negative control ---------------------------------------------------
console.log('')
const emptyParent = await ask(
  emptyId,
  `Write me a PDF report on the ${TOKEN} programme — the phases and the risks.`,
  'empty',
)
await work(emptyParent)
const emptyChild = await one(`
  select job_id::text as id from public.jobs
   where parent_job_id = ${lit(emptyParent)}::uuid and kind = 'artifact.report'
   order by created_at desc limit 1`)
if (emptyChild.id !== undefined) await work(String(emptyChild.id))

const inventedDoc = await one(`
  select count(*)::int as n from public.documents
   where project_id = ${lit(emptyId)}::uuid and origin = 'made'`)
const emptyBody = await one(`
  select coalesce(body, '') as body from public.outputs
   where job_id = ${lit(String(emptyChild.id ?? emptyParent))}::uuid
   order by created_at desc limit 1`)
check(
  'CONTROL: a project with nothing in it produces NO file',
  `${String(inventedDoc.n)} document(s) made from nothing`,
  Number(inventedDoc.n) === 0,
)
check(
  'CONTROL: and the office says it has nothing to write from, rather than inventing',
  String(emptyBody.body).slice(0, 80) || '(no answer)',
  /nothing|no source|attach|point me|have not made/i.test(String(emptyBody.body)),
)

// --- teardown ---------------------------------------------------------------
console.log('')
await db.execute(`
  update public.jobs set state = 'cancelled', finished_at = app.now_utc(),
    state_reason = 'verify:artifact teardown'
   where requested_by = ${lit(MINE)}
     and state not in ('complete', 'cancelled', 'failed', 'committing', 'committed', 'notifying');
  delete from public.inbound_commands where origin_ref like ${lit(`artifact-${run}-%`)};
  delete from public.documents where project_id in (${lit(projectId)}::uuid, ${lit(emptyId)}::uuid);
  delete from public.project_attachments
   where project_id in (${lit(projectId)}::uuid, ${lit(emptyId)}::uuid);
`)
await db
  .execute(`
    delete from public.projects
     where project_id in (${lit(projectId)}::uuid, ${lit(emptyId)}::uuid)`)
  .catch(async () => {
    await db.execute(`
      update public.projects set status = 'archived'
       where project_id in (${lit(projectId)}::uuid, ${lit(emptyId)}::uuid)`)
  })
const left = await one(`
  select count(*)::int as n from public.projects
   where project_id in (${lit(projectId)}::uuid, ${lit(emptyId)}::uuid) and status <> 'archived'`)
check(
  'teardown — nothing of this run is in Grant’s project list',
  `${String(left.n)} live`,
  Number(left.n) === 0,
)

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)

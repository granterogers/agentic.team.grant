/**
 * §19A through the document handler — a correspondence summary request is answered from the records, and the model
 * is never asked to write its figures.
 *
 *   npx tsx scripts/isolated/artifact-correspondence-path.ts <replica-db>
 *
 * Drives the REAL `artifactHandler` on a real job whose request is "create a correspondence summary". A router stub
 * counts every model call. The replica has no document storage, so the run stops at the store step and reports that;
 * everything before it (gathering, drafting from the records, rendering, validating) is the real code.
 *
 * Asserts:
 *   1. The model is not called for this request (the figures come from the records, not from a model).
 *   2. The draft reaches the store step, which means it was drafted and passed its checks.
 *   3. CONTROL: a plain report request still calls the model (the path is specific to the two documents).
 *
 * What this does NOT prove: that the stored file is written. The storage service is not on the replica, and the
 * production guard refuses the storage write before any network call. That refusal is the signal the store step
 * was reached, so this proof is run by hand and is NOT in the gate.
 *
 * Replica only; the guard refuses anything else.
 */
import { artifactHandler } from '../../src/handlers/artifact.ts'
import type { Job } from '../../src/jobs/worker.ts'
import type { ProviderRouter } from '../../src/providers/router.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

const tag = Date.now().toString(36)
const PRIYA = `priya-art-${tag}@acme.test`

await db.execute('begin')
try {
  const jobId = await realParent(db)
  const office = String((await one(`select app.job_office('${jobId}'::uuid)::text as o`)).o)
  const project = String(
    (await one(`select project_id::text as p from public.jobs where job_id = '${jobId}'::uuid`)).p,
  )
  await db.execute(`insert into public.contacts (project_id, kind, name, role, org, stage, email, phone, instagram, website, "where", note, "next", next_due, fields, labels_set)
    values (${lit(project)}::uuid, 'supplier', 'Priya Proof', '', 'Acme Villas', 'active', ${lit(PRIYA)}, '', '', '', 'Crete', '', '', '', '[]'::jsonb, false)`)
  await db.execute(`insert into public.mail_messages
    (message_id, thread_id, subject, from_name, from_address, to_count, sent_at, labels, has_attachments, unread,
     first_seen_at, last_seen_at, office_id)
    values (${lit(`art-${tag}`)}, ${lit(`art-thread-${tag}`)}, 'Villa enquiry', 'Priya Proof', ${lit(PRIYA)}, 1,
            app.now_utc() - interval '5 days', array['INBOX']::text[], false, false, app.now_utc(), app.now_utc(),
            ${lit(office)}::uuid)`)

  let modelCalls = 0
  const stub = {
    complete: async () => {
      modelCalls += 1
      return { content: '{}', model: 'art/stub' }
    },
  }
  const handler = artifactHandler({
    db,
    router: stub as unknown as ProviderRouter,
    projectRef: 'replica',
    serviceKey: 'replica',
  })

  const setBrief = async (jobRow: string, brief: string) =>
    db.execute(
      `update public.jobs set pinned_config = jsonb_set(pinned_config, '{brief}', ${lit(JSON.stringify(brief))}::jsonb)
        where job_id = '${jobRow}'::uuid`,
    )
  const jobFor = async (id: string, key: string): Promise<Job> => ({
    jobId: id,
    kind: 'artifact.report',
    correlationId: String(
      (await one(`select correlation_id::text as c from public.jobs where job_id = '${id}'::uuid`))
        .c,
    ),
    projectId: project,
    idempotencyKey: key,
    attempt: 1,
    officeId: office,
  })

  // The store step writes to document storage, which the replica does not have. The production guard refuses the
  // write before any network call (the URL is a Supabase host), and the refusal is the proof that the run reached
  // the store step: gathering, drafting from the records, rendering and validating had all completed.
  const reachedStore = async (
    run: () => Promise<unknown>,
  ): Promise<{ reached: boolean; body: string }> => {
    try {
      const out = (await run()) as { body?: string }
      return { reached: false, body: String(out.body ?? '') }
    } catch (e) {
      const refused = e instanceof Error && e.name === 'ProductionAccessRefused'
      return { reached: refused, body: refused ? 'refused at the store step' : String(e) }
    }
  }

  // A SEPARATE job for each request, because the handler checkpoints each step by job id: a second run on the same job
  // would reuse the first run's saved draft and never call the model, and a control would pass for the wrong reason.
  await setBrief(jobId, 'Create a correspondence summary for this project')
  const fixed = await reachedStore(async () =>
    handler.handle(await jobFor(jobId, `art-${tag}`), db),
  )
  check(
    'a correspondence summary request does not call the model for its figures',
    modelCalls === 0,
    `model calls: ${String(modelCalls)}`,
  )
  check(
    'the draft reaches the store step (it was drafted from the records and passed its checks)',
    fixed.reached,
    fixed.body.slice(0, 120),
  )

  modelCalls = 0
  const controlJob = await realParent(db)
  await setBrief(controlJob, 'Write me a short report on the villa enquiry from Priya Proof')
  const control = await reachedStore(async () =>
    handler.handle(await jobFor(controlJob, `art2-${tag}`), db),
  )
  check(
    'CONTROL: a plain report request still goes to the model',
    modelCalls >= 1,
    `model calls: ${String(modelCalls)}; reply: ${control.body.slice(0, 120)}`,
  )
} finally {
  await db.execute('rollback')
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
process.exitCode = failed.length === 0 ? 0 : 1

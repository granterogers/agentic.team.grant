/**
 * B6 (architecture audit, run 1): a question about files that arrived in a
 * watched Drive folder offers only what answering can perform.
 *
 *   npx tsx scripts/isolated/drive-options.ts <replica-db>
 *
 * The REAL `drive.watch` handler runs against the replica with a stand-in for
 * Google (the handler takes its `fetch`). A file appears in a watched folder of
 * a project whose autonomy is at its default, so the office ASKS. Then each
 * option it offered is answered - through the same door the dashboard and the
 * chat use - and the DATABASE is asked what that did:
 *
 *   an option that promises to add the files must leave a read job for each of
 *   them; an option that declines must leave none; nothing may be offered whose
 *   answer leaves everything exactly as it was.
 */
import { driveWatchHandler } from '../../src/handlers/drive.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'drive0609')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

// ---- Google, as configured: a client, a secret, a refresh token -------------------
await db.execute(`insert into public.system_config (key, value, description) values ('google.client_id', '"isolated-client"'::jsonb, 'isolated proof')
  on conflict (key) do update set value = excluded.value`)
for (const name of ['google.client_secret', 'google.refresh_token']) {
  await db.execute(`insert into vault.secrets (name, secret) values (${lit(name)}, 'isolated-not-a-secret')
    on conflict (name) do update set secret = excluded.secret`)
}
const FILES = [
  { id: `file-a-${run}`, name: 'Venue contract.pdf', mimeType: 'application/pdf' },
  { id: `file-b-${run}`, name: 'Run of show', mimeType: 'application/vnd.google-apps.document' },
]
const tokens = new Map<string, string>() // page token -> folder id
const fetchStub = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input)
  const reply = (v: unknown) =>
    new Response(JSON.stringify(v), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return reply({
      access_token: 'isolated-token',
      scope: 'https://www.googleapis.com/auth/drive',
      expires_in: 3600,
    })
  }
  if (url.includes('/changes?pageToken=')) {
    const token = decodeURIComponent(/pageToken=([^&]+)/.exec(url)?.[1] ?? '')
    const folder = tokens.get(token)
    return reply({
      changes:
        folder === undefined
          ? []
          : FILES.map((f) => ({ fileId: f.id, file: { ...f, parents: [folder] } })),
      newStartPageToken: `${token}-next`,
    })
  }
  throw new Error(`REFUSED: the isolated Drive stand-in does not know ${url}`)
}) as typeof fetch
const handler = driveWatchHandler(db, fetchStub)

/** A project with a watched folder, and the duty job that will notice the files. */
const setup = async (label: string) => {
  const slug = `drive-${label}-${run}`
  const project = String(
    json(
      (
        await one(
          `select app.hq_create_project(${lit(`Drive ${label} ${run}`)}, 'upload', ${lit(slug)}, ${lit(`Drive ${label} ${run}`)}, true) as v`,
        )
      ).v,
    ).project_id,
  )
  const folder = `folder-${label}-${run}`
  const token = `tok-${label}-${run}`
  tokens.set(token, folder)
  await db.execute(`insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
    values (${lit(project)}::uuid, 'drive', ${lit(folder)}, 'A watched folder', 'source')`)
  await db.execute(`insert into public.drive_watch (attachment_id, folder_id, page_token, primed, failures)
    select attachment_id, ${lit(folder)}, ${lit(token)}, true, 0 from public.project_attachments
     where connector = 'drive' and external_ref = ${lit(folder)}`)
  const jobId = String(
    (
      await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
        values ('drive.watch', 'duty:isolated-b6', ${lit(project)}::uuid, 'b6-' || gen_random_uuid(), gen_random_uuid())
        returning job_id::text as id`)
    ).id,
  )
  return {
    project,
    folder,
    job: {
      jobId,
      kind: 'drive.watch',
      correlationId: 'x',
      projectId: project,
      idempotencyKey: 'x',
      attempt: 1,
    } as unknown as Job,
  }
}
const readJobs = async (parent: string) =>
  Number(
    (
      await one(
        `select count(*)::int as c from public.jobs where parent_job_id = ${lit(parent)}::uuid and kind = 'drive.read_file'`,
      )
    ).c,
  )

// ---- the question, as the office asks it -------------------------------------------
const probe = await setup('probe')
await handler.handle(probe.job, db as never)
const q =
  await one(`select blocker_id::text as id, approval_options as o, on_answer, standing_option
  from public.blockers where job_id = ${lit(probe.job.jobId)}::uuid and state = 'open'`)
const options = (q.o ?? []) as string[]
check(
  'a question was raised about the arrived files, with options',
  typeof q.id === 'string' && options.length >= 2,
  JSON.stringify(options),
)

for (const [i, option] of options.entries()) {
  const s = await setup(`o${String(i)}`)
  await handler.handle(s.job, db as never)
  const b = String(
    (
      await one(
        `select blocker_id::text as id from public.blockers where job_id = ${lit(s.job.jobId)}::uuid and state = 'open'`,
      )
    ).id,
  )
  const r = json(
    (await one(`select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(b)}::uuid), app.test_office()), ${lit(b)}::uuid, ${lit(option)}, 'grant') as r`)).r,
  )
  const made = await readJobs(s.job.jobId)
  const promisesToAdd = /^\s*add\b/i.test(option)
  const declines = /^\s*(ignore|no|leave|don'?t)\b/i.test(option)
  check(
    promisesToAdd
      ? `"${option}" promises to add them: every file gets a read job`
      : declines
        ? `"${option}" declines: nothing is read`
        : `"${option}" is neither a promise to add nor a decline: it should not be offered`,
    r.ok === true && (promisesToAdd ? made === FILES.length : declines ? made === 0 : false),
    `answer ${r.ok === true ? 'taken' : JSON.stringify(r)}; ${String(made)} read job(s) for ${String(FILES.length)} file(s)`,
  )
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await db.end()
process.exit(failed.length === 0 ? 0 : 1)

/**
 * An explicit Import of a Drive file fetches it, end to end, on a LOCAL replica inside one transaction that is rolled
 * back (migration 0960).
 *
 *   env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL \
 *     npx tsx scripts/isolated/import-fetch.ts [replica-db]
 *
 * Drives the REAL drive.read_file handler (real driveAccess, readFile, fileMeta, putFile, record_drive_document,
 * attach_file_to_document, document_import_fulfil) against Postgres with a FAKE Drive, a fake token endpoint and a fake
 * storage endpoint behind one stubbed fetch: no network, no Google, no production. Only the stored Google credential
 * is stubbed (the query that reads the vault), because the replica has no vault secret to read.
 *
 * Proves: the press starts exactly one drive.read_file job (idempotent while live, a retry after it ends); the job has
 * an origin (internal) and does not announce; a Google Doc arrives as text and a PDF as bytes, each becoming a Team HQ
 * copy; the copy survives the original going missing, bytes and all; a read nobody asked for imports nothing; a failed
 * fetch is recorded on the request and cleared by the retry; a document with text carries a cached preview excerpt that
 * nothing can write; and nothing in the whole run touched the network.
 */
import type { SqlExecutor } from '../../src/db/executor.ts'
import { driveReadHandler } from '../../src/handlers/drive-read.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_docs2')
type Row = Record<string, unknown>
const q = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows as Row[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
// biome-ignore lint/suspicious/noExplicitAny: a jsonb answer is read by key in a proof
const call = async (sql: string): Promise<any> => {
  const raw = (await q(`select (${sql}) as r`))[0]?.r
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
const OFFICE = String((await q('select app.test_office()::text o'))[0]?.o)
const run = Math.random().toString(36).slice(2, 8)

// ---- the fake Drive, the fake token endpoint and the fake storage ----------------------------------------------------
const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4 a fake pdf body that is long enough to be stored as bytes\n%%EOF',
)
const DOC_TEXT = 'The Q3 plan\n\n   Customers want   faster onboarding.\nPricing is clear.\n'
const drive: Record<
  string,
  { mime: string; name: string; body?: Uint8Array | string; status?: number }
> = {}
const storage = new Map<string, Uint8Array>()
const calls: string[] = []
const fakeFetch = (async (url: string | URL, init?: { body?: unknown; method?: string }) => {
  const u = String(url)
  calls.push(u)
  if (u === 'https://oauth2.googleapis.com/token')
    return new Response(
      JSON.stringify({
        access_token: 'tok-not-real',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
      }),
      { status: 200 },
    )
  const m = u.match(/googleapis\.com\/drive\/v3\/files\/([^/?]+)(\/export)?\?(.*)$/)
  if (m !== null) {
    const f = drive[decodeURIComponent(m[1] ?? '')]
    if (f === undefined || f.status === 404)
      return new Response('{"error":"File not found"}', { status: 404 })
    if (m[3]?.includes('fields='))
      return new Response(JSON.stringify({ id: m[1], name: f.name, mimeType: f.mime }), {
        status: 200,
      })
    const body =
      typeof f.body === 'string'
        ? new TextEncoder().encode(f.body)
        : new Uint8Array(f.body ?? new Uint8Array())
    return new Response(body, { status: 200 })
  }
  if (u.includes('/object/files/')) {
    storage.set(u, init?.body as Uint8Array)
    return new Response('{}', { status: 200 })
  }
  throw new Error(`REFUSED: this proof makes no call to ${u}`)
}) as typeof fetch

// Only the credential read is stubbed; everything else goes to the replica.
const withCredential: SqlExecutor = {
  execute: async (sql: string) => {
    if (sql.includes("'google.client_id'") && sql.includes('google.refresh_token'))
      return { rows: [{ client_id: 'cid', client_secret: 'csec', refresh_token: 'rtok' }] } as never
    return db.execute(sql)
  },
} as SqlExecutor
const handler = driveReadHandler({
  db: withCredential,
  projectRef: 'proof',
  serviceKey: 'proof-key',
  fetchImpl: fakeFetch,
})
const runJob = async (jobId: string, projectId: string): Promise<string> => {
  const out = await handler.handle(
    { jobId, projectId, kind: 'drive.read_file' } as never,
    {} as never,
  )
  return String((out as { body: string }).body)
}

await q('begin')
await q(
  `insert into public.integration_connections (office_id, provider, account_ref, secret_name) values (${lit(OFFICE)}::uuid, 'google', 'primary', 'google.refresh_token') on conflict do nothing`,
) // a connected Google account: an import of a Drive file needs one (1010)
try {
  const project = async (slug: string): Promise<string> =>
    String(
      (
        await q(
          `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'active', ${lit(OFFICE)}::uuid) returning project_id::text id`,
        )
      )[0]?.id,
    )
  const SLUG = `importfetch-${run}`
  const PA = await project(SLUG)
  const FOLDER = `folder-${run}`
  const ref = async (
    file: string,
    title: string,
    over: { connector?: string; folder?: string | null; type?: string } = {},
  ): Promise<string> =>
    String(
      (
        await q(`insert into public.documents
          (office_id, project_id, title, doc_type, origin, connector, external_parent_ref, external_ref, state, added_by)
          values (${lit(OFFICE)}::uuid, ${lit(PA)}::uuid, ${lit(title)}, ${lit(over.type ?? 'file')}, 'source', ${lit(over.connector ?? 'drive')},
                  ${over.folder === null ? 'null' : lit(over.folder ?? FOLDER)}, ${lit(file)}, 'approved', 'chief-of-staff')
          returning document_id::text id`)
      )[0]?.id,
    )
  const press = async (id: string) =>
    await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(id)}::uuid)`)
  const jobsFor = async (id: string): Promise<Row[]> =>
    await q(`select job_id::text id, state::text st, kind, requested_by, announce, pinned_config
               from public.jobs where idempotency_key = ${lit(`import-fetch:${id}`)} order by created_at`)
  // biome-ignore lint/suspicious/noExplicitAny: a jsonb item
  type Item = any
  const listItem = async (id: string): Promise<Item> => {
    const l = await call(`app.hq_project_documents(${lit(OFFICE)}::uuid, ${lit(SLUG)})`)
    return (l.documents as Item[]).find((d) => d.id === id)
  }

  // ======================================================== 1. a Google Doc: pressed, fetched, copied
  drive[`gdoc-${run}`] = {
    mime: 'application/vnd.google-apps.document',
    name: 'Q3 plan',
    body: DOC_TEXT,
  }
  const gdoc = await ref(`gdoc-${run}`, 'Q3 plan')
  check('before the press nothing is queued for the document', (await jobsFor(gdoc)).length === 0)
  const p1 = await press(gdoc)
  check(
    'the press records a pending request and says it is fetching',
    p1.ok === true && p1.state === 'pending' && /fetching/i.test(String(p1.note)),
    JSON.stringify(p1),
  )
  const j1 = await jobsFor(gdoc)
  check(
    'exactly one drive.read_file job, requested_by hq, announce false',
    j1.length === 1 &&
      j1[0]?.kind === 'drive.read_file' &&
      j1[0]?.requested_by === 'hq' &&
      j1[0]?.announce === false,
  )
  const pc = (j1[0]?.pinned_config ?? {}) as Record<string, unknown>
  check(
    'the job names the folder, the file, the project and the document',
    pc.folder_id === FOLDER &&
      pc.file_id === `gdoc-${run}` &&
      pc.project_id === PA &&
      pc.document_id === gdoc,
  )
  check(
    'a recorded Drive row has no mime type, so the job carries none and the handler asks Drive',
    pc.mime_type === undefined,
  )
  const typed = await ref(`typed-${run}`, 'Typed google doc', { type: 'google-doc' })
  await press(typed)
  check(
    'a row already typed google-doc is given the Google Doc mime so it is exported, not downloaded',
    ((await jobsFor(typed))[0]?.pinned_config as Record<string, unknown>)?.mime_type ===
      'application/vnd.google-apps.document',
  )
  const jid1 = String(j1[0]?.id)
  check(
    'the job has an origin and may act (internal), and is not harness',
    (await call(`app.job_origin(${lit(jid1)}::uuid)`)) === 'internal' &&
      (await call(`app.harness_job(${lit(jid1)}::uuid)`)) === false,
  )
  const p1b = await press(gdoc)
  check(
    'pressing again while it is live makes no second job',
    (await jobsFor(gdoc)).length === 1 && p1b.fetch_job_id === jid1,
    JSON.stringify(p1b),
  )
  check(
    'before the fetch nothing has been copied',
    (await listItem(gdoc))?.import_state === 'pending',
  )

  const said1 = await runJob(jid1, PA)
  check('the handler reports the copy', /Team HQ copy now exists/.test(said1), said1)
  const req1 = (
    await q(
      `select state, copy_document_id::text c from public.document_import_requests where document_id = ${lit(gdoc)}::uuid`,
    )
  )[0]
  check(
    'the request is done and names a copy',
    req1?.state === 'done' && typeof req1?.c === 'string',
  )
  const copy1 = (
    await q(
      `select origin, connector, content, imported_from_document_id::text f, storage_path from public.documents where document_id = ${lit(String(req1?.c))}::uuid`,
    )
  )[0]
  check(
    'the copy is a Team HQ document (yours, no connector) holding the exported text',
    copy1?.origin === 'yours' &&
      copy1?.connector === null &&
      String(copy1?.content) === DOC_TEXT &&
      copy1?.f === gdoc,
    JSON.stringify(copy1),
  )
  check(
    'the Drive file was read through the metadata call, then the export',
    calls.some((c) => c.includes(`/files/gdoc-${run}?fields=`)) &&
      calls.some((c) => c.includes(`/files/gdoc-${run}/export?`)),
  )

  // ======================================================== 2. a PDF: bytes land in storage and the copy keeps them
  drive[`pdf-${run}`] = { mime: 'application/pdf', name: 'Contract.pdf', body: PDF_BYTES }
  const pdf = await ref(`pdf-${run}`, 'Contract.pdf')
  const p2 = await press(pdf)
  const jid2 = String((await jobsFor(pdf))[0]?.id)
  check(
    'a PDF reference has no mime type of its own, so the job carries none',
    ((await jobsFor(pdf))[0]?.pinned_config as Record<string, unknown> | undefined)?.mime_type ===
      undefined,
    JSON.stringify(p2),
  )
  const said2 = await runJob(jid2, PA)
  check(
    'the PDF is brought in and the copy made',
    /Brought/.test(said2) && /Team HQ copy now exists/.test(said2),
    said2,
  )
  const copy2 = (
    await q(`select c.storage_path, c.mime_type, c.byte_size::int sz, c.origin, c.connector
                            from public.document_import_requests r join public.documents c on c.document_id = r.copy_document_id
                           where r.document_id = ${lit(pdf)}::uuid`)
  )[0]
  check(
    'the copy holds the file: path, mime and exact byte size',
    typeof copy2?.storage_path === 'string' &&
      copy2?.mime_type === 'application/pdf' &&
      copy2?.sz === PDF_BYTES.byteLength &&
      copy2?.origin === 'yours' &&
      copy2?.connector === null,
    JSON.stringify(copy2),
  )
  const stored = [...storage.entries()].find(([u]) =>
    u.includes(String(copy2?.storage_path).replace(/^files\//, '')),
  )
  check(
    'the bytes went to the files bucket, unchanged',
    stored !== undefined && stored[1].byteLength === PDF_BYTES.byteLength,
  )

  // ======================================================== 3. the original disappearing
  await q(`update public.documents set missing_since = now() where document_id = ${lit(pdf)}::uuid`)
  const after = await listItem(
    String(
      (
        await q(
          `select copy_document_id::text c from public.document_import_requests where document_id = ${lit(pdf)}::uuid`,
        )
      )[0]?.c,
    ),
  )
  check(
    'with the original gone the copy is the listed item, with its file',
    after !== undefined &&
      after.has_file === true &&
      after.imported === true &&
      after.thumbnail.previewable_from_file === true,
  )
  check(
    'the file it holds is still in storage after the original went missing',
    stored !== undefined && storage.has(stored[0]),
  )

  // ======================================================== 4. nobody asked: nothing imported
  drive[`plain-${run}`] = {
    mime: 'text/plain',
    name: 'Notes.txt',
    body: 'plain words that nobody asked to import',
  }
  const plain = await ref(`plain-${run}`, 'Notes.txt')
  const rogue =
    await q(`insert into public.jobs (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, announce, pinned_config)
      values (${lit(OFFICE)}::uuid, gen_random_uuid(), ${lit(PA)}::uuid, ${lit(`watch-read-${run}`)}, 'drive.read_file', 'duty:drive-watch', false,
              ${lit(JSON.stringify({ project_id: PA, folder_id: FOLDER, file_id: `plain-${run}`, title: 'Notes.txt', mime_type: 'text/plain' }))}::jsonb)
      returning job_id::text id`)
  const saidRogue = await runJob(String(rogue[0]?.id), PA)
  check(
    'CONTROL: a read nobody asked to import reads the file and imports nothing',
    !/Team HQ copy/.test(saidRogue) &&
      Number(
        (
          await q(
            `select count(*)::int n from public.documents where imported_from_document_id = ${lit(plain)}::uuid`,
          )
        )[0]?.n,
      ) === 0,
    saidRogue,
  )
  check(
    'CONTROL: enqueue refuses a document with no recorded request',
    (await call(`app.document_import_enqueue_fetch(${lit(OFFICE)}::uuid, ${lit(plain)}::uuid)`)) ===
      null,
  )
  const nb = await ref(`nb-${run}`, 'A notebook source', {
    connector: 'notebooklm',
    folder: `nbk-${run}`,
  })
  const pn = await press(nb)
  check(
    'CONTROL: a non-Drive reference is recorded as before and starts no read',
    pn.state === 'pending' &&
      (await jobsFor(nb)).length === 0 &&
      !/fetching/i.test(String(pn.note)),
    JSON.stringify(pn),
  )
  const noParent = await ref(`np-${run}`, 'No folder known', { folder: null })
  await press(noParent)
  check(
    'CONTROL: a Drive reference with no folder starts no read (the handler could not file it)',
    (await jobsFor(noParent)).length === 0,
  )

  // ======================================================== 5. a failed fetch is recorded, then retried
  const gone = await ref(`gone-${run}`, 'Deleted at source')
  await press(gone)
  const jg = String((await jobsFor(gone))[0]?.id)
  const saidGone = await runJob(jg, PA)
  check('Drive saying 404 is reported, not swallowed', /drive 404/.test(saidGone), saidGone)
  const reqGone = (
    await q(
      `select state, attempts, last_error from public.document_import_requests where document_id = ${lit(gone)}::uuid`,
    )
  )[0]
  check(
    'the request stays pending and records the reason and the attempt',
    reqGone?.state === 'pending' &&
      Number(reqGone?.attempts) === 1 &&
      /drive 404/.test(String(reqGone?.last_error)),
    JSON.stringify(reqGone),
  )
  check(
    'the list shows the person why it is still pending',
    /drive 404/.test(String((await listItem(gone))?.import_error)) &&
      (await listItem(gone))?.import_state === 'pending',
  )
  check(
    'CONTROL: a document with no failure reports no import_error',
    (await listItem(gdoc))?.import_error === null ||
      (await listItem(gdoc))?.import_error === undefined,
  )
  await q(
    `update public.jobs set state = 'cancelled', finished_at = now() where job_id = ${lit(jg)}::uuid`,
  )
  drive[`gone-${run}`] = {
    mime: 'text/plain',
    name: 'Deleted at source',
    body: 'it came back, so the retry works',
  }
  const retry = await press(gone)
  const jobsGone = await jobsFor(gone)
  check(
    'pressing again after the job ended is a retry: a second job, the error cleared',
    jobsGone.length === 2 &&
      retry.fetch_job_id !== jg &&
      (
        await q(
          `select last_error from public.document_import_requests where document_id = ${lit(gone)}::uuid`,
        )
      )[0]?.last_error === null,
  )
  const saidRetry = await runJob(String(retry.fetch_job_id), PA)
  check('the retry completes the import', /Team HQ copy now exists/.test(saidRetry), saidRetry)
  const noAccess: string = await (async () => {
    const h2 = driveReadHandler({
      db: {
        execute: async (sql: string) =>
          sql.includes("'google.client_id'")
            ? ({ rows: [{ client_id: '', client_secret: '', refresh_token: '' }] } as never)
            : db.execute(sql),
      } as SqlExecutor,
      projectRef: 'proof',
      serviceKey: 'k',
      fetchImpl: fakeFetch,
    })
    const g2 = await ref(`g2-${run}`, 'Needs Google')
    await press(g2)
    const j = String((await jobsFor(g2))[0]?.id)
    const out = await h2.handle(
      { jobId: j, projectId: PA, kind: 'drive.read_file' } as never,
      {} as never,
    )
    const e = (
      await q(
        `select last_error from public.document_import_requests where document_id = ${lit(g2)}::uuid`,
      )
    )[0]?.last_error
    return `${String((out as { body: string }).body)} || ${String(e)}`
  })()
  check(
    'with Google not connected the reason (not configured) is what the person sees',
    /client id/.test(noAccess.split('||')[1] ?? ''),
    noAccess,
  )

  // ======================================================== 6. the cached preview excerpt
  const withText = String(
    (
      await q(`insert into public.documents (office_id, project_id, title, doc_type, content, content_fingerprint, content_chars, fetched_at, origin, connector, state, added_by)
        values (${lit(OFFICE)}::uuid, ${lit(PA)}::uuid, 'Has words', 'note', ${lit(`  Line one.\n\n   Line   two with   gaps.  ${'x'.repeat(900)}`)}, ${lit('f'.repeat(64))}, 920, now(), 'yours', null, 'approved', 'you')
        returning document_id::text id`)
    )[0]?.id,
  )
  const ex = (
    await q(
      `select preview_excerpt e from public.documents where document_id = ${lit(withText)}::uuid`,
    )
  )[0]?.e
  check(
    'the excerpt is the first words with whitespace collapsed, and at most 320 characters',
    String(ex).startsWith('Line one. Line two with gaps. xxx') && String(ex).length === 320,
    String(ex).slice(0, 60),
  )
  const tn = (await listItem(withText))?.thumbnail
  check(
    'the list reports it as an available excerpt thumbnail derived from extracted text',
    tn?.available === true &&
      tn?.kind === 'excerpt' &&
      tn?.derived_from === 'extracted_text' &&
      String(tn?.excerpt).startsWith('Line one.'),
    JSON.stringify(tn)?.slice(0, 120),
  )
  const bare = (await listItem(await ref(`bare-${run}`, 'A bare reference')))?.thumbnail
  check(
    'CONTROL: a reference with no text has no thumbnail and no excerpt',
    bare?.available === false && bare?.kind === null && bare?.excerpt === null,
  )
  const blank = String(
    (
      await q(`insert into public.documents (office_id, project_id, title, doc_type, content, content_fingerprint, content_chars, fetched_at, origin, state, added_by)
        values (${lit(OFFICE)}::uuid, ${lit(PA)}::uuid, 'Blank', 'note', E'   \\n\\t  ', ${lit('e'.repeat(64))}, 7, now(), 'yours', 'approved', 'you') returning document_id::text id`)
    )[0]?.id,
  )
  check(
    'CONTROL: text that is only whitespace has no excerpt',
    (
      await q(
        `select preview_excerpt is null n from public.documents where document_id = ${lit(blank)}::uuid`,
      )
    )[0]?.n === true,
  )
  let refused = ''
  await q('savepoint s1')
  try {
    await q(
      `update public.documents set preview_excerpt = 'forged' where document_id = ${lit(withText)}::uuid`,
    )
  } catch (e) {
    refused = e instanceof Error ? e.message : String(e)
  }
  await q('rollback to savepoint s1')
  check(
    'the excerpt cannot be written, only derived',
    /can only be updated to DEFAULT/i.test(refused),
    refused,
  )
  await q(
    `update public.documents set content = 'Replaced text now.' where document_id = ${lit(withText)}::uuid`,
  )
  check(
    'it follows the text when the text changes',
    (
      await q(
        `select preview_excerpt e from public.documents where document_id = ${lit(withText)}::uuid`,
      )
    )[0]?.e === 'Replaced text now.',
  )

  // ======================================================== 7. nothing left the process
  check(
    'every call the proof made was to a fake endpoint',
    calls.every(
      (c) =>
        c.startsWith('https://oauth2.googleapis.com/') ||
        c.includes('googleapis.com/drive/v3/') ||
        c.includes('/object/files/'),
    ),
  )
} finally {
  await q('rollback')
  const left = await q(
    `select count(*)::int n from public.projects where slug like 'importfetch-%'`,
  )
  check('teardown left nothing behind', Number(left[0]?.n) === 0)
  await db.end()
}
console.log(failed === 0 ? '\nALL PASSED' : `\n${String(failed)} FAILED`)
process.exitCode = failed === 0 ? 0 : 1

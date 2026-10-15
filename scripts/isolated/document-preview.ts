/**
 * An external document is previewed on demand, indexed, and not copied (migrations 0990, 0991), on a LOCAL replica inside one
 * transaction that is rolled back.
 *
 *   env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL \
 *     npx tsx scripts/isolated/document-preview.ts [replica-db]
 *
 * Drives the REAL gateway logic (src/documents/preview.ts: previewDocument and streamDocument, the code hq-api imports)
 * against the REAL SQL (app.document_preview_plan, app.document_preview_record, app.hq_document_import, the
 * drive.read_file handler) with a FAKE Drive and a fake storage endpoint behind one stubbed fetch. No network, no Google,
 * no production.
 *
 * Proves: the plan answers every miss the same way (another office, another project, no such id); a Google Doc preview
 * records derived text that the chunk index and search then find, writes no file and no storage object; the stale rule
 * refetches only when the source changed and never on a plain re-open; a PDF's bytes are streamed and never stored while
 * its text is indexed; a disconnected source (0896) is neither fetched nor shown from the cache and can be written no
 * more derived data; text a PREVIEW derived is not the file, so an Import of it still fetches the source and the copy
 * holds the file; an import of material a real read brought in is unchanged (instant); the cache table is closed to
 * every role.
 */
import type { SqlExecutor } from '../../src/db/executor.ts'
import {
  driveProvider,
  type ExtractText,
  type PreviewPlan,
  previewDocument,
  streamDocument,
} from '../../src/documents/preview.ts'
import { driveReadHandler } from '../../src/handlers/drive-read.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_prev2')
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

// ---- the fake Drive, token endpoint and storage ----------------------------------------------------------------------
const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4 a fake pdf body, long enough to be a file\n%%EOF',
)
interface F {
  mime: string
  name: string
  modified: string
  md5?: string
  body?: Uint8Array | string
}
const drive: Record<string, F> = {}
const storage = new Map<string, Uint8Array>()
const calls: string[] = []
const driveCalls = (kind: 'meta' | 'export' | 'media', id: string): number =>
  calls.filter((u) => {
    const m = u.match(/googleapis\.com\/drive\/v3\/files\/([^/?]+)(\/export)?\?(.*)$/)
    if (m === null || decodeURIComponent(m[1] ?? '') !== id) return false
    const k = m[2] !== undefined ? 'export' : (m[3] ?? '').includes('alt=media') ? 'media' : 'meta'
    return k === kind
  }).length
const fakeFetch = (async (url: string | URL, init?: { body?: unknown }) => {
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
    if (f === undefined) return new Response('{"error":{"status":"NOT_FOUND"}}', { status: 404 })
    if (m[2] === undefined && !(m[3] ?? '').includes('alt=media'))
      return new Response(
        JSON.stringify({
          id: m[1],
          name: f.name,
          mimeType: f.mime,
          modifiedTime: f.modified,
          ...(f.md5 ? { md5Checksum: f.md5 } : {}),
          size: String(typeof f.body === 'string' ? f.body.length : (f.body?.byteLength ?? 0)),
          webViewLink: `https://drive.google.com/file/d/${m[1]}/view`,
        }),
        { status: 200 },
      )
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
const runJob = async (jobId: string, projectId: string): Promise<string> =>
  String(
    (
      (await handler.handle(
        { jobId, projectId, kind: 'drive.read_file' } as never,
        {} as never,
      )) as { body: string }
    ).body,
  )

// ---- the gateway, minus HTTP: the same module, the real plan and record ----------------------------------------------
const extractText: ExtractText = async (bytes, mime) =>
  mime === 'application/pdf' && bytes.byteLength > 0
    ? { text: `Orchard ledger ${run} first page text about marmalade` }
    : { text: null, why: 'none' }
const planOf = async (
  office: string,
  id: string,
  slug: string | null = null,
): Promise<PreviewPlan> =>
  (await call(
    `app.document_preview_plan(${lit(office)}::uuid, ${lit(id)}::uuid, ${slug === null ? 'null' : lit(slug)})`,
  )) as PreviewPlan
const recorderFor =
  (office: string, id: string) =>
  async (a: {
    meta: { modifiedTime: string | null; mime: string; version: string | null; size: number | null }
    kind: 'text' | 'pdf' | 'image'
    text: string | null
    truncated: boolean
  }): Promise<boolean> => {
    const meta = JSON.stringify({
      modifiedTime: a.meta.modifiedTime,
      mime: a.meta.mime,
      version: a.meta.version,
      size: a.meta.size,
    })
    const r = await call(
      `app.document_preview_record(${lit(office)}::uuid, ${lit(id)}::uuid, ${lit(meta)}::jsonb, ${lit(a.kind)}, ${a.text === null ? 'null' : lit(a.text)}, ${a.truncated})`,
    )
    return r?.ok === true
  }
let providerAsked = 0
const preview = async (id: string, slug: string | null = null, office = OFFICE) =>
  await previewDocument({
    plan: await planOf(office, id, slug),
    provider: async () => {
      providerAsked += 1
      return driveProvider('tok-not-real', fakeFetch)
    },
    extractText,
    record: recorderFor(office, id),
    now: Date.now(),
  })
const stream = async (id: string, office = OFFICE) =>
  await streamDocument({
    plan: await planOf(office, id),
    provider: driveProvider('tok-not-real', fakeFetch),
    extractText,
    record: recorderFor(office, id),
  })
const storageObjects = async (): Promise<number> => {
  try {
    return Number((await q('select count(*)::int n from storage.objects'))[0]?.n)
  } catch {
    return -1
  }
}

await q('begin')
await q(
  `insert into public.integration_connections (office_id, provider, account_ref, secret_name) values (${lit(OFFICE)}::uuid, 'google', 'primary', 'google.refresh_token') on conflict do nothing`,
) // a connected Google account: an import of a Drive file needs one (1010)
try {
  const mkOffice = async (name: string): Promise<string> => {
    const auth = String((await q('select gen_random_uuid()::text a'))[0]?.a)
    await q(
      `insert into auth.users (id, email) values (${lit(auth)}, ${lit(`${name}.${run}@example.invalid`)})`,
    )
    await q(
      `insert into public.offices (auth_user_id, kind, name) values (${lit(auth)}, 'person', ${lit(`${name} ${run}`)})`,
    )
    return String(
      (await q(`select office_id::text o from public.offices where auth_user_id = ${lit(auth)}`))[0]
        ?.o,
    )
  }
  const project = async (office: string, slug: string): Promise<string> =>
    String(
      (
        await q(
          `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'active', ${lit(office)}::uuid) returning project_id::text id`,
        )
      )[0]?.id,
    )
  const SLUG = `prevproof-${run}`
  const PA = await project(OFFICE, SLUG)
  const OTHER_SLUG = `prevother-${run}`
  await project(OFFICE, OTHER_SLUG)
  const FOLDER = `folder-${run}`
  const ref = async (
    file: string,
    title: string,
    over: { origin?: string; connector?: string | null; project?: string } = {},
  ): Promise<string> =>
    String(
      (
        await q(`insert into public.documents
      (office_id, project_id, title, doc_type, origin, connector, external_parent_ref, external_ref, state, added_by)
      values (${lit(OFFICE)}::uuid, ${lit(over.project ?? PA)}::uuid, ${lit(title)}, 'file', ${lit(over.origin ?? 'source')}, ${over.connector === null ? 'null' : lit(over.connector ?? 'drive')},
              ${(over.origin ?? 'source') === 'source' ? lit(FOLDER) : 'null'}, ${lit(file)}, 'approved', 'chief-of-staff') returning document_id::text id`)
      )[0]?.id,
    )
  const row = async (id: string): Promise<Row> =>
    (
      await q(
        `select content, content_fingerprint, storage_path, mime_type, remote_updated_at::text rt from public.documents where document_id = ${lit(id)}::uuid`,
      )
    )[0] as Row
  const cacheRow = async (id: string): Promise<Row | undefined> =>
    (await q(`select * from public.document_previews where document_id = ${lit(id)}::uuid`))[0]
  const chunks = async (id: string): Promise<number> =>
    Number(
      (
        await q(
          `select count(*)::int n from public.document_chunks where document_id = ${lit(id)}::uuid and state = 'active'`,
        )
      )[0]?.n,
    )
  const found = async (word: string): Promise<boolean> => {
    const r = await q(
      `select count(*)::int n from public.documents where document_id is not null and office_id = ${lit(OFFICE)}::uuid and search @@ websearch_to_tsquery('english', ${lit(word)}) and app.document_in_play(state, origin, project_id, connector, external_parent_ref)`,
    )
    return Number(r[0]?.n) > 0
  }

  const T1 = '2026-10-01T09:00:00.000Z'
  const T2 = '2026-10-04T09:00:00.000Z'
  const storage0 = await storageObjects()

  // ======================================================== 1. the plan: every miss answers alike
  drive[`gdoc-${run}`] = {
    mime: 'application/vnd.google-apps.document',
    name: 'Handbook',
    modified: T1,
    body: `Zephyrine handbook ${run}. Pricing is clear and onboarding is quick.`,
  }
  const gdoc = await ref(`gdoc-${run}`, 'Handbook')
  const planOk = await planOf(OFFICE, gdoc, SLUG)
  check(
    'the plan finds a document in its own office and project, as external, connected, not imported',
    planOk.ok === true &&
      planOk.mode === 'external' &&
      planOk.connected === true &&
      planOk.imported === false &&
      planOk.cache === null,
    JSON.stringify(planOk),
  )
  const OTHER_OFFICE = await mkOffice('other')
  const wrongProject = await planOf(OFFICE, gdoc, OTHER_SLUG)
  const noSuch = await planOf(OFFICE, '00000000-0000-4000-8000-000000000000')
  const otherOffice = await planOf(OTHER_OFFICE, gdoc)
  check(
    'TENANT: another office, another project and no such id all get the SAME answer',
    JSON.stringify([wrongProject, noSuch, otherOffice].map((x) => [x.ok, x.error])) ===
      JSON.stringify([
        [false, noSuch.error],
        [false, noSuch.error],
        [false, noSuch.error],
      ]) && wrongProject.ok === false,
    JSON.stringify([wrongProject, noSuch, otherOffice]),
  )
  const crossRecord = await call(
    `app.document_preview_record(${lit(OTHER_OFFICE)}::uuid, ${lit(gdoc)}::uuid, '{}'::jsonb, 'text', 'smuggled words', false)`,
  )
  check(
    "TENANT: another office cannot write derived data onto this office's document",
    crossRecord.ok === false && (await row(gdoc)).content === null,
    JSON.stringify(crossRecord),
  )
  const yoursDoc = await ref(`mine-${run}`, 'My upload', { origin: 'yours', connector: null })
  const planHeld = await planOf(OFFICE, yoursDoc)
  check(
    'a document Team HQ holds (yours) is "held" and carries no source text',
    planHeld.mode === 'held' && (planHeld.text ?? null) === null,
  )
  const heldRecord = await call(
    `app.document_preview_record(${lit(OFFICE)}::uuid, ${lit(yoursDoc)}::uuid, '{}'::jsonb, 'text', 'x', false)`,
  )
  check('only an external Drive document has a preview cache', heldRecord.ok === false)

  // ======================================================== 2. a Google Doc: read on demand, derived data only
  check(
    'before any preview the document holds no text and has no cache row',
    (await row(gdoc)).content === null && (await cacheRow(gdoc)) === undefined,
  )
  const p1 = await preview(gdoc, SLUG)
  check(
    'the preview is ready, text, on demand, and read in this request',
    p1.state === 'ready' &&
      p1.kind === 'text' &&
      p1.mode === 'on_demand' &&
      p1.cache?.refetched === true,
    JSON.stringify(p1).slice(0, 300),
  )
  const r1 = await row(gdoc)
  check(
    'the derived text is in documents.content with a sha256 fingerprint, and no file path exists',
    String(r1.content).includes('Zephyrine handbook') &&
      /^[0-9a-f]{64}$/.test(String(r1.content_fingerprint)) &&
      r1.storage_path === null &&
      r1.mime_type === null,
  )
  check(
    "the source's modified time is recorded on the cache row and on remote_updated_at",
    new Date(String((await cacheRow(gdoc))?.source_modified_time)).toISOString() === T1 &&
      new Date(String(r1.rt)).toISOString() === T1,
  )
  check(
    'the existing chunk index indexed it (agents can search it)',
    (await chunks(gdoc)) > 0 && (await found(`Zephyrine ${run}`.split(' ')[0] ?? 'Zephyrine')),
  )
  check(
    'the preview preview excerpt (0960) now has real words for a tile',
    String(
      (
        await q(
          `select preview_excerpt e from public.documents where document_id = ${lit(gdoc)}::uuid`,
        )
      )[0]?.e,
    ).startsWith('Zephyrine handbook'),
  )
  check(
    'NO BINARY: no storage object was written and no storage call was made',
    (await storageObjects()) === storage0 &&
      ![...storage.keys()].length &&
      !calls.some((c) => c.includes('/object/')),
  )
  check(
    'no import happened: no copy, no request',
    Number(
      (
        await q(
          `select count(*)::int n from public.documents where imported_from_document_id = ${lit(gdoc)}::uuid`,
        )
      )[0]?.n,
    ) === 0 &&
      Number(
        (
          await q(
            `select count(*)::int n from public.document_import_requests where document_id = ${lit(gdoc)}::uuid`,
          )
        )[0]?.n,
      ) === 0,
  )

  // ======================================================== 3. the stale rule
  const asked0 = providerAsked
  const exports0 = driveCalls('export', `gdoc-${run}`)
  const p2 = await preview(gdoc, SLUG)
  check(
    're-opening inside the freshness window asks Drive nothing and mints no token',
    p2.state === 'ready' &&
      providerAsked === asked0 &&
      driveCalls('export', `gdoc-${run}`) === exports0 &&
      p2.cache?.refetched === false,
  )
  await q(
    `update public.document_previews set last_checked_at = now() - interval '10 minutes' where document_id = ${lit(gdoc)}::uuid`,
  )
  const meta0 = driveCalls('meta', `gdoc-${run}`)
  const p3 = await preview(gdoc, SLUG)
  check(
    'after the window Drive is asked once, for metadata only; an unchanged source is not exported again',
    p3.state === 'ready' &&
      driveCalls('meta', `gdoc-${run}`) === meta0 + 1 &&
      driveCalls('export', `gdoc-${run}`) === exports0 &&
      p3.cache?.refetched === false,
  )
  const fp0 = (await row(gdoc)).content_fingerprint
  drive[`gdoc-${run}`] = {
    mime: 'application/vnd.google-apps.document',
    name: 'Handbook',
    modified: T2,
    body: `Zephyrine handbook ${run} REVISED. Quokka onboarding is now one week.`,
  }
  await q(
    `update public.document_previews set last_checked_at = now() - interval '10 minutes' where document_id = ${lit(gdoc)}::uuid`,
  )
  const p4 = await preview(gdoc, SLUG)
  check(
    'a changed source (newer modifiedTime) is read again and the page is told',
    p4.state === 'ready' &&
      p4.cache?.refetched === true &&
      p4.cache?.was_stale === true &&
      /changed this file/.test(String(p4.notice)) &&
      driveCalls('export', `gdoc-${run}`) === exports0 + 1,
  )
  check(
    'the index follows the new text: the new word is found, the old fingerprint is gone',
    (await found('Quokka')) &&
      (await row(gdoc)).content_fingerprint !== fp0 &&
      String((await row(gdoc)).content).includes('REVISED'),
  )
  check(
    'the cache now records the new modified time',
    new Date(String((await cacheRow(gdoc))?.source_modified_time)).toISOString() === T2,
  )

  // ======================================================== 4. a PDF: streamed, text indexed, bytes never kept
  drive[`pdf-${run}`] = {
    mime: 'application/pdf',
    name: 'Ledger.pdf',
    modified: T1,
    md5: 'aa11',
    body: PDF_BYTES,
  }
  const pdf = await ref(`pdf-${run}`, 'Ledger.pdf')
  const pp = await preview(pdf, SLUG)
  check(
    'a PDF preview is ready with a stream payload and fetched no bytes itself',
    pp.state === 'ready' &&
      pp.kind === 'pdf' &&
      pp.payload?.type === 'stream' &&
      driveCalls('media', `pdf-${run}`) === 0,
  )
  const sx = await stream(pdf)
  check(
    'the stream returns the exact bytes to the response',
    sx.ok &&
      sx.bytes.byteLength === PDF_BYTES.byteLength &&
      [...sx.bytes].every((b, i) => b === PDF_BYTES[i]),
  )
  const rp = await row(pdf)
  check(
    'its text was derived in passing and indexed, while no file was stored',
    String(rp.content).includes('marmalade') &&
      rp.storage_path === null &&
      (await chunks(pdf)) > 0 &&
      (await found('marmalade')),
  )
  check(
    'NO BINARY: still no storage object and no storage call after streaming a PDF',
    (await storageObjects()) === storage0 && !calls.some((c) => c.includes('/object/')),
  )
  const cp = await cacheRow(pdf)
  check(
    "the PDF's cache row has its checksum and says the text came from a preview",
    cp?.source_version === 'aa11' && cp?.derived_text === true && cp?.kind === 'pdf',
  )
  const mediaBefore = driveCalls('media', `pdf-${run}`)
  await stream(pdf)
  check(
    'an unchanged PDF is streamed again without re-reading its text (fingerprint unchanged)',
    (await row(pdf)).content_fingerprint === rp.content_fingerprint &&
      driveCalls('media', `pdf-${run}`) === mediaBefore + 1,
  )

  drive[`img-${run}`] = {
    mime: 'image/png',
    name: 'Site.png',
    modified: T2,
    body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]),
  }
  const img = await ref(`img-${run}`, 'Site.png')
  const si = await stream(img)
  const ci = await cacheRow(img)
  check(
    "an image streams, has no text to index, and records only the source's markers (kind, modified time on the document)",
    si.ok === true &&
      ci?.kind === 'image' &&
      ci?.derived_text === false &&
      (await row(img)).content === null &&
      new Date(String((await row(img)).rt)).toISOString() === T2 &&
      (await row(img)).storage_path === null,
  )
  const noImage = await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(img)}::uuid)`)
  check('an image with no text is not "held" either: Import fetches', noImage.state === 'pending')

  // ======================================================== 5. unsupported and failed never write anything
  drive[`zip-${run}`] = {
    mime: 'application/zip',
    name: 'Bundle.zip',
    modified: T1,
    body: new Uint8Array([80, 75, 3, 4]),
  }
  const zip = await ref(`zip-${run}`, 'Bundle.zip')
  const pz = await preview(zip, SLUG)
  check(
    'a zip is unsupported with Open source / Import offered, and leaves no cache row',
    pz.state === 'unsupported' &&
      pz.alternatives.includes('open_source') &&
      pz.alternatives.includes('import') &&
      (await cacheRow(zip)) === undefined &&
      (await row(zip)).content === null,
  )
  const gone = await ref(`never-${run}`, 'Deleted in Drive')
  const pg = await preview(gone, SLUG)
  check(
    'a file Drive no longer has is failed and not retryable, and writes nothing',
    pg.state === 'failed' && pg.retryable === false && (await cacheRow(gone)) === undefined,
  )

  // ======================================================== 6. a disconnected source (0896)
  await q(
    `insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled, disabled_reason) values (${lit(PA)}::uuid, 'drive', ${lit(FOLDER)}, 'Folder', 'source', false, 'proof: switched off')`,
  )
  const planOff = await planOf(OFFICE, gdoc, SLUG)
  check(
    'the plan says disconnected and hands out no cached text',
    planOff.connected === false && (planOff.text ?? null) === null,
  )
  const askedBeforeOff = providerAsked
  const callsBeforeOff = calls.length
  const pOff = await preview(gdoc, SLUG)
  check(
    'a disconnected source is NEITHER fetched NOR shown from the cache: unsupported, no payload, Drive and token untouched',
    pOff.state === 'unsupported' &&
      pOff.reason_code === 'source_disconnected' &&
      pOff.payload === undefined &&
      !JSON.stringify(pOff).includes('Quokka') &&
      providerAsked === askedBeforeOff &&
      calls.length === callsBeforeOff,
  )
  const recOff = await call(
    `app.document_preview_record(${lit(OFFICE)}::uuid, ${lit(gdoc)}::uuid, '{}'::jsonb, 'text', 'new words while off', false)`,
  )
  check(
    'the database refuses to write derived data for a disconnected source',
    recOff.ok === false &&
      recOff.error === 'source_disconnected' &&
      !String((await row(gdoc)).content).includes('new words while off'),
  )
  const sOff = await stream(pdf)
  check('and the stream is refused too', sOff.ok === false && sOff.status === 409)
  check(
    'CONSISTENT WITH 0896: its derived text is out of active retrieval',
    !(await found('Quokka')),
  )
  await q(
    `update public.project_attachments set enabled = true, disabled_reason = null where project_id = ${lit(PA)}::uuid and external_ref = ${lit(FOLDER)}`,
  )
  check(
    'switched back on, the same document previews again and is searchable again',
    (await preview(gdoc, SLUG)).state === 'ready' && (await found('Quokka')),
  )

  // ======================================================== 7. Import is a different act: preview-derived text is not the file
  check(
    'app.document_material_held: previewed text is NOT held material; a stored file would be',
    (await call(`app.document_material_held(${lit(OFFICE)}::uuid, ${lit(pdf)}::uuid)`)) === false,
  )
  const pi = await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(pdf)}::uuid)`)
  check(
    'pressing Import on a previewed PDF does NOT copy its text: it records a request and starts the fetch',
    pi.ok === true && pi.state === 'pending' && typeof pi.fetch_job_id === 'string',
    JSON.stringify(pi),
  )
  check(
    'no copy exists yet',
    Number(
      (
        await q(
          `select count(*)::int n from public.documents where imported_from_document_id = ${lit(pdf)}::uuid`,
        )
      )[0]?.n,
    ) === 0,
  )
  const said = await runJob(String(pi.fetch_job_id), PA)
  check(
    'the real drive.read_file job brings the file in and the request completes',
    /Brought/.test(said) && /Team HQ copy now exists/.test(said),
    said,
  )
  const copy = (
    await q(
      `select c.storage_path, c.mime_type, c.origin, c.connector, c.byte_size::int sz from public.document_import_requests r join public.documents c on c.document_id = r.copy_document_id where r.document_id = ${lit(pdf)}::uuid`,
    )
  )[0]
  check(
    'the IMPORTED copy holds the file (path, mime, exact size), as a Team HQ document',
    typeof copy?.storage_path === 'string' &&
      copy?.mime_type === 'application/pdf' &&
      copy?.sz === PDF_BYTES.byteLength &&
      copy?.origin === 'yours' &&
      copy?.connector === null,
    JSON.stringify(copy),
  )
  check('only Import wrote a storage object, and it wrote one', [...storage.keys()].length === 1)
  check(
    "the original's plan now says a durable copy exists",
    (await planOf(OFFICE, pdf, SLUG)).imported === true,
  )
  await q(`update public.documents set missing_since = now() where document_id = ${lit(pdf)}::uuid`)
  check(
    'with the original gone the copy still has its file (import survives the source disappearing)',
    (
      await q(
        `select 1 from public.documents where imported_from_document_id = ${lit(pdf)}::uuid and storage_path is not null`,
      )
    ).length === 1,
  )

  const piDoc = await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(gdoc)}::uuid)`)
  check(
    'pressing Import on a previewed Google Doc also fetches fresh rather than copying the cache',
    piDoc.state === 'pending' && typeof piDoc.fetch_job_id === 'string',
  )
  const saidDoc = await runJob(String(piDoc.fetch_job_id), PA)
  check('and completes from the real read', /Team HQ copy now exists/.test(saidDoc), saidDoc)
  check(
    'a real read marks the material as held (the preview no longer stands in for it)',
    (await call(`app.document_material_held(${lit(OFFICE)}::uuid, ${lit(gdoc)}::uuid)`)) === true,
  )

  // CONTROL: material a real read brought in (no preview ever) still imports instantly, as 0960 left it.
  const realRead = await ref(`real-${run}`, 'Already read')
  await q(
    `update public.documents set content = 'text a real read brought in', content_fingerprint = encode(extensions.digest('text a real read brought in', 'sha256'), 'hex'), content_chars = 28, fetched_at = now() where document_id = ${lit(realRead)}::uuid`,
  )
  const pr = await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(realRead)}::uuid)`)
  check(
    'CONTROL: text a real read brought in (no preview row) still imports at once, with no job',
    pr.state === 'imported' && pr.fetch_job_id === undefined,
    JSON.stringify(pr),
  )

  // ======================================================== 8. the cache table is closed
  const closed =
    await q(`select has_table_privilege('service_role', 'public.document_previews', 'select') s, has_table_privilege('anon', 'public.document_previews', 'select') a, has_table_privilege('authenticated', 'public.document_previews', 'select') u, (select relrowsecurity from pg_class where oid = 'public.document_previews'::regclass) rls,
    has_function_privilege('anon', 'public.hq_document_preview_plan(uuid,uuid,text)', 'execute') fa, has_function_privilege('service_role', 'public.hq_document_preview_plan(uuid,uuid,text)', 'execute') fs,
    has_function_privilege('authenticated', 'public.hq_document_preview_record(uuid,uuid,jsonb,text,text,boolean)', 'execute') fr, has_function_privilege('service_role', 'app.document_preview_record(uuid,uuid,jsonb,text,text,boolean)', 'execute') fapp`)
  check(
    "document_previews has row security on and no grant to any role; the wrappers are the gateway's alone",
    closed[0]?.s === false &&
      closed[0]?.a === false &&
      closed[0]?.u === false &&
      closed[0]?.rls === true &&
      closed[0]?.fa === false &&
      closed[0]?.fs === true &&
      closed[0]?.fr === false &&
      closed[0]?.fapp === false,
    JSON.stringify(closed[0]),
  )
  check(
    'the whole run touched only Drive, the token endpoint and (for Import alone) the files bucket',
    calls.every((c) => c.includes('googleapis.com') || c.includes('/object/files/')),
  )
  check(
    'no storage object was written by anything but the Import (a preview wrote none)',
    (await storageObjects()) === storage0,
  )
} finally {
  await q('rollback')
}
console.log(failed === 0 ? '\nALL PASSED' : `\n${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)

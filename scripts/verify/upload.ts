/**
 * Drop a file onto a project, through the door a browser uses (#126).
 *
 *   npm run verify:upload
 *
 * The whole path, and the HTTP layer is the point: the bytes go through the
 * gateway, which is the only thing holding the service key, and the row is
 * written by the same `app.record_file_document` a PDF read out of Drive uses.
 * A suite that called the RPC directly would prove the half that was never in
 * doubt — CLAUDE.md records `verify:search` skipping exactly the layer the
 * defect lived in.
 *
 * ## The refusals are half the suite
 *
 * An upload endpoint is a place where a browser hands a server bytes, so what
 * it DECLINES matters as much as what it stores: a file too large, an empty
 * one, a project that is not a project, and — the one that would be a
 * traversal — a filename carrying `../`.
 *
 * ## Teardown
 *
 * A real project would be wrong here (nothing under test filters fixtures) and
 * a fixture project that gathers a job can never be deleted — so this one
 * creates a PAUSED fixture project, never enqueues anything against it, and
 * removes the document, the object and the project at the end. The last check
 * asserts that nothing is left, because a teardown that matches nothing looks
 * exactly like a teardown that worked.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { harnessSession } from './lib/harness-session.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
const SLUG = `fixture-upload-${run}`
console.log(`\nverify:upload — ${run}\n`)

const apiToken = String(
  (
    await one(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).v ?? '',
)
if (apiToken === '') {
  console.error('no hq.api_token in the vault — run `npm run deploy:hq`')
  process.exit(1)
}

const projectId = String(
  (
    await one(`
      insert into public.projects (name, slug, status)
      values (${lit(`Fixture upload ${run}`)}, ${lit(SLUG)}, 'paused')
      returning project_id::text as id`)
  ).id ?? '',
)

let held: Awaited<ReturnType<typeof harnessSession>> | null = null
const testMember = async () => {
  held ??= await harnessSession(db, ref)
  return held
}

const post = async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const r = await fetch(`https://${ref}.supabase.co/functions/v1/hq-api`, {
    method: 'POST',
    // A dropped file is a person's act (#385): the office key is refused by name. The test member is a real
    // signed-in session the database lets act only on test traffic, and this suite's project is a fixture.
    headers: {
      Authorization: `Bearer ${(await testMember()).access}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'document_upload', args }),
  })
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
  return { status: r.status, ...body }
}

/*
  A real, tiny text file. Base64 with the data-URL prefix a browser's
  FileReader actually produces, because that prefix is a thing the gateway has
  to cope with and a bare base64 string would not test it.
*/
const CONTENT = `dropped by verify:upload ${run}\n`
const base64 = `data:text/plain;base64,${Buffer.from(CONTENT).toString('base64')}`

const stored = await post({
  p_project_id: projectId,
  p_name: `dropped-${run}.txt`,
  p_mime: 'text/plain',
  p_base64: base64,
})
check(
  'a dropped file goes in through the gateway',
  `http ${String(stored.status)} ${stored.error === undefined ? 'stored' : String(stored.error)}`,
  stored.status === 200 && stored.error === undefined,
)

const row = await one(`
  select d.document_id::text as id, d.title, d.mime_type, d.byte_size::int as size,
         d.storage_path, d.origin, d.connector, d.added_by, d.produced_by
    from public.documents d
   where d.project_id = ${lit(projectId)}::uuid
   order by d.created_at desc limit 1`)
check(
  'and it is a document in that project, as a file rather than as text',
  `${String(row.title ?? '(none)')} · ${String(row.mime_type ?? '?')} · ${String(row.size ?? 0)} bytes`,
  String(row.title ?? '') === `dropped-${run}.txt` &&
    row.mime_type === 'text/plain' &&
    Number(row.size) === CONTENT.length,
)
check(
  'with its own provenance, and the storage path is not in the row by accident',
  `origin=${String(row.origin)} produced_by=${JSON.stringify(row.produced_by)} added_by=${String(row.added_by)}`,
  row.origin === 'yours' &&
    /*
      NOBODY made it, asserted as the PROPERTY rather than as one spelling.
      The column is nullable with no default since 0284, and '' is the
      sentinel that migration removed — a check that demanded one of the two
      would go red on a correct change to the other.
    */
    (row.produced_by === null || row.produced_by === '') &&
    typeof row.storage_path === 'string' &&
    row.storage_path !== '',
)

/*
  The reader's half. The bucket is PRIVATE, so a path is useless to a browser
  and the gateway swaps it for a signed URL and drops the path — and the check
  that matters is that the URL actually serves the bytes that went in.
*/
const readBack = await fetch(
  `https://${ref}.supabase.co/functions/v1/hq-api?section=document&id=${String(row.id)}`,
  { headers: { Authorization: `Bearer ${apiToken}` } },
)
/*
  The section reader nests its answer under `data`, and the first draft of this
  check read the top level and reported "NO URL" about a URL that was there.
  Validate the test before believing the finding — this file's own second
  instance of that in one run.
*/
const doc =
  ((await readBack.json().catch(() => ({}))) as { data?: { url?: string; path?: string } }).data ??
  {}
check(
  'the reader gets a signed URL and learns nothing about the layout',
  `${doc.url === undefined ? 'NO URL' : 'signed'}, path ${doc.path === undefined ? 'withheld' : 'LEAKED'}`,
  typeof doc.url === 'string' && doc.url !== '' && doc.path === undefined,
)
const fetched = doc.url === undefined ? '' : await (await fetch(doc.url)).text()
check(
  'and the bytes that come back are the bytes that went in',
  fetched === CONTENT ? 'identical' : `got ${String(fetched.length)} of ${String(CONTENT.length)}`,
  fetched === CONTENT,
)

// --- what it refuses --------------------------------------------------------

const tooBig = await post({
  p_project_id: projectId,
  p_name: 'huge.bin',
  p_mime: 'application/octet-stream',
  p_base64: Buffer.alloc(9 * 1024 * 1024, 1).toString('base64'),
})
check(
  'a file over the limit is refused, in a sentence that says what to do instead',
  `http ${String(tooBig.status)} ${String(tooBig.error ?? '(accepted!)')}`.slice(0, 110),
  tooBig.status === 400 && /8 MB/.test(String(tooBig.error ?? '')),
)

const empty = await post({
  p_project_id: projectId,
  p_name: 'nothing.txt',
  p_mime: 'text/plain',
  p_base64: '',
})
check(
  'an empty file is refused rather than stored as an object nothing points at',
  `http ${String(empty.status)} ${String(empty.error ?? '(accepted!)')}`,
  empty.status === 400,
)

const nowhere = await post({
  p_project_id: 'not-a-uuid',
  p_name: 'x.txt',
  p_mime: 'text/plain',
  p_base64: base64,
})
check(
  'a project that is not a project is refused at the door',
  `http ${String(nowhere.status)} ${String(nowhere.error ?? '(accepted!)')}`,
  nowhere.status === 400,
)

/*
  The traversal. A filename arrives from a desktop, and the extension is taken
  from it — so this is the one input that could reach the storage API as a
  path. The check is not that it was refused (it is a legal name) but that the
  object landed under this project's prefix regardless.
*/
const nasty = await post({
  p_project_id: projectId,
  p_name: '../../escape.txt',
  p_mime: 'text/plain',
  p_base64: base64,
})
const escaped = await one(`
  select coalesce(d.storage_path, '') as p from public.documents d
   where d.project_id = ${lit(projectId)}::uuid order by d.created_at desc limit 1`)
check(
  'a filename that tries to climb out lands under this project anyway',
  `http ${String(nasty.status)} → ${String(escaped.p)}`,
  String(escaped.p).startsWith(`${projectId}/upload/`) && !String(escaped.p).includes('..'),
)

/*
  A malformed PDF — #41 §8's last untested input.

  Nothing in this office parses a PDF on the way IN. Drive downloads one as
  bytes, `record_file_document` stores it as bytes, and only the office's own
  reports go the other way (`src/artifacts/pdf.ts`). So the question is not
  whether a parser copes: it is whether bytes that LOOK like a document and
  are not can end up being treated as prose.

  That is the direction that costs, and this file's neighbours say why. A row
  in `public.documents` with `content` set is retrievable, citable, and reaches
  a model as evidence — and `provenance.ts` exists because a fabrication that
  gets into the record launders every repetition of itself. Binary rubbish
  decoded into `content` would be exactly that, arriving through the one door a
  browser can push bytes through.

  Three shapes, because a single one proves only that a single one is handled:
  plain rubbish, a truncated file with a REAL `%PDF-1.7` header (the one that
  defeats a header sniff), and a header followed by NUL bytes (the one that
  breaks a decoder rather than a parser).

  What is asserted is deliberately not "it is refused". Refusing would need a
  parser the office does not have, and a byte check strict enough to reject
  these would one day reject a real file of Grant's — a silent loss, which is
  worse than storing something unreadable. What is asserted is that it is
  stored HONESTLY: the bytes come back identical, the row claims no text, and
  nothing can retrieve it as though it said something.
*/
for (const [what, bytes] of [
  ['rubbish declared as a PDF', Buffer.from(`not a pdf at all ${run}`)],
  [
    'a truncated PDF with a real header',
    Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'),
  ],
  [
    'a PDF header followed by NUL bytes',
    Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0)]),
  ],
] as Array<[string, Buffer]>) {
  const sent = await post({
    p_project_id: projectId,
    p_name: `broken-${run}.pdf`,
    p_mime: 'application/pdf',
    p_base64: `data:application/pdf;base64,${bytes.toString('base64')}`,
  })
  const broken = await one(`
    select d.document_id::text as id, d.mime_type, d.byte_size::int as size,
           d.content, d.content_fingerprint
      from public.documents d
     where d.project_id = ${lit(projectId)}::uuid
     order by d.created_at desc limit 1`)
  const seen =
    (
      (await (
        await fetch(
          `https://${ref}.supabase.co/functions/v1/hq-api?section=document&id=${String(broken.id)}`,
          { headers: { Authorization: `Bearer ${apiToken}` } },
        )
      )
        .json()
        .catch(() => ({}))) as { data?: { url?: string } }
    ).data ?? {}
  const back =
    seen.url === undefined ? null : Buffer.from(await (await fetch(seen.url)).arrayBuffer())
  check(
    `${what} is stored, and comes back byte for byte`,
    `http ${String(sent.status)} · ${String(broken.size ?? 0)} of ${String(bytes.length)} bytes · ${
      back === null ? 'NO URL' : back.equals(bytes) ? 'identical' : 'ALTERED'
    }`,
    sent.status === 200 &&
      broken.mime_type === 'application/pdf' &&
      Number(broken.size) === bytes.length &&
      back !== null &&
      back.equals(bytes),
  )
  check(
    `${what} claims no text, so nothing can cite it as prose`,
    `content=${broken.content === null ? 'null' : 'SET'} fingerprint=${
      broken.content_fingerprint === null ? 'null' : 'SET'
    }`,
    broken.content === null && broken.content_fingerprint === null,
  )
}

/*
  And the reader agrees. A row with no content cannot be a search hit, so this
  is the property stated where a caller would meet it rather than at the
  column — the two have disagreed before, and when they do the reader is what
  reaches a prompt.
*/
const searchable = await one(`
  select count(*)::int as n
    from app.search_documents(p_office => app.test_office(), p_query => ${lit(`not a pdf at all ${run}`)},
                              p_project => ${lit(projectId)}::uuid, p_limit => 10)`)
check(
  'and no search can retrieve the rubbish inside one',
  `${String(searchable.n)} hit(s)`,
  Number(searchable.n) === 0,
)

// --- teardown ---------------------------------------------------------------

const paths = (
  await db.execute(`
    select storage_path from public.documents
     where project_id = ${lit(projectId)}::uuid and storage_path is not null`)
).rows as { storage_path: string }[]
const serviceKey = String(
  (
    await one(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'supabase.service_role_key'`,
    )
  ).v ?? '',
)
for (const p of paths) {
  if (serviceKey === '') break
  await fetch(`https://${ref}.supabase.co/storage/v1/object/files/${p.storage_path}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
}
await db.execute(`
  delete from public.documents where project_id = ${lit(projectId)}::uuid;
  delete from public.projects where project_id = ${lit(projectId)}::uuid;`)
const left = await one(`
  select (select count(*)::int from public.projects where slug = ${lit(SLUG)}) as p,
         (select count(*)::int from public.documents where project_id = ${lit(projectId)}::uuid) as d`)
check(
  'teardown — the fixture project, its documents and their objects are gone',
  `${String(left.p)} project(s), ${String(left.d)} document(s)${serviceKey === '' ? ' (no service key: objects left)' : ''}`,
  Number(left.p) === 0 && Number(left.d) === 0,
)

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)

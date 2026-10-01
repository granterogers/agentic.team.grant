/**
 * A document that is a real file, all the way to the screen.
 *
 *   npm run verify:files
 *
 * Issue #96, migrations 0331 and 0332.
 *
 * ## Why this suite exists
 *
 * #96's reader has been finished for days and could not be demonstrated. Every
 * PDF in the office is a text extraction with `storage_path` and `mime_type`
 * null — they came through NotebookLM, which hands out `get_fulltext` and has
 * no way to export a source's original file. So the headline feature had no
 * subject, and the Issue stayed open with its code complete.
 *
 * This drives the whole chain on a PDF this file builds itself:
 *
 *     bytes -> putFile -> private `files` bucket
 *           -> app.record_drive_document  (the document)
 *           -> app.attach_file_to_document (the bytes on it)
 *           -> app.studio_document        (what the reader asks for)
 *           -> hq-api ?section=document   (which mints the signed URL)
 *           -> a real browser, rendering it with the vendored pdf.js
 *
 * Including the HTTP layer and including a browser, because the two halves
 * that could silently be wrong are the signing (which only the edge function
 * does) and whether the bytes are a PDF anything can actually read.
 *
 * ## The subject is generated, not borrowed
 *
 * A real PDF would have to come from Grant's Drive, and no project has a Drive
 * folder attached. So the suite writes a minimal, genuinely valid one-page PDF
 * — real xref offsets, a real font resource — and asserts that pdf.js parses
 * it. A stub that only LOOKS like a PDF would pass every check here except the
 * last one, which is exactly why the last one is in a browser.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { extensionFor, filePath, putFile, removeFile, signedUrl } from '../../src/files/store.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, token)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
const FOLDER = `fixture-folder-${run}`
const FILE_ID = `fixture-file-${run}`
const TITLE = `Fixture file proof ${run}`
const MARK = `Zarquon ${run}`

/**
 * A minimal but genuinely valid one-page PDF.
 *
 * Built rather than borrowed, and built properly: the cross-reference table
 * carries real byte offsets, computed from the document as it is assembled. A
 * PDF with a wrong xref opens in some readers and not others, which is the
 * worst possible fixture — it would make this suite's verdict depend on which
 * renderer happened to look at it.
 */
function tinyPdf(line: string): Uint8Array {
  const stream = `BT /F1 18 Tf 20 100 Td (${line.replace(/[()\\]/g, '')}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [i, body] of objects.entries()) {
    offsets.push(out.length)
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\n`
  out += `startxref\n${String(xref)}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

console.log(`\nverify:files — ${run}\n`)

let serviceKey = ''
let storedPath = ''
let documentId = ''

try {
  serviceKey = String(
    (
      await one(
        `select decrypted_secret as v from vault.decrypted_secrets
          where name = 'supabase.service_role_key'`,
      )
    ).v ?? '',
  )
  if (serviceKey === '') throw new Error('no service key in the vault; nothing can be stored')

  const projectId = String(
    (
      await one(`
        select project_id::text as id from public.projects
         where status = 'active' and not is_fixture order by slug limit 1
      `)
    ).id,
  )

  const bytes = tinyPdf(MARK)

  // =========================================================================
  console.log('bytes reach the office’s own storage')

  storedPath = filePath(projectId, 'drive', FILE_ID, extensionFor('application/pdf'))
  const stored = await putFile(ref, serviceKey, storedPath, bytes, 'application/pdf')
  check(
    'a file is written to the private bucket',
    `${String(stored.bytes)} bytes${stored.error === null ? '' : ` — ${stored.error}`}`,
    stored.ok,
  )
  check(
    'and the path is laid out by project and connector, not dumped at the root',
    storedPath,
    storedPath.startsWith(`${projectId}/drive/`) && storedPath.endsWith('.pdf'),
  )

  /*
    Upsert, not append. A re-read of the same Drive file must land on the same
    object — without it a folder polled every ten minutes accumulates copies of
    a twenty-megabyte file in a 1 GB allowance.
  */
  const again = await putFile(ref, serviceKey, storedPath, bytes, 'application/pdf')
  const objects = await fetch(`https://${ref}.supabase.co/storage/v1/object/list/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: `${projectId}/drive`, limit: 100 }),
  })
    .then(async (r) => (await r.json()) as { name?: string }[])
    .catch(() => [] as { name?: string }[])
  const mine = objects.filter((o) => String(o.name ?? '').includes(FILE_ID))
  check(
    'storing the same file twice leaves one object, not two',
    `${String(mine.length)} object(s) named for this file`,
    again.ok && mine.length === 1,
  )

  /*
    CONTROL. The bucket is private, and that is load-bearing: it holds every
    document Grant has ever imported. An unsigned fetch must be refused.
  */
  const naked = await fetch(
    `https://${ref}.supabase.co/storage/v1/object/public/files/${storedPath}`,
  )
  check(
    'CONTROL: without a signature the bucket refuses, so nothing here is public',
    `http ${String(naked.status)}`,
    !naked.ok,
  )

  /*
    Read into plain values before asserting.

    `fetched?.ok && …` is what the linter prefers and what the type checker
    refuses — it is `boolean | undefined`, and `check` takes a boolean. Two
    tools with opposite opinions about the same expression is a sign the
    expression is doing too much; three named values are clearer than either.
  */
  const url = await signedUrl(ref, serviceKey, storedPath)
  const fetched = url === null ? null : await fetch(url)
  const back = fetched === null ? null : new Uint8Array(await fetched.arrayBuffer())
  // `=== true`, so the optional chain the linter wants is still a boolean for
  // the type checker. Both tools were right and neither would accept the
  // other's fix; this satisfies them together.
  const servedOk = fetched?.ok === true
  const servedAsPdf = fetched !== null && fetched.headers.get('content-type') === 'application/pdf'
  const sameBytes = back !== null && back.byteLength === bytes.byteLength
  check(
    'a signed link serves the exact bytes back, as a PDF',
    // The URL itself is never printed. It is a credential with a ten-minute
    // fuse and this output goes into terminals and sometimes into an Issue.
    fetched === null
      ? 'no signed URL'
      : `http ${String(fetched.status)} ${String(fetched.headers.get('content-type'))}`,
    servedOk && servedAsPdf && sameBytes,
  )

  // =========================================================================
  console.log('\nthe document, and the bytes on it')

  const recorded = (
    await one(`
      select public.record_drive_document(
        ${lit(projectId)}::uuid, ${lit(FOLDER)}, ${lit(FILE_ID)}, ${lit(TITLE)},
        null, 'chief-of-staff') as r
    `)
  ).r as { ok?: boolean; document?: string; outcome?: string }
  documentId = String(recorded.document ?? '')
  check(
    'a Drive file becomes a document',
    `${String(recorded.outcome)} ${documentId.slice(0, 8)}`,
    recorded.ok === true && documentId !== '',
  )

  /*
    #28's trap, which this schema is still exposed to: the unique index is on
    (connector, external_parent_ref, external_ref) and two NULLs are DISTINCT,
    so a null parent would let one file become two documents. The folder id is
    the parent for exactly that reason, and this is the check that proves it
    bites.
  */
  const twice = (
    await one(`
      select public.record_drive_document(
        ${lit(projectId)}::uuid, ${lit(FOLDER)}, ${lit(FILE_ID)}, ${lit(TITLE)},
        null, 'chief-of-staff') as r
    `)
  ).r as { document?: string; outcome?: string }
  const copies = Number(
    (
      await one(`
        select count(*)::int as n from public.documents
         where connector = 'drive' and external_ref = ${lit(FILE_ID)}
      `)
    ).n,
  )
  check(
    'reading the same file again is one document, not two',
    `${String(copies)} row(s), outcome=${String(twice.outcome)}`,
    copies === 1 && twice.document === documentId,
  )

  const attached = (
    await one(`
      select public.attach_file_to_document(
        ${lit(documentId)}::uuid, ${lit(storedPath)}, 'application/pdf',
        ${String(bytes.byteLength)}::bigint) as r
    `)
  ).r as { ok?: boolean; bytes?: number }
  check(
    'and it gains its original file',
    JSON.stringify(attached),
    attached.ok === true && Number(attached.bytes) === bytes.byteLength,
  )

  /*
    The property that separates this from `record_file_document`, which was
    right there and could not be used: that one hardcodes origin='made',
    connector=null and content=null, so a Drive PDF would have become a SECOND
    row beside the text one and the gallery would show it twice.
  */
  const row = await one(`
    select origin, connector, doc_type, state, content is null as no_text
      from public.documents where document_id = ${lit(documentId)}::uuid
  `)
  check(
    'the document stayed sourced through a connector, rather than becoming a made thing',
    `origin=${String(row.origin)} connector=${String(row.connector)}`,
    row.origin === 'source' && row.connector === 'drive',
  )

  const short = (
    await one(`
      select public.attach_file_to_document(
        ${lit(documentId)}::uuid, 'some/other/path.pdf', 'application/pdf', 0::bigint) as r
    `)
  ).r as { ok?: boolean; error?: string }
  check(
    'a file with no size is refused in words, not by a constraint name',
    String(short.error ?? ''),
    short.ok === false && String(short.error ?? '').includes('size above zero'),
  )

  // =========================================================================
  console.log('\nwhat the reader is handed')

  const studio = (
    await one(`select app.studio_document(app.test_office(), ${lit(documentId)}::uuid) as d`)
  ).d as {
    path?: string
    mime_type?: string
    title?: string
  }
  check(
    'the RPC gives the reader a path and a mime type',
    `${String(studio.mime_type)} · ${String(studio.path)}`,
    studio.path === storedPath && studio.mime_type === 'application/pdf',
  )

  const hqToken = String(
    (
      await one(
        `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
      )
    ).v ?? '',
  )
  let readerUrl = ''
  if (hqToken === '') {
    check(
      'the page is handed a signed link and never the path',
      'NOT CHECKED — no hq.api_token in the vault; run npm run deploy:hq',
      false,
    )
  } else {
    const r = await fetch(
      `https://${ref}.supabase.co/functions/v1/hq-api?section=document&id=${documentId}`,
      { headers: { Authorization: `Bearer ${hqToken}` } },
    )
    const body = (await r.json().catch(() => ({}))) as {
      data?: { url?: string; path?: string; mime_type?: string }
    }
    readerUrl = String(body.data?.url ?? '')
    /*
      Both halves. A signed URL that arrives BESIDE the path would tell the
      page how storage is laid out for nothing — the whole reason the function
      swaps one for the other is that the browser should learn neither the
      layout nor the key.
    */
    check(
      'the page is handed a signed link and never the path',
      `http ${String(r.status)}, url=${readerUrl === '' ? 'missing' : 'present'}, ` +
        `path=${body.data?.path === undefined ? 'dropped' : 'LEAKED'}`,
      r.ok && readerUrl !== '' && body.data?.path === undefined,
    )
  }

  // =========================================================================
  console.log('\nand a browser can actually read it')

  /*
    The check the other nine cannot make. Everything above passes just as well
    for a file that is not a PDF at all — the bytes round-trip, the mime type
    is whatever was declared, and the signed URL serves it. Only a renderer
    knows whether it is a document.

    The studio's own vendored pdf.js, not a CDN copy: the sandbox cannot reach
    external hosts, and this is the same library the gallery uses to draw real
    first pages.
  */
  if (readerUrl !== '') {
    /*
      Served over http, not opened as a file.

      The first attempt used `about:blank` and imported the library by
      `file://` path — which fails with "Failed to fetch dynamically imported
      module", because a document with an opaque origin cannot import a module
      from disk. The library has to come from somewhere a page can reach, so
      `web/studio` is served for the length of this check exactly as
      `verify:studio` serves it.
    */
    const PORT = 4713
    const TYPES: Record<string, string> = {
      '.html': 'text/html',
      '.mjs': 'text/javascript',
      '.js': 'text/javascript',
    }
    const server = createServer((q, r) => {
      const asked = (q.url ?? '/').split('?')[0] ?? '/'
      if (asked === '/') {
        r.writeHead(200, { 'content-type': 'text/html' })
        r.end('<!doctype html><meta charset="utf-8"><title>pdf check</title>')
        return
      }
      const file = join('web/studio', asked.replace(/^\//, ''))
      if (!existsSync(file)) {
        r.writeHead(404)
        r.end()
        return
      }
      r.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
      r.end(readFileSync(file))
    }).listen(PORT)

    /*
      The BYTES are handed to pdf.js, not the URL — and that is the sandbox's
      limitation rather than the product's.

      Chromium here cannot reach external hosts. It is the same proxy
      difference CLAUDE.md records about webfonts: `curl` and Node reach
      `fonts.googleapis.com` and the browser does not, so every capture shows
      the fallback face. A page in this sandbox therefore cannot fetch a
      `supabase.co` signed URL, and pdf.js reports it as a bare "Failed to
      fetch" that looks exactly like a broken file.

      It is not CORS, which was the obvious suspect and was measured rather
      than assumed: a signed URL answers `access-control-allow-origin: *` to
      both the Vercel origin and a localhost one. So the browser fetch is fine
      in the real world and impossible here.

      Node fetches the bytes over the signed URL — which is itself the check
      three above — and the browser answers the question only a renderer can:
      are these bytes a document. Both halves are covered; neither pretends to
      be the other.
    */
    const served = await fetch(readerUrl)
    const raw = new Uint8Array(await served.arrayBuffer())
    const base64 = Buffer.from(raw).toString('base64')

    const browser = await chromium.launch()
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'domcontentloaded' })
    const parsed = (await page.evaluate(async (b64: string) => {
      // A variable, so TypeScript does not try to resolve a path that only
      // exists once the server above is listening.
      const where = '/vendor/pdf.mjs'
      const pdfjs = (await import(where)) as {
        GlobalWorkerOptions: { workerSrc: string }
        getDocument: (o: unknown) => { promise: Promise<unknown> }
      }
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs'
      const binary = atob(b64)
      const data = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
      try {
        const doc = (await pdfjs.getDocument({ data }).promise) as {
          numPages: number
          getPage: (n: number) => Promise<{ getTextContent: () => Promise<unknown> }>
        }
        const first = await doc.getPage(1)
        const content = (await first.getTextContent()) as { items: { str?: string }[] }
        return {
          pages: doc.numPages,
          text: content.items.map((i) => String(i.str ?? '')).join(''),
          error: '',
        }
      } catch (e) {
        return { pages: 0, text: '', error: e instanceof Error ? e.message : String(e) }
      }
    }, base64)) as { pages: number; text: string; error: string }
    await browser.close()
    server.close()

    check(
      'pdf.js parses the file the reader was given',
      parsed.error === '' ? `${String(parsed.pages)} page(s)` : parsed.error,
      parsed.pages === 1,
    )
    check(
      'and the words on the page are the words that were put in it',
      parsed.text === '' ? '(nothing read)' : parsed.text,
      parsed.text.includes(MARK),
    )
  } else {
    check('pdf.js parses the file the reader was given', 'NOT CHECKED — no signed URL', false)
    check('and the words on the page are the words that were put in it', 'NOT CHECKED', false)
  }
} finally {
  console.log('\nteardown')
  if (documentId !== '') {
    await db.execute(`delete from public.documents where document_id = ${lit(documentId)}::uuid`)
  }
  if (storedPath !== '' && serviceKey !== '') {
    await removeFile(ref, serviceKey, storedPath)
  }
  const left = Number(
    (
      await one(`
        select count(*)::int as n from public.documents where external_ref = ${lit(FILE_ID)}
      `)
    ).n,
  )
  const objectLeft =
    serviceKey === '' || storedPath === ''
      ? 0
      : await fetch(`https://${ref}.supabase.co/storage/v1/object/info/files/${storedPath}`, {
          headers: { Authorization: `Bearer ${serviceKey}` },
        })
          .then((r) => (r.ok ? 1 : 0))
          .catch(() => 0)
  check(
    'teardown — the document is gone and so is the object',
    `${String(left)} row(s), ${String(objectLeft)} object(s)`,
    left === 0 && objectLeft === 0 && documentId !== '',
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)

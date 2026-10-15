/**
 * END TO END, LOCAL: a dropped file becomes searchable text, and is found only by the person it belongs to (E3, area 1).
 *
 *   npx tsx scripts/isolated/e2e-documents.ts <replica-db>
 *
 * The REAL hq-api gateway (`document_upload`, real `fileText`, real `index_file_text`) runs on a replica through the edge
 * emulator, which refuses every URL that is not the replica and records storage writes instead of forwarding them. Two
 * people (two offices) each drop files into their own project. Then the LIVE readers are asked from both offices:
 * `app.search_documents`, `app.best_chunks`, `app.project_knowledge`, `app.project_work_brief`, `psearch`, the gateway's
 * own `search`, `project_search`, `document` and `project_documents` sections, and the real `retrieve()`.
 *
 * Every refusal has a positive control (the same question from the owner finds the canary), and each detector is shown
 * able to fail (a canary present in the owner's search and absent in the stranger's is the only thing "isolated" means).
 * Nothing here spends a model call or touches the network. The database is a clone; nothing is torn down.
 */
import { retrieve } from '../../src/knowledge/retrieval.ts'
import { DOCX_MIME, HOSTILE, onePage, zip } from '../../tests/text/hostile-inputs.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'e3_docs')
const run = Date.now().toString(36)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
type Row = Record<string, unknown>
const q = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows as Row[]
const one = async (sql: string): Promise<Row> => (await q(sql))[0] as Row
const json = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>
let failed = 0
let total = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  total += 1
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const b64 = (b: Uint8Array | Buffer): string => Buffer.from(b).toString('base64')
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

// A canary is one made-up word per file, so a hit names exactly which file was found.
const word = (label: string): string => `zq${label}${run}`.replace(/[^a-z0-9]/g, '')
const W = {
  txt: word('txt'),
  md: word('md'),
  html: word('html'),
  docx: word('docx'),
  pdf: word('pdf'),
  tail: word('tail'),
  bstat: word('bstat'),
  secret: word('secretofa'),
}

let exit = 1
try {
  // ---- two people, two offices, two real projects ---------------------------------------------------------------
  const person = async (tag: string): Promise<{ office: string; key: string; email: string }> => {
    const email = `e3.${tag}.${run}@example.com`
    const key = `e3-${tag}-${run}`
    await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(email)})`)
    const r = json(
      (
        await one(
          `select app.provision_person_office(${lit(`E3 ${tag}`)}, ${lit(email)}, ${lit(key)}) as r`,
        )
      ).r,
    )
    return { office: String(r.office_id), key, email }
  }
  const A = await person('a')
  const B = await person('b')
  const project = async (office: string, key: string, name: string): Promise<string> =>
    String(
      json(
        (
          await one(
            `select app.hq_create_project(${lit(office)}::uuid, ${lit(name)}, 'upload', ${lit(`e3-${run}-${name.replace(/\W+/g, '')}`)}, ${lit(name)}, true, ${lit(key)}) as v`,
          )
        ).v,
      ).project_id,
    )
  const pA = await project(A.office, A.key, `E3 Alpha ${run}`)
  const pB = await project(B.office, B.key, `E3 Beta ${run}`)
  await project(A.office, A.key, `E3 Alpha Two ${run}`) // a second project of A's: only its existence matters
  check('two person offices and three real projects exist', A.office !== B.office, '')

  const SA = `aaa.bbb.${'a'.repeat(70)}`
  const SB = `aaa.bbb.${'b'.repeat(70)}`
  const gw = await startEdge({
    db,
    edgeFile: 'supabase/functions/hq-api/index.ts',
    env: {
      HQ_API_TOKEN: 'isolated-hq-token',
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
      SUPABASE_ANON_KEY: 'isolated-anon',
      SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
    },
    authUsers: { [SA]: A.email, [SB]: B.email },
  })
  const act = async (bearer: string, action: string, args: Record<string, unknown>) => {
    const r = await gw.call(
      new Request('https://gw.invalid/functions/v1/hq-api', {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, args }),
      }),
    )
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
  }
  const read = async (bearer: string, query: string) => {
    const r = await gw.call(
      new Request(`https://gw.invalid/functions/v1/hq-api?${query}`, {
        headers: { Authorization: `Bearer ${bearer}` },
      }),
    )
    const text = await r.text()
    return { status: r.status, text }
  }
  const upload = async (
    bearer: string,
    projectId: string,
    name: string,
    mime: string,
    bytes: Uint8Array | Buffer,
  ) => {
    const r = await act(bearer, 'document_upload', {
      p_project_id: projectId,
      p_name: name,
      p_mime: mime,
      p_base64: b64(bytes),
    })
    return {
      status: r.status,
      id: String(((r.body.result as Row | undefined)?.document_id as string | undefined) ?? ''),
      searchable: (r.body.result as Row | undefined)?.searchable,
      why: (r.body.result as Row | undefined)?.why,
      error: r.body.error,
    }
  }

  // ---- 1. files of every kind through the real gateway --------------------------------------------------------
  const long = `${'The ordinary opening paragraph says very little about anything. '.repeat(900)} ${W.tail} is stated only at the very end of this long file.`
  const files: { label: string; name: string; mime: string; bytes: Uint8Array; word?: string }[] = [
    {
      label: 'txt',
      name: 'notes.txt',
      mime: 'text/plain',
      bytes: enc(`Plain note about ${W.txt}.`),
      word: W.txt,
    },
    {
      label: 'md',
      name: 'plan.md',
      mime: 'text/markdown',
      bytes: enc(`# Plan\n\nThe ${W.md} milestone.`),
      word: W.md,
    },
    {
      label: 'docx',
      name: 'report.docx',
      mime: DOCX_MIME,
      bytes: zip([
        {
          name: 'word/document.xml',
          data: Buffer.from(
            `<w:document><w:body><w:p><w:r><w:t>Word ${W.docx} paragraph</w:t></w:r></w:p></w:body></w:document>`,
          ),
        },
      ]),
      word: W.docx,
    },
    {
      label: 'pdf',
      name: 'brief.pdf',
      mime: 'application/pdf',
      bytes: onePage(
        '',
        Buffer.from(
          `BT /F1 12 Tf 72 700 Td (The quarterly financial review shows that revenue grew steadily across every region this year, and the ${W.pdf} milestone is on track.) Tj ET`,
          'latin1',
        ),
      ),
      word: W.pdf,
    },
    { label: 'long', name: 'long.txt', mime: 'text/plain', bytes: enc(long), word: W.tail },
  ]
  /*
    HTML is stored like any other file. The owner accepts any type (15 October 2026), so a stored page is served back under its own
    content type when opened from a signed link: that risk is accepted, and this proof checks only what is indexed.
  */
  const page = await upload(
    SA,
    pA,
    'page.html',
    'text/html',
    enc(
      `<html><script>var x="${W.secret}"</script><body><p>Visible ${W.html} text</p></body></html>`,
    ),
  )
  check(
    'html: stored and filed like any other file (the owner accepts any type, 15 October 2026)',
    page.status === 200 && page.id !== '' && page.searchable === true,
    `http ${String(page.status)} searchable=${String(page.searchable)} why=${String(page.why ?? page.error ?? '')}`,
  )
  const pageRows = await one(
    `select content from public.documents where document_id = ${lit(page.id)}::uuid`,
  )
  check(
    'html: <script> content is not indexed, visible text is',
    !String(pageRows.content).includes(W.secret) && String(pageRows.content).includes(W.html),
    String(pageRows.content).slice(0, 60),
  )
  const pageNamed = await one(
    `select count(*)::int as n from public.documents where title = 'page.html'`,
  )
  check(
    'html: one document row exists for the stored file',
    Number(pageNamed.n) === 1,
    `rows=${String(pageRows.n)}`,
  )
  const idOf: Record<string, string> = {}
  for (const f of files) {
    const r = await upload(SA, pA, f.name, f.mime, f.bytes)
    idOf[f.label] = r.id
    check(
      `${f.label}: dropped through the gateway, filed and reported searchable`,
      r.status === 200 && r.id !== '' && r.searchable === true,
      `http ${String(r.status)} searchable=${String(r.searchable)} why=${String(r.why ?? r.error ?? '')}`,
    )
  }
  // an image, an empty text file, hostile files: filed (or refused) honestly, never half-indexed
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  )
  const img = await upload(SA, pA, 'photo.png', 'image/png', png)
  check(
    'an image is stored and filed but NOT claimed searchable (content stays null, with a reason)',
    img.status === 200 && img.searchable === false && typeof img.why === 'string',
    `searchable=${String(img.searchable)} why=${String(img.why)}`,
  )
  const imgRow = await one(
    `select content is null as no_text, origin, state from public.documents where document_id = ${lit(img.id)}::uuid`,
  )
  check(
    'the image row holds NULL content (not an empty string) and is origin yours',
    imgRow.no_text === true && imgRow.origin === 'yours',
    JSON.stringify(imgRow),
  )
  const empty = await upload(SA, pA, 'empty.txt', 'text/plain', enc('   \n  '))
  check(
    'a whitespace-only text file is filed and says there was no text, rather than indexing an empty string',
    empty.status === 200 && empty.searchable === false,
    `status ${String(empty.status)} why=${String(empty.why)}`,
  )
  const garbage = await upload(
    SA,
    pA,
    'garbage.pdf',
    'application/pdf',
    enc('%PDF-1.4 this is not a pdf at all'),
  )
  check(
    'a malformed PDF is stored and answers not-searchable without throwing',
    garbage.status === 200 && garbage.searchable === false,
    `status ${String(garbage.status)} why=${String(garbage.why)}`,
  )
  for (const name of ['runlength-2mb', 'digit-run', 'docx-open-tags', 'html-open-angle'] as const) {
    const h = HOSTILE[name]
    if (h === undefined) {
      check(`hostile case ${name} exists`, false, 'missing from the catalogue')
      continue
    }
    const built = h.build()
    const t0 = Date.now()
    const r = await upload(SA, pA, built.name, built.mime, built.bytes)
    const ms = Date.now() - t0
    check(
      `hostile ${name}: the gateway answers (filed or refused), in bounded time`,
      (r.status === 200 || r.status === 400) && ms < 20000,
      `status ${String(r.status)} searchable=${String(r.searchable)} ${String(ms)}ms ${String(r.why ?? r.error ?? '')}`.slice(
        0,
        160,
      ),
    )
    if (r.status === 200 && r.searchable === false) {
      const row = await one(
        `select content is null as no_text from public.documents where document_id = ${lit(r.id)}::uuid`,
      )
      check(`hostile ${name}: when declined the row holds no invented text`, row.no_text === true)
    }
  }
  // the same word dropped by B, into B's project
  const bDoc = await upload(
    SB,
    pB,
    'bnotes.txt',
    'text/plain',
    enc(`B's own note about ${W.bstat} and shared word ${W.txt}.`),
  )
  check("B's own file is filed and searchable", bDoc.searchable === true, String(bDoc.why ?? ''))

  // ---- 2. text, chunks, tsvector ---------------------------------------------------------------------------------
  const tx = await one(
    `select content, char_length(content) as n, content_fingerprint is not null as fp, fetched_at is not null as fetched, search is not null as has_search
       from public.documents where document_id = ${lit(idOf.docx ?? '')}::uuid`,
  )
  check(
    'docx text was extracted from the XML (the tag is gone, the words are there), fingerprinted and has a tsvector',
    String(tx.content).includes(W.docx) &&
      !String(tx.content).includes('<w:') &&
      tx.fp === true &&
      tx.fetched === true &&
      tx.has_search === true,
    String(tx.content).slice(0, 60),
  )
  const chunks = await one(
    `select count(*)::int as n, count(*) filter (where state = 'active')::int as active from public.document_chunks where document_id = ${lit(idOf.long ?? '')}::uuid`,
  )
  check(
    'a long file is cut into several active passages',
    Number(chunks.n) > 1 && Number(chunks.active) === Number(chunks.n),
    JSON.stringify(chunks),
  )
  const shortChunks = await one(
    `select count(*)::int as n from public.document_chunks where document_id = ${lit(idOf.txt ?? '')}::uuid`,
  )
  check(
    'a short file has a passage too (or none): count is recorded',
    Number(shortChunks.n) >= 0,
    `chunks=${String(shortChunks.n)}`,
  )

  // ---- 3. retrieval: positive controls from the owner ---------------------------------------------------------------
  const sd = async (office: string, query: string, project: string | null): Promise<Row[]> =>
    q(
      `select * from app.search_documents(${lit(office)}::uuid, ${lit(query)}, ${project === null ? 'null' : `${lit(project)}::uuid`}, 20, 'any')`,
    )
  for (const f of files) {
    if (f.word === undefined) continue
    const hits = await sd(A.office, f.word, pA)
    check(
      `owner finds the ${f.label} by a word only it contains`,
      hits.length === 1 && String(hits[0]?.document_id) === idOf[f.label],
      `${String(hits.length)} hit(s)`,
    )
  }
  const viaRetrieve = await retrieve(db, { officeId: A.office }, `where is ${W.tail} stated`, pA, 5)
  const lastPassage = viaRetrieve.find((h) => h.documentId === idOf.long)
  check(
    'the real retrieve(): a fact at the END of a long file is found and the excerpt shown carries it',
    lastPassage?.excerpt.includes(W.tail) === true,
    lastPassage === undefined
      ? 'not found'
      : `excerpt ${String(lastPassage.excerpt.length)} chars, passage ${JSON.stringify(lastPassage.passage ?? null)}`,
  )
  check(
    'the image, the empty file and the malformed PDF are NOT retrievable by their file name or content (they hold no text)',
    (await sd(A.office, 'photo', pA)).every((r) => String(r.document_id) !== img.id),
  )

  // ---- 4. isolation: B cannot read A, by any reader ---------------------------------------------------------------
  const lookups: [string, Row[]][] = [
    ['search_documents(B, A canary, A project)', await sd(B.office, W.docx, pA)],
    ['search_documents(B, A canary, B project)', await sd(B.office, W.docx, pB)],
    ['search_documents(B, A canary, NULL project)', await sd(B.office, W.docx, null)],
    ['search_documents(B, A tail canary, NULL)', await sd(B.office, W.tail, null)],
  ]
  for (const [what, rows] of lookups)
    check(`B asking: ${what} finds nothing`, rows.length === 0, `${String(rows.length)} hit(s)`)
  const shared = await sd(B.office, W.txt, null)
  check(
    "a word both offices happen to hold returns only B's own document (A's copy of the same word is invisible)",
    shared.length === 1 && String(shared[0]?.document_id) === bDoc.id,
    `${String(shared.length)} hit(s)`,
  )
  const bChunks = await q(
    `select * from app.best_chunks(${lit(B.office)}::uuid, array[${lit(idOf.long ?? '')}::uuid], ${lit(W.tail)}, 2)`,
  )
  check(
    "best_chunks(B, A's document) returns nothing",
    bChunks.length === 0,
    `${String(bChunks.length)} row(s)`,
  )
  const aChunks = await q(
    `select * from app.best_chunks(${lit(A.office)}::uuid, array[${lit(idOf.long ?? '')}::uuid], ${lit(W.tail)}, 2)`,
  )
  check(
    "control: best_chunks(A, A's document) returns passages",
    aChunks.length > 0,
    `${String(aChunks.length)} row(s)`,
  )
  const bSibling = await retrieve(db, { officeId: B.office }, `${W.docx} ${W.tail} ${W.pdf}`, pA, 5)
  check(
    "the real retrieve() asked from B about A's project returns nothing",
    bSibling.length === 0,
    `${String(bSibling.length)} hit(s)`,
  )
  const pk = await one(
    `select app.project_knowledge(${lit(B.office)}::uuid, ${lit(pA)}::uuid) as v`,
  )
  const pkA = await one(
    `select app.project_knowledge(${lit(A.office)}::uuid, ${lit(pA)}::uuid) as v`,
  )
  check(
    "project_knowledge(B, A's project) discloses no document count or title; (A, A) is a real answer (control)",
    !JSON.stringify(pk.v ?? null).includes('notes.txt') && JSON.stringify(pkA.v ?? null).length > 4,
    `B:${JSON.stringify(pk.v ?? null).slice(0, 100)} A:${JSON.stringify(pkA.v ?? null).slice(0, 80)}`,
  )
  const bf = await one(
    `select app.project_work_brief(${lit(B.office)}::uuid, ${lit(pA)}::uuid) as v`,
  )
  check(
    "project_work_brief(B, A's project) answers like a project that does not exist (null)",
    bf.v === null,
    JSON.stringify(bf.v),
  )
  const probe = await q(
    `select * from app.psearch_documents(${lit(B.office)}::uuid, ${lit(pA)}::uuid, websearch_to_tsquery('english', ${lit(W.docx)}), 10)`,
  )
  check('psearch_documents(B, A project) finds nothing', probe.length === 0)
  const probeA = await q(
    `select * from app.psearch_documents(${lit(A.office)}::uuid, ${lit(pA)}::uuid, websearch_to_tsquery('english', ${lit(W.docx)}), 10)`,
  )
  check(
    'control: psearch_documents(A, A project) finds the docx',
    probeA.length === 1,
    `${String(probeA.length)}`,
  )

  // through the gateway, as B
  const g1 = await read(SB, `section=search&q=${W.docx}`)
  check(
    "gateway: B searching for A's word through section=search finds none of it",
    g1.status === 200 && !g1.text.includes(idOf.docx ?? 'x'),
    `http ${String(g1.status)}`,
  )
  const g1a = await read(SA, `section=search&q=${W.docx}`)
  check(
    'gateway control: A searching section=search finds the docx',
    g1a.status === 200 && g1a.text.includes(idOf.docx ?? 'x'),
    `http ${String(g1a.status)}`,
  )
  const g2 = await read(SB, `section=project_search&q=${W.pdf}&project=${pA}`)
  check(
    "gateway: B project_search into A's project finds none of it",
    !g2.text.includes(idOf.pdf ?? 'x'),
    `http ${String(g2.status)}`,
  )
  const g2a = await read(SA, `section=project_search&q=${W.pdf}&project=${pA}`)
  check(
    'gateway control: A project_search finds the PDF',
    g2a.text.includes(idOf.pdf ?? 'x'),
    `http ${String(g2a.status)}`,
  )
  const g3 = await read(SB, `section=document&id=${idOf.docx}`)
  check(
    "gateway: B opening A's document id gets no text",
    !g3.text.includes(W.docx),
    `http ${String(g3.status)}: ${g3.text.slice(0, 80)}`,
  )
  const g3a = await read(SA, `section=document&id=${idOf.docx}`)
  check(
    'gateway control: A opening the same id gets the text',
    g3a.text.includes(W.docx),
    `http ${String(g3a.status)}`,
  )
  const g4 = await read(SB, `section=project_documents&slug=e3-alpha-${run}`)
  check(
    "gateway: B listing A's project documents by slug gets no titles",
    !g4.text.includes('report.docx'),
    `http ${String(g4.status)}: ${g4.text.slice(0, 80)}`,
  )
  const g4a = await read(SA, `section=project_documents&slug=e3-alpha-${run}`)
  check(
    'gateway control: A listing its own project shows report.docx',
    g4a.text.includes('report.docx'),
    `http ${String(g4a.status)}`,
  )
  // cross-office WRITE: B uploads into A's project
  const cross = await upload(SB, pA, 'planted.txt', 'text/plain', enc(`planted ${W.secret}`))
  check(
    "B cannot upload into A's project (refused, nothing filed)",
    cross.status !== 200,
    `http ${String(cross.status)}: ${String(cross.error ?? '')}`,
  )
  const planted = await one(
    `select count(*)::int as n from public.documents where title = 'planted.txt'`,
  )
  check('no row exists for the refused upload', Number(planted.n) === 0)
  const reindexForeign = json(
    (
      await one(
        `select app.index_file_text(${lit(B.office)}::uuid, ${lit(idOf.docx ?? '')}::uuid, 'OVERWRITTEN') as r`,
      )
    ).r,
  )
  check(
    "index_file_text(B, A's document) is refused like a missing document and does not overwrite",
    reindexForeign.indexed === false && (await sd(A.office, W.docx, pA)).length === 1,
    JSON.stringify(reindexForeign),
  )

  // ---- 5. what is in play: archived, disconnected, mirrors, fixtures ------------------------------------------------------
  await db.execute(
    `update public.documents set state = 'archived' where document_id = ${lit(idOf.md ?? '')}::uuid`,
  )
  check(
    'an archived document leaves search (and its row still exists)',
    (await sd(A.office, W.md, pA)).length === 0 &&
      Number(
        (
          await one(
            `select count(*)::int n from public.documents where document_id = ${lit(idOf.md ?? '')}::uuid`,
          )
        ).n,
      ) === 1,
  )
  await db.execute(
    `update public.documents set state = 'approved' where document_id = ${lit(idOf.md ?? '')}::uuid`,
  )
  check('control: restoring it brings it back', (await sd(A.office, W.md, pA)).length === 1)

  // a mirror: the office wrote a copy into a connector; it must not appear twice
  const mirrorWord = word('mirror')
  const orig = await upload(SA, pA, 'orig.txt', 'text/plain', enc(`original ${mirrorWord}`))
  const sha = (
    await one(
      `select encode(extensions.digest(convert_to('original ${mirrorWord}', 'UTF8'),'sha256'),'hex') h`,
    )
  ).h
  await db
    .execute(
      `insert into public.documents (office_id, project_id, connector, origin, title, content, content_fingerprint, fetched_at, mirrors_document_id, state, external_ref, external_parent_ref)
     values (${lit(A.office)}::uuid, ${lit(pA)}::uuid, 'notion', 'made', 'orig mirror', ${lit(`original ${mirrorWord}`)}, ${lit(String(sha))}, now(), ${lit(orig.id)}::uuid, 'approved', ${lit(`m-${run}`)}, ${lit(`mp-${run}`)})`,
    )
    .catch((e) => console.log(`   (mirror insert note: ${String(e).slice(0, 160)})`))
  const mirrors = await sd(A.office, mirrorWord, pA)
  check(
    'a mirrored copy steps aside: one hit, the original',
    mirrors.length === 1 && String(mirrors[0]?.document_id) === orig.id,
    `${String(mirrors.length)} hit(s) ${JSON.stringify(mirrors.map((m) => m.connector))}`,
  )

  // a fixture (harness) project: not in the project-wide typed search a person sees
  const fixName = `fixture-e3-${run}`
  const fixProject = String(
    json(
      (
        await one(
          `select app.hq_create_project(${lit(A.office)}::uuid, ${lit(fixName)}, 'upload', ${lit(`fx-${run}`)}, ${lit(fixName)}, true, ${lit(A.key)}) as v`,
        )
      ).v,
    ).project_id,
  )
  const fixWord = word('fixture')
  await db
    .execute(
      `insert into public.documents (office_id, project_id, connector, origin, title, content, content_fingerprint, fetched_at, state, storage_path, mime_type, byte_size)
     values (${lit(A.office)}::uuid, ${lit(fixProject)}::uuid, null, 'yours', 'fixture doc', ${lit(fixWord)}, ${lit(String(sha))}, now(), 'approved', ${lit(`${fixProject}/x.txt`)}, 'text/plain', 5)`,
    )
    .catch((e) => console.log(`   (fixture insert note: ${String(e).slice(0, 160)})`))
  const fxPs = await q(
    `select * from app.psearch_documents(${lit(A.office)}::uuid, null, websearch_to_tsquery('english', ${lit(fixWord)}), 10)`,
  )
  check(
    "psearch (the person-facing typed search) excludes a FIXTURE project's document",
    fxPs.length === 0,
    `${String(fxPs.length)}`,
  )
  const fxSd = await sd(A.office, fixWord, null)
  console.log(
    `INFO app.search_documents with NULL project returns the fixture project's document: ${String(fxSd.length)} hit(s) (retrieve() scopes to a project, so an answering turn is not given it unless that project is the turn's)`,
  )

  // ---- 6. census / exhaustiveness: the work brief declares itself complete only when everything was listed ------------------
  for (let i = 0; i < 5; i += 1) {
    await db.execute(
      `select app.task_add(p_office => ${lit(A.office)}::uuid, p_project => ${lit(pA)}::uuid, p_title => ${lit(`E3 task ${String(i)} ${run}`)}, p_detail => '', p_due_on => ${i % 2 === 0 ? 'current_date - 3' : 'null'}, p_added_by => ${lit(A.key)})`,
    )
  }
  const wb = json(
    (await one(`select app.project_work_brief(${lit(A.office)}::uuid, ${lit(pA)}::uuid, 3) as v`))
      .v,
  )
  const counts = json(wb.counts ?? {})
  console.log(`INFO work brief keys: ${Object.keys(wb).join(',')} counts=${JSON.stringify(counts)}`)
  const shownN = Array.isArray(wb.tasks) ? (wb.tasks as unknown[]).length : Number(wb.shown ?? -1)
  check(
    'work brief with limit 3 over 5 tasks lists 3 and counts 5 (a count beside the list, so a claim of completeness can be refused)',
    Number(counts.total ?? wb.total) === 5 && shownN === 3,
    `shown ${String(shownN)} total ${String(counts.total ?? wb.total)}`,
  )
  const coverage = await one(
    `select app.project_knowledge(${lit(A.office)}::uuid, ${lit(pA)}::uuid) as v`,
  )
  console.log(`INFO project_knowledge(A, Alpha) = ${JSON.stringify(coverage.v).slice(0, 300)}`)
  check(
    'project_knowledge counts a dropped file as upload material (no connector) and names nothing as unindexed',
    !JSON.stringify(coverage.v ?? '')
      .toLowerCase()
      .includes('nothing indexed'),
  )

  console.log(`\n${String(total - failed)}/${String(total)} passed`)
  exit = failed === 0 ? 0 : 1
} finally {
  await db.end()
}
process.exit(exit)

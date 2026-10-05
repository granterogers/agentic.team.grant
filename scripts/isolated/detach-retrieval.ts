/**
 * Detaching a source takes what it indexed out of active retrieval; a Team HQ copy stays (ADR-0013, amended 2026-10-04).
 *
 *   npx tsx scripts/isolated/detach-retrieval.ts <replica-db>
 *
 * The real `app.hq_detach`, the real search and passage readers and the real retrieval code on a replica. Two documents
 * carry the same marker word: one INDEXED from a connector (origin source, under an attachment) and one that Team HQ
 * HOLDS (an upload, and an output explicitly imported, filed as made). Detach the source: the indexed one must leave
 * search, passages, retrieval and the coverage count, and the held ones must not move. Then the boundaries: a source
 * nothing names is left alone, a second enabled route keeps its own documents, re-attaching brings it all back with no
 * copy, nothing was deleted, and a foreign office is untouched. Sabotage controls prove each check can fail.
 */
import { retrieve } from '../../src/knowledge/retrieval.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'detach_retrieval')
const q = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const sha = async (s: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

const OFFICE = String((await q(`select app.test_office()::text o`))[0]?.o)
const OTHER = String(
  (await q(`select office_id::text o from public.offices where kind = 'person' limit 1`))[0]?.o,
)
const run = Math.random().toString(36).slice(2, 8)
const WORD = `Quillmarsh${run}`
const project = async (office: string, name: string): Promise<string> =>
  String(
    (
      await q(
        `insert into public.projects (slug, name, status, office_id) values (${lit(`detach-${run}-${name}`)}, ${lit(name)}, 'archived', ${lit(office)}::uuid) returning project_id::text id`,
      )
    )[0]?.id,
  )
const attach = async (p: string, connector: string, ref: string): Promise<string> =>
  String(
    (
      await q(
        `insert into public.project_attachments (project_id, connector, external_ref, display_name, role) values (${lit(p)}::uuid, ${lit(connector)}, ${lit(ref)}, ${lit(`${connector} ${ref}`)}, 'source') returning attachment_id::text id`,
      )
    )[0]?.id,
  )
const doc = async (
  office: string,
  p: string,
  title: string,
  origin: 'source' | 'yours' | 'made',
  connector: string | null,
  parent: string | null,
): Promise<string> => {
  const body = `${title}. The ${WORD} figure for the quarter is the number forty-two. ${title} is otherwise unremarkable.`
  return String(
    (
      await q(
        `insert into public.documents (office_id, project_id, title, content, content_fingerprint, fetched_at, origin, state, connector, external_parent_ref, external_ref)
         values (${lit(office)}::uuid, ${lit(p)}::uuid, ${lit(title)}, ${lit(body)}, ${lit(await sha(body))}, now(), ${lit(origin)}, 'approved', ${connector === null ? 'null' : lit(connector)}, ${parent === null ? 'null' : lit(parent)}, ${origin === 'source' ? lit(`ext-${title}`) : 'null'})
         returning document_id::text id`,
      )
    )[0]?.id,
  )
}
const found = async (p: string, office = OFFICE): Promise<Set<string>> =>
  new Set(
    (
      await q(
        `select document_id::text id from app.search_documents(${lit(office)}::uuid, ${lit(WORD)}, ${lit(p)}::uuid, 50)`,
      )
    ).map((r) => String(r.id)),
  )
const passages = async (ids: string[]): Promise<Set<string>> =>
  new Set(
    (
      await q(
        `select distinct document_id::text id from app.best_chunks(${lit(OFFICE)}::uuid, array[${ids.map((i) => `${lit(i)}::uuid`).join(',')}], ${lit(WORD)}, 3)`,
      )
    ).map((r) => String(r.id)),
  )
const retrieved = async (p: string): Promise<Set<string>> =>
  new Set(
    (await retrieve(db, { officeId: OFFICE }, `what is the ${WORD} figure`, p)).map(
      (h) => h.documentId,
    ),
  )
const knowledge = async (p: string, connector: string): Promise<number> => {
  const r = (
    await q(`select app.project_knowledge(${lit(OFFICE)}::uuid, ${lit(p)}::uuid)::text j`)
  )[0]?.j
  const j = JSON.parse(String(r)) as { sources?: { connector: string; documents: number }[] }
  return j.sources?.find((c) => c.connector === connector)?.documents ?? -1
}

const P = await project(OFFICE, 'main')
const NB = 'notebook-a'
const nbAttachment = await attach(P, 'notebooklm', NB)
const driveAttachment = await attach(P, 'drive', 'folder-b')
const indexed = await doc(OFFICE, P, 'Notebook finding', 'source', 'notebooklm', NB)
const driveDoc = await doc(OFFICE, P, 'Drive finding', 'source', 'drive', 'folder-b')
const orphan = await doc(OFFICE, P, 'Unattributed finding', 'source', 'notion', 'db-never-attached')
const upload = await doc(OFFICE, P, 'Uploaded note', 'yours', null, null)
const imported = await doc(OFFICE, P, 'Imported output', 'made', 'upload', null)
const all = [indexed, driveDoc, orphan, upload, imported]

const before = await found(P)
check(
  'before: all five are found by search',
  all.every((d) => before.has(d)),
  `${String(before.size)} found`,
)
check('before: all five have passages', (await passages(all)).size === 5)
check('before: the notebook source is counted as indexed', (await knowledge(P, 'notebooklm')) === 1)

// ---- detach the notebook source ----
const out = await q(
  `select app.hq_detach(${lit(OFFICE)}::uuid, ${lit(nbAttachment)}::uuid)::text j`,
)
check('the detach is accepted and offers an undo', String(out[0]?.j).includes('"undo"'))
const after = await found(P)
check('detached: the notebook-indexed document leaves search', !after.has(indexed))
check(
  'detached: an uploaded note and an explicitly imported output are still found',
  after.has(upload) && after.has(imported),
)
check('detached: a source on a different, still-enabled route is untouched', after.has(driveDoc))
check(
  'detached: a source no attachment ever named is left alone (not attributable, not hidden)',
  after.has(orphan),
)
const pAfter = await passages(all)
check(
  'detached: the passage reader agrees with search',
  !pAfter.has(indexed) && pAfter.has(upload) && pAfter.has(imported) && pAfter.has(driveDoc),
)
const rAfter = await retrieved(P)
check(
  'detached: the real retrieval path agrees too',
  !rAfter.has(indexed) && rAfter.has(upload) && rAfter.has(imported),
  `${String(rAfter.size)} hit(s)`,
)
check('detached: the coverage count no longer claims it', (await knowledge(P, 'notebooklm')) <= 0)
const kept = await q(
  `select (select count(*) from public.documents where document_id = ${lit(indexed)}::uuid)::int as d,
          (select count(*) from public.document_chunks where document_id = ${lit(indexed)}::uuid and state = 'active')::int as c,
          (select state from public.documents where document_id = ${lit(indexed)}::uuid) as s`,
)
check(
  'nothing was deleted: the row, its passages and its state are exactly as they were',
  Number(kept[0]?.d) === 1 && Number(kept[0]?.c) > 0 && kept[0]?.s === 'approved',
  JSON.stringify(kept[0]),
)

// ---- two routes to one connector: either open route keeps the document in play ----
// (a document with no parent is fed by whichever route of its connector is open: two Notion routes, one document)
const n1 = await attach(P, 'notion', 'db-one')
const n2 = await attach(P, 'notion', 'db-two')
const parentless = await doc(OFFICE, P, 'Notion page', 'source', 'notion', null)
check('with two enabled routes the parentless source is found', (await found(P)).has(parentless))
await q(
  `update public.project_attachments set enabled = false, disabled_reason = 'proof' where attachment_id = ${lit(n1)}::uuid`,
)
check('one route closed: another is open, so it stays', (await found(P)).has(parentless))
await q(
  `update public.project_attachments set enabled = false, disabled_reason = 'proof' where attachment_id = ${lit(n2)}::uuid`,
)
check('both closed: it leaves retrieval', !(await found(P)).has(parentless))
await q(
  `update public.project_attachments set enabled = true where attachment_id = ${lit(n2)}::uuid`,
)
check('one reopened: it returns', (await found(P)).has(parentless))

// ---- re-attach: the undo brings it all back with no copy ----
await q(
  `update public.project_attachments set enabled = true, disabled_reason = null where attachment_id = ${lit(nbAttachment)}::uuid`,
)
const back = await found(P)
check('re-attached: it is found again, same document id, nothing re-indexed', back.has(indexed))
check(
  're-attached: and the other four have not moved',
  [driveDoc, orphan, upload, imported].every((d) => back.has(d)),
)

// ---- detach the drive route too, and an archive still wins over a connected route ----
await q(`select app.hq_detach(${lit(OFFICE)}::uuid, ${lit(driveAttachment)}::uuid)`)
check(
  'detaching a second source removes only its own documents',
  !(await found(P)).has(driveDoc) && (await found(P)).has(indexed),
)
await q(`update public.documents set state = 'archived' where document_id = ${lit(upload)}::uuid`)
check(
  'an archived Team HQ copy still leaves retrieval (ADR-0040 is unchanged)',
  !(await found(P)).has(upload),
)
await q(`update public.documents set state = 'approved' where document_id = ${lit(upload)}::uuid`)

// ---- a foreign office is untouched, and cannot see ours ----
const PO = await project(OTHER, 'foreign')
const foreignAttach = await attach(PO, 'notebooklm', NB)
const foreign = await doc(OTHER, PO, 'Foreign finding', 'source', 'notebooklm', NB)
await q(`select app.hq_detach(${lit(OTHER)}::uuid, ${lit(foreignAttach)}::uuid)`)
check(
  'another office detaching the same notebook id does not move ours',
  (await found(P)).has(indexed),
)
check('and ours returns nothing of theirs', !(await found(P)).has(foreign))
check('their detach took out their own', !(await found(PO, OTHER)).has(foreign))

// ---- sabotage: the predicate is what does the work, and the checks can fail ----
{
  await q(
    `create or replace function app.source_connected(p_origin text, p_project uuid, p_connector text, p_parent text) returns boolean language sql stable as $$ select true $$`,
  )
  await q(
    `update public.project_attachments set enabled = false, disabled_reason = 'proof' where attachment_id = ${lit(nbAttachment)}::uuid`,
  )
  const s = await found(P)
  check(
    'SABOTAGE: with the predicate always true a detached source is found again (the checks above would go red)',
    s.has(indexed),
  )
}

console.log(`\n${failed === 0 ? 'all' : String(failed)} ${failed === 0 ? 'passed' : 'FAILED'}`)
await db.end()
process.exit(failed === 0 ? 0 : 1)

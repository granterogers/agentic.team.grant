/**
 * Invariant 17 - an agent's retrieval is scoped to a project, and a missing project is not "all of them".
 *
 *   npx tsx scripts/isolated/retrieval-scope.ts <replica-db>
 *
 * The real `retrieve()` against the real `app.search_documents`. A document in project A is found when A is asked
 * for, never when B is, and never when NO project is named (which used to mean every project). The dashboard's own
 * search, which is Grant searching his own material, still reads null as everything: that is the positive control
 * proving the narrowing did not take the search box with it.
 */
import { retrieve } from '../../src/knowledge/retrieval.ts'
import { testOffice } from '../test-office.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'rscope')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const mk = async (label: string): Promise<string> => {
  const name = `fixture scope ${label} ${run}`
  await one(
    `select app.hq_create_project(app.test_office(), ${lit(name)}, 'upload', ${lit(`scope-${label}-${run}`)}, ${lit(name)}, true)::text as r`,
  )
  return String(
    (
      await one(
        `select project_id::text as id from public.projects where slug = ${lit(`fixture-scope-${label}-${run}`)}`,
      )
    ).id,
  )
}
const A = await mk('a')
const B = await mk('b')
const WORD = `zebracrossing${run}`
const BODY = `${WORD} is the only marker in this document. `.repeat(20)
const addDoc = (project: string, ref: string) =>
  one(`insert into public.documents (office_id, project_id, title, connector, external_ref, content, content_chars, content_fingerprint, fetched_at, added_by)
    values ((select office_id from public.projects where project_id = ${lit(project)}::uuid), ${lit(project)}::uuid, ${lit(`Scope doc ${ref}`)}, 'upload', ${lit(ref)}, ${lit(BODY + ref)}, ${String((BODY + ref).length)},
            encode(extensions.digest(${lit(BODY + ref)}, 'sha256'), 'hex'), app.now_utc(), 'grant')
    returning document_id::text as id`)
const docA = String((await addDoc(A, `a-${run}`)).id)

const office = await testOffice(db)
const inA = await retrieve(db, office, WORD, A)
check(
  'control: a document in project A is found when A is asked for',
  inA.some((h) => h.documentId === docA),
  `${inA.length} hit(s)`,
)
const inB = await retrieve(db, office, WORD, B)
check(
  'a question in project B does not see project A',
  !inB.some((h) => h.documentId === docA),
  `${inB.length} hit(s)`,
)
const nobody = await retrieve(db, office, WORD, null)
check(
  'NO project named is not "every project": the document of A is not returned',
  !nobody.some((h) => h.documentId === docA),
  `${nobody.length} hit(s)`,
)
const box = await db.execute(
  `select document_id::text as id from app.search_documents(${lit(office.officeId)}::uuid, ${lit(WORD)}, null, 10)`,
)
check(
  "control: Grant's own search box (a null project on purpose) still finds it, so the narrowing is precise",
  box.rows.some((r) => (r as { id: string }).id === docA),
  `${box.rows.length} hit(s)`,
)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1

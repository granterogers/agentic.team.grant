/**
 * P4 step 5: retrieval canaries in BOTH directions, each with a positive control, down to the layer a model is shown.
 *   npx tsx scripts/p4/canaries.ts
 *
 *   A. Grant's real words must never be retrievable from the second office (SQL search, the product's search section, and
 *      the question put to Claire end to end) - and the same words MUST be found from Grant's office (positive control).
 *   B. A canary planted in the second office must never be retrievable from Grant's office (SQL, the product's search
 *      section as Grant) - and MUST be found by the second person (positive control).
 * Nothing is planted in Grant's office.
 */
import { createHash } from 'node:crypto'
import { act, check, db, grantSession, read, results, SECOND_OFFICE, secondSession } from './lib.ts'

const one = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const T = (await secondSession()).access_token
const G = (await grantSession()).access_token
const run = Date.now().toString(36)
const token = `quokka${run}zanzibar`
const content = `Private note belonging to the second person. The code word is ${token}. Nothing else here.`
const second = String(
  (
    await one(
      `select project_id::text v from public.projects where office_id='${SECOND_OFFICE}' and slug='personal'`,
    )
  )[0]?.v,
)
const grantUnnamed = String(
  (await one(`select app.unnamed_project(app.operator_office())::text v`))[0]?.v,
)

const inserted =
  await one(`insert into public.documents (office_id, project_id, connector, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
  values ('${SECOND_OFFICE}', '${second}', 'upload', 'P4 canary note ${run}', 'note', '${content}', '${createHash('sha256').update(content).digest('hex')}', ${content.length}, app.now_utc(), 'p4-acceptance')
  returning document_id::text v`)
const canaryDoc = String(inserted[0]?.v)
check('the canary document exists in the second office', canaryDoc.length === 36)

// ---- B: second person's canary
const searchAs = async (office: string, project: string, q: string): Promise<number> =>
  Number(
    (
      await one(
        `select count(*)::int v from app.search_documents('${office}'::uuid, '${q}', '${project}'::uuid, 20, 'any')`,
      )
    )[0]?.v,
  )
check(
  'positive control: the second office finds its own canary',
  (await searchAs(SECOND_OFFICE, second, token)) === 1,
)
const opOffice = String((await one(`select app.operator_office()::text v`))[0]?.v)
check(
  "Grant's office (SQL search over his Unnamed project) does not find it",
  (await searchAs(opOffice, grantUnnamed, token)) === 0,
)
const grantProjects = (
  await one(
    `select project_id::text v from public.projects where office_id = app.operator_office()`,
  )
).map((r) => String(r.v))
let any = 0
for (const p of grantProjects) any += await searchAs(opOffice, p, token)
check(`none of Grant's ${grantProjects.length} projects finds it`, any === 0, `${any} hits`)
const gs = await read(G, 'search', `&q=${token}`)
check(
  "the product's search, signed in as Grant, does not find it",
  gs.status === 200 && !gs.text.includes(token) && !gs.text.includes(canaryDoc),
  gs.text.slice(0, 120),
)
const ss = await read(T, 'search', `&q=${token}`)
check(
  "positive control: the product's search as the second person finds it",
  ss.text.includes(canaryDoc) || ss.text.includes(token),
  ss.text.slice(0, 120),
)

// ---- A: Grant's real words
const grantWords = (
  await one(
    `select distinct d.title v from public.documents d where d.office_id = app.operator_office() and length(d.title) between 12 and 60 and d.content is not null and exists (select 1 from public.projects p where p.project_id=d.project_id and not p.is_fixture) limit 12`,
  )
).map((r) => String(r.v).replace(/'/g, "''"))
console.log(`${grantWords.length} of Grant's real document titles used as canaries`)
check('there are Grant canaries', grantWords.length >= 6)
let leakedSql = 0
let leakedApi = 0
let controlHits = 0
const secondProjects = (
  await one(`select project_id::text v from public.projects where office_id='${SECOND_OFFICE}'`)
).map((r) => String(r.v))
for (const w of grantWords) {
  for (const p of secondProjects) leakedSql += await searchAs(SECOND_OFFICE, p, w)
  const r = await read(T, 'search', `&q=${encodeURIComponent(w.replace(/''/g, "'"))}`)
  const bodyHits = (r.text.match(/"document_id"|"id":"[0-9a-f-]{36}"/g) ?? []).length
  // the second person's only searchable document is the canary: any other hit would be Grant's
  if (bodyHits > 0 && !r.text.includes(canaryDoc)) leakedApi += bodyHits
  // positive control: the words are findable from Grant's own office (any of his projects)
  let found = 0
  for (const p of grantProjects.slice(0, 40)) {
    found += await searchAs(opOffice, p, w)
    if (found > 0) break
  }
  controlHits += found > 0 ? 1 : 0
}
check(
  "none of Grant's document titles is retrievable from the second office (SQL)",
  leakedSql === 0,
  `${leakedSql} hits`,
)
check(
  "none is retrievable through the product's search as the second person",
  leakedApi === 0,
  `${leakedApi} hits`,
)
check(
  "positive control: Grant's own office finds the same titles",
  controlHits >= Math.ceil(grantWords.length / 2),
  `${controlHits}/${grantWords.length}`,
)

// ---- the layer a model is shown: ask Claire as the second person about each canary
const asks = [
  `What does my note say the code word is? It contains the word ${token}.`,
  `Find anything in my files about ${grantWords[0]?.replace(/''/g, "'")}`,
]
const jobs: string[] = []
for (const q of asks) {
  const r = await act(T, 'say', { p_project_id: second, p_text: q })
  const id = ((r.json as { result?: { job?: string } } | null)?.result?.job ?? '') as string
  check(`accepted: ${q.slice(0, 50)}`, id !== '', r.text.slice(0, 90))
  if (id !== '') jobs.push(id)
}
const deadline = Date.now() + 8 * 60_000
const ids = jobs.map((j) => `'${j}'`).join(',')
let states: Record<string, unknown>[] = []
do {
  await new Promise((ok) => setTimeout(ok, 6000))
  states = await one(
    `with recursive t as (select * from public.jobs where job_id in (${ids}) union select c.* from public.jobs c join t on c.parent_job_id = t.job_id) select job_id::text, state, office_id::text from t`,
  )
} while (
  Date.now() < deadline &&
  states.some((s) => !['complete', 'failed', 'cancelled'].includes(String(s.state)))
)
check(
  'both chains ran in the second office',
  states.length >= 2 && states.every((s) => s.office_id === SECOND_OFFICE),
)
const outs = await one(
  `select j.job_id::text j, o.body b from public.outputs o join public.jobs j using (job_id) where o.job_id in (${states.map((s) => `'${String(s.job_id)}'`).join(',')})`,
)
for (const o of outs) console.log('--- answer:', String(o.b).replace(/\s+/g, ' ').slice(0, 300))
check(
  "the answer to the first question quotes the second person's own canary",
  outs.some((o) => String(o.b).includes(token)),
  'positive control through the model path',
)
const second_answer = outs
  .filter((o) => String(o.j) !== jobs[0])
  .map((o) => String(o.b))
  .join(' ')
check(
  "the answer about Grant's title contains none of Grant's content",
  !grantWords.some(
    (w) =>
      w.length > 20 && second_answer.toLowerCase().includes(w.replace(/''/g, "'").toLowerCase()),
  ),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
process.exitCode = failed.length === 0 ? 0 : 1

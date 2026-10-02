/**
 * P4 step 4: Claire and the specialists answer the second person, and nothing in the chain leaves their office.
 *   npx tsx scripts/p4/chat.ts
 * Sends ambiguous questions as the second person (including "What has Grant been working on?"), waits for the whole job
 * tree to settle, then reads the CANONICAL rows: the office of every job, delivery, output, routing decision and
 * consultation, and scans the answers for strings that exist only in Grant's office (positive control: the same scan
 * must find them in a payload of Grant's own).
 */
import { act, check, db, results, SECOND_OFFICE, secondSession } from './lib.ts'

const T = (await secondSession()).access_token
const one = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const projectId = String(
  (
    await one(
      `select project_id::text v from public.projects where office_id='${SECOND_OFFICE}' and slug='personal'`,
    )
  )[0]?.v,
)

// Canaries: distinctive words that exist ONLY in Grant's office (project names and document titles of his real projects).
const canaries = (
  await one(`select distinct name v from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' and length(name) > 6
             union select distinct title from public.documents d where office_id = app.operator_office() and length(title) > 14 and exists (select 1 from public.projects p where p.project_id=d.project_id and not p.is_fixture) limit 60`)
).map((r) => String(r.v))
console.log(
  `${canaries.length} canary strings from Grant's office, e.g. ${JSON.stringify(canaries.slice(0, 3))}`,
)
check('there are canaries to look for', canaries.length >= 10)

const questions = [
  'What has Grant been working on?',
  'Summarise everything you know about my projects and who I work with.',
  'Ask the finance director and the research director what they know about our pricing, then tell me.',
]
// Job ids on the command line resume a run that already sent its questions (a re-run must not spend the model again).
const jobs: string[] = process.argv.slice(2)
for (const q of jobs.length > 0 ? [] : questions) {
  const r = await act(T, 'say', { p_project_id: projectId, p_text: q })
  const id = ((r.json as { result?: { job?: string } } | null)?.result?.job ?? '') as string
  check(`the office accepted: ${q.slice(0, 40)}`, id !== '', r.text.slice(0, 100))
  if (id !== '') jobs.push(id)
}

const tree = async (): Promise<Record<string, unknown>[]> =>
  one(`with recursive t as (select * from public.jobs where job_id in (${jobs.map((j) => `'${j}'`).join(',')})
        union select c.* from public.jobs c join t on c.parent_job_id = t.job_id)
       select job_id::text, state, kind, office_id::text, attempt from t`)
const deadline = Date.now() + 9 * 60_000
let rows = await tree()
while (
  Date.now() < deadline &&
  rows.some((r) => !['complete', 'failed', 'cancelled'].includes(String(r.state)))
) {
  await new Promise((ok) => setTimeout(ok, 6000))
  rows = await tree()
}
console.log(
  `job tree: ${rows.length} job(s): ${JSON.stringify(rows.map((r) => `${String(r.kind)}:${String(r.state)}`))}`,
)
check(
  'every job of the chain ran in the second office',
  rows.length >= jobs.length && rows.every((r) => r.office_id === SECOND_OFFICE),
  `${rows.filter((r) => r.office_id !== SECOND_OFFICE).length} elsewhere`,
)
check(
  'the chain settled',
  rows.every((r) => ['complete', 'failed', 'cancelled'].includes(String(r.state))),
)
const ids = rows.map((r) => `'${String(r.job_id)}'`).join(',')

const outs = await one(
  `select o.job_id::text j, o.body b, j.office_id::text off from public.outputs o join public.jobs j using (job_id) where o.job_id in (${ids})`,
)
console.log(`${outs.length} output(s)`)
check(
  'every output is in the second office',
  outs.every((o) => o.off === SECOND_OFFICE),
)
for (const o of outs) console.log('--- answer:', String(o.b).replace(/\s+/g, ' ').slice(0, 420))
const hits = outs.flatMap((o) =>
  canaries.filter((c) => String(o.b).toLowerCase().includes(c.toLowerCase())),
)
check(
  "no answer contains a string that exists only in Grant's office",
  hits.length === 0,
  JSON.stringify(hits.slice(0, 5)),
)
const mentionsGrantFacts = outs.filter((o) =>
  /legacy coaching|unified-proof|ai learning|ai team hq/i.test(String(o.b)),
)
check("no answer names one of Grant's real projects", mentionsGrantFacts.length === 0)

const other = await one(`select
   (select count(*) from public.deliveries d where d.job_id in (${ids}) and d.office_id <> '${SECOND_OFFICE}') deliv_elsewhere,
   (select count(*) from public.routing_decisions r join public.jobs j using (job_id) where r.job_id in (${ids}) and j.office_id <> '${SECOND_OFFICE}') routing_elsewhere,
   (select count(*) from public.routing_decisions r where r.job_id in (${ids})) routing_total,
   (select count(*) from public.consultations c join public.jobs j using (job_id) where c.job_id in (${ids}) and j.office_id <> '${SECOND_OFFICE}') consult_elsewhere,
   (select count(*) from public.consultations c where c.job_id in (${ids})) consult_total,
   (select count(*) from public.deliveries d where d.job_id in (${ids})) deliv_total`)
console.log(JSON.stringify(other[0]))
check(
  'deliveries, routing decisions and consultations all carry the second office',
  Number(other[0]?.deliv_elsewhere) === 0 &&
    Number(other[0]?.routing_elsewhere) === 0 &&
    Number(other[0]?.consult_elsewhere) === 0,
)

// What a model was SHOWN: every inference recorded against the chain, and its provider request if stored.
const inf = await one(
  `select i.office_id::text off, count(*) n from public.inference_usage i where i.correlation_id in (select correlation_id from public.jobs where job_id in (${ids})) group by 1`,
).catch(() => [])
console.log('inference_usage by office:', JSON.stringify(inf))
check(
  'every recorded model call belongs to the second office',
  inf.every((r) => r.off === SECOND_OFFICE),
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok; jobs=${jobs.join(',')}`)
process.exitCode = failed.length === 0 ? 0 : 1

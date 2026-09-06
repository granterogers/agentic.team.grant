/**
 * The knowledge layer, checked against the live database.
 *
 *   npm run verify:knowledge
 *
 * ADR-0013 decides that the project is the source of truth and that every
 * knowledge tool is a connector to it. The claims that decision rests on are
 * not "we wrote a search function" — they are:
 *
 *   - a document is findable whatever fed it in;
 *   - **turning a connector off does not lose what it already brought in**,
 *     which is the difference between an outage and amnesia, and the exact
 *     property 2026-09-04 tested for real;
 *   - the search index cannot drift from the content, because a stale index
 *     that returns yesterday's text is worse than no index;
 *   - a document cannot claim a connector that does not exist.
 *
 * Every check below has a CONTROL or an inverse where one is possible: a search
 * suite that only ever searches for words that are present will pass against a
 * function that returns every row.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const run = Date.now().toString(36)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

// A word that exists nowhere else in the corpus, so a match is this suite's
// document and not a coincidence in 69,000 characters of Wikipedia.
const TOKEN = `zarquon${run}`

const project = await one(`
  insert into public.projects (slug, name, status)
  values (${lit(`fixture-knowledge-${run}`)}, 'Fixture: knowledge', 'active')
  returning project_id::text as id
`)
const projectId = String(project?.id)

const other = await one(`
  insert into public.projects (slug, name, status)
  values (${lit(`fixture-knowledge-other-${run}`)}, 'Fixture: knowledge (other)', 'active')
  returning project_id::text as id
`)
const otherId = String(other?.id)

const fingerprint = (seed: string): string =>
  Array.from({ length: 64 }, (_, i) =>
    seed
      .charCodeAt(i % seed.length)
      .toString(16)
      .slice(-1),
  ).join('')

const insertDoc = async (input: {
  connector: string
  parent: string
  ref: string | null
  title: string
  content: string
  project: string
}): Promise<string> => {
  const r = await one(`
    insert into public.documents
      (project_id, connector, external_parent_ref, external_ref, title, content,
       content_fingerprint, content_chars, fetched_at)
    values (${lit(input.project)}::uuid, ${lit(input.connector)},
            ${input.ref === null ? 'null' : lit(input.parent)},
            ${input.ref === null ? 'null' : lit(input.ref)}, ${lit(input.title)},
            ${lit(input.content)}, ${lit(fingerprint(input.ref ?? input.title))},
            ${String(input.content.length)}, app.now_utc())
    returning document_id::text as id
  `)
  return String(r?.id)
}

// ---------------------------------------------------------------------------
// 1. A document is findable, whatever connector fed it
// ---------------------------------------------------------------------------

const uploaded = await insertDoc({
  connector: 'upload',
  parent: `fixture-${run}`,
  ref: null,
  title: `Ledger note ${run}`,
  content: `An uploaded note about ${TOKEN} and nothing else of interest.`,
  project: projectId,
})

const found = await all(`select * from app.search_documents(${lit(TOKEN)}, null, 10)`)
record(
  'a document reaches search whatever connector fed it in',
  `${String(found.length)} hit(s), connector=${String(found[0]?.connector)}`,
  found.length === 1 && found[0]?.connector === 'upload',
)

// CONTROL. Without this, a search function that ignored its argument and
// returned every row would pass every check above and below it.
const absent = await all(`select * from app.search_documents(${lit(`absent${run}`)}, null, 10)`)
record(
  'CONTROL: a term in no document returns nothing, so the query is doing the work',
  `${String(absent.length)} hit(s)`,
  absent.length === 0,
)

// ---------------------------------------------------------------------------
// 2. The index cannot drift from the content
// ---------------------------------------------------------------------------

const NEW_TOKEN = `plugh${run}`
await db.execute(`
  update public.documents
     set content = ${lit(`Rewritten, and now about ${NEW_TOKEN}.`)},
         content_fingerprint = ${lit(fingerprint(NEW_TOKEN))}
   where document_id = ${lit(uploaded)}::uuid
`)
const afterEdit = await all(`select * from app.search_documents(${lit(NEW_TOKEN)}, null, 10)`)
const staleHit = await all(`select * from app.search_documents(${lit(TOKEN)}, null, 10)`)
record(
  'editing content re-indexes it, and the OLD text stops matching',
  `new term ${String(afterEdit.length)} hit(s), old term ${String(staleHit.length)} hit(s)`,
  afterEdit.length === 1 && staleHit.length === 0,
)

// ---------------------------------------------------------------------------
// 3. Weighting: a title is a stronger signal than a passing mention
// ---------------------------------------------------------------------------

const SUBJECT = `bandersnatch${run}`
await insertDoc({
  connector: 'upload',
  parent: `fixture-${run}`,
  ref: null,
  title: `${SUBJECT} — the note about it`,
  content: 'A short note whose subject is named in its title.',
  project: projectId,
})
await insertDoc({
  connector: 'upload',
  parent: `fixture-${run}`,
  ref: null,
  title: 'Something else entirely',
  content: `A long aside that happens to mention ${SUBJECT} once, in passing, ${'and then goes on about other matters. '.repeat(20)}`,
  project: projectId,
})
const ranked = await all(`select * from app.search_documents(${lit(SUBJECT)}, null, 10)`)
record(
  'a document titled for the subject outranks one that mentions it in passing',
  `${String(ranked.length)} hit(s); first=${String(ranked[0]?.title)}`,
  ranked.length === 2 && String(ranked[0]?.title).startsWith(SUBJECT),
)

// ---------------------------------------------------------------------------
// 4. The project filter narrows, and does so by project
// ---------------------------------------------------------------------------

await insertDoc({
  connector: 'upload',
  parent: `fixture-${run}`,
  ref: null,
  title: `${SUBJECT} in another project`,
  content: 'Same subject, different project.',
  project: otherId,
})
const unfiltered = await all(`select * from app.search_documents(${lit(SUBJECT)}, null, 10)`)
const filtered = await all(
  `select * from app.search_documents(${lit(SUBJECT)}, ${lit(projectId)}::uuid, 10)`,
)
record(
  'the project filter narrows to that project and not to "the first one"',
  `all=${String(unfiltered.length)} filtered=${String(filtered.length)}`,
  unfiltered.length === 3 && filtered.length === 2,
)

// ---------------------------------------------------------------------------
// 5. §17: turning a connector off loses the ROUTE, not the CORPUS
// ---------------------------------------------------------------------------

await db.execute(`
  insert into public.knowledge_connectors (connector, name, automated, enabled, notes)
  values (${lit(`fixture_${run}`)}, 'Fixture connector', true, true, 'verification fixture')
`)
const viaConnector = await insertDoc({
  connector: `fixture_${run}`,
  parent: `fixture-${run}`,
  ref: `remote-${run}`,
  title: `Brought in by a connector ${run}`,
  content: `A document about ${SUBJECT} that arrived through a connector.`,
  project: projectId,
})
await db.execute(`
  update public.knowledge_connectors
     set enabled = false, disabled_reason = 'verification: the route is closed'
   where connector = ${lit(`fixture_${run}`)}
`)
const afterDisable = await all(
  `select * from app.search_documents(${lit(SUBJECT)}, ${lit(projectId)}::uuid, 10)`,
)
record(
  'disabling a connector does NOT hide the documents it already brought in (§17, ADR-0003)',
  `${String(afterDisable.length)} hit(s) with the route closed`,
  afterDisable.length === 3 && afterDisable.some((r) => String(r.document_id) === viaConnector),
)

// ---------------------------------------------------------------------------
// 6. A document cannot claim a connector that does not exist
// ---------------------------------------------------------------------------

let refusedCode = 'nothing was refused'
try {
  await insertDoc({
    connector: 'a_connector_that_was_never_registered',
    parent: `fixture-${run}`,
    ref: `x-${run}`,
    title: 'Should not exist',
    content: 'Should not exist.',
    project: projectId,
  })
} catch (error) {
  refusedCode =
    error instanceof SqlExecutionError
      ? (error.message.match(/\b\d{5}\b/)?.[0] ?? 'unknown')
      : 'wrong error type'
}
record(
  'a document cannot name a connector that is not registered',
  `refused with ${refusedCode}`,
  refusedCode === '23503',
)

// ---------------------------------------------------------------------------
// 7. Uniqueness is per connector, and an upload has no external identity
// ---------------------------------------------------------------------------

let dupeCode = 'nothing was refused'
try {
  await insertDoc({
    connector: `fixture_${run}`,
    parent: `fixture-${run}`,
    ref: `remote-${run}`,
    title: 'The same remote document, twice',
    content: 'Should be refused.',
    project: projectId,
  })
} catch (error) {
  dupeCode =
    error instanceof SqlExecutionError
      ? (error.message.match(/\b\d{5}\b/)?.[0] ?? 'unknown')
      : 'wrong error type'
}
record(
  'the same external reference cannot be stored twice under one connector',
  `refused with ${dupeCode}`,
  dupeCode === '23505',
)

// The inverse: an upload has no external id, so two uploads are two documents
// rather than a uniqueness violation on a fabricated key.
const uploadsBefore = await one(
  `select count(*)::int as n from public.documents
    where connector = 'upload' and project_id = ${lit(projectId)}::uuid`,
)
await insertDoc({
  connector: 'upload',
  parent: `fixture-${run}`,
  ref: null,
  title: 'Another upload with no external identity',
  content: 'Two uploads are two documents.',
  project: projectId,
})
const uploadsAfter = await one(
  `select count(*)::int as n from public.documents
    where connector = 'upload' and project_id = ${lit(projectId)}::uuid`,
)
record(
  'but two uploads are two documents — a null external ref is not a duplicate',
  `${String(uploadsBefore?.n)} -> ${String(uploadsAfter?.n)}`,
  Number(uploadsAfter?.n) === Number(uploadsBefore?.n) + 1,
)

// ---------------------------------------------------------------------------
// 8. A person's query syntax is understood, not raised as an error
// ---------------------------------------------------------------------------

let phraseOutcome = ''
try {
  const phrase = await all(
    `select * from app.search_documents(${lit(`"note about it" or ${SUBJECT}`)}, ${lit(projectId)}::uuid, 10)`,
  )
  phraseOutcome = `${String(phrase.length)} hit(s), no error`
} catch (error) {
  phraseOutcome = `raised: ${(error as Error).message.slice(0, 60)}`
}
record(
  'quotes and OR are understood rather than raised as a syntax error',
  phraseOutcome,
  phraseOutcome.endsWith('no error'),
)

// ---------------------------------------------------------------------------
// 9. §17 again: the registry says why a route is closed
// ---------------------------------------------------------------------------

let reasonlessCode = 'nothing was refused'
try {
  await db.execute(`
    update public.knowledge_connectors set enabled = false, disabled_reason = null
     where connector = 'notion'
  `)
} catch (error) {
  reasonlessCode =
    error instanceof SqlExecutionError
      ? (error.message.match(/\b\d{5}\b/)?.[0] ?? 'unknown')
      : 'wrong error type'
}
record(
  'a connector cannot be turned off without saying why (§17)',
  `refused with ${reasonlessCode}`,
  reasonlessCode === '23514',
)

// ---------------------------------------------------------------------------
// Report, then clean up after itself
// ---------------------------------------------------------------------------

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)

// A suite that leaves fixtures behind is a suite that poisons the next run's
// counts — and one that leaves a DISABLED connector behind has changed real
// configuration, which this project has already paid for twice.
await db.execute(`
  delete from public.documents where project_id in (${lit(projectId)}::uuid, ${lit(otherId)}::uuid);
  delete from public.knowledge_connectors where connector = ${lit(`fixture_${run}`)};
  delete from public.projects where project_id in (${lit(projectId)}::uuid, ${lit(otherId)}::uuid);
`)
console.log('fixtures removed.')

if (failed.length > 0) process.exit(1)

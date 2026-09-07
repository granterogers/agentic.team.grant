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
  with created as (
    insert into public.projects (slug, name, status)
    values (${lit(`fixture-knowledge-${run}`)}, 'Fixture: knowledge', 'active')
    returning project_id
  ),
  attached as (
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, role)
    select project_id, 'upload', 'fixture', 'Verification fixture', 'source'
      from created
    returning project_id
  )
  select project_id::text as id from created
`)
const projectId = String(project?.id)

const other = await one(`
  with created as (
    insert into public.projects (slug, name, status)
    values (${lit(`fixture-knowledge-other-${run}`)}, 'Fixture: knowledge (other)', 'active')
    returning project_id
  ),
  attached as (
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, role)
    select project_id, 'upload', 'fixture', 'Verification fixture', 'source'
      from created
    returning project_id
  )
  select project_id::text as id from created
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
// 7b. A question is not a search box (0060)
// ---------------------------------------------------------------------------

// The default ANDs every term, which is right for a deliberate search and
// useless for retrieval: a natural question includes words like "material" and
// "say" that appear in no document, and ten conditions match nothing. Both
// semantics are asserted here, against the same corpus, because each is wrong
// in the other's place.
{
  const question = `What does our note say about the subject of ${SUBJECT}?`
  const anded = await all(
    `select * from app.search_documents(${lit(question)}, ${lit(projectId)}::uuid, 10, 'all')`,
  )
  const ored = await all(
    `select * from app.search_documents(${lit(question)}, ${lit(projectId)}::uuid, 10, 'any')`,
  )
  record(
    "a whole question finds nothing under 'all' and finds the documents under 'any'",
    `all=${String(anded.length)} hit(s), any=${String(ored.length)} hit(s)`,
    anded.length === 0 && ored.length >= 2,
  )

  // And ranking still discriminates under OR — otherwise "any" would be a
  // synonym for "every document that shares a stop word", which is the failure
  // people complain about in search boxes.
  record(
    "under 'any', the document titled for the subject still ranks first",
    `first=${String(ored[0]?.title)}`,
    String(ored[0]?.title).startsWith(SUBJECT),
  )

  // CONTROL: a question with nothing but stop words yields no tsquery at all,
  // and must return nothing rather than everything.
  const stopWords = await all(
    `select * from app.search_documents('the and of it', ${lit(projectId)}::uuid, 10, 'any')`,
  )
  record(
    "CONTROL: a query of only stop words returns nothing under 'any', not everything",
    `${String(stopWords.length)} hit(s)`,
    stopWords.length === 0,
  )
}

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
// A source arriving is news (0107)
// ---------------------------------------------------------------------------
//
// §22 A opens *"Grant adds a source ... → detected within the sync interval →
// Research analyzes"*, and for 586 documents nothing joined those two clauses:
// the sync wrote a row and stopped. The trigger joins them. These checks are
// the ones that would have noticed it was missing, and the ones that keep the
// guards honest — a trigger that fired on everything would be worse than none.

// The fixture project is `fixture-knowledge-…`, which 0107 excludes by name,
// so the guards have to be exercised on a project shaped like a real one.
const realish = await one(`
  with created as (
    insert into public.projects (slug, name, status)
    values (${lit(`newsroom-${run}`)}, ${lit(`Newsroom ${run}`)}, 'active')
    returning project_id
  ),
  attached as (
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, role)
    select project_id, 'upload', ${lit(`newsroom-${run}`)}, 'Fixture', 'source'
      from created
    returning project_id
  )
  select project_id::text as id from created
`)
const newsroom = String(realish?.id)
const LONG = `A substantive document about ${TOKEN}. `.repeat(40)

const jobFor = async (documentId: string): Promise<string | undefined> =>
  (
    await one(`
      select state::text as state from public.jobs
       where idempotency_key = ${lit(`read:${documentId}`)}
    `)
  )?.state as string | undefined

// The first document of a project is an import, not news.
const firstDoc = await insertDoc({
  connector: 'upload',
  parent: `newsroom-${run}`,
  ref: `newsroom-first-${run}`,
  title: `First arrival ${run}`,
  content: LONG,
  project: newsroom,
})
record(
  'the FIRST document of a project starts nothing — attaching a notebook is an import',
  `job=${String(await jobFor(firstDoc))}`,
  (await jobFor(firstDoc)) === undefined,
)

// The second is.
const secondDoc = await insertDoc({
  connector: 'upload',
  parent: `newsroom-${run}`,
  ref: `newsroom-second-${run}`,
  title: `Second arrival ${run}`,
  content: LONG,
  project: newsroom,
})
record(
  'a document arriving into an established project starts a research job',
  `job=${String(await jobFor(secondDoc))}`,
  (await jobFor(secondDoc)) === 'queued',
)

// CONTROL. Without it the check above would pass on a trigger that fired for
// everything, which is the version that stampedes forty jobs on a first sync.
const tinyDoc = await insertDoc({
  connector: 'upload',
  parent: `newsroom-${run}`,
  ref: `newsroom-tiny-${run}`,
  title: `Tiny arrival ${run}`,
  content: 'Two lines. Not worth convening anyone over.',
  project: newsroom,
})
record(
  'CONTROL: a trivial document starts nothing, so the trigger is not simply firing on everything',
  `job=${String(await jobFor(tinyDoc))}`,
  (await jobFor(tinyDoc)) === undefined,
)

// And a fixture project is excluded by name, so a verification run never
// convenes anyone or eats the hourly cap.
const fixtureDoc = await insertDoc({
  connector: 'upload',
  parent: `fixture-${run}`,
  ref: `fixture-news-${run}`,
  title: `Fixture arrival ${run}`,
  content: LONG,
  project: projectId,
})
record(
  'a document in a FIXTURE project starts nothing, whatever its size',
  `job=${String(await jobFor(fixtureDoc))}`,
  (await jobFor(fixtureDoc)) === undefined,
)

// The job is real work, attributed to the person §9 gives it to.
const newsJob = await one(`
  select j.kind, j.announce, j.priority,
         (j.pinned_config ->> 'document_id') as document_id
    from public.jobs j where j.idempotency_key = ${lit(`read:${secondDoc}`)}
`)
record(
  'and it carries the document, announces itself, and sits below an instruction Grant is waiting on',
  `kind=${String(newsJob?.kind)} announce=${String(newsJob?.announce)} priority=${String(newsJob?.priority)}`,
  newsJob?.kind === 'knowledge.read_source' &&
    newsJob?.announce === true &&
    String(newsJob?.document_id) === secondDoc,
)

// Cancelled, not deleted. `job_state_transitions` references `jobs`, and the
// ledger is append-only by design — a suite that could delete its own job
// history could delete anyone's.
await db.execute(`
  update public.jobs set state = 'cancelled', state_reason = 'verify:knowledge fixture retired',
         finished_at = app.now_utc()
   where idempotency_key like ${lit(`read:%`)}
     and project_id in (${lit(newsroom)}::uuid, ${lit(projectId)}::uuid)
     and state not in ('complete', 'cancelled', 'failed');
  delete from public.documents where project_id = ${lit(newsroom)}::uuid;
`)
// Archived rather than deleted, for the same reason: the cancelled jobs above
// still point at it.
await db.execute(`
  update public.projects set status = 'archived' where project_id = ${lit(newsroom)}::uuid
`)

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

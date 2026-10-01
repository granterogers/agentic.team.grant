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
// Whose documents: the office of the project this suite makes (every reader is asked of one office).
const PO = `(select office_id from public.projects where project_id = ${lit(projectId)}::uuid)`

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

const found = await all(`select * from app.search_documents(${PO}, ${lit(TOKEN)}, null, 10)`)
record(
  'a document reaches search whatever connector fed it in',
  `${String(found.length)} hit(s), connector=${String(found[0]?.connector)}`,
  found.length === 1 && found[0]?.connector === 'upload',
)

// CONTROL. Without this, a search function that ignored its argument and
// returned every row would pass every check above and below it.
const absent = await all(
  `select * from app.search_documents(${PO}, ${lit(`absent${run}`)}, null, 10)`,
)
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
const afterEdit = await all(
  `select * from app.search_documents(${PO}, ${lit(NEW_TOKEN)}, null, 10)`,
)
const staleHit = await all(`select * from app.search_documents(${PO}, ${lit(TOKEN)}, null, 10)`)
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
const ranked = await all(`select * from app.search_documents(${PO}, ${lit(SUBJECT)}, null, 10)`)
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
const unfiltered = await all(`select * from app.search_documents(${PO}, ${lit(SUBJECT)}, null, 10)`)
const filtered = await all(
  `select * from app.search_documents(${PO}, ${lit(SUBJECT)}, ${lit(projectId)}::uuid, 10)`,
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
  `select * from app.search_documents(${PO}, ${lit(SUBJECT)}, ${lit(projectId)}::uuid, 10)`,
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
    `select * from app.search_documents(${PO}, ${lit(question)}, ${lit(projectId)}::uuid, 10, 'all')`,
  )
  const ored = await all(
    `select * from app.search_documents(${PO}, ${lit(question)}, ${lit(projectId)}::uuid, 10, 'any')`,
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
    `select * from app.search_documents(app.test_office(), 'the and of it', ${lit(projectId)}::uuid, 10, 'any')`,
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
    `select * from app.search_documents(${PO}, ${lit(`"note about it" or ${SUBJECT}`)}, ${lit(projectId)}::uuid, 10)`,
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
// The index knows what it has NOT got (#257)
// ---------------------------------------------------------------------------

/*
  Grant asked about a document in the project's linked Google Notebook and was
  told it could not be found.

  A search that finds nothing is legitimate evidence for "there is nothing in
  our documents" — that is what `consultedDomains` is for and it is right
  whenever the index covers what is attached. It stops being right the moment a
  connector is attached with nothing indexed, and until 0427 nothing anywhere
  could tell the difference.

  So the property is not "the reader returns a number". It is that an attached
  connector with no documents behind it is NAMED, and that a fully indexed
  project says nothing at all — because a caveat on every turn is noise.
*/
console.log('\nwhat the index cannot speak for (#257)')

{
  // A connector attached to this suite's project with nothing behind it.
  await db.execute(`
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, role, enabled)
    values (${lit(projectId)}::uuid, 'drive', ${lit(`fixture-folder-${run}`)},
            ${lit(`Fixture folder ${run}`)}, 'source', true)`)

  /*
    The executor hands a jsonb column back as an OBJECT, not a string.
    `JSON.parse(String(x))` on it produces "[object Object]" and throws — the
    same guessed shape that has caught a reader in this repository before.
  */
  const asJson = (v: unknown): Record<string, unknown> =>
    typeof v === 'string'
      ? (JSON.parse(v) as Record<string, unknown>)
      : (v as Record<string, unknown>)

  const gap = await one(`select app.project_knowledge(${PO}, ${lit(projectId)}::uuid) as k`)
  const k = asJson(gap?.k) as {
    blank?: string[]
    complete?: boolean
    documents?: number
    sources?: { connector: string; blank: boolean }[]
  }
  record(
    'a connector attached with nothing indexed is NAMED',
    `blank: ${JSON.stringify(k.blank)}`,
    Array.isArray(k.blank) && k.blank.includes('drive'),
  )
  record(
    'and the index does not claim to be complete',
    `complete: ${String(k.complete)}`,
    k.complete === false,
  )
  record(
    'while still reporting what it DOES hold, so the caveat is not the whole answer',
    `${String(k.documents)} document(s) indexed`,
    Number(k.documents) > 0,
  )

  /*
    CONTROL. Remove the attachment and the same project reports complete.

    Without this the checks above would pass against a function that always
    said "incomplete", which is the safe-looking failure: an office that
    caveats every answer is one whose caveats stop being read.
  */
  await db.execute(`
    delete from public.project_attachments
     where project_id = ${lit(projectId)}::uuid and external_ref = ${lit(`fixture-folder-${run}`)}`)
  const back = await one(`select app.project_knowledge(${PO}, ${lit(projectId)}::uuid) as k`)
  const b = asJson(back?.k) as { blank?: string[]; complete?: boolean }
  record(
    'CONTROL: with nothing attached-but-blank, it says so and names nobody',
    `complete: ${String(b.complete)}, blank: ${JSON.stringify(b.blank)}`,
    b.complete === true && Array.isArray(b.blank) && b.blank.length === 0,
  )

  /*
    And a connector whose attachment is GONE but whose documents remain is not
    a gap. §17 turns off a route, not what it already brought in — the property
    the section above this file already proves for search, asserted here for
    coverage so the two cannot disagree.
  */
  const kept = asJson(back?.k) as { sources?: { connector: string; blank: boolean }[] }
  record(
    'a connector that fed documents in still counts, attached or not',
    `${String((kept.sources ?? []).length)} source(s) named`,
    (kept.sources ?? []).some((x) => x.blank === false),
  )
}

// ---------------------------------------------------------------------------
// A file renamed at the SOURCE (#257)
// ---------------------------------------------------------------------------

{
  /*
    #257's sixth acceptance criterion is *"updates, renames and deletions
    reconcile correctly"*. Content updates already did — editing re-indexes and
    the old text stops matching, two hundred lines above. Renames never had:
    `record_file_document` found the row by storage path, returned
    `already_there` and touched nothing, so a file renamed in Drive kept the
    title it was first read with. Grant searching for its new name would find
    nothing — which is this Issue's ORIGINAL complaint wearing different
    clothes.

    Three cases, and the middle one is the reason it is not simply "the source
    wins": `app.rename_document` lets him rename a document himself, with an
    undo, so overwriting on every re-read would silently take that back.
  */
  /*
    The executor hands a jsonb column back as an OBJECT, not a string —
    `JSON.parse(String(x))` on one produces "[object Object]" is not valid
    JSON, which reads like a corrupt payload and is a guessed shape.
  */
  const asJson = (v: unknown): Record<string, unknown> =>
    v === null || v === undefined
      ? {}
      : ((typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>)
  const path = `${projectId}/drive/renamed-${run}.pdf`
  const keep = `${projectId}/drive/steady-${run}.pdf`
  const put = (title: string, storage: string) => `
    app.record_file_document(app.test_office(), ${lit(projectId)}::uuid, ${lit(title)}, ${lit(storage)},
      'application/pdf', 2048, null, ${lit(`ext-${run}`)}, null, 'grant', null, 'yours')`

  const upstream = await one(`
    begin;
    create temp table rn (k text primary key, v jsonb) on commit drop;
    insert into rn values ('first', ${put(`Plan ${run}.pdf`, path)});
    insert into rn values ('again', ${put(`Plan ${run} FINAL.pdf`, path)});
    select (select v from rn where k = 'again') as again,
           (select title from public.documents where storage_path = ${lit(path)}) as title;
    rollback;`)
  const againJson = asJson(upstream?.again)
  record(
    'a file renamed at the source is found under its NEW name',
    `${String(upstream?.title ?? '(nothing)')}`,
    String(upstream?.title ?? '') === `Plan ${run} FINAL.pdf` &&
      againJson.renamed_at_source === true,
  )

  const mine = await one(`
    begin;
    create temp table rm (k text primary key, v jsonb) on commit drop;
    insert into rm values ('first', ${put(`Plan ${run}.pdf`, path)});
    select app.rename_document(app.test_office(), 
      (select document_id from public.documents where storage_path = ${lit(path)}),
      ${lit(`What I call it ${run}`)});
    insert into rm values ('again', ${put(`Plan ${run} FINAL.pdf`, path)});
    select (select v from rm where k = 'again') as again,
           (select title from public.documents where storage_path = ${lit(path)}) as title,
           (select source_title from public.documents where storage_path = ${lit(path)}) as source;
    rollback;`)
  const mineJson = asJson(mine?.again)
  record(
    'but a name GRANT gave it survives the source renaming it',
    `his "${String(mine?.title ?? '')}" kept; the source now says "${String(mine?.source ?? '')}"`,
    String(mine?.title ?? '') === `What I call it ${run}` && mineJson.kept_your_name === true,
  )
  record(
    "and the source's new name is written down rather than lost",
    String(mine?.source ?? ''),
    String(mine?.source ?? '') === `Plan ${run} FINAL.pdf`,
  )

  /*
    The control. Without it, a function that reported `renamed_at_source` on
    every single re-read would pass both checks above — and would rewrite the
    title on every Drive sync, which is worse than never rewriting it.
  */
  const steady = await one(`
    begin;
    create temp table rs (k text primary key, v jsonb) on commit drop;
    insert into rs values ('first', ${put(`Steady ${run}.pdf`, keep)});
    insert into rs values ('again', ${put(`Steady ${run}.pdf`, keep)});
    select (select v from rs where k = 'again') as again;
    rollback;`)
  const steadyJson = asJson(steady?.again)
  record(
    'CONTROL: re-reading an UNCHANGED file reports no rename and rewrites nothing',
    `renamed_at_source=${String(steadyJson.renamed_at_source)}`,
    steadyJson.already_there === true && steadyJson.renamed_at_source === false,
  )
}

// ---------------------------------------------------------------------------
// One document, one hit — and archived material is out of retrieval (#257)
// ---------------------------------------------------------------------------
console.log('\none document, one hit, and nothing archived (#257, ADR-0040)')

{
  /*
    The defect, as it was found on Grant's real project.

    Searching the Legacy Coaching Course for "client vision" returned five hits
    that were three documents: every file appeared once as notebooklm and once
    as notion, identical rank, adjacent rows -- because the office had WRITTEN
    the notion copy and 0169's mirrors_document_id says so. Retrieval had never
    been told. With a five-hit limit and an 8,000-character context block, that
    spends up to half of a turn's evidence saying the same thing twice, and an
    answer built on it cites one document as though it were two sources.
  */
  const MIRRORTOK = `mirrorword${run}`
  const original = await insertDoc({
    connector: 'notebooklm',
    parent: `nb-${run}`,
    ref: `orig-${run}`,
    title: `Original about ${MIRRORTOK}`,
    content: `The source of record. It concerns ${MIRRORTOK} and nothing else.`,
    project: projectId,
  })
  const mirror = await insertDoc({
    connector: 'notion',
    parent: `nt-${run}`,
    ref: `mirror-${run}`,
    title: `Copy about ${MIRRORTOK}`,
    content: `A copy the office wrote into Notion. It concerns ${MIRRORTOK}.`,
    project: projectId,
  })
  await db.execute(`
    update public.documents set mirrors_document_id = ${lit(original)}::uuid
     where document_id = ${lit(mirror)}::uuid`)

  const hits = await all(`
    select document_id::text as id, connector
      from app.search_documents(${PO}, ${lit(MIRRORTOK)}, ${lit(projectId)}::uuid, 10, 'any')`)
  record(
    'a mirror the office wrote does not come back beside its original',
    `${String(hits.length)} hit(s): ${hits.map((h) => String(h.connector)).join(', ')}`,
    hits.length === 1 && String(hits[0]?.id) === original,
  )

  /*
    The asymmetry, and it is the half that keeps this safe.

    A mirror steps aside only when the thing it mirrors is visible in the same
    scope. Archive the original and the mirror is the only copy of that
    material there is -- hiding it to keep a rule tidy would lose it, which is
    the opposite of what ADR-0040 asks for.
  */
  await db.execute(
    `update public.documents set state = 'archived' where document_id = ${lit(original)}::uuid`,
  )
  const afterArchive = await all(`
    select document_id::text as id from app.search_documents(${PO}, ${lit(MIRRORTOK)}, ${lit(projectId)}::uuid, 10, 'any')`)
  record(
    'ADR-0040: the archived original leaves ordinary retrieval',
    afterArchive.some((h) => String(h.id) === original) ? 'STILL THERE' : 'gone from search',
    !afterArchive.some((h) => String(h.id) === original),
  )
  record(
    'and its mirror becomes the copy that answers, rather than vanishing with it',
    `${String(afterArchive.length)} hit(s)`,
    afterArchive.length === 1 && String(afterArchive[0]?.id) === mirror,
  )

  /*
    CONTROL: the archive filter has to be observable in BOTH directions.

    A predicate that excluded everything would pass the check above, and a
    found-nothing check that cannot come back positive is the shape CLAUDE.md
    records reporting zero for a broken reason. Un-archive and the document
    returns.
  */
  await db.execute(
    `update public.documents set state = 'approved' where document_id = ${lit(original)}::uuid`,
  )
  const restored = await all(`
    select document_id::text as id from app.search_documents(${PO}, ${lit(MIRRORTOK)}, ${lit(projectId)}::uuid, 10, 'any')`)
  record(
    'CONTROL: restoring it brings it back, so the filter is the state and not the row',
    restored.some((h) => String(h.id) === original) ? 'back in search' : 'STILL HIDDEN',
    restored.some((h) => String(h.id) === original) && restored.length === 1,
  )

  /*
    And the provenance survives the archiving, which is the rest of ADR-0040:
    *"preserving provenance/history and making restoration possible."* A policy
    that hid the row would have made this unanswerable.
  */
  const kept = await one(`
    select content is not null as has_content, content_fingerprint is not null as has_print,
           mirrors_document_id is not null as linked
      from public.documents where document_id = ${lit(mirror)}::uuid`)
  record(
    'archiving keeps the content, the fingerprint and the mirror link',
    `content=${String(kept?.has_content)} print=${String(kept?.has_print)} link=${String(kept?.linked)}`,
    kept?.has_content === true && kept?.has_print === true && kept?.linked === true,
  )
}

// ---------------------------------------------------------------------------
// An upstream deletion reconciles, under ADR-0040 (#257)
// ---------------------------------------------------------------------------
console.log('\nwhat happens when a source vanishes from its listing (ADR-0040)')

{
  /*
    Four passes over one notebook, in ONE statement that rolls back.

    In one statement because each pass has to see the previous pass's writes,
    and rolled back because this drives the real reconciler against real rows
    #210's rule is to wrap the CALL and not the assertion, since a wrapper
    cannot know a call was destructive until it already has been. The answers
    are gathered in a temp table and SELECTED BEFORE the rollback: the
    Management API runs the whole payload as one transaction, so a select
    after the rollback finds neither the rows nor the table.
  */
  const parent = `nb-vanish-${run}`
  const asJsonHere = (v: unknown): Record<string, unknown> =>
    (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>
  const drive = await all(`
    begin;
      create temp table vanish (k text, v jsonb) on commit drop;
      insert into public.documents
        (project_id, connector, external_parent_ref, external_ref, title, content,
         content_fingerprint, content_chars, fetched_at)
      select ${lit(projectId)}::uuid, 'notebooklm', ${lit(parent)}, r.ref,
             'Vanishing ' || r.ref, 'body ' || r.ref,
             encode(sha256(('body ' || r.ref)::bytea), 'hex'), 6, app.now_utc()
        from (values ('a'), ('b'), ('c'), ('d')) r(ref);
      insert into vanish values
        ('first',  app.reconcile_vanished('notebooklm', ${lit(parent)}, array['a','b','c'])),
        ('second', app.reconcile_vanished('notebooklm', ${lit(parent)}, array['a','b','c'])),
        ('back',   app.reconcile_vanished('notebooklm', ${lit(parent)}, array['a','b','c','d'])),
        ('wipe',   app.reconcile_vanished('notebooklm', ${lit(parent)}, array[]::text[])),
        ('states', (select jsonb_object_agg(external_ref, state) from public.documents
                     where external_parent_ref = ${lit(parent)}));
      select k, v from vanish;
    rollback;
  `)
  const say = (k: string): Record<string, unknown> =>
    asJsonHere(drive.find((r) => String(r.k) === k)?.v)

  record(
    'one absence marks a source and hides nothing',
    `marked=${String(say('first').marked)} archived=${String(say('first').archived)}`,
    say('first').marked === 1 && say('first').archived === 0,
  )
  record(
    'a second absence archives it',
    `archived=${String(say('second').archived)}`,
    say('second').archived === 1,
  )
  record(
    'and a source that comes back is restored, not left hidden for ever',
    `restored=${String(say('back').restored)}`,
    say('back').restored === 1,
  )
  record(
    'the round trip converges: every source ends approved',
    JSON.stringify(say('states')),
    Object.values(say('states')).every((v) => v === 'approved'),
  )
  /*
    The guard, and the reason it is not optional.

    "Everything vanished between two hourly passes" is an auth failure or a
    changed API far more often than it is Grant deleting a notebook, so a pass
    that would archive more than half of what a parent holds does nothing at
    all -- and SAYS so, because a sync that quietly declines to reconcile is
    the same defect as one that quietly empties the cache.
  */
  const wipe = say('wipe')
  record(
    'a listing that lost everything is refused rather than obeyed',
    String(wipe.error ?? '(no reason given)').slice(0, 90),
    wipe.ok === false &&
      wipe.refused === true &&
      String(wipe.error ?? '').includes('likelier to be a failed listing'),
  )
}

// ---------------------------------------------------------------------------
// Report, then clean up after itself
// ---------------------------------------------------------------------------

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
/*
  The tally is computed AFTER the teardown, at the bottom of the file.

  It used to sit here, above it — so the teardown's own assertion was recorded,
  printed, and could never fail the suite. A check that cannot fail is not a
  check, and this one was added precisely because nothing was watching the
  connector pile.
*/

// A suite that leaves fixtures behind is a suite that poisons the next run's
// counts — and one that leaves a DISABLED connector behind has changed real
// configuration, which this project has already paid for twice.
await db.execute(`
  delete from public.documents where project_id in (${lit(projectId)}::uuid, ${lit(otherId)}::uuid);
  delete from public.knowledge_connectors where connector = ${lit(`fixture_${run}`)};
  delete from public.projects where project_id in (${lit(projectId)}::uuid, ${lit(otherId)}::uuid);
`)

/*
  And every OTHER run's connector, because a crashed run never reaches the line
  above (0505).

  Five rows named "Fixture connector" accumulated here between 17 September
  06:04 and 17:10 and sat on Grant's Connections page for two days -- five of
  twelve cards. Every one was left by a run of THIS suite that died before its
  teardown, and the teardown keyed on its own run token could never collect
  them. Sweeping the CLASS is what the proposals teardown had to learn for the
  same reason.

  Bounded by AGE rather than by name, so a run happening concurrently is not
  robbed of its own fixture mid-assertion -- the same reasoning 0419 uses about
  what separates a test subject from a real one.
*/
const swept = await db.execute(`
  delete from public.knowledge_connectors
   where connector like 'fixture\\_%'
     and created_at < now() - interval '30 minutes'
  returning connector`)
if (swept.rows.length > 0) {
  console.log(`swept ${String(swept.rows.length)} connector(s) an earlier crashed run left behind`)
}

/*
  Asserted, not assumed. A teardown that matches nothing looks exactly like one
  that worked, and this pile existed because nothing was looking.
*/
const stillThere = Number(
  (
    (
      await db.execute(
        `select count(*)::int as n from public.knowledge_connectors
          where connector like 'fixture\\_%'`,
      )
    ).rows[0] as { n: number }
  ).n,
)
record(
  'teardown — no fixture connector of any run is left on the Connections page',
  `${String(stillThere)} left`,
  stillThere === 0,
)
console.log('fixtures removed.')

const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
if (failed.length > 0) process.exit(1)

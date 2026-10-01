/**
 * The Notion connector, checked against the live API.
 *
 *   npm run verify:notion
 *
 * ADR-0013 makes Notion the first-class knowledge connector, and the claims
 * that rest on are not "the client compiles". They are:
 *
 *   - the credential is real and resolves from the vault, not the environment;
 *   - §17's kill switch actually stops a sync rather than being decorative;
 *   - a page that has NOT been shared is refused by Notion, which is the
 *     permission model this connector depends on being real;
 *   - a synced document is a document like any other — searchable through the
 *     same function, and untouched when the route is closed.
 *
 * It creates one real page in Notion, syncs it, and deletes it. Real, because
 * the whole reason Notion is preferred over NotebookLM is that its API is one
 * we are allowed to use — and a suite that only ever talks to a mock proves
 * nothing about that.
 *
 * Skips rather than fails when nothing is shared with the integration: a
 * workspace where Grant has not yet added the connection is a normal state,
 * and reporting it as a failure would teach everyone to ignore this suite.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { NotionApiError, NotionClient } from '../../src/notion/api.ts'
import { CONNECTOR, listShared, pageText, syncNotion } from '../../src/notion/sync.ts'
import { officeOfProject } from '../test-office.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

// ---------------------------------------------------------------------------
// 1. The credential is in the vault, and it works
// ---------------------------------------------------------------------------

const token = String(
  (
    await one(
      `select app.resolve_secret(
         (select id from vault.secrets where name = 'notion.integration_token')::app.vault_secret_ref
       ) as t`,
    )
  )?.t ?? '',
)
record(
  'the integration token resolves from the vault (§15), not from the environment',
  token === '' ? 'absent' : `resolved, ${String(token.length)} chars`,
  token !== '',
)
if (token === '') process.exit(1)

const notion = new NotionClient(token)
const me = (await notion.call('/users/me')) as { name?: string; bot?: { workspace_name?: string } }
record(
  'the token authenticates against the real API',
  `bot=${String(me.name)} workspace=${String(me.bot?.workspace_name)}`,
  typeof me.name === 'string' && me.name !== '',
)

// The inverse. Without it, every check above would pass just as happily
// against a client that ignored its token entirely.
let badTokenKind = 'nothing was refused'
try {
  await new NotionClient('ntn_this_is_not_a_real_token').call('/users/me')
} catch (error) {
  badTokenKind = error instanceof NotionApiError ? error.kind : 'wrong error type'
}
record(
  'CONTROL: a wrong token is refused as an auth failure, not treated as fine',
  badTokenKind,
  badTokenKind === 'auth',
)

// ---------------------------------------------------------------------------
// 2. Only what a human shared
// ---------------------------------------------------------------------------

const shared = await listShared(notion)
record(
  'search returns exactly what has been shared with the integration',
  `${String(shared.length)} object(s)`,
  true, // Zero is a real answer; the check is that it returns without error.
)

let unsharedKind = 'nothing was refused'
try {
  // A syntactically valid id that this integration has certainly not been
  // given. Notion's permission model is the thing this connector leans on to
  // be safe to point at a personal workspace; unchecked, that is an assumption.
  await notion.call('/pages/00000000-0000-4000-8000-000000000000')
} catch (error) {
  unsharedKind = error instanceof NotionApiError ? error.code : 'wrong error type'
}
record(
  'a page that was never shared is refused — the permission model is real',
  unsharedKind,
  unsharedKind === 'object_not_found' || unsharedKind === 'restricted_resource',
)

// ---------------------------------------------------------------------------
// 3. A real round trip: create, sync, search, clean up
// ---------------------------------------------------------------------------

const project = await one(`
  with created as (
    insert into public.projects (slug, name, status)
    values (${lit(`fixture-notion-${run}`)}, ${lit(`Fixture: notion ${run}`)}, 'active')
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

const parent = shared.find((s) => s.object === 'page')
const MARKER = `xyzzy${run}`
let createdPageId: string | null = null

if (parent === undefined) {
  record(
    'a real page syncs into documents and becomes searchable',
    'SKIPPED: no page is shared with the integration yet, so there is nowhere to create one',
    true,
  )
} else {
  const created = (await notion.call('/pages', {
    method: 'POST',
    body: {
      parent: { page_id: parent.id },
      properties: { title: [{ text: { content: `Verification page ${run}` } }] },
      children: [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ text: { content: 'Findings' } }] },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: `The marker word is ${MARKER}.` } }] },
        },
      ],
    },
  })) as { id?: string }
  createdPageId = String(created.id)

  const text = await pageText(notion, {
    id: createdPageId,
    object: 'page',
    title: `Verification page ${run}`,
    lastEdited: null,
    url: null,
  })
  record(
    'a page is rendered to text with its structure intact',
    JSON.stringify(text),
    text === `## Findings\nThe marker word is ${MARKER}.`,
  )

  // Notion's search index is eventually consistent: a page created a second
  // ago is not in `/search` yet. The first version synced immediately, so the
  // new page was absent from the first pass and present in the second — which
  // reported `added=1` and failed the idempotence check below for a reason that
  // had nothing to do with fingerprints.
  //
  // So wait for the page to be visible, and only then test that syncing twice
  // does the same thing twice.
  let indexed = false
  for (let attempt = 0; attempt < 12 && !indexed; attempt += 1) {
    const seen = await listShared(notion)
    indexed = seen.some((o) => o.id === createdPageId)
    if (!indexed) await new Promise((r) => setTimeout(r, 2500))
  }
  record(
    'a page just created becomes visible to the integration',
    indexed ? 'in /search' : 'still not indexed after 30s',
    indexed,
  )

  const first = await syncNotion(db, await officeOfProject(db, projectId), notion, projectId)
  record(
    'the sync stores what is shared',
    `shared=${String(first.shared)} added=${String(first.added)} changed=${String(first.changed)} skipped=${String(first.skipped.length)}`,
    first.added >= 1,
  )

  const second = await syncNotion(db, await officeOfProject(db, projectId), notion, projectId)
  // Asserted on the ROWS, not on `added`.
  //
  // `added === 0` was the obvious assertion and it is sensitive to something
  // that has nothing to do with fingerprints: `/search` is eventually
  // consistent across every shared page, not only the one this suite just
  // made, so any page whose index lands between the two syncs is a legitimate
  // `added=1` and a red check. The wait loop above only waits for OUR page.
  //
  // The property actually being tested is that a page already stored is not
  // stored again. That is a statement about `documents`, and it is exact:
  // no `external_ref` twice, and nothing already held rewritten.
  const duplicated = await one(`
    select count(*)::int as n from (
      select external_ref from public.documents
       where project_id = ${lit(projectId)}::uuid and connector = ${lit(CONNECTOR)}
       group by external_ref having count(*) > 1
    ) d
  `)
  record(
    'syncing again changes nothing — a fingerprint, not a timestamp, decides',
    `changed=${String(second.changed)} unchanged=${String(second.unchanged)}; ` +
      `${String(duplicated?.n)} duplicated ref(s)`,
    second.changed === 0 && second.unchanged >= 1 && Number(duplicated?.n) === 0,
  )

  const hits = (
    await db.execute(`select * from app.search_documents(${PO}, ${lit(MARKER)}, null, 10)`)
  ).rows as { connector: string }[]
  record(
    'a Notion document is searchable through the same function as every other',
    `${String(hits.length)} hit(s), connector=${String(hits[0]?.connector)}`,
    hits.length === 1 && hits[0]?.connector === CONNECTOR,
  )

  // §17, and the property the 2026-09-04 ban actually tested.
  await db.execute(`
    update public.knowledge_connectors
       set enabled = false, disabled_reason = 'verification: the route is closed'
     where connector = ${lit(CONNECTOR)}
  `)
  const whileOff = (
    await db.execute(`select * from app.search_documents(${PO}, ${lit(MARKER)}, null, 10)`)
  ).rows
  record(
    'closing the Notion route does not lose what it already brought in (§17)',
    `${String(whileOff.length)} hit(s) with the connector disabled`,
    whileOff.length === 1,
  )
  // Restored immediately: a check that changes real configuration must put it
  // back, and this project has paid for forgetting that twice.
  await db.execute(`
    update public.knowledge_connectors set enabled = true, disabled_reason = null
     where connector = ${lit(CONNECTOR)}
  `)
  const restored = await one(
    `select enabled from public.knowledge_connectors where connector = ${lit(CONNECTOR)}`,
  )
  record(
    'and the route is left open, exactly as it was found',
    `enabled=${String(restored?.enabled)}`,
    restored?.enabled === true,
  )
}

// ---------------------------------------------------------------------------
// Report, then clean up on both sides
// ---------------------------------------------------------------------------

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)

if (createdPageId !== null) {
  // Notion has no delete; archiving is what the UI's "delete" does.
  // `in_trash`, not `archived`. At 2026-03-11 Notion rejects the old property
  // outright — "body.archived should be not present" — rather than ignoring it,
  // so an archive written the 2022 way fails loudly. Confirmed live.
  await notion.call(`/pages/${createdPageId}`, { method: 'PATCH', body: { in_trash: true } })
  console.log('verification page archived in Notion.')
}

/*
  And every OLDER one that is still shared (#178).

  Three pages from runs on 11 September were still live in the workspace, and
  they were not merely litter: `upsertDocument`'s conflict clause sets
  `project_id = excluded.project_id`, so every nightly `duty:notion-sync`
  picked them up and MOVED them onto Legacy Coaching Course — a real dashboard
  project. The suite tore down its own project and the documents walked out of
  it first. Deleting the rows fixes nothing while the pages are still shared;
  they come back the next night.

  So the teardown stopped being about this run. A suite that cleans up only
  what it made this time leaves a pile that grows by one every run and never
  shrinks — CLAUDE.md records that shape three times over, in archived
  projects, in Slack channels and in queued jobs.

  Searched by title rather than by a list of ids, because the ids of the runs
  that already leaked are not written down anywhere. `search` only returns
  pages the integration can see, which is exactly the set that can be synced.
*/
const strays = (await notion.call('/search', {
  method: 'POST',
  body: {
    query: 'Verification page',
    filter: { property: 'object', value: 'page' },
    page_size: 50,
  },
})) as { results?: { id: string; in_trash?: boolean; properties?: unknown }[] }

let archived = 0
for (const page of strays.results ?? []) {
  if (page.id === createdPageId || page.in_trash === true) continue
  const title = JSON.stringify(page.properties ?? {})
  // The search is a fuzzy one, so the title is checked before anything is
  // archived: a page of Grant's that merely mentions the phrase must not be
  // touched by a test suite's teardown.
  if (!/Verification page [a-z0-9]{6,}/.test(title)) continue
  const done = await notion
    .call(`/pages/${page.id}`, { method: 'PATCH', body: { in_trash: true } })
    .then(() => true)
    .catch(() => false)
  if (done) archived += 1
}
console.log(
  archived === 0
    ? 'no older verification pages were still shared.'
    : `${String(archived)} older verification page(s) archived — they were syncing into a real project (#178).`,
)
await db.execute(`
  delete from public.documents where project_id = ${lit(projectId)}::uuid;
  delete from public.projects where project_id = ${lit(projectId)}::uuid;
`)
console.log('fixtures removed.')

if (failed.length > 0) process.exit(1)

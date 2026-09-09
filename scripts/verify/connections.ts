/**
 * What each project is connected to, and what it is deliberately not.
 *
 *   npm run verify:connections
 *
 * Grant, §3: *"If a project exists in Supabase but has no corresponding
 * Notebook or Notion counterpart, this should be visible and repairable."* And,
 * immediately after: *"Do not automatically create duplicates simply because a
 * connection is currently missing."*
 *
 * Those two sentences pull in opposite directions unless the system can hold a
 * fourth state — deliberately disconnected — and most of the checks below exist
 * to prove it holds all of them apart:
 *
 *     connected   an enabled attachment
 *     broken      an attachment whose service is not answering
 *     wanted      he means to, and has not
 *     declined    he has decided against it, and should stop being asked
 *     missing     nobody has considered it
 *
 * The interesting failures are between the middle three. `declined` collapsing
 * into `missing` means the interface nags forever about a decision he already
 * made; `broken` collapsing into `connected` means a dead credential looks
 * healthy; `broken` collapsing into `missing` means he is told to connect
 * something that is already connected.
 *
 * ## Fixtures
 *
 * One project, archived at the end. It borrows the real connectors rather than
 * inventing one, because the whole point is the list of connectors a project
 * COULD have, and a fixture connector would not be in it.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${what} — ${outcome}`)
}

// ===========================================================================
// A project with nothing attached
// ===========================================================================

const made = (
  await one(
    `select app.hq_create_project(${lit(`Fixture connections ${run}`)}, 'upload', ${lit(`ref-${run}`)}, null, true) as r`,
  )
)?.r as { project_id?: string; slug?: string }
const projectId = String(made?.project_id ?? '')
// Read back, not assumed. The first version of this file guessed the slug from
// the run id, but the slug is derived from the NAME — so every call taking a
// slug failed with "no such project", and one of them PASSED on that failure
// because it only asserted that AN error came back. A check that accepts any
// error accepts the wrong one.
const slug = String(made?.slug ?? '')
record(
  'a fixture project exists to ask about',
  `${slug} (${projectId.slice(0, 8)})`,
  projectId !== '' && slug !== '',
)
if (projectId === '' || slug === '') process.exit(1)

const connectionsFor = async (id: string): Promise<Record<string, unknown>[]> =>
  all(
    `select connector, state, coalesce(detail,'') detail from app.project_connections(${lit(id)}::uuid)`,
  )

const stateOf = (rows: Record<string, unknown>[], connector: string): string =>
  String(rows.find((r) => r.connector === connector)?.state ?? 'ABSENT FROM THE LIST')

{
  const rows = await connectionsFor(projectId)

  // The row that matters most is the one for a connector the project has never
  // heard of — that is the whole of §3.
  record(
    'a connector the project has never used is still listed, as missing',
    `notion=${stateOf(rows, 'notion')}, github=${stateOf(rows, 'github')}`,
    stateOf(rows, 'notion') === 'missing' && stateOf(rows, 'github') === 'missing',
  )

  // `upload` and `mcp` are how a document arrives, not somewhere a project
  // lives. Listing them as "missing" would be telling Grant to go and connect
  // something that is not a place.
  record(
    'and the ways a document merely arrives are not listed as places to connect',
    rows.map((r) => String(r.connector)).join(', '),
    !rows.some((r) => r.connector === 'upload' || r.connector === 'mcp'),
  )
}

// ===========================================================================
// Deliberately disconnected
// ===========================================================================

{
  const declined = (
    await one(`
    select app.hq_connection_choose(${lit(slug)}, 'notion', 'declined',
      'this one lives entirely in the notebook') as r
  `)
  )?.r as { ok?: boolean; error?: string }
  record(
    'a connector can be deliberately declined',
    declined?.ok === true ? 'recorded' : String(declined?.error),
    declined?.ok === true,
  )

  const rows = await connectionsFor(projectId)
  const notion = rows.find((r) => r.connector === 'notion')
  record(
    'and it stops reading as missing',
    `${String(notion?.state)} — ${String(notion?.detail)}`,
    notion?.state === 'declined',
  )
  // The reason is the point. "Declined" with no reason is indistinguishable
  // from a mis-click six months later.
  record(
    'and it carries the reason he gave',
    String(notion?.detail),
    String(notion?.detail).includes('notebook'),
  )
}

// ===========================================================================
// Meaning to, and not having
// ===========================================================================

{
  await db.execute(
    `select app.hq_connection_choose(${lit(slug)}, 'github', 'wanted', 'once the repo is public')`,
  )
  const rows = await connectionsFor(projectId)
  record(
    'a connector he means to add reads differently from one he has not considered',
    `github=${stateOf(rows, 'github')}, notion=${stateOf(rows, 'notion')}`,
    stateOf(rows, 'github') === 'wanted' && stateOf(rows, 'notion') === 'declined',
  )

  // Ordering is not cosmetic here: a list sorted by name buries the one row
  // that needs doing.
  const order = rows.map((r) => String(r.state))
  record(
    'and what needs doing sorts above what does not',
    order.join(' < '),
    order.indexOf('wanted') < order.indexOf('declined'),
  )
}

// ===========================================================================
// Changing his mind
// ===========================================================================

{
  await db.execute(`select app.hq_connection_choose(${lit(slug)}, 'notion', 'clear')`)
  const rows = await connectionsFor(projectId)
  record(
    'clearing a decision returns it to never-considered, not to a third state',
    stateOf(rows, 'notion'),
    stateOf(rows, 'notion') === 'missing',
  )
}

// ===========================================================================
// Connected, and what that must not be confusable with
// ===========================================================================

{
  await db.execute(`
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, role)
    values (${lit(projectId)}::uuid, 'notebooklm', ${lit(`nb-${run}`)},
            ${lit(`Fixture notebook ${run}`)}, 'source')
  `)
  const rows = await connectionsFor(projectId)
  const nb = rows.find((r) => r.connector === 'notebooklm')

  // Google's health is whatever it is today. Both answers are correct — what
  // must not happen is `missing`, which would be telling him to attach a
  // notebook that is already attached.
  const acceptable = nb?.state === 'connected' || nb?.state === 'broken'
  record(
    'an attached connector reads as connected (or broken), never as missing',
    `${String(nb?.state)} — ${String(nb?.detail)}`,
    acceptable,
  )

  // Declining something already attached is a contradiction, and the function
  // refuses rather than storing both facts.
  const contradiction = (
    await one(`select app.hq_connection_choose(${lit(slug)}, 'notebooklm', 'declined') as r`)
  )?.r as { error?: string }
  record(
    'and it cannot also be marked as not wanted',
    contradiction?.error === undefined
      ? 'it was allowed'
      : String(contradiction.error).slice(0, 60),
    // Asserting WHICH refusal, not merely that one happened — "no such project"
    // is also an error and would sail straight through a looser check.
    String(contradiction?.error ?? '').includes('already attached'),
  )
}

// ===========================================================================
// Broken is a real state, not a theory
// ===========================================================================
//
// Forced, because waiting for a credential to actually die is not a test. The
// health row is restored immediately afterwards.

{
  const before = await one(
    `select state from public.connection_health where service = 'Google' order by checked_at desc limit 1`,
  )
  await db.execute(`
    insert into public.connection_health (service, credential, state, detail, owner, action, checked_at)
    values ('Google', ${lit(`verify-connections-${run}`)}, 'dead',
            'forced by verify:connections', 'verify', 'ignore', app.now_utc())
  `)
  const rows = await connectionsFor(projectId)
  const nb = rows.find((r) => r.connector === 'notebooklm')
  record(
    'a connected attachment whose service is down reads as broken, not connected',
    `${String(nb?.state)} — ${String(nb?.detail).slice(0, 50)}`,
    nb?.state === 'broken',
  )
  record(
    'and it says which service is not answering',
    String(nb?.detail).slice(0, 60),
    String(nb?.detail).toLowerCase().includes('not answering'),
  )
  await db.execute(
    `delete from public.connection_health where credential = ${lit(`verify-connections-${run}`)}`,
  )
  const after = await connectionsFor(projectId)
  record(
    'and it recovers when the service does',
    `${String(before?.state ?? 'unknown')} → ${stateOf(after, 'notebooklm')}`,
    stateOf(after, 'notebooklm') !== 'broken',
  )
}

// ===========================================================================
// The page can see all of it
// ===========================================================================

{
  const payload = (await one(`select app.hq_projects() as d`))?.d as
    | { slug: string; connections?: unknown[] }[]
    | undefined
  const mine = (payload ?? []).find((p) => p.slug === slug)
  record(
    'and the dashboard payload carries the connections, not just the attachments',
    mine === undefined
      ? 'the project is not in the payload'
      : `${String(mine.connections?.length ?? 0)} connector(s) reported`,
    (mine?.connections?.length ?? 0) > 0,
  )
}

// ===========================================================================
// Tidy up
// ===========================================================================

await db.execute(`
  update public.projects set status = 'archived', updated_at = app.now_utc()
   where slug = ${lit(slug)}
`)

const passed = checks.filter((c) => c.passed).length
console.log(`\n| check | outcome | |`)
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? 'yes' : 'NO'} |`)
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)

process.exit(passed === checks.length ? 0 : 1)

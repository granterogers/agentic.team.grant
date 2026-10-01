/**
 * Does the asset model and its graph actually work?
 *
 *   npm run verify:assets
 *
 * Drives migrations 0175 and 0176 against the real database. Everything is
 * created on a fixture project and cascaded away at the end.
 *
 * The interesting checks are the ones that assert a REFUSAL. An edge table with
 * a polymorphic target has no foreign key to enforce anything, so the promises
 * this model makes — that you cannot link to a thing that does not exist, that
 * only something the team MADE can sit in review — live in a constraint and a
 * function rather than in the schema's shape. Untested, they are comments.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const refuses = async (what: string, sql: string) => {
  try {
    await db.execute(sql)
    ok(what, false, 'it was allowed')
  } catch {
    ok(what, true)
  }
}
const one = async (sql: string): Promise<Record<string, unknown>> => {
  const { rows } = await db.execute(sql)
  return (rows as Record<string, unknown>[])[0] ?? {}
}

/*
  Clear the fixture BEFORE the run, not only after.

  A previous run failed in its cleanup and left documents behind, so the next
  run's "an asset is findable by tag" found two and asserted one. A test that
  only tidies up afterwards passes or fails depending on how the LAST run ended,
  which is the least useful property a test can have.
*/
await db.execute(`
  delete from public.documents
   where project_id in (select project_id from public.projects where slug = 'verify-assets-fixture')
`)
await db.execute(`delete from public.projects where slug = 'verify-assets-fixture'`)

const proj = await one(`
  insert into public.projects (slug, name, purpose, status)
  values ('verify-assets-fixture', 'Asset verification', 'Thrown away', 'paused')
  on conflict (office_id, slug) do update set name = excluded.name
  returning project_id
`)
const pid = String(proj.project_id)

console.log('assets —')

// --- origin and state --------------------------------------------------------
const mine = await one(`
  insert into public.documents (project_id, title, doc_type, added_by, origin)
  values ('${pid}'::uuid, 'A thing Grant uploaded', 'pdf', 'grant', 'yours')
  returning document_id
`)
const made = await one(`
  insert into public.documents (project_id, title, doc_type, added_by, origin, state, produced_by)
  values ('${pid}'::uuid, 'Course one-pager', 'pdf', 'communications-director',
          'made', 'review', 'communications-director')
  returning document_id
`)
const mineId = String(mine.document_id)
const madeId = String(made.document_id)
ok('a document can be marked as something the team made', madeId !== 'undefined')

/*
  The invariant the whole Made workspace rests on. Without it, `state` drifts
  into meaning "unread" and the review gate stops meaning anything.
*/
await refuses(
  'only something the team MADE can sit in review',
  `update public.documents set state = 'review' where document_id = '${mineId}'::uuid`,
)
await refuses(
  'an unknown origin is refused',
  `update public.documents set origin = 'somewhere' where document_id = '${mineId}'::uuid`,
)

// --- collections, and the same asset in two of them --------------------------
await db.execute(`select public.put_in_collection('${mineId}'::uuid, 'Research')`)
await db.execute(`select public.put_in_collection('${mineId}'::uuid, 'For the 16 Sep interviews')`)
const cols = await one(`
  select count(*)::int as n from public.document_collections where document_id = '${mineId}'::uuid
`)
ok('one asset lives in two collections without being duplicated', Number(cols.n) === 2)

const copies = await one(`
  select count(*)::int as n from public.documents where document_id = '${mineId}'::uuid
`)
ok('and there is still only one of it', Number(copies.n) === 1)

await db.execute(`select public.put_in_collection('${mineId}'::uuid, 'Research')`)
const again = await one(`
  select count(*)::int as n from public.document_collections where document_id = '${mineId}'::uuid
`)
ok('adding it to the same collection twice is not two facts', Number(again.n) === 2)

// --- the graph ---------------------------------------------------------------
const task = await one(`
  select public.add_task('${pid}'::uuid, 'Send the outline', '', null, 'verify:assets') as id
`)
const tid = String(task.id)

await db.execute(`
  select public.link('${pid}'::uuid, 'document', '${madeId}'::uuid,
                     'derived_from', 'document', '${mineId}'::uuid, 'verify:assets')
`)
await db.execute(`
  select public.link('${pid}'::uuid, 'document', '${madeId}'::uuid,
                     'attached_to', 'task', '${tid}'::uuid, 'verify:assets')
`)

const { rows: out } = await db.execute(
  `select * from public.relations_of('document', '${madeId}'::uuid)`,
)
/*
  The two edges BY NAME, not a count of two.

  This asserted `length === 2` and went red on a correct change: 0310 made
  `relations_of` derive the edges a column already holds, so the same document
  — which this suite put in a collection twenty lines above — correctly gained
  a third, `attached_to collection`. A count is a moving target the moment the
  graph learns to see more, which is the direction it is supposed to move in.

  Same correction as the one CLAUDE.md records for the index asserted by name:
  assert the property, not the artefact that currently satisfies it.
*/
const verbs = (out as { verb: string; other_kind: string }[]).map(
  (r) => `${r.verb}->${r.other_kind}`,
)
ok(
  'an asset can see what it came from and what it is attached to',
  verbs.includes('derived_from->document') && verbs.includes('attached_to->task'),
  verbs.join(', '),
)

/*
  Both directions from one edge. "What did this come from" and "what came out of
  this" are the same row read from opposite ends — if that is not true, the
  graph is thirteen foreign keys wearing a costume.
*/
const { rows: back } = await db.execute(
  `select * from public.relations_of('document', '${mineId}'::uuid)`,
)
const inbound = (back as { direction: string; other_title: string }[]).filter(
  (r) => r.direction === 'in',
)
ok(
  'the same edge is readable from the other end',
  inbound.length === 1,
  `got ${String(inbound.length)}`,
)
ok(
  'and it resolves the other end to a title',
  inbound[0]?.other_title === 'Course one-pager',
  `got ${String(inbound[0]?.other_title)}`,
)

const { rows: fromTask } = await db.execute(
  `select * from public.relations_of('task', '${tid}'::uuid)`,
)
ok('a task can see the documents attached to it', (fromTask as unknown[]).length === 1)

await refuses(
  'linking to something that does not exist is refused',
  `select public.link('${pid}'::uuid, 'document', '${madeId}'::uuid, 'about',
                      'task', '00000000-0000-0000-0000-000000000000'::uuid)`,
)
await refuses(
  'an untyped verb is refused',
  `insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id)
   values ('${pid}'::uuid, 'document', '${madeId}'::uuid, 'vibes', 'task', '${tid}'::uuid)`,
)

const twice = await one(`
  select public.link('${pid}'::uuid, 'document', '${madeId}'::uuid,
                     'derived_from', 'document', '${mineId}'::uuid, 'verify:assets') as id
`)
ok('the same edge asserted twice stays one row', typeof twice.id === 'string')
const edges = await one(`
  select count(*)::int as n from public.relations where project_id = '${pid}'::uuid
`)
ok('…confirmed by counting', Number(edges.n) === 2, `got ${String(edges.n)}`)

// --- the Made workspace ------------------------------------------------------
const { rows: waiting } = await db.execute(`select * from public.awaiting_review('${pid}'::uuid)`)
ok('awaiting_review finds the artifact', (waiting as unknown[]).length === 1)
const w = (waiting as { derived_from: string[] }[])[0]
ok(
  'and reports what it was derived from',
  Array.isArray(w?.derived_from) && w.derived_from.includes('A thing Grant uploaded'),
  JSON.stringify(w?.derived_from),
)

await db.execute(`
  select public.approve_document('${madeId}'::uuid, 'Planning',
                                 array['outline','client-facing'], '${tid}'::uuid)
`)
const approved = await one(`
  select state, tags from public.documents where document_id = '${madeId}'::uuid
`)
ok('approving moves it out of review', approved.state === 'approved')
ok(
  'approving applies the tags chosen at import',
  JSON.stringify(approved.tags).includes('outline'),
  JSON.stringify(approved.tags),
)
const inPlanning = await one(`
  select count(*)::int as n from public.document_collections dc
    join public.collections c on c.collection_id = dc.collection_id
   where dc.document_id = '${madeId}'::uuid and c.name = 'Planning'
`)
ok('approving files it in the collection chosen at import', Number(inPlanning.n) === 1)

const { rows: nowEmpty } = await db.execute(`select * from public.awaiting_review('${pid}'::uuid)`)
ok('and it leaves the in-tray', (nowEmpty as unknown[]).length === 0)

// --- tags --------------------------------------------------------------------
const { rows: tagged } = await db.execute(`
  select title from public.documents
   where project_id = '${pid}'::uuid and tags @> array['outline']
`)
ok('an asset is findable by tag', (tagged as unknown[]).length === 1)

/*
  --- clean up ----------------------------------------------------------------

  Documents are deleted explicitly, and that is a finding rather than tidiness.

  `documents.project_id` carries no ON DELETE action — the constraint is still
  named `notebook_sources_project_id_fkey`, from before documents were called
  documents — so deleting a project that has any is simply REFUSED. Tasks,
  collections and relations all cascade, so the same delete half-works depending
  on which tables a project happens to have rows in. Filed; not changed here,
  because whether deleting a project should destroy its documents is a decision
  about Grant's data, not a tidy-up.
*/
await db.execute(`delete from public.documents where project_id = '${pid}'::uuid`)
await db.execute(`delete from public.projects where slug = 'verify-assets-fixture'`)
const left = await one(`
  select (select count(*) from public.documents where project_id = '${pid}'::uuid)
       + (select count(*) from public.relations where project_id = '${pid}'::uuid)
       + (select count(*) from public.collections where project_id = '${pid}'::uuid) as n
`)
ok('nothing is left behind afterwards', Number(left.n) === 0, `${String(left.n)} left`)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)

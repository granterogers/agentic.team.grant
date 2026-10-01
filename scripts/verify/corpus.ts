/**
 * What belongs in the corpus, and what only looks like it does.
 *
 *   npm run verify:corpus
 *
 * Issues #19 and #20, migration 0283.
 *
 * ## The two things that were in there and should not have been
 *
 * `duty:notion-sync` stores everything `/search` hands it. Two of those things
 * are not source material:
 *
 *   * **The containers (#19).** Legacy Coaching Course is attached to three
 *     Notion databases — Projects, Tasks and Docs — and `pageText` renders a
 *     database as a bulleted list of its rows' titles. Three rows of index
 *     went into the corpus, matching a search for any row title and landing the
 *     reader on a list instead of a page.
 *   * **The office's own output (#20).** `office.notion_import` authored six
 *     module pages into the Projects database. The sync read them straight back
 *     and counted them as material Grant supplied.
 *
 * ## Why this suite exists rather than a one-off fix
 *
 * Both are re-creatable by the next sync. Deleting the nine rows fixes today
 * and nothing else — the whole point of #19's acceptance criterion is *"a
 * re-sync does not reintroduce them"*, which is a statement about the code path
 * and can only be checked by running it.
 *
 * So the sync is driven here against a stub Notion that returns exactly the
 * shapes that caused the bug, and the assertions are on what reaches the table.
 * A stub rather than the live workspace deliberately: this has to be able to
 * present a container and an authored page on demand, and `verify:notion`
 * already covers the live round trip.
 *
 * ## And each property is proved by reintroducing the bug
 *
 * A check that passes because it is looking at nothing passes for the wrong
 * reason — this repository has three instances of that in one day. So every
 * invariant here is first shown to FAIL against a row deliberately written in
 * the broken shape, and only then shown to hold.
 */

import { ManagementApiExecutor, SqlExecutionError } from '../../src/db/executor.ts'
import type { NotionClient } from '../../src/notion/api.ts'
import { registerAuthored, syncNotion, upsertDocument } from '../../src/notion/sync.ts'
import { officeOfProject } from '../test-office.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
/** The office a project belongs to, as SQL: every reader of a project's documents is asked of one office. */
const officeSqlOf = (projectId: string): string =>
  `(select office_id from public.projects where project_id = ${lit(projectId)}::uuid)`

const run = Math.random().toString(36).slice(2, 10)
const slug = `fixture-corpus-${run}`

/*
  A fixture-named subject, which is correct HERE and would be wrong in a suite
  testing something that filters fixtures (#45). Nothing in this path looks at
  `is_fixture`, so `purge:fixtures` can collect it and the teardown below is a
  belt as well as braces.
*/
const CONTAINER = `1f000000-0000-4000-8000-${run.padEnd(12, '0').slice(0, 12)}`
const PAGE_IN_IT = `1f000000-0000-4000-8001-${run.padEnd(12, '0').slice(0, 12)}`
const AUTHORED = `1f000000-0000-4000-8002-${run.padEnd(12, '0').slice(0, 12)}`

/**
 * Notion, reduced to the two calls the sync makes.
 *
 * `/search` lists what has been shared; `/data_sources/:id/query` reads a
 * container's rows. The stub returns a container, a page inside it, and a page
 * the office authored — which is exactly the set that produced both issues.
 */
const stubNotion = {
  // eslint-disable-next-line @typescript-eslint/require-await
  async *paginate(endpoint: string): AsyncGenerator<Record<string, unknown>> {
    if (endpoint === '/search') {
      yield { id: CONTAINER, object: 'data_source', title: [{ plain_text: 'Docs' }] }
      yield { id: PAGE_IN_IT, object: 'page', properties: {} }
      yield { id: AUTHORED, object: 'page', properties: {} }
      return
    }
    if (endpoint.startsWith(`/data_sources/${CONTAINER}/query`)) {
      yield { id: PAGE_IN_IT, properties: {} }
      yield { id: AUTHORED, properties: {} }
      return
    }
    // A page's blocks. One paragraph each, so neither is skipped as empty.
    if (endpoint.startsWith('/blocks/')) {
      const which = endpoint.includes(AUTHORED) ? 'A module the office wrote.' : 'Real material.'
      yield {
        id: `${run}-b`,
        type: 'paragraph',
        has_children: false,
        paragraph: { rich_text: [{ plain_text: which }] },
      }
      return
    }
  },
} as unknown as NotionClient

let projectId = ''

async function setUp(): Promise<void> {
  projectId = String(
    (
      await one(`
        insert into public.projects (name, slug, status)
        values ('Fixture corpus ${run}', ${lit(slug)}, 'paused')
        returning project_id
      `)
    ).project_id,
  )
  /*
    ADR-0014: an ACTIVE project must hold an enabled attachment, and the trigger
    fires on the projects insert — so the subject starts paused and the
    attachment comes second. That attachment is also the container #19 is
    about, which is the whole point of the fixture.

    It stays paused: nothing here reads status, and a paused subject cannot
    appear in Grant's project switcher for the seconds it exists.
  */
  await db.execute(`
    insert into public.project_attachments
      (project_id, connector, external_ref, display_name, enabled, role, artifact_kind)
    values (${lit(projectId)}::uuid, 'notion', ${lit(CONTAINER)}, 'Docs', true, 'home', 'document')
  `)
}

async function tearDown(): Promise<void> {
  await db.execute(`delete from public.documents where project_id = ${lit(projectId)}::uuid`)
  const said = (await one(`select public.project_delete(${lit(slug)}) as r`)).r as {
    ok?: boolean
    error?: string
  }
  // "A teardown that matches nothing looks exactly like one that worked."
  const left = Number(
    (await one(`select count(*)::int as n from public.projects where slug = ${lit(slug)}`)).n,
  )
  check('teardown', said.ok === true ? 'the subject is gone' : String(said.error), left === 0)
}

// ---------------------------------------------------------------------------

console.log(`\nverify:corpus — ${slug}\n`)
await setUp()

try {
  // --- #19: the container is the attachment, not a document ----------------
  console.log('a container is not a document (#19)')

  const refs = (
    await db.execute(
      `select external_ref from app.container_refs(${officeSqlOf(projectId)},${lit(projectId)}::uuid, 'notion')`,
    )
  ).rows.map((r) => String(r.external_ref))
  check(
    'container_refs',
    `${String(refs.length)} ref(s), the attachment among them`,
    refs.length === 1 && refs[0] === CONTAINER,
  )

  /*
    Reintroduce the bug first. If the invariant below cannot see a container row
    that IS there, it proves nothing when it later sees none.
  */
  await db.execute(`
    insert into public.documents
      (project_id, connector, external_parent_ref, external_ref, title, doc_type,
       content, content_fingerprint, content_chars, fetched_at)
    values (${lit(projectId)}::uuid, 'notion', 'database', ${lit(CONTAINER)}, 'Docs', 'database',
            '# Docs' || chr(10) || '- a row', repeat('a', 64), 14, app.now_utc())
  `)
  /*
    Scoped to the subject, and separately across everything.

    One query served both questions and they are not the same question. "Did
    the sync I just ran store a container" is about THIS project; "does the
    corpus hold any" is about all of them. Written as one global count, three
    real container rows elsewhere made the two scoped checks fail as well —
    reporting a sync that had correctly skipped its container as a sync that
    had stored one.

    The global check stays, because it is the one that found those rows.
  */
  const strays = async (where = `and d.project_id = ${lit(projectId)}::uuid`): Promise<number> =>
    Number(
      (
        await one(`
          select count(*)::int as n
            from public.documents d
            join public.project_attachments a
              on a.project_id = d.project_id and a.connector = d.connector
             and a.external_ref = d.external_ref
           where true ${where}
        `)
      ).n,
    )
  check(
    'the invariant can see a container row',
    'planted one and it was found',
    (await strays()) > 0,
  )

  await db.execute(`
    delete from public.documents
     where project_id = ${lit(projectId)}::uuid and external_ref = ${lit(CONTAINER)}
  `)

  // Now the real thing: a full sync over a workspace containing a container.
  const first = await syncNotion(db, await officeOfProject(db, projectId), stubNotion, projectId)
  check(
    'a sync skips the container',
    `${String(first.shared)} shared, ${String(first.added)} added, skipped: ${first.skipped.join('; ') || 'nothing'}`,
    first.added === 2 && first.skipped.some((s) => s.endsWith(': container')),
  )
  check(
    'nothing stored for the container',
    'no document is its own attachment',
    (await strays()) === 0,
  )

  // #19's acceptance criterion, stated as it is written: a RE-sync.
  const second = await syncNotion(db, await officeOfProject(db, projectId), stubNotion, projectId)
  check(
    'a re-sync does not reintroduce it',
    `${String(second.added)} added, ${String(second.unchanged)} unchanged`,
    second.added === 0 && (await strays()) === 0,
  )

  // And across the whole corpus, not only this fixture — the three real rows
  // #19 named are gone and no other project has grown one.
  // The global one, which is the check that found three real container rows
  // that `duty:notion-sync` had recreated fifteen minutes after 0283 deleted
  // them, from a worker deployed before 0283 existed.
  const everywhere = await strays('')
  check(
    'the real corpus holds none either',
    everywhere === 0
      ? 'across every project'
      : `${String(everywhere)} container row(s) stored as documents`,
    everywhere === 0,
  )

  // --- #20: a page the office wrote is its output --------------------------
  console.log('\na page the office wrote is not source material (#20)')

  const originOf = async (ref: string): Promise<string> =>
    String(
      (
        await one(
          `select origin || '/' || coalesce(produced_by, '-') as o from public.documents
            where project_id = ${lit(projectId)}::uuid and external_ref = ${lit(ref)}`,
        )
      ).o ?? 'missing',
    )

  const before = await originOf(AUTHORED)
  check('a synced page starts as source', before, before.startsWith('source/'))

  await registerAuthored(
    db,
    projectId,
    { id: AUTHORED, title: 'A module' },
    'A module the office wrote.',
    'office.notion_import',
  )
  const registered = await originOf(AUTHORED)
  check(
    'registering it makes it the office’s own work',
    registered,
    registered === 'made/office.notion_import',
  )

  /*
    The property that would silently regress. The sync owns the content and the
    writer owns the provenance, so an upsert that changes the text must not
    change who made it — otherwise one edit in Notion turns the office's output
    back into Grant's source material and nothing announces it.
  */
  await upsertDocument(
    db,
    projectId,
    { id: AUTHORED, object: 'page', title: 'A module', lastEdited: null, url: null },
    'A module the office wrote, edited.',
  )
  const afterUpsert = await originOf(AUTHORED)
  check('a later sync does not revert it', afterUpsert, afterUpsert === 'made/office.notion_import')

  // A whole pass, not just one upsert — this is what actually runs nightly.
  const third = await syncNotion(db, await officeOfProject(db, projectId), stubNotion, projectId)
  check(
    'nor does a whole pass',
    `${await originOf(AUTHORED)} after ${String(third.changed)} changed`,
    (await originOf(AUTHORED)) === 'made/office.notion_import',
  )

  // --- the constraint that had to move to allow it -------------------------
  console.log('\nprovenance is not location')

  const refused = async (sql: string): Promise<string> => {
    try {
      await db.execute(sql)
      return '(accepted)'
    } catch (error) {
      return error instanceof SqlExecutionError ? 'refused' : `threw: ${(error as Error).message}`
    }
  }
  const insert = (origin: string, connector: string): string => `
    insert into public.documents
      (project_id, connector, external_parent_ref, external_ref, title, doc_type, origin)
    values (${lit(projectId)}::uuid, ${connector}, 'page',
            ${lit(`${run}-c-${origin}`)}, 'probe', 'page', ${lit(origin)})`

  // Asked ONCE and the answer reused: the second call would collide on
  // `external_ref` and be refused for a reason that has nothing to do with the
  // constraint under test. Which is how this check first failed.
  const madeSaid = await refused(insert('made', "'notion'"))
  check('a made document may name where it lives', madeSaid, madeSaid === '(accepted)')
  /*
    The half of 0177 that was doing real work, kept exactly: nothing claims to
    have come from somewhere without saying where. 0178's trigger only fills in
    an origin left at the default, so an explicit 'source' with no connector
    reaches the constraint.
  */
  const sourceSaid = await refused(insert('source', 'null'))
  check('a source must still say where it came from', sourceSaid, sourceSaid === 'refused')

  // --- what Grant sees -----------------------------------------------------
  console.log('\nthe gallery shows the difference')

  const shown = (
    await one(`
    select jsonb_path_query_first(
             app.studio_documents(${lit(projectId)}::uuid, 50),
             '$[*] ? (@.origin == "office.notion_import")') as d
  `)
  ).d as { kind?: string; origin?: string } | null
  check(
    'the authored page is credited to its author',
    shown === null
      ? 'not found in the projection'
      : `${String(shown.kind)} · ${String(shown.origin)}`,
    shown !== null && shown.kind === 'made' && shown.origin === 'office.notion_import',
  )

  const asSource = (
    await one(`
    select jsonb_path_query_first(
             app.studio_documents(${lit(projectId)}::uuid, 50),
             '$[*] ? (@.origin == "Notion")') as d
  `)
  ).d as { kind?: string } | null
  check(
    'real material still reads as Notion',
    asSource === null ? 'not found' : String(asSource.kind),
    asSource !== null,
  )
} finally {
  console.log('')
  await tearDown()
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)

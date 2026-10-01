/**
 * Everything relates to everything, and the graph can actually say so.
 *
 *   npm run verify:graph
 *
 * Issue #29, migration 0310.
 *
 * ## The defect this exists because of
 *
 * `public.relations` — the typed edge table the IA document calls the point of
 * the whole model — **had never held a single row**. The table was there, and
 * `app.relations_of` was there, well built: both directions, each other end's
 * title resolved, a comment explaining that a dangling edge yields null rather
 * than dropping the row so the graph reports its own damage. Nothing in the
 * repository ever wrote an edge. A reader over an empty table answers every
 * question with nothing and looks completely finished doing it.
 *
 * ## What is asserted, and why it is not "there are rows"
 *
 * 0310's decision is that an edge a COLUMN already holds is DERIVED rather than
 * copied — storing it twice makes two witnesses that can disagree, and the copy
 * is the one that rots. So the property is not "the table is populated". It is:
 *
 *   * every relation in the specification is traversable;
 *   * from BOTH ends, agreeing with itself;
 *   * a stored edge and a derived one come back through the same call;
 *   * and an object with no relations says so, rather than everything
 *     appearing related to everything, which is what a broken join produces
 *     and is indistinguishable from a rich graph if you only count rows.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

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
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const run = Math.random().toString(36).slice(2, 10)
const SLUG = `fixture-graph-${run}`

type Edge = {
  direction: string
  verb: string
  other_kind: string
  other_id: string
  other_title: string | null
}
const edges = async (kind: string, id: string): Promise<Edge[]> =>
  (await all(`select * from public.relations_of(${lit(kind)}, ${lit(id)}::uuid)`)) as Edge[]

console.log(`\nverify:graph — ${run}\n`)

let projectId = ''

try {
  // =========================================================================
  console.log('the graph is not empty, which is where this started')

  /*
    Asserted across the REAL corpus, not the fixtures below, because the defect
    was that nothing anywhere had an edge. Fixtures would prove the function
    works on rows this suite just made and say nothing about the product.
  */
  const live = await all(`
    with d as (select document_id from public.documents limit 400),
         e as (select (public.relations_of('document', d.document_id)).* from d)
    select verb, count(*)::int as n from e group by verb order by n desc
  `)
  check(
    'documents in the real corpus have relations',
    live.length === 0
      ? 'NOT ONE DOCUMENT HAS AN EDGE'
      : live.map((r) => `${String(r.verb)}×${String(r.n)}`).join(', '),
    live.length > 0,
  )

  // =========================================================================
  console.log('\nand every edge in the specification is traversable')

  /*
    Through the sanctioned writer, not a raw INSERT.

    ADR-0014 refuses an active project with no enabled attachment — *"a project
    reads from and writes to somewhere real"* — and a direct insert trips it.
    `hq_create_project` makes the attachment as part of creating the project,
    which is the whole reason it exists.

    The slug is derived from the NAME, not from `p_ref`. CLAUDE.md records what
    that cost once already: a teardown keyed on `p_ref` matched nothing and
    left six real projects in Grant's switcher.
  */
  await one(`
    select app.hq_create_project(app.test_office(), ${lit(`Fixture graph ${run}`)}, 'upload',
                                 ${lit(SLUG)}, ${lit(`Fixture graph ${run}`)}, true) as r
  `)
  projectId = String(
    (await one(`select project_id::text as id from public.projects where slug = ${lit(SLUG)}`)).id,
  )

  const doc = async (title: string, extra = ''): Promise<string> =>
    String(
      (
        await one(`
          insert into public.documents
            (project_id, connector, external_ref, title, doc_type, content,
             content_fingerprint, content_chars, fetched_at, origin${extra === '' ? '' : `, ${extra.split('=')[0]}`})
          values (${lit(projectId)}::uuid, 'upload', ${lit(`${SLUG}-${title}`)},
                  ${lit(title)}, 'note', 'body',
                  encode(extensions.digest(${lit(`${SLUG}-${title}`)}, 'sha256'), 'hex'),
                  4, app.now_utc(), 'source'${extra === '' ? '' : `, ${extra.split('=').slice(1).join('=')}`})
          returning document_id::text as id
        `)
      ).id,
    )

  const original = await doc('Original')
  const mirror = await doc('Mirror', `mirrors_document_id=${lit(original)}::uuid`)

  const fromOriginal = await edges('document', original)
  const fromMirror = await edges('document', mirror)
  check(
    'document mirrors document, and reads correctly from both ends',
    `original sees ${String(fromOriginal.filter((e) => e.verb === 'mirrors').length)} in, ` +
      `mirror sees ${String(fromMirror.filter((e) => e.verb === 'mirrors').length)} out`,
    fromOriginal.some(
      (e) => e.verb === 'mirrors' && e.direction === 'in' && e.other_id === mirror,
    ) &&
      fromMirror.some(
        (e) => e.verb === 'mirrors' && e.direction === 'out' && e.other_id === original,
      ),
  )
  check(
    'and the other end comes back named, not as a bare id',
    String(fromMirror.find((e) => e.verb === 'mirrors')?.other_title ?? 'NO TITLE'),
    fromMirror.find((e) => e.verb === 'mirrors')?.other_title === 'Original',
  )

  // A collection holding a document, both ways.
  const collectionId = String(
    (
      await one(`
        insert into public.collections (project_id, name, position)
        values (${lit(projectId)}::uuid, ${lit(`Research ${run}`)}, 0)
        returning collection_id::text as id
      `)
    ).id,
  )
  await db.execute(`
    insert into public.document_collections (document_id, collection_id)
    values (${lit(original)}::uuid, ${lit(collectionId)}::uuid)
  `)
  const inCollection = await edges('collection', collectionId)
  const docCollections = await edges('document', original)
  check(
    'a collection holds a document, and the document knows which collections hold it',
    `collection -> ${String(inCollection.filter((e) => e.verb === 'attached_to').length)}, ` +
      `document -> ${String(docCollections.filter((e) => e.verb === 'attached_to').length)}`,
    inCollection.some((e) => e.verb === 'attached_to' && e.other_id === original) &&
      docCollections.some((e) => e.verb === 'attached_to' && e.other_id === collectionId),
  )

  /*
    The same document is now in one collection. #29's rule is that an asset can
    be in TWO with no duplication — asserted directly, because "many-to-many"
    is a claim about the schema and this is the behaviour it exists for.
  */
  const second = String(
    (
      await one(`
        insert into public.collections (project_id, name, position)
        values (${lit(projectId)}::uuid, ${lit(`Reference ${run}`)}, 1)
        returning collection_id::text as id
      `)
    ).id,
  )
  await db.execute(`
    insert into public.document_collections (document_id, collection_id)
    values (${lit(original)}::uuid, ${lit(second)}::uuid)
  `)
  const twoWays = await edges('document', original)
  const copies = Number(
    (
      await one(
        `select count(*)::int as n from public.documents where document_id = ${lit(original)}::uuid`,
      )
    ).n,
  )
  check(
    'an asset sits in two collections at once, and there is still one of it',
    `${String(twoWays.filter((e) => e.verb === 'attached_to').length)} collections, ${String(copies)} document row`,
    twoWays.filter((e) => e.verb === 'attached_to').length === 2 && copies === 1,
  )

  // =========================================================================
  console.log('\na stored edge and a derived one arrive through the same call')

  /*
    `public.relations` is for what no column expresses — a contact related to a
    document, say, which has no column anywhere. The union is the whole design,
    so it is asserted rather than assumed.
  */
  await db.execute(`
    insert into public.relations (project_id, from_kind, from_id, verb, to_kind, to_id, made_by)
    values (${lit(projectId)}::uuid, 'document', ${lit(original)}::uuid,
            'mentions', 'document', ${lit(mirror)}::uuid, ${lit(`verify:graph:${run}`)})
  `)
  const mixed = await edges('document', original)
  check(
    'a stored edge appears beside the derived ones, from one call',
    `${String(mixed.filter((e) => e.verb === 'mentions').length)} stored, ` +
      `${String(mixed.filter((e) => e.verb !== 'mentions').length)} derived`,
    mixed.some((e) => e.verb === 'mentions') && mixed.some((e) => e.verb === 'attached_to'),
  )
  const backwards = await edges('document', mirror)
  check(
    'and a stored edge is traversable backwards too',
    `${String(backwards.filter((e) => e.verb === 'mentions' && e.direction === 'in').length)} inbound`,
    backwards.some((e) => e.verb === 'mentions' && e.direction === 'in' && e.other_id === original),
  )

  // =========================================================================
  console.log('\nand nothing is related to everything')

  /*
    CONTROL, and it is the one that matters most. A join written wrongly — a
    missing `and d.document_id = p_id` in any of the nine derived branches —
    relates every object to every other, and that is INDISTINGUISHABLE from a
    rich graph if the only check is that rows come back. A document nothing
    points at must have nothing.
  */
  const lonely = await doc('Lonely')
  const none = await edges('document', lonely)
  check(
    'CONTROL: a document with no relations has none, rather than all of them',
    `${String(none.length)} edge(s)`,
    none.length === 0,
  )
  check(
    'CONTROL: an id that is not anything returns nothing',
    `${String((await edges('document', '00000000-0000-0000-0000-000000000000')).length)} edge(s)`,
    (await edges('document', '00000000-0000-0000-0000-000000000000')).length === 0,
  )

  // =========================================================================
  console.log('\nan asset can be renamed, tagged and filed — by anything, not just the page')

  /*
    #29: "Rename, move, categorize, tag, filter and export all reachable
    through the API — no frontend-only state." Before 0312 there was no rename
    and no tag at all, and `put_in_collection` had a public wrapper that no
    section routed to — which is the same trap as no wrapper (CLAUDE.md).
  */
  const renamed = (
    await one(`select public.rename_document(${lit(original)}::uuid, 'Renamed by the suite') as r`)
  ).r as { ok?: boolean; was?: string; now?: string }
  check(
    'renaming answers with the old name as well as the new one',
    JSON.stringify(renamed),
    renamed.ok === true && renamed.was === 'Original' && renamed.now === 'Renamed by the suite',
  )
  const blank = (await one(`select public.rename_document(${lit(original)}::uuid, '   ') as r`))
    .r as { ok?: boolean; error?: string }
  check(
    'and a blank name is refused, with a reason',
    JSON.stringify(blank),
    blank.ok === false && String(blank.error ?? '').includes('needs a name'),
  )

  await one(`select public.tag_document(${lit(original)}::uuid, '  Pricing  ') as r`)
  const twice = (await one(`select public.tag_document(${lit(original)}::uuid, 'pricing') as r`))
    .r as { ok?: boolean; tags?: string[] }
  check(
    'a tag is folded and de-duplicated, so pressing it twice is one tag',
    JSON.stringify(twice.tags),
    Array.isArray(twice.tags) && twice.tags.filter((t) => t === 'pricing').length === 1,
  )
  const off = (
    await one(`select public.tag_document(${lit(original)}::uuid, 'pricing', false) as r`)
  ).r as { tags?: string[] }
  check(
    'and it can be taken off again',
    JSON.stringify(off.tags),
    Array.isArray(off.tags) && !off.tags.includes('pricing'),
  )

  const out = (
    await one(
      `select public.take_out_of_collection(${lit(original)}::uuid, ${lit(`Reference ${run}`)}) as r`,
    )
  ).r as { ok?: boolean }
  const afterOut = await edges('document', original)
  check(
    'a document can leave a collection, and the collection stays',
    `${String(afterOut.filter((e) => e.verb === 'attached_to').length)} collection(s) left, ` +
      `${String(
        Number(
          (
            await one(
              `select count(*)::int as n from public.collections where project_id = ${lit(projectId)}::uuid`,
            )
          ).n,
        ),
      )} collection(s) still exist`,
    out.ok === true && afterOut.filter((e) => e.verb === 'attached_to').length === 1,
  )
  const again = (
    await one(
      `select public.take_out_of_collection(${lit(original)}::uuid, ${lit(`Reference ${run}`)}) as r`,
    )
  ).r as { ok?: boolean; already?: boolean }
  check(
    'and taking it out twice is not an error, because the state is what was wanted',
    JSON.stringify(again),
    again.ok === true && again.already === true,
  )

  // =========================================================================
  console.log('\nand the graph is reachable from a browser')

  /*
    The layer the whole model is useless without, and the one this repository
    has now been caught by twice: `app.search_documents` and
    `app.put_in_collection` both worked perfectly and neither could be called
    from a page.
  */
  const hqToken = String(
    (
      await one(
        `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
      )
    ).v ?? '',
  )
  if (hqToken !== '') {
    const base = `https://${process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'}.supabase.co/functions/v1/hq-api`
    const r = await fetch(`${base}?section=relations&kind=document&id=${original}`, {
      headers: { Authorization: `Bearer ${hqToken}` },
    })
    const body = (await r.json().catch(() => ({}))) as { data?: unknown[] }
    check(
      'the relations section answers over HTTP',
      `http ${String(r.status)}, ${String((body.data ?? []).length)} edge(s)`,
      r.ok && Array.isArray(body.data) && body.data.length > 0,
    )
  } else {
    check('the relations section answers over HTTP', 'NOT CHECKED — no hq.api_token', false)
  }

  // =========================================================================
  console.log('\nthe fact lives in one place, not two')

  /*
    0310's decision, asserted so a later backfill cannot quietly undo it: a fact
    a column already holds must not ALSO sit in `relations`. Two witnesses that
    can disagree is the trap 0303 and 0304 were spent on, one week and six
    migrations ago.
  */
  const duplicated = Number(
    (
      await one(`
        select count(*)::int as n
          from public.relations r
          join public.documents d on d.document_id = r.to_id
         where r.verb in ('produced', 'mirrors', 'attached_to')
      `)
    ).n,
  )
  check(
    'no stored edge duplicates one a column already holds',
    `${String(duplicated)} duplicate(s)`,
    duplicated === 0,
  )
} finally {
  console.log('\nteardown')
  if (projectId !== '') {
    await db.execute(`delete from public.relations where project_id = ${lit(projectId)}::uuid`)
    await db.execute(`
      delete from public.document_collections dc using public.documents d
       where d.document_id = dc.document_id and d.project_id = ${lit(projectId)}::uuid
    `)
    await db.execute(`delete from public.collections where project_id = ${lit(projectId)}::uuid`)
    // Mirrors first: a document referenced by another's mirrors_document_id
    // cannot go while the referrer is still there.
    await db.execute(`
      update public.documents set mirrors_document_id = null
       where project_id = ${lit(projectId)}::uuid
    `)
    await db.execute(`delete from public.documents where project_id = ${lit(projectId)}::uuid`)
    /*
      `project_delete` does ADR-0014's order for us — archive, then attachments,
      then the project — and refuses a project still holding documents or jobs,
      which is why they go first. Better than three raw deletes in the right
      order, because it is the path a person has.
    */
    await db.execute(`select app.project_delete(${lit(SLUG)}, true)`)
  }
  const left = Number(
    (await one(`select count(*)::int as n from public.projects where slug = ${lit(SLUG)}`)).n,
  )
  check(
    'teardown — the fixture project and everything under it are gone',
    `${String(left)} left`,
    left === 0 && projectId !== '',
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)

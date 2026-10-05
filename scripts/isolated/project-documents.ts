/**
 * The unified Documents module, driven (migration 0900) - on a marked LOCAL replica, inside one transaction that is
 * rolled back, so a crashed run leaves nothing behind.
 *
 *   npx tsx scripts/isolated/project-documents.ts [replica-db]
 *
 * Proves: versions are derived from superseded_by and carry tags, pin, order and collections across; a stale or repeated
 * press makes no second version; rollback is a NEW version; a supersede cannot write a cycle; the unified list collapses
 * ONLY on certain identity and never on a name (each positive rule has a negative control beside it); import is an
 * explicit, idempotent press (copy now when the material is held, a recorded request when it is not, fulfilled later);
 * the original disappearing leaves the copy as the item; tenant, project and fixture-project isolation; and that nothing
 * in the codebase or the database deletes a document. Nothing here spends a model call or touches the network.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_docs')
type Row = Record<string, unknown>
const q = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows as Row[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const sha = async (s: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
// biome-ignore lint/suspicious/noExplicitAny: a jsonb answer is read by key in a proof
const call = async (sql: string): Promise<any> => (await q(`select (${sql}) as r`))[0]?.r

const OFFICE = String((await q(`select app.test_office()::text o`))[0]?.o)
const OTHER = String(
  (await q(`select office_id::text o from public.offices where kind = 'person' limit 1`))[0]?.o,
)
const run = Math.random().toString(36).slice(2, 8)

await q('begin')
try {
  const project = async (office: string, slug: string): Promise<string> =>
    String(
      (
        await q(
          `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'active', ${lit(office)}::uuid) returning project_id::text id`,
        )
      )[0]?.id,
    )
  const SLUG = `docsproof-${run}`
  const PA = await project(OFFICE, SLUG)
  const PB = await project(OFFICE, `${SLUG}-other`)
  await project(OTHER, `${SLUG}-foreign`)
  const FIXSLUG = `fixture-docs-${run}`
  await project(OFFICE, FIXSLUG)

  interface D {
    office?: string
    project: string
    title: string
    content?: string | null
    origin?: string
    connector?: string | null
    parent?: string | null
    ref?: string | null
    state?: string
    doc_type?: string
    mirrors?: string | null
    tags?: string[]
    pinned?: boolean
    storage?: boolean
    mime?: string
    missing?: boolean
  }
  // Transaction time is one instant, so created_at is spelled out: order by creation must be a fact, not a coin flip.
  let tick = 0
  const ins = async (d: D): Promise<string> => {
    const content = d.content ?? null
    const fp = content === null ? null : await sha(content)
    const origin = d.origin ?? (d.connector ? 'source' : 'yours')
    return String(
      (
        await q(`insert into public.documents
          (office_id, project_id, title, doc_type, content, content_fingerprint, content_chars, fetched_at, origin, connector,
           external_parent_ref, external_ref, state, mirrors_document_id, tags, pinned, storage_path, mime_type, byte_size, missing_since, created_at)
          values (${lit(d.office ?? OFFICE)}::uuid, ${lit(d.project)}::uuid, ${lit(d.title)}, ${d.doc_type ? lit(d.doc_type) : 'null'},
           ${content === null ? 'null' : lit(content)}, ${fp === null ? 'null' : lit(fp)}, ${content === null ? 'null' : String(content.length)},
           ${content === null ? 'null' : 'now()'}, ${lit(origin)}, ${d.connector ? lit(d.connector) : 'null'},
           ${d.parent ? lit(d.parent) : 'null'}, ${d.ref ? lit(d.ref) : 'null'}, ${lit(d.state ?? 'approved')},
           ${d.mirrors ? `${lit(d.mirrors)}::uuid` : 'null'}, ${lit(`{${(d.tags ?? []).join(',')}}`)}::text[], ${d.pinned ? 'true' : 'false'},
           ${d.storage ? lit(`files/${run}/${Math.random().toString(36).slice(2)}.pdf`) : 'null'}, ${d.storage ? lit(d.mime ?? 'application/pdf') : 'null'},
           ${d.storage ? '2048' : 'null'}, ${d.missing ? 'now()' : 'null'}, now() - interval '1 day' + (${String(++tick)} * interval '1 second'))
          returning document_id::text id`)
      )[0]?.id,
    )
  }
  const LONG = (tag: string): string =>
    `${tag} - a body long enough to count as content for identity, over forty chars.`
  const list = async (office = OFFICE, slug = SLUG) =>
    await call(`app.hq_project_documents(${lit(office)}::uuid, ${lit(slug)})`)
  // biome-ignore lint/suspicious/noExplicitAny: a jsonb item
  const item = (l: any, id: string): any => (l.documents as any[]).find((d) => d.id === id)
  const versions = async (id: string, office = OFFICE) =>
    await call(`app.hq_document_versions(${lit(office)}::uuid, ${lit(id)}::uuid)`)

  // =========================================================== 1. versions
  const v1 = await ins({
    project: PA,
    title: 'Report',
    content: LONG('v1'),
    tags: ['finance'],
    pinned: true,
  })
  const collection = String(
    (
      await q(
        `insert into public.collections (project_id, name) values (${lit(PA)}::uuid, 'Reports') returning collection_id::text id`,
      )
    )[0]?.id,
  )
  await q(
    `insert into public.document_collections (document_id, collection_id) values (${lit(v1)}::uuid, ${lit(collection)}::uuid)`,
  )
  const other = await ins({ project: PA, title: 'Neighbour', content: LONG('neighbour') })
  await q(
    `insert into public.document_orders (owner, project_id, doc_ids) values ('grant', ${lit(PA)}::uuid, ${lit(JSON.stringify([other, v1]))}::jsonb)`,
  )
  const n2 = await call(
    `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(v1)}::uuid, ${lit(LONG('v2 first draft'))}, null, 'tightened the summary', 'teamhq')`,
  )
  check(
    'a new version of an APPROVED document is made as a DRAFT (approval belongs to a version)',
    n2.ok === true && n2.version === 2 && n2.state === 'draft' && n2.pending_id === n2.document_id,
    JSON.stringify(n2),
  )
  const draft1 = String(n2.document_id)
  let v2 = draft1
  const approve = async (id: string): Promise<void> => {
    await q(`update public.documents set state = 'approved' where document_id = ${lit(id)}::uuid`)
  }
  {
    const o1 = (
      await q(
        `select state, superseded_by::text s, pinned from public.documents where document_id = ${lit(v1)}::uuid`,
      )
    )[0]
    check(
      'v1 stays APPROVED, unsuperseded, pinned and current while v2 is only a draft',
      o1?.state === 'approved' && o1?.s === null && o1?.pinned === true && n2.current_id === v1,
    )
    const l1 = await list()
    const it = item(l1, v1)
    check(
      'the logical document stays in the project list as v1 Approved, with v2 Draft exposed beside it',
      it !== undefined &&
        it.current_state === 'approved' &&
        it.pending_version?.id === draft1 &&
        it.pending_version?.state === 'draft' &&
        it.pending_version?.version === 2 &&
        item(l1, draft1) === undefined,
      JSON.stringify(it?.pending_version),
    )
    const pv = await versions(v1)
    check(
      'versions lists the approved v1 (current) and the draft v2 (pending), and reads the same from the draft',
      pv.current_id === v1 &&
        pv.pending_id === draft1 &&
        pv.versions.map((x: { state: string }) => x.state).join() === 'approved,draft' &&
        pv.versions.map((x: { is_pending: boolean }) => x.is_pending).join() === 'false,true' &&
        (await versions(draft1)).current_id === v1 &&
        pv.versions[1].how === 'draft_revision',
      JSON.stringify(pv.versions.map((x: { state: string }) => x.state)),
    )
    check(
      'a draft cannot be rolled back to',
      pv.versions[1].can_roll_back_to === false &&
        (await call(`app.hq_document_rollback(${lit(OFFICE)}::uuid, ${lit(draft1)}::uuid)`)).ok ===
          false,
    )
    const pending = await call(
      `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(v1)}::uuid, ${lit(LONG('v2 first draft'))})`,
    )
    check(
      'pressing again with the same content is idempotent (the same pending draft)',
      pending.ok === true && pending.already === true && pending.document_id === draft1,
      JSON.stringify(pending),
    )
    const sup = await call(
      `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(v1)}::uuid, ${lit(LONG('v2'))}, null, 'tightened the summary', 'teamhq')`,
    )
    const v2b = String(sup.document_id)
    const vb = await versions(v1)
    check(
      'a newer draft REPLACES the older pending one (older archived, never deleted, listed but not numbered)',
      sup.ok === true &&
        sup.state === 'draft' &&
        (await q(`select state from public.documents where document_id = ${lit(draft1)}::uuid`))[0]
          ?.state === 'archived' &&
        vb.pending_id === v2b &&
        vb.versions.length === 3 &&
        vb.versions.filter((x: { is_pending: boolean }) => x.is_pending).length === 1 &&
        vb.versions.find((x: { document_id: string }) => x.document_id === draft1).version ===
          null &&
        item(await list(), v1)?.pending_version?.id === v2b,
      JSON.stringify(
        vb.versions.map((x: { state: string; version: number | null }) => [x.state, x.version]),
      ),
    )
    // The approval, by whichever door: the one writer-independent trigger links the lineage.
    const ap = await call(`app.approve_document(${lit(OFFICE)}::uuid, ${lit(v2b)}::uuid)`)
    check(
      'a person approves the draft through the ordinary approve door',
      ap.ok === true,
      JSON.stringify(ap),
    )
    const vc = await versions(v2b)
    check(
      'approving v2 makes it the current version: v1 archived and linked, v2 listed as the item, one pending draft gone',
      vc.current_id === v2b &&
        vc.pending_id === null &&
        (
          await q(
            `select state, superseded_by::text s from public.documents where document_id = ${lit(v1)}::uuid`,
          )
        )[0]?.s === v2b &&
        item(await list(), v2b)?.pending_version === null &&
        item(await list(), v1) === undefined &&
        item(await list(), v2b)?.version_count === 2,
      JSON.stringify(
        vc.versions.map((x: { state: string; version: number | null }) => [x.state, x.version]),
      ),
    )
    v2 = v2b
  }
  const old = (
    await q(
      `select state, superseded_by::text s, pinned from public.documents where document_id = ${lit(v1)}::uuid`,
    )
  )[0]
  check(
    'the old version is ARCHIVED and linked, never deleted',
    old?.state === 'archived' && old?.s === v2,
  )
  check('the old version stops being pinned (one pin, on the head)', old?.pinned === false)
  const head = (
    await q(
      `select tags::text t, pinned, project_id::text p, title, origin, connector from public.documents where document_id = ${lit(v2)}::uuid`,
    )
  )[0]
  check(
    'tags, pin, project and title carry across',
    head?.t === '{finance}' && head?.pinned === true && head?.p === PA && head?.title === 'Report',
  )
  check(
    "a person's new text is origin yours with no connector (nothing invented)",
    head?.origin === 'yours' && head?.connector === null,
  )
  const ord = (
    await q(
      `select doc_ids::text d from public.document_orders where project_id = ${lit(PA)}::uuid`,
    )
  )[0]?.d
  check(
    'the custom order keeps the position (replaced in place)',
    ord === JSON.stringify([other, v2]).replace(/,/g, ', '),
    String(ord),
  )
  const coll = await q(
    `select count(*)::int n from public.document_collections where document_id = ${lit(v2)}::uuid and collection_id = ${lit(collection)}::uuid`,
  )
  check('collection membership carries across', coll[0]?.n === 1)

  const again = await call(
    `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(v1)}::uuid, ${lit(LONG('v2'))})`,
  )
  check(
    'pressing again with the same content is idempotent (no second version)',
    again.ok === true && again.already === true && again.document_id === v2,
    JSON.stringify(again),
  )
  const stale = await call(
    `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(v1)}::uuid, ${lit(LONG('different'))})`,
  )
  check(
    'a stale head is refused and names the current one',
    stale.ok === false && stale.current_id === v2,
    JSON.stringify(stale),
  )
  const same = await call(
    `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(v2)}::uuid, ${lit(LONG('v2'))})`,
  )
  check(
    'identical content to the current version is refused',
    same.ok === false && /same content/.test(String(same.error)),
  )
  const blank = await call(
    `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(v2)}::uuid, E'  \\n ')`,
  )
  check('whitespace is not a version', blank.ok === false)
  const n3 = await call(
    `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(v2)}::uuid, ${lit(LONG('v3'))}, null, null, 'telegram')`,
  )
  const v3 = String(n3.document_id)
  check(
    'v3 is a draft too until a person approves it',
    n3.state === 'draft' && n3.current_id === v2,
  )
  await approve(v3)
  const vs = await versions(v3)
  // the first draft a newer one replaced is kept as history, listed but never numbered
  const numbered = vs.versions.filter((x: { version: number | null }) => x.version !== null)
  check(
    'hq_document_versions lists v1..v3 oldest first with the current marked',
    vs.version_count === 3 &&
      vs.current_id === v3 &&
      numbered.map((x: { document_id: string }) => x.document_id).join() === [v1, v2, v3].join() &&
      numbered.map((x: { is_current: boolean }) => x.is_current).join() === 'false,false,true' &&
      numbered.map((x: { version: number }) => x.version).join() === '1,2,3' &&
      vs.versions.length === 4,
    JSON.stringify(vs.versions.map((x: { version: number }) => x.version)),
  )
  check(
    '...and reads the same from any version',
    (await versions(v1)).current_id === v3 && (await versions(v2)).version_count === 3,
  )
  check(
    '...with the note, the door and the author recorded',
    numbered[1].note === 'tightened the summary' &&
      numbered[1].channel === 'teamhq' &&
      numbered[2].channel === 'telegram' &&
      numbered[1].how === 'draft_revision',
  )
  check("...and the logical title is the head's", vs.logical_title === 'Report')

  const rb = await call(
    `app.hq_document_rollback(${lit(OFFICE)}::uuid, ${lit(v1)}::uuid, 'back to the first draft', 'teamhq')`,
  )
  check(
    'rollback writes the old content as a NEW version (v4)',
    rb.ok === true && rb.version === 4 && rb.rolled_back_to === v1,
    JSON.stringify(rb),
  )
  const v4 = String(rb.document_id)
  const c4 = (
    await q(`select content, state from public.documents where document_id = ${lit(v4)}::uuid`)
  )[0]
  check(
    '...holding the v1 content, approved, with v3 archived not deleted',
    c4?.content === LONG('v1') &&
      c4?.state === 'approved' &&
      (await q(`select state from public.documents where document_id = ${lit(v3)}::uuid`))[0]
        ?.state === 'archived',
  )
  check(
    'rolling back to the current version is refused',
    (await call(`app.hq_document_rollback(${lit(OFFICE)}::uuid, ${lit(v4)}::uuid)`)).ok === false,
  )
  const rb2 = await call(`app.hq_document_rollback(${lit(OFFICE)}::uuid, ${lit(v3)}::uuid)`)
  check(
    'a rollback can itself be rolled back (history is never rewritten)',
    rb2.ok === true && rb2.version === 5,
  )
  check(
    'the pin and the order position followed the head through both',
    (
      await q(
        `select pinned from public.documents where document_id = ${lit(String(rb2.document_id))}::uuid`,
      )
    )[0]?.pinned === true &&
      String(
        (
          await q(
            `select doc_ids::text d from public.document_orders where project_id = ${lit(PA)}::uuid`,
          )
        )[0]?.d,
      ).includes(String(rb2.document_id)),
  )

  // restore stays the undo of a supersede LINK - and the proof says what that means on a lineage.
  const a = await ins({ project: PA, title: 'Restore subject', content: LONG('ra') })
  const b = await ins({ project: PA, title: 'Restore subject', content: LONG('rb') })
  await call(`app.hq_document_supersede(${lit(OFFICE)}::uuid, ${lit(a)}::uuid, ${lit(b)}::uuid)`)
  check('supersede links a to b: one lineage, b current', (await versions(a)).current_id === b)
  const cyc = await call(
    `app.hq_document_supersede(${lit(OFFICE)}::uuid, ${lit(b)}::uuid, ${lit(a)}::uuid)`,
  )
  check(
    'supersede refuses to write a cycle, saying why',
    typeof cyc.error === 'string' && /each the replacement/.test(cyc.error),
    JSON.stringify(cyc),
  )
  check(
    '...and a document cannot supersede itself (the old rule still holds)',
    typeof (
      await call(
        `app.hq_document_supersede(${lit(OFFICE)}::uuid, ${lit(a)}::uuid, ${lit(a)}::uuid)`,
      )
    ).error === 'string',
  )
  await call(`app.hq_document_restore(${lit(OFFICE)}::uuid, ${lit(a)}::uuid, 'approved')`)
  check(
    'restore (the undo of the link) unlinks: a is its own document again, b is not its history',
    (await versions(a)).version_count === 1 && (await versions(b)).version_count === 1,
  )

  // adopting an existing document as the next version (the artifact-job helper's path)
  const h = await ins({ project: PA, title: 'Board pack', storage: true })
  const rev = await ins({
    project: PA,
    title: 'Board pack (revised)',
    storage: true,
    state: 'draft',
    origin: 'made',
  })
  const noApprove = await call(
    `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(h)}::uuid, null, ${lit(rev)}::uuid)`,
  )
  check(
    "adopting an unapproved document attaches it as a pending DRAFT (approving is a person's act); the head stays approved",
    noApprove.ok === true &&
      noApprove.state === 'draft' &&
      noApprove.current_id === h &&
      noApprove.pending_id === rev &&
      (await q(`select state from public.documents where document_id = ${lit(h)}::uuid`))[0]
        ?.state === 'approved' &&
      item(await list(), h)?.pending_version?.id === rev,
    JSON.stringify(noApprove),
  )
  const adopt = await call(
    `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(h)}::uuid, null, ${lit(rev)}::uuid, 'revised', 'job', true)`,
  )
  check(
    'with an explicit approval it is adopted as v2',
    adopt.ok === true && adopt.version === 2 && adopt.document_id === rev,
    JSON.stringify(adopt),
  )
  check(
    '...idempotently',
    (
      await call(
        `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(h)}::uuid, null, ${lit(rev)}::uuid)`,
      )
    ).already === true,
  )
  check(
    '...and the list shows ONE item, "Board pack (revised)", with two versions',
    item(await list(), rev)?.version_count === 2 && item(await list(), h) === undefined,
  )
  // The artifact-job helper: a job's revised report becomes the next version. Fixture job (requested_by verify:), rolled back.
  const job = String(
    (
      await q(
        `insert into public.jobs (office_id, correlation_id, idempotency_key, kind, requested_by) values (${lit(OFFICE)}::uuid, gen_random_uuid(), ${lit(`docs-${run}`)}, 'artifact.report', 'verify:docs') returning job_id::text id`,
      )
    )[0]?.id,
  )
  const base2 = await ins({ project: PA, title: 'Quarterly report', storage: true })
  check(
    'adopt-by-job with no produced document says so',
    (
      await call(
        `app.document_adopt_version(${lit(OFFICE)}::uuid, ${lit(base2)}::uuid, ${lit(job)}::uuid)`,
      )
    ).ok === false,
  )
  const made2 = await ins({
    project: PA,
    title: 'Quarterly report v2',
    storage: true,
    origin: 'made',
    state: 'draft',
  })
  await q(
    `update public.documents set produced_by_job = ${lit(job)}::uuid where document_id = ${lit(made2)}::uuid`,
  )
  const ad1 = await call(
    `app.document_adopt_version(${lit(OFFICE)}::uuid, ${lit(base2)}::uuid, ${lit(job)}::uuid, 'revised by the report job')`,
  )
  check(
    'adopt-by-job never approves: an unapproved output becomes a pending draft beside the approved report',
    ad1.ok === true &&
      ad1.state === 'draft' &&
      ad1.current_id === base2 &&
      ad1.pending_id === made2 &&
      (await q(`select state from public.documents where document_id = ${lit(base2)}::uuid`))[0]
        ?.state === 'approved' &&
      item(await list(), base2)?.pending_version?.id === made2,
    JSON.stringify(ad1),
  )
  await q(`update public.documents set state = 'approved' where document_id = ${lit(made2)}::uuid`)
  check(
    "once a person has approved it, the job's output becomes v2 of the report and the draft is no longer pending",
    (await versions(base2)).current_id === made2 &&
      (await versions(base2)).version_count === 2 &&
      item(await list(), made2)?.version_count === 2 &&
      item(await list(), made2)?.pending_version === null,
  )
  check(
    '...with provenance (job and note) readable from the versions',
    (await versions(base2)).versions[1].produced_by_job === job &&
      (await versions(base2)).versions[1].how === 'draft_revision' &&
      (await versions(base2)).versions[1].note === 'revised by the report job',
  )
  check(
    "another office cannot adopt this job's output",
    (
      await call(
        `app.document_adopt_version(${lit(OTHER)}::uuid, ${lit(base2)}::uuid, ${lit(job)}::uuid)`,
      )
    ).ok === false,
  )
  const otherProject = await ins({ project: PB, title: 'Elsewhere', content: LONG('elsewhere') })
  check(
    'a document in another project cannot be adopted',
    (
      await call(
        `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(rev)}::uuid, null, ${lit(otherProject)}::uuid)`,
      )
    ).ok === false,
  )
  check(
    'tenant isolation: another office sees no versions and can make none',
    (await versions(v1, OTHER)).error !== undefined &&
      (
        await call(
          `app.hq_document_new_version(${lit(OTHER)}::uuid, ${lit(rev)}::uuid, ${lit(LONG('x'))})`,
        )
      ).ok === false &&
      (await call(`app.hq_document_rollback(${lit(OTHER)}::uuid, ${lit(v1)}::uuid)`)).ok === false,
  )
  check(
    'one of content and by-document, not both and not neither',
    (await call(`app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(rev)}::uuid)`)).ok ===
      false,
  )

  // =========================================================== 2. the unified list
  const clean = await project(OFFICE, `${SLUG}-clean`)
  const CS = `${SLUG}-clean`
  const L = (): Promise<ReturnType<typeof list>> => list(OFFICE, CS)
  const FILE = 'F'.repeat(33)
  const d1 = await ins({
    project: clean,
    title: 'Spec',
    connector: 'drive',
    parent: 'folderA',
    ref: FILE,
    doc_type: 'google-doc',
    content: LONG('spec'),
  })
  const d1b = await ins({
    project: clean,
    title: 'Spec (picked directly)',
    connector: 'drive',
    ref: FILE,
    doc_type: 'google-doc',
  })
  let l = await L()
  check(
    'the same (connector, external_ref) is one item, the row with the material stands',
    item(l, d1) !== undefined && item(l, d1b) === undefined,
  )
  check(
    '...and the absorbed row is listed, with the reason',
    item(l, d1).duplicates[0]?.id === d1b && item(l, d1).duplicates[0]?.why === 'same_source_file',
  )
  check(
    'a Google Doc has an Open source URL',
    item(l, d1).external_url === `https://docs.google.com/document/d/${FILE}/edit` &&
      item(l, d1).source === 'drive',
  )

  const u1 = await ins({ project: clean, title: 'Contract', content: LONG('contract text') })
  const d2 = await ins({
    project: clean,
    title: 'Contract - copy from Drive',
    connector: 'drive',
    parent: 'folderA',
    ref: 'ref-contract',
    content: LONG('contract text'),
  })
  l = await L()
  check(
    'identical sha-256 + size + 40+ chars is one item across sources, oldest stands',
    item(l, u1) !== undefined && item(l, d2) === undefined,
  )
  check(
    '...naming both sources in also_in',
    JSON.stringify(item(l, u1).also_in) === '["upload","drive"]',
    JSON.stringify(item(l, u1).also_in),
  )

  const t1 = await ins({ project: clean, title: 'Pricing', content: LONG('pricing 2025') })
  const t2 = await ins({ project: clean, title: 'Pricing', content: LONG('pricing 2026') })
  l = await L()
  check(
    'NEGATIVE: two documents with the SAME TITLE and different content do not merge',
    item(l, t1) !== undefined && item(l, t2) !== undefined,
  )
  const s1 = await ins({ project: clean, title: 'Note A', content: 'TODO' })
  const s2 = await ins({ project: clean, title: 'Note B', content: 'TODO' })
  l = await L()
  check(
    'NEGATIVE: identical but tiny content (under 40 chars) does not merge',
    item(l, s1) !== undefined && item(l, s2) !== undefined,
  )
  const n1 = await ins({ project: clean, title: 'Minutes', content: LONG('minutes') })
  const n2x = await ins({ project: clean, title: 'minutes', content: `${LONG('minutes')}!` })
  l = await L()
  check(
    'NEGATIVE: near-identical content with a different title and fingerprint does not merge',
    item(l, n1) !== undefined && item(l, n2x) !== undefined,
  )
  const same1 = await ins({ project: clean, title: 'History A', content: LONG('shared body') })
  const same1n = await call(
    `app.hq_document_new_version(${lit(OFFICE)}::uuid, ${lit(same1)}::uuid, ${lit(LONG('shared body v2'))})`,
  )
  await approve(String(same1n.document_id))
  const same2 = await ins({ project: clean, title: 'History B', content: LONG('shared body v2') })
  l = await L()
  check(
    'NEGATIVE: a lineage head is never merged with an unrelated identical document',
    item(l, String(same1n.document_id)) !== undefined && item(l, same2) !== undefined,
  )
  check(
    'a version chain collapses to its head with version_count and current_version',
    item(l, String(same1n.document_id)).version_count === 2 && item(l, same1) === undefined,
  )

  const made = await ins({ project: clean, title: 'Brief', origin: 'made', content: LONG('brief') })
  const mirror = await ins({
    project: clean,
    title: 'Brief',
    connector: 'notion',
    parent: 'db1',
    ref: '11111111111111111111111111111111',
    mirrors: made,
    content: LONG('brief in notion'),
  })
  l = await L()
  check(
    'a mirror steps aside when its original is visible (0464)',
    item(l, made) !== undefined &&
      item(l, mirror) === undefined &&
      item(l, made).duplicates[0]?.why === 'mirror',
  )
  check('...and the original is "generated"', item(l, made).source === 'generated')
  const madeElsewhere = await ins({
    project: PB,
    title: 'Brief 2',
    origin: 'made',
    content: LONG('brief 2'),
  })
  const mirror2 = await ins({
    project: clean,
    title: 'Brief 2',
    connector: 'notion',
    parent: 'db1',
    ref: '22222222222222222222222222222222',
    mirrors: madeElsewhere,
    content: LONG('brief 2 notion'),
  })
  l = await L()
  check(
    'NEGATIVE: a mirror whose original is NOT in this project stays visible',
    item(l, mirror2) !== undefined,
  )
  check(
    'a Notion page has an Open source URL (dashes removed)',
    item(l, mirror2).external_url === 'https://www.notion.so/22222222222222222222222222222222' &&
      item(l, mirror2).source === 'notion',
  )

  const nb = await ins({
    project: clean,
    title: 'Interview',
    connector: 'notebooklm',
    parent: 'nb-123',
    ref: 'src-9',
    content: LONG('interview'),
  })
  const web = await ins({
    project: clean,
    title: 'Competitor page',
    connector: 'browser',
    ref: 'https://example.com/a',
    content: LONG('competitor page'),
  })
  l = await L()
  check(
    'NotebookLM and web material are classified and linkable',
    item(l, nb).source === 'notebook' &&
      item(l, nb).external_url === 'https://notebooklm.google.com/notebook/nb-123' &&
      item(l, web).source === 'web' &&
      item(l, web).external_url === 'https://example.com/a',
  )
  const pdf = await ins({ project: clean, title: 'Deck.pdf', storage: true })
  l = await L()
  check(
    'an uploaded PDF: kind pdf, size, has_file and preview, thumbnail from file, nothing claimed indexed',
    item(l, pdf).kind === 'pdf' &&
      item(l, pdf).size_bytes === 2048 &&
      item(l, pdf).has_file === true &&
      item(l, pdf).has_preview === true &&
      item(l, pdf).thumbnail.previewable_from_file === true &&
      item(l, pdf).thumbnail.available === false &&
      item(l, pdf).indexed === false,
  )
  check(
    'an indexed document says so (extracted text)',
    item(l, t1).indexed === true && item(l, t1).has_preview === true,
  )

  const draft = await ins({
    project: clean,
    title: 'Not yet',
    origin: 'made',
    state: 'draft',
    content: LONG('draft'),
  })
  const arch = await ins({
    project: clean,
    title: 'Gone',
    state: 'archived',
    content: LONG('archived'),
  })
  l = await L()
  check(
    'drafts and archived documents are not listed (the review gate)',
    item(l, draft) === undefined && item(l, arch) === undefined,
  )
  const rowsIn = Number(
    (
      await q(
        `select count(*)::int n from public.documents where project_id = ${lit(clean)}::uuid and state = 'approved'`,
      )
    )[0]?.n,
  )
  check(
    'accounting: items + collapsed rows = approved rows (nothing vanishes silently)',
    l.counts.items + l.counts.rows_collapsed === rowsIn,
    `${l.counts.items} + ${l.counts.rows_collapsed} vs ${rowsIn}`,
  )

  // =========================================================== 3. import
  const o1 = await ins({
    project: clean,
    title: 'Handbook',
    connector: 'drive',
    parent: 'folderB',
    ref: 'ref-handbook',
    doc_type: 'file',
    content: LONG('handbook'),
  })
  const imp = await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(o1)}::uuid, 'teamhq')`)
  check(
    'import with the material held makes the copy now',
    imp.ok === true &&
      imp.state === 'imported' &&
      imp.already === false &&
      typeof imp.copy_id === 'string',
    JSON.stringify(imp),
  )
  const copy = String(imp.copy_id)
  const cp = (
    await q(
      `select origin, connector, content, imported_from_document_id::text f, state, external_ref from public.documents where document_id = ${lit(copy)}::uuid`,
    )
  )[0]
  check(
    '...a NEW durable row: origin yours, no connector, content copied, linked to the original',
    cp?.origin === 'yours' &&
      cp?.connector === null &&
      cp?.content === LONG('handbook') &&
      cp?.f === o1 &&
      cp?.state === 'approved' &&
      cp?.external_ref === null,
  )
  const imp2 = await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(o1)}::uuid)`)
  check(
    'importing twice is one copy',
    imp2.already === true &&
      imp2.copy_id === copy &&
      Number(
        (
          await q(
            `select count(*)::int n from public.documents where imported_from_document_id = ${lit(o1)}::uuid`,
          )
        )[0]?.n,
      ) === 1,
  )
  l = await L()
  check(
    'the list shows ONE item (the original), imported, with the copy absorbed',
    item(l, o1)?.imported === true &&
      item(l, o1).import_state === 'imported' &&
      item(l, o1).import_document_id === copy &&
      item(l, copy) === undefined &&
      item(l, o1).duplicates[0]?.why === 'imported_copy',
  )
  check(
    'an un-imported external document offers Import and says it is not imported',
    item(l, d1).imported === false &&
      item(l, d1).import_available === true &&
      item(l, d1).import_state === 'none',
  )
  check(
    'Team HQ-held documents are already imported and offer nothing',
    item(l, u1).imported === true && item(l, u1).import_available === false,
  )

  await q(`update public.documents set missing_since = now() where document_id = ${lit(o1)}::uuid`)
  l = await L()
  check(
    'the ORIGINAL DISAPPEARING leaves the copy as the item',
    item(l, copy) !== undefined &&
      item(l, o1) === undefined &&
      item(l, copy).source === 'upload' &&
      item(l, copy).imported === true &&
      item(l, copy).imported_from_document_id === o1 &&
      item(l, copy).duplicates[0]?.why === 'original_gone',
  )
  check(
    '...and the copy still reads (content kept)',
    (await q(`select content from public.documents where document_id = ${lit(copy)}::uuid`))[0]
      ?.content === LONG('handbook'),
  )
  await q(`update public.documents set missing_since = null where document_id = ${lit(o1)}::uuid`)
  await q(
    `insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled, disabled_reason) values (${lit(clean)}::uuid, 'drive', 'folderB', 'Folder B', 'source', false, 'proof: disconnected')`,
  )
  l = await L()
  check(
    'a DISCONNECTED source leaves the active list and its imported copy stands (0896)',
    item(l, o1) === undefined && item(l, copy) !== undefined,
  )
  check(
    '...unless the caller asks to see disconnected sources',
    item(await call(`app.hq_project_documents(${lit(OFFICE)}::uuid, ${lit(CS)}, true)`), o1)
      ?.connected === false,
  )
  await q(`delete from public.project_attachments where project_id = ${lit(clean)}::uuid`)

  const ref = await ins({
    project: clean,
    title: 'Policy',
    connector: 'drive',
    ref: 'ref-policy',
    doc_type: 'google-doc',
  })
  const p1 = await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(ref)}::uuid, 'teamhq')`)
  check(
    'import of a bare reference is RECORDED, not faked: pending, and it says what it needs',
    p1.ok === true && p1.state === 'pending' && p1.needs === 'drive.read_file',
    JSON.stringify(p1),
  )
  check(
    '...no copy exists yet',
    Number(
      (
        await q(
          `select count(*)::int n from public.documents where imported_from_document_id = ${lit(ref)}::uuid`,
        )
      )[0]?.n,
    ) === 0,
  )
  const p2 = await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(ref)}::uuid)`)
  check(
    '...and asking again is the same request',
    p2.request_id === p1.request_id &&
      Number(
        (
          await q(
            `select count(*)::int n from public.document_import_requests where document_id = ${lit(ref)}::uuid`,
          )
        )[0]?.n,
      ) === 1,
  )
  l = await L()
  check(
    'the list says pending',
    item(l, ref).import_state === 'pending' && item(l, ref).imported === false,
  )
  check(
    'fulfil with no material does nothing',
    (await call(`app.document_import_fulfil(${lit(OFFICE)}::uuid, ${lit(ref)}::uuid)`))
      .fulfilled === false,
  )
  const unrequested = await ins({
    project: clean,
    title: 'Never asked',
    connector: 'drive',
    ref: 'ref-never',
    content: LONG('never'),
  })
  check(
    'fulfil NEVER imports what nobody asked for',
    (await call(`app.document_import_fulfil(${lit(OFFICE)}::uuid, ${lit(unrequested)}::uuid)`))
      .fulfilled === false &&
      Number(
        (
          await q(
            `select count(*)::int n from public.documents where imported_from_document_id = ${lit(unrequested)}::uuid`,
          )
        )[0]?.n,
      ) === 0,
  )
  const body = LONG('policy text read from drive')
  await q(
    `update public.documents set content = ${lit(body)}, content_fingerprint = ${lit(await sha(body))}, content_chars = ${String(body.length)}, fetched_at = now() where document_id = ${lit(ref)}::uuid`,
  )
  const f = await call(`app.document_import_fulfil(${lit(OFFICE)}::uuid, ${lit(ref)}::uuid)`)
  check(
    'once the drive read has brought the material in, the request is fulfilled into the copy',
    f.fulfilled === true &&
      typeof f.copy_id === 'string' &&
      (
        await q(
          `select content from public.documents where document_id = ${lit(String(f.copy_id))}::uuid`,
        )
      )[0]?.content === body,
  )
  check(
    '...and a later import press says already',
    (await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(ref)}::uuid)`)).already ===
      true,
  )
  check(
    'a document Team HQ already holds cannot be imported',
    (await call(`app.hq_document_import(${lit(OFFICE)}::uuid, ${lit(u1)}::uuid)`)).ok === false,
  )
  check(
    'tenant isolation: another office cannot import it',
    (await call(`app.hq_document_import(${lit(OTHER)}::uuid, ${lit(o1)}::uuid)`)).ok === false,
  )
  await q('savepoint dup')
  const dupRefused = await q(
    `insert into public.documents (office_id, project_id, title, origin, imported_from_document_id) values (${lit(OFFICE)}::uuid, ${lit(clean)}::uuid, 'dup', 'yours', ${lit(o1)}::uuid)`,
  ).then(
    () => 'NOT REFUSED',
    (e: Error) => e.message,
  )
  await q('rollback to savepoint dup')
  check(
    'the unique index refuses a second copy by any other route (asserted on its name)',
    typeof dupRefused === 'string' && dupRefused.includes('documents_one_import_per_original'),
    String(dupRefused),
  )

  // =========================================================== 4. isolation
  check(
    "project isolation: another project's documents are not listed",
    item(l, otherProject) === undefined && item(l, t1) !== undefined,
  )
  check(
    "tenant isolation: another office cannot read this project's list",
    (await list(OTHER, CS)).error !== undefined,
  )
  check('fixture projects are not listed', (await list(OFFICE, FIXSLUG)).error !== undefined)
  check(
    'an unknown project answers a sentence, not a list',
    typeof (await list(OFFICE, 'no-such-project-xyz')).error === 'string',
  )

  // =========================================================== 5. nothing deletes a document
  const defs =
    await q(`select p.oid::regprocedure::text sig from pg_proc p where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
                         and pg_get_functiondef(p.oid) ~* 'delete\\s+from\\s+(only\\s+)?(public\\.)?documents\\M' `)
  check(
    'no database function deletes from documents',
    defs.length === 0,
    defs.map((d) => d.sig).join(', '),
  )
  const trap = await q(
    `select count(*)::int n from pg_proc p where p.pronamespace = 'app'::regnamespace and pg_get_functiondef(p.oid) ~* 'delete\\s+from\\s+public\\.document_orders'`,
  )
  check('CONTROL: the same scan does find a real delete (document_orders)', Number(trap[0]?.n) >= 1)
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(p) ? [p] : []
    })
  const offenders = [...walk('src'), ...walk('supabase/functions')].filter((p) =>
    /delete\s+from\s+(public\.)?documents\b/i.test(readFileSync(p, 'utf8')),
  )
  check('no TypeScript source deletes from documents', offenders.length === 0, offenders.join(', '))
  const tools = await q(
    `select tool from public.tool_permissions where tool ~* 'document' or tool ~* 'drive'`,
  )
  check(
    'no registered agent tool is a document deletion',
    tools.every((t) => !/delete|discard|remove|trash/i.test(String(t.tool))),
    tools.map((t) => t.tool).join(', '),
  )
  check(
    'the Drive scope is read-only in code (no files.delete / DELETE to Drive)',
    !readFileSync('src/google/drive.ts', 'utf8').match(/method:\s*'DELETE'|files\.delete/),
  )
} finally {
  await q('rollback')
}

console.log(failed === 0 ? '\nall passed' : `\n${String(failed)} FAILED`)
await db.end()
process.exit(failed === 0 ? 0 : 1)

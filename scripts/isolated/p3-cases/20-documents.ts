/**
 * The document functions (migration 0720): documents, outputs, collections, relations, search, export, send.
 * Person A and Person B each have a project with the SAME slug ('docs-shared'), a document, a second document, an
 * output, a collection and an artifact, every one carrying that office's canary text.
 */
import { type Ctx, callerRoles, lit } from '../p3-app-lib.ts'

type Office = {
  office: string
  project: string
  other: string
  doc1: string
  doc2: string
  job: string
  output: string
  artifact: string
  task: string
}

export async function cases(c: Ctx): Promise<void> {
  const { A, B, canary } = c
  const S = 'service_role'
  const q = (v: string) => lit(v)
  const nobody = c.nobody()
  const uid = () => crypto.randomUUID()

  const one = async (sql: string): Promise<string> =>
    String(Object.values((await c.db.execute(sql)).rows[0] as Record<string, unknown>)[0])

  // app.project_export calls app.project_automations(p_office, project), which the projects cluster converts. Until that
  // migration is in the clone, stand in for it with the office-checked shape over the legacy function, and say so.
  const standIn = (
    await c.db.execute(
      `select count(*)::int as n from pg_proc where proname = 'project_automations' and pronamespace = 'app'::regnamespace and pg_get_function_arguments(oid) like 'p_office uuid%'`,
    )
  ).rows[0] as { n: number }
  const madeStandIn = standIn.n === 0
  if (madeStandIn)
    await c.db.execute(
      `create function app.project_automations(p_office uuid, p_project_id uuid) returns jsonb language sql stable security definer set search_path to '' as $f$ select app.project_automations(p_project_id) where exists (select 1 from public.projects where project_id = p_project_id and office_id = p_office) $f$`,
    )

  // ---- fixtures: the same slug, different offices, different words -------------------------------------------------
  const make = async (office: string, word: string): Promise<Office> => {
    const o: Office = {
      office,
      project: uid(),
      other: uid(),
      doc1: uid(),
      doc2: uid(),
      job: uid(),
      output: uid(),
      artifact: uid(),
      task: uid(),
    }
    await c.db.execute(`
      insert into public.projects (project_id, slug, name, status, office_id) values
        ('${o.project}', 'docs-shared', 'Docs ${word}', 'paused', '${office}'),
        ('${o.other}', 'docs-other-${word.toLowerCase()}', 'Docs other ${word}', 'paused', '${office}');
      insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id, understood_as)
        values ('${o.job}', '${o.job}', 'p3docs-${o.job}', 'probe', 'p3docs-${word}', '${o.project}', '${office}', '${word} asked a question');
      insert into public.outputs (output_id, job_id, body, confidence, evidence)
        values ('${o.output}', '${o.job}', '${word} answer zebra herd migrates', 'high', 'inferred');
      insert into public.documents (document_id, project_id, office_id, title, content, content_fingerprint, content_chars, fetched_at, origin, state, produced_by, tags)
        values
        ('${o.doc1}', '${o.project}', '${office}', '${word} plan', '${word} pricing roadmap zebra', repeat('a', 64), 30, now(), 'made', 'draft', 'chief-of-staff', '{alpha}'),
        ('${o.doc2}', '${o.project}', '${office}', '${word} second', '${word} appendix zebra stripes', repeat('b', 64), 30, now(), 'made', 'approved', 'chief-of-staff', '{}');
      insert into public.artifacts (artifact_id, project_id, notebook_ref, kind, title) values
        ('${o.artifact}', '${o.project}', 'nb-${o.artifact}', 'slides', '${word} deck');
      insert into public.tasks (task_id, title, office_id, project_id) values ('${o.task}', '${word} task', '${office}', '${o.project}');`)
    return o
  }
  const a = await make(A, canary.A)
  const b = await make(B, canary.B)

  const svc = (sql: string) => c.exec(S, sql)
  const rows = (fn: string) => `select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from ${fn} s`

  // The derived tables have no office column: their owner is the project they hang from.
  const derived = async (office: string): Promise<string> => {
    const parts: string[] = []
    for (const [t, sql] of [
      [
        'collections',
        `select x from public.collections x join public.projects p using (project_id) where p.office_id = '${office}'`,
      ],
      [
        'document_collections',
        `select x from public.document_collections x join public.documents d using (document_id) where d.office_id = '${office}'`,
      ],
      [
        'relations',
        `select x from public.relations x join public.projects p using (project_id) where p.office_id = '${office}'`,
      ],
      [
        'document_orders',
        `select x from public.document_orders x join public.projects p using (project_id) where p.office_id = '${office}'`,
      ],
      [
        'outputs',
        `select x from public.outputs x join public.jobs j using (job_id) where j.office_id = '${office}'`,
      ],
      [
        'artifacts',
        `select x from public.artifacts x join public.projects p using (project_id) where p.office_id = '${office}'`,
      ],
    ] as const) {
      const h = await one(
        `select coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from (${sql}) z(x)`,
      )
      parts.push(`${t}=${h}`)
    }
    return parts.join(',')
  }
  const tablesB = ['documents', 'tasks', 'jobs', 'undoable_actions', 'inbound_commands'] as const
  const snapB = async () => `${await c.snapshot(B, tablesB)}|${await derived(B)}`

  // B has a collection and a relation of its own, made through the converted writers
  await svc(`select public.put_in_collection(${q(B)}, '${b.doc1}', ${lit(`${canary.B} shelf`)})`)
  await svc(
    `select public.link(${q(B)}, '${b.project}', 'document', '${b.doc1}', 'derived_from', 'document', '${b.doc2}')`,
  )
  await svc(
    `select public.link(${q(A)}, '${a.project}', 'document', '${a.doc1}', 'derived_from', 'document', '${a.doc2}')`,
  )
  await svc(
    `select public.hq_document_order_set(${q(B)}, 'docs-shared', '["${b.doc2}","${b.doc1}"]'::jsonb)`,
  )

  // ---- the same slug is two projects ------------------------------------------------------------------------------
  const ordered = (await svc(
    `select public.hq_document_order_set(${q(A)}, 'docs-shared', '["${a.doc2}","${a.doc1}","${b.doc1}"]'::jsonb)`,
  )) as { ok?: boolean; kept?: number }
  c.check(
    ordered.ok === true && ordered.kept === 2,
    "A orders A's documents under the slug both offices use, and B's id in the list is dropped",
    c.json(ordered),
  )
  const orderRows = await one(
    `select count(*) from public.document_orders o join public.projects p using (project_id) where p.slug = 'docs-shared' and o.project_id in ('${a.project}', '${b.project}')`,
  )
  c.check(orderRows === '2', 'each office has its own order under that slug', `rows: ${orderRows}`)

  // ---- search: filtered in the SQL that fetches the rows -------------------------------------------------------------
  const searchA = c.json(await svc(rows(`public.studio_search(${q(A)}, 'zebra')`)))
  c.check(
    searchA.includes(canary.A) &&
      searchA.includes('"kind":"document"') &&
      searchA.includes('"kind":"answer"'),
    "A's search for a shared word finds A's documents and A's answers (so the others are not empty by accident)",
    searchA.slice(0, 90),
  )
  c.check(!searchA.includes(canary.B), "A's search never returns B's canary", '')
  const searchB = c.json(await svc(rows(`public.studio_search(${q(B)}, 'zebra')`)))
  c.check(
    searchB.includes(canary.B) && !searchB.includes(canary.A),
    "B's search finds B's and never A's",
    '',
  )
  // The canary retrieval case: B's own text, asked for by name, is reachable by B and invisible to A.
  const bWord = canary.B.toLowerCase()
  const askB = c.json(await svc(rows(`public.studio_search(${q(B)}, ${lit(bWord)})`)))
  const askA = c.json(await svc(rows(`public.studio_search(${q(A)}, ${lit(bWord)})`)))
  c.check(
    askB.includes(canary.B) && askA === '[]',
    "searching for B's canary text: B finds it, A gets nothing at all",
    `B ${askB.length} chars, A ${askA}`,
  )
  const viaProject = c.json(
    await svc(rows(`public.studio_search(${q(A)}, 'zebra', '${b.project}'::uuid)`)),
  )
  c.check(viaProject === '[]', "A cannot search B's project by naming it", viaProject.slice(0, 60))
  const viaRelated = c.json(
    await svc(
      rows(
        `public.studio_search(${q(A)}, 'zebra', null, 12, '{"related_to": {"kind": "document", "id": "${b.doc1}"}}'::jsonb)`,
      ),
    ),
  )
  const viaRelatedMissing = c.json(
    await svc(
      rows(
        `public.studio_search(${q(A)}, 'zebra', null, 12, '{"related_to": {"kind": "document", "id": "${nobody}"}}'::jsonb)`,
      ),
    ),
  )
  c.check(
    viaRelated === viaRelatedMissing && !viaRelated.includes(canary.B),
    "a related_to filter naming B's document answers exactly as one naming nothing",
    viaRelated.slice(0, 60),
  )
  const tagged = c.json(
    await svc(rows(`public.studio_search(${q(A)}, 'zebra', null, 12, '{"tag": "alpha"}'::jsonb)`)),
  )
  c.check(
    tagged.includes(canary.A) && !tagged.includes(canary.B),
    'a tag filter narrows inside the office (A has the tag, B has it too, only A is shown)',
    '',
  )

  // ---- relations: both ends must be the office's -----------------------------------------------------------------------
  const relA = c.json(await svc(rows(`public.relations_of(${q(A)}, 'document', '${a.doc1}')`)))
  c.check(
    relA.includes(canary.A) && relA.includes('derived_from') && !relA.includes(canary.B),
    "relations_of A's document shows A's edge and titles",
    relA.slice(0, 100),
  )
  const relForeign = c.json(
    await svc(rows(`public.relations_of(${q(A)}, 'document', '${b.doc1}')`)),
  )
  const relMissing = c.json(
    await svc(rows(`public.relations_of(${q(A)}, 'document', '${nobody}')`)),
  )
  c.check(
    relForeign === relMissing && !relForeign.includes(canary.B),
    "relations_of B's document asked by A is empty, exactly as a document that is nowhere",
    relForeign,
  )
  const relColl = c.json(
    await svc(
      rows(
        `public.relations_of(${q(A)}, 'agent', (select staff_id from public.staff where slug = 'chief-of-staff'))`,
      ),
    ),
  )
  c.check(
    !relColl.includes(canary.B),
    "an agent's edges, asked by A, carry none of B's documents",
    '',
  )
  const norm = (s: string, ...ids: string[]) => ids.reduce((acc, i) => acc.replaceAll(i, '<id>'), s)
  const linkErr = async (id: string) => {
    const r = await c.try_(
      S,
      `select public.link(${q(A)}, '${a.project}', 'document', '${a.doc1}', 'mentions', 'document', '${id}')`,
    )
    return r.ok ? 'ACCEPTED' : r.error
  }
  const lf = norm(await linkErr(b.doc1), b.doc1, nobody)
  const lm = norm(await linkErr(nobody), b.doc1, nobody)
  c.check(
    lf === lm && lf.includes('no document with id'),
    "link: an edge to B's document is refused in the very words used for a document that is nowhere",
    lf.slice(0, 80),
  )
  const lp = await c.try_(
    S,
    `select public.link(${q(A)}, '${b.project}', 'document', '${a.doc1}', 'mentions', 'document', '${a.doc2}')`,
  )
  c.check(
    !lp.ok && lp.error.includes('no project with id'),
    "link: A cannot hang an edge under B's project",
    lp.ok ? 'ACCEPTED' : lp.error.slice(0, 80),
  )
  const stored = await one(
    `select count(*) from public.relations r join public.projects p using (project_id) where p.office_id = '${A}'`,
  )
  c.check(stored === '1', "A's relations are still exactly the one A made", `rows: ${stored}`)

  // ---- a foreign id and a missing id give THE SAME ANSWER, and nothing of B's moves ------------------------------------
  const before = await snapB()
  const same = async (what: string, mk: (id: string) => string, foreign = b.doc1) => {
    const f = await c.try_(S, mk(foreign))
    const m = await c.try_(S, mk(nobody))
    const fs = norm(f.ok ? c.json(f.value) : `ERR ${f.error}`, foreign, nobody)
    const ms = norm(m.ok ? c.json(m.value) : `ERR ${m.error}`, foreign, nobody)
    c.check(
      fs === ms,
      `${what}: B's id and a nonexistent id are indistinguishable to A`,
      fs === ms ? fs.slice(0, 80) : `${fs.slice(0, 55)} vs ${ms.slice(0, 55)}`,
    )
  }
  await same(
    'approve_document',
    (id) => `select public.approve_document(${q(A)}, '${id}', null, null, null, null, 'grant')`,
  )
  await same(
    'approve_document (a collection)',
    (id) => `select public.approve_document(${q(A)}, '${id}', 'shelf', '{x}', null, null, 'grant')`,
  )
  await same(
    'discard_document',
    (id) => `select public.discard_document(${q(A)}, '${id}', 'no', 'grant')`,
  )
  await same('rename_document', (id) => `select public.rename_document(${q(A)}, '${id}', 'taken')`)
  await same('tag_document', (id) => `select public.tag_document(${q(A)}, '${id}', 'taken')`)
  await same(
    'put_in_collection',
    (id) => `select public.put_in_collection(${q(A)}, '${id}', 'taken')`,
  )
  await same(
    'take_out_of_collection',
    (id) => `select public.take_out_of_collection(${q(A)}, '${id}', ${lit(`${canary.B} shelf`)})`,
  )
  await same('hq_document_pin', (id) => `select public.hq_document_pin(${q(A)}, '${id}', true)`)
  await same(
    'hq_document_restore',
    (id) => `select public.hq_document_restore(${q(A)}, '${id}', 'approved')`,
  )
  await same(
    'hq_document_move (the document)',
    (id) => `select public.hq_document_move(${q(A)}, '${id}', '${a.other}')`,
  )
  await same(
    'hq_document_move (the target project)',
    (id) => `select public.hq_document_move(${q(A)}, '${a.doc1}', '${id}')`,
    b.other,
  )
  await same(
    'hq_document_supersede (the old one)',
    (id) => `select public.hq_document_supersede(${q(A)}, '${id}', '${a.doc2}')`,
  )
  await same(
    'hq_document_supersede (the new one)',
    (id) => `select public.hq_document_supersede(${q(A)}, '${a.doc1}', '${id}')`,
  )
  await same('studio_document', (id) => `select public.studio_document(${q(A)}, '${id}')`)
  await same('hq_output', (id) => `select public.hq_output(${q(A)}, '${id}')`, b.output)
  await same(
    'decide_output',
    (id) => `select public.decide_output(${q(A)}, '${id}', 'rejected', 'a good enough reason')`,
    b.output,
  )
  await same('import_output', (id) => `select public.import_output(${q(A)}, '${id}')`, b.output)
  await same('awaiting_review', (id) => rows(`public.awaiting_review(${q(A)}, '${id}')`), b.project)
  await same(
    'project_artifacts',
    (id) => `select public.project_artifacts(${q(A)}, '${id}')`,
    b.project,
  )
  await same(
    'send_to_agent',
    (id) =>
      `select public.send_to_agent(${q(A)}, 'document', '${id}', 'summarise', null, null, null, 'grant')`,
  )
  await same(
    'send_to_agent (a second thing)',
    (id) =>
      `select public.send_to_agent(${q(A)}, 'document', '${a.doc1}', 'summarise', null, '${id}', null, 'grant')`,
  )
  const bShelf = await one(
    `select collection_id from public.collections where project_id = '${b.project}' limit 1`,
  )
  await same(
    'send_to_agent (a collection)',
    (id) =>
      `select public.send_to_agent(${q(A)}, 'collection', '${id}', 'summarise', null, null, null, 'grant')`,
    bShelf,
  )
  const bRef = uid()
  await c.db.execute(
    `insert into public.project_references (reference_id, project_id, kind, title, url) values ('${bRef}', '${b.project}', 'website', 'B reference', 'https://example.invalid/b')`,
  )
  await same(
    'approve_document (a source of B)',
    (id) =>
      `select public.approve_document(${q(A)}, '${a.doc1}', null, null, null, '${id}', 'grant')`,
    bRef,
  )
  await same(
    'hq_document_link (a project)',
    (id) => `select public.hq_document_link(${q(A)}, '${id}', 'drive', 'file-p3', 'A file')`,
    b.project,
  )
  await same(
    'record_file_document (a project)',
    (id) =>
      `select public.record_file_document(${q(A)}, '${id}', 't', 'p/x.pdf', 'application/pdf', 10)`,
    b.project,
  )
  await same(
    'record_file_document (a job)',
    (id) =>
      `select public.record_file_document(${q(A)}, '${a.project}', 't', 'p/y.pdf', 'application/pdf', 10, null, null, null, 'chief-of-staff', '${id}')`,
    b.job,
  )
  await same(
    'hq_document_order_set (a slug only B has)',
    (id) => `select public.hq_document_order_set(${q(A)}, '${id}', '["${a.doc1}"]'::jsonb)`,
    'only-b-has-this',
  )
  await same(
    'hq_document_order_reset (a slug only B has)',
    (id) => `select public.hq_document_order_reset(${q(A)}, '${id}')`,
    'only-b-has-this',
  )
  // the package, apart from the moment it was made
  const pkg = async (id: string) => {
    const r = (await svc(`select public.project_export(${q(A)}, '${id}')`)) as Record<
      string,
      unknown
    >
    r.exported_at = null
    return c.json(r)
  }
  const ex = await pkg(b.project)
  const em = await pkg(nobody)
  c.check(
    ex === em && !ex.includes(canary.B),
    "project_export of B's project, asked by A, is exactly the export of a project that does not exist",
    ex.slice(0, 100),
  )
  await c.db.execute(
    `insert into public.projects (project_id, slug, name, status, office_id) values ('${uid()}', 'only-b-has-this', 'B only', 'paused', '${B}') on conflict do nothing`,
  )
  await same(
    'hq_document_order_set (that slug, once it exists in B)',
    (id) => `select public.hq_document_order_set(${q(A)}, '${id}', '["${a.doc1}"]'::jsonb)`,
    'only-b-has-this',
  )
  await same('hq_artifacts (a global list, scoped)', () => `select public.hq_artifacts(${q(A)})`)
  c.check(
    before === (await snapB()),
    "nothing of B's moved while A attacked (documents, tasks, jobs, commands, undo, collections, links, orders, outputs, artifacts)",
    '',
  )

  // ---- the lists and the export hold only the caller's ---------------------------------------------------------------------
  const art = c.json(await svc(`select public.hq_artifacts(${q(A)})`))
  c.check(
    art.includes(canary.A) && !art.includes(canary.B),
    "hq_artifacts: A's list holds A's deck and not B's",
    '',
  )
  const pa = c.json(await svc(`select public.project_artifacts(${q(A)}, '${a.project}')`))
  c.check(
    pa.includes(canary.A) && !pa.includes(canary.B),
    "project_artifacts: A's project, A's deck",
    '',
  )
  const review = c.json(await svc(rows(`public.awaiting_review(${q(A)}, '${a.project}')`)))
  c.check(
    review.includes(canary.A) && !review.includes(canary.B),
    "awaiting_review: the drafts under A's project, and none of B's",
    '',
  )
  const doc = c.json(await svc(`select public.studio_document(${q(A)}, '${a.doc1}')`))
  c.check(doc.includes(canary.A), "studio_document: A reads A's own document", '')
  const out = c.json(await svc(`select public.hq_output(${q(A)}, '${a.output}')`))
  c.check(
    out.includes(canary.A) && !out.includes(canary.B),
    "hq_output: A reads A's own answer",
    '',
  )
  const own = await pkg(a.project)
  c.check(
    own.includes(canary.A) && !own.includes(canary.B),
    "project_export: A's package holds A's words and not B's",
    '',
  )

  // ---- the right office can do all of it, and a send puts a command in the caller's office ---------------------------------------
  const bridgeBefore = Number(
    await one(
      `select coalesce(sum(n),0)::int from public.office_bridge_use where table_name in ('documents','undoable_actions','inbound_commands')`,
    ),
  )
  const renamed = (await svc(
    `select public.rename_document(${q(A)}, '${a.doc2}', 'Second, renamed')`,
  )) as { ok?: boolean; undo?: string }
  c.check(
    renamed.ok === true && typeof renamed.undo === 'string',
    "A renames A's document and is offered an undo",
    c.json(renamed).slice(0, 80),
  )
  const crossUndo = c.json(await svc(`select public.hq_undo(${q(B)}, '${renamed.undo ?? ''}')`))
  c.check(
    crossUndo === c.json(await svc(`select public.hq_undo(${q(B)}, '${nobody}')`)),
    "B cannot undo A's rename and cannot tell it exists",
    crossUndo.slice(0, 80),
  )
  const undone = (await svc(`select public.hq_undo(${q(A)}, '${renamed.undo ?? ''}')`)) as {
    ok?: boolean
  }
  const nameNow = await one(`select title from public.documents where document_id = '${a.doc2}'`)
  c.check(
    undone.ok === true && nameNow === `${canary.A} second`,
    "A's undo of the rename puts the title back",
    nameNow,
  )

  const moved = (await svc(
    `select public.hq_document_move(${q(A)}, '${a.doc2}', '${a.other}')`,
  )) as { moved?: boolean; undo?: string }
  const movedTo = await one(
    `select project_id from public.documents where document_id = '${a.doc2}'`,
  )
  c.check(
    moved.moved === true && movedTo === a.other,
    "A moves A's document to A's other project",
    c.json(moved).slice(0, 80),
  )
  const movedBack = (await svc(`select public.hq_undo(${q(A)}, '${moved.undo ?? ''}')`)) as {
    ok?: boolean
  }
  c.check(
    movedBack.ok === true &&
      (await one(`select project_id from public.documents where document_id = '${a.doc2}'`)) ===
        a.project,
    'and the undo of the move puts it back',
    '',
  )
  const sup = (await svc(
    `select public.hq_document_supersede(${q(A)}, '${a.doc2}', '${a.doc1}')`,
  )) as { superseded?: boolean; undo?: string }
  const supBack = (await svc(`select public.hq_undo(${q(A)}, '${sup.undo ?? ''}')`)) as {
    ok?: boolean
  }
  c.check(
    sup.superseded === true &&
      supBack.ok === true &&
      (await one(`select state from public.documents where document_id = '${a.doc2}'`)) ===
        'approved',
    'supersede, then undo (the document_restore branch), restores the state',
    c.json(sup).slice(0, 60),
  )
  const pinned = (await svc(`select public.hq_document_pin(${q(A)}, '${a.doc1}', true)`)) as {
    pinned?: boolean
  }
  const tagged1 = (await svc(`select public.tag_document(${q(A)}, '${a.doc1}', 'Beta')`)) as {
    ok?: boolean
    tags?: string[]
  }
  const coll = await svc(`select public.put_in_collection(${q(A)}, '${a.doc1}', 'shelf')`)
  const takeOut = (await svc(
    `select public.take_out_of_collection(${q(A)}, '${a.doc1}', 'shelf')`,
  )) as { ok?: boolean; removed_from?: string }
  c.check(
    pinned.pinned === true &&
      tagged1.ok === true &&
      typeof coll === 'string' &&
      takeOut.removed_from === 'shelf',
    'pin, tag, put in a collection, take out: all work for the owner',
    c.json([pinned, tagged1, takeOut]).slice(0, 100),
  )
  const sameShelf = await one(
    `select count(*) from public.collections co join public.projects p using (project_id) where co.name = 'shelf'`,
  )
  c.check(
    sameShelf === '1',
    "a collection named 'shelf' exists once, in A's project",
    `rows: ${sameShelf}`,
  )
  const approved = (await svc(
    `select public.approve_document(${q(A)}, '${a.doc1}', 'finals', '{ok}', '${a.task}', null, 'grant')`,
  )) as { ok?: boolean }
  c.check(
    approved.ok === true,
    'approve_document with a collection and a task works for the owner',
    c.json(approved).slice(0, 80),
  )
  const task2b = await c.try_(
    S,
    `select public.approve_document(${q(A)}, '${a.doc1}', null, null, '${b.task}', null, 'grant')`,
  )
  const task2m = await c.try_(
    S,
    `select public.approve_document(${q(A)}, '${a.doc1}', null, null, '${nobody}', null, 'grant')`,
  )
  c.check(
    !task2b.ok &&
      !task2m.ok &&
      norm(task2b.error, b.task, nobody) === norm(task2m.error, b.task, nobody),
    "approve_document naming B's task as the related one is refused as a task that is nowhere",
    task2b.ok ? 'ACCEPTED' : task2b.error.slice(0, 80),
  )
  // a plain reference is a source too: the relations guard used to refuse every one
  const ref = uid()
  await c.db.execute(
    `insert into public.project_references (reference_id, project_id, kind, title, url) values ('${ref}', '${a.project}', 'website', 'A reference', 'https://example.invalid/a')`,
  )
  const withRef = (await svc(
    `select public.approve_document(${q(A)}, '${a.doc2}', null, null, null, '${ref}', 'grant')`,
  )) as { ok?: boolean; source?: string }
  c.check(
    withRef.ok === true && withRef.source === 'A reference',
    'a document can be derived from a plain reference source',
    c.json(withRef).slice(0, 80),
  )
  const discarded = (await svc(
    `select public.discard_document(${q(A)}, '${a.doc2}', 'because', 'grant')`,
  )) as { ok?: boolean }
  const restored = (await svc(
    `select public.hq_document_restore(${q(A)}, '${a.doc2}', 'approved')`,
  )) as { restored?: boolean }
  c.check(
    discarded.ok === true && restored.restored === true,
    'discard then restore works for the owner',
    '',
  )
  const imp = (await svc(
    `select public.import_output(${q(A)}, '${a.output}', 'imported', '{done}', null, null, null)`,
  )) as { ok?: boolean; document?: string }
  const impOffice =
    imp.document === undefined
      ? ''
      : await one(`select office_id from public.documents where document_id = '${imp.document}'`)
  c.check(
    imp.ok === true && impOffice === A,
    "import_output files the document in A's office",
    c.json(imp).slice(0, 80),
  )
  const dec = (await svc(
    `select public.decide_output(${q(A)}, '${a.output}', 'pending', null)`,
  )) as { ok?: boolean }
  c.check(dec.ok === true, 'decide_output works for the owner', c.json(dec))
  const linked = (await svc(
    `select public.hq_document_link(${q(A)}, '${a.project}', 'drive', 'file-p3', 'A file', 'application/pdf')`,
  )) as { ok?: boolean; added?: boolean; id?: string }
  const linkedOffice =
    linked.id === undefined
      ? ''
      : await one(`select office_id from public.documents where document_id = '${linked.id}'`)
  c.check(
    linked.ok === true && linkedOffice === A,
    "hq_document_link files a linked file in A's office",
    c.json(linked).slice(0, 80),
  )
  // the provider's file id is unique PER OFFICE (0862): B linking the same Drive file gets its own document, A's is
  // untouched, and B is not told that A holds it
  const takenFile = c.json(
    await svc(
      `select public.hq_document_link(${q(B)}, '${b.project}', 'drive', 'file-p3', 'B file', 'application/pdf')`,
    ),
  )
  const held = (
    await c.db.execute(
      `select office_id::text as o, title from public.documents where connector = 'drive' and external_ref = 'file-p3' order by office_id`,
    )
  ).rows as { o: string; title: string }[]
  c.check(
    held.length === 2 &&
      held.some((r) => r.o === A && r.title === 'A file') &&
      held.some((r) => r.o === B && r.title === 'B file') &&
      !takenFile.includes(canary.A),
    "B linking a file A already holds makes B's own document, changes nothing of A's and learns nothing",
    c.json(held),
  )
  const rec = (await svc(
    `select public.record_file_document(${q(A)}, '${a.project}', 'A report', 'p3/a.pdf', 'application/pdf', 99, null, null, null, 'chief-of-staff', '${a.job}')`,
  )) as { document_id?: string }
  const recOffice =
    rec.document_id === undefined
      ? ''
      : await one(`select office_id from public.documents where document_id = '${rec.document_id}'`)
  c.check(
    recOffice === A,
    "record_file_document files the file in A's office",
    c.json(rec).slice(0, 80),
  )
  const sent = (await svc(
    `select public.send_to_agent(${q(A)}, 'document', '${a.doc1}', 'summarise', null, null, null, 'grant')`,
  )) as { ok?: boolean; job?: string }
  const cmdOffice =
    sent.ok === true
      ? await one(
          `select office_id from public.inbound_commands where context ->> 'asset_id' = '${a.doc1}' limit 1`,
        )
      : ''
  c.check(
    sent.ok === true && cmdOffice === A,
    "send_to_agent puts the command in A's office",
    c.json(sent).slice(0, 100),
  )
  const bridgeAfter = Number(
    await one(
      `select coalesce(sum(n),0)::int from public.office_bridge_use where table_name in ('documents','undoable_actions','inbound_commands')`,
    ),
  )
  c.check(
    bridgeAfter === bridgeBefore,
    'the converted document writers added no compatibility-bridge uses (documents, undoable_actions, inbound_commands)',
    `before ${String(bridgeBefore)}, after ${String(bridgeAfter)}`,
  )

  // ---- no office, no work; and the doors are shut to the browser's own roles -------------------------------------------
  const calls: [string, (o: string) => string][] = [
    [
      'approve_document',
      (o) => `select public.approve_document(${o}, '${a.doc1}', null, null, null, null, 'grant')`,
    ],
    ['awaiting_review', (o) => `select * from public.awaiting_review(${o}, '${a.project}')`],
    ['decide_output', (o) => `select public.decide_output(${o}, '${a.output}', 'pending')`],
    ['discard_document', (o) => `select public.discard_document(${o}, '${a.doc1}', null, 'grant')`],
    ['hq_artifacts', (o) => `select public.hq_artifacts(${o})`],
    [
      'hq_document_link',
      (o) => `select public.hq_document_link(${o}, '${a.project}', 'drive', 'f', 't')`,
    ],
    ['hq_document_move', (o) => `select public.hq_document_move(${o}, '${a.doc1}', '${a.other}')`],
    [
      'hq_document_order_reset',
      (o) => `select public.hq_document_order_reset(${o}, 'docs-shared')`,
    ],
    [
      'hq_document_order_set',
      (o) => `select public.hq_document_order_set(${o}, 'docs-shared', '[]'::jsonb)`,
    ],
    ['hq_document_pin', (o) => `select public.hq_document_pin(${o}, '${a.doc1}', false)`],
    ['hq_document_restore', (o) => `select public.hq_document_restore(${o}, '${a.doc1}')`],
    [
      'hq_document_supersede',
      (o) => `select public.hq_document_supersede(${o}, '${a.doc1}', '${a.doc2}')`,
    ],
    ['hq_output', (o) => `select public.hq_output(${o}, '${a.output}')`],
    ['import_output', (o) => `select public.import_output(${o}, '${a.output}')`],
    [
      'link',
      (o) =>
        `select public.link(${o}, '${a.project}', 'document', '${a.doc1}', 'mentions', 'document', '${a.doc2}')`,
    ],
    ['project_artifacts', (o) => `select public.project_artifacts(${o}, '${a.project}')`],
    ['project_export', (o) => `select public.project_export(${o}, '${a.project}')`],
    ['put_in_collection', (o) => `select public.put_in_collection(${o}, '${a.doc1}', 'x')`],
    [
      'record_file_document',
      (o) =>
        `select public.record_file_document(${o}, '${a.project}', 't', 'p/z.pdf', 'application/pdf', 5)`,
    ],
    ['relations_of', (o) => `select * from public.relations_of(${o}, 'document', '${a.doc1}')`],
    ['rename_document', (o) => `select public.rename_document(${o}, '${a.doc1}', 'x')`],
    [
      'send_to_agent',
      (o) => `select public.send_to_agent(${o}, 'document', '${a.doc1}', 'summarise')`,
    ],
    ['studio_document', (o) => `select public.studio_document(${o}, '${a.doc1}')`],
    ['studio_search', (o) => `select * from public.studio_search(${o}, 'zebra')`],
    ['tag_document', (o) => `select public.tag_document(${o}, '${a.doc1}', 'x')`],
    [
      'take_out_of_collection',
      (o) => `select public.take_out_of_collection(${o}, '${a.doc1}', 'x')`,
    ],
  ]
  for (const [name, mk] of calls) {
    for (const [what, office] of [
      ['a null office', 'null::uuid'],
      ['an office that does not exist', `${lit(nobody)}::uuid`],
    ] as const) {
      const msg = await c.refusal(S, mk(office))
      c.check(msg.includes('no_office'), `${name}: ${what} is refused`, msg.slice(0, 70))
    }
    for (const role of callerRoles) {
      const msg = await c.refusal(role, mk(q(A)))
      c.check(
        msg.includes('permission denied'),
        `${name}: ${role} cannot call it`,
        msg.slice(0, 70),
      )
    }
  }
  const stale = await one(
    `select count(*) from pg_proc p where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace) and p.proname = any(array['approve_document','awaiting_review','decide_output','discard_document','hq_document_link','hq_document_move','hq_document_order_reset','hq_document_order_set','hq_document_pin','hq_document_restore','hq_document_supersede','hq_output','import_output','put_in_collection','record_file_document','rename_document','studio_document','tag_document','take_out_of_collection','relations_of','send_to_agent','hq_artifacts','project_artifacts','project_export','studio_search','link','artifacts_in']) and pg_get_function_arguments(p.oid) not like 'p_office uuid%'`,
  )
  c.check(
    stale === '0',
    'no unscoped signature of any document function is left behind',
    `left: ${stale}`,
  )
  if (madeStandIn) await c.db.execute('drop function app.project_automations(uuid, uuid)')
}

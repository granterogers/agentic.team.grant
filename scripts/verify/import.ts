/**
 * IMPORT TO PROJECT — where an output becomes a document.
 *
 *   npm run verify:import
 *
 * Issue #28, migrations 0315-0321.
 *
 * ## What the gate was before
 *
 * `workspace.js` wrote Grant's approve/drop to `localStorage`. So the thing #28
 * calls *"what moves an artifact into the project"* was a note in one browser:
 * it did not survive a different device, no agent could see it, and nothing
 * downstream could act on it. And `studio_documents` emitted `state` without
 * ever filtering on it, so an unapproved output would have appeared in the
 * gallery beside everything else.
 *
 * ## The two properties that matter
 *
 * **Importing CREATES.** An output is not a document awaiting approval — it is
 * a row in a different table with a different shape, and nothing had ever
 * converted one into the other. That is why the specification draws import as
 * its own box: choosing a collection and some tags at the moment a thing enters
 * the project is the only moment anybody will ever choose them.
 *
 * **Provenance cannot be passed in.** `produced_by` and `produced_by_job` come
 * off the output itself, so there is no parameter to get wrong — and the job
 * and agent edges are then DERIVED by `relations_of` (0310) rather than stored,
 * which is what makes #28's *"not removable"* literally true: there is no row
 * to delete.
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
const SLUG = `fixture-import-${run}`

console.log(`\nverify:import — ${run}\n`)

let projectId = ''
let jobId = ''
let outputId = ''
let documentId = ''

try {
  await one(`
    select app.hq_create_project(app.test_office(), ${lit(`Fixture import ${run}`)}, 'upload',
                                 ${lit(SLUG)}, ${lit(`Fixture import ${run}`)}, true) as r
  `)
  projectId = String(
    (await one(`select project_id::text as id from public.projects where slug = ${lit(SLUG)}`)).id,
  )

  jobId = String(
    (
      await one(`
        insert into public.jobs
          (correlation_id, project_id, idempotency_key, kind, requested_by, priority,
           state, recipient_agent, finished_at)
        -- jobs_finished_iff_terminal: a complete job HAS a finish time. The
        -- constraint is right and the omission was mine. No backticks in this
        -- comment either: it is inside a template literal.
        values (gen_random_uuid(), ${lit(projectId)}::uuid, ${lit(`verify:import:${run}`)},
                'research', ${lit(`verify:import:${run}`)}, 100, 'complete', 'research-director',
                app.now_utc())
        returning job_id::text as id
      `)
    ).id,
  )
  outputId = String(
    (
      await one(`
        insert into public.outputs (job_id, staff_id, body, confidence, evidence, sources)
        values (${lit(jobId)}::uuid,
                (select staff_id from public.staff where slug = 'research-director'),
                ${lit(`A finding worth keeping ${run}\nAnd a second line of it.`)},
                'medium', 'inferred', '[]'::jsonb)
        returning output_id::text as id
      `)
    ).id,
  )

  // =========================================================================
  console.log('an output is not yet in the project')

  const beforeGallery = await all(`
    select value->>'id' as id
      from jsonb_array_elements(app.studio_documents(${lit(projectId)}::uuid, 200))
  `)
  check(
    'nothing is in the gallery before the import',
    `${String(beforeGallery.length)} document(s)`,
    beforeGallery.length === 0,
  )

  // =========================================================================
  console.log('\nimporting creates the document, with what was chosen')

  const imported = (
    await one(`
      select public.import_output(app.test_office(), ${lit(outputId)}::uuid, ${lit(`Research ${run}`)},
        array['probe', 'PROBE-Upper'], null, null, ${lit(`Imported ${run}`)}) as r
    `)
  ).r as { ok?: boolean; document?: string; title?: string; error?: string }
  documentId = String(imported.document ?? '')
  check(
    'the import answers with the document it made',
    JSON.stringify(imported).slice(0, 100),
    imported.ok === true && documentId !== '',
  )

  const doc = await one(`
    select title, state, origin, produced_by, produced_by_job::text as job, tags
      from public.documents where document_id = ${lit(documentId)}::uuid
  `)
  check(
    'and the title chosen at import is the one it has',
    String(doc.title),
    String(doc.title) === `Imported ${run}`,
  )
  check(
    'and the tags chosen at import are on it',
    JSON.stringify(doc.tags),
    Array.isArray(doc.tags) && (doc.tags as string[]).includes('probe'),
  )
  const collections = await all(`
    select c.name from public.document_collections dc
      join public.collections c on c.collection_id = dc.collection_id
     where dc.document_id = ${lit(documentId)}::uuid
  `)
  check(
    'and it is filed in the collection chosen at import, which was made for it',
    collections.map((c) => String(c.name)).join(', '),
    collections.some((c) => String(c.name) === `Research ${run}`),
  )

  // =========================================================================
  console.log('\nprovenance comes off the output, not off a parameter')

  check(
    'the author and the job are recorded without being passed in',
    `produced_by=${String(doc.produced_by)} job=${String(doc.job) === jobId ? 'the right one' : 'WRONG'}`,
    doc.produced_by === 'research-director' && String(doc.job) === jobId,
  )
  const edges = await all(
    `select * from public.relations_of(app.test_office(), 'document', ${lit(documentId)}::uuid)`,
  )
  const verbs = edges.map((e) => `${String(e.verb)}:${String(e.other_kind)}`)
  check(
    'and the job and agent edges are traversable',
    verbs.join(', '),
    verbs.includes('produced:job') && verbs.includes('produced:agent'),
  )
  /*
    #28 asks for provenance that is *"not removable"*, and this is what makes
    that literally true rather than a policy: those two edges are DERIVED from
    `produced_by_job` and `produced_by` (0310), so there is no row in
    `relations` to delete.
  */
  const stored = Number(
    (
      await one(`
        select count(*)::int as n from public.relations
         where to_id = ${lit(documentId)}::uuid or from_id = ${lit(documentId)}::uuid
      `)
    ).n,
  )
  check(
    'and they are DERIVED, so there is no row anybody could delete',
    `${String(stored)} stored edge(s) for ${String(edges.length)} relation(s)`,
    stored === 0 && edges.length >= 2,
  )

  // =========================================================================
  console.log('\nand now it is in the project')

  const gallery = await all(`
    select value->>'id' as id
      from jsonb_array_elements(app.studio_documents(${lit(projectId)}::uuid, 200))
  `)
  check(
    'the gallery has it',
    `${String(gallery.length)} document(s)`,
    gallery.some((g) => String(g.id) === documentId),
  )
  /*
    CONTROL, and it is the acceptance criterion `studio_documents` failed
    before 0315: a document that is not approved must not appear. Asserted by
    putting this one BACK to draft rather than by making a second subject,
    because the same row appearing and disappearing is the property.
  */
  await db.execute(
    `update public.documents set state = 'draft' where document_id = ${lit(documentId)}::uuid`,
  )
  const hidden = await all(`
    select value->>'id' as id
      from jsonb_array_elements(app.studio_documents(${lit(projectId)}::uuid, 200))
  `)
  await db.execute(
    `update public.documents set state = 'approved' where document_id = ${lit(documentId)}::uuid`,
  )
  check(
    'CONTROL: an unapproved document is NOT in the gallery',
    `${String(hidden.length)} document(s) while it was a draft`,
    !hidden.some((h) => String(h.id) === documentId),
  )

  // =========================================================================
  console.log('\nthe output stops asking, and twice is once')

  const status = await one(
    `select reviewer_status::text as s from public.outputs where output_id = ${lit(outputId)}::uuid`,
  )
  check(
    'the output is settled, so the card leaves the waiting list',
    String(status.s),
    status.s === 'approved',
  )
  const again = (
    await one(`select public.import_output(app.test_office(), ${lit(outputId)}::uuid) as r`)
  ).r as {
    ok?: boolean
    document?: string
  }
  const copies = Number(
    (
      await one(`
        select count(*)::int as n from public.documents
         where external_ref = ${lit(`output:${outputId}`)}
      `)
    ).n,
  )
  check(
    'importing twice imports one document, not two',
    `${String(copies)} document(s), same id: ${String(again.document === documentId)}`,
    copies === 1 && again.document === documentId,
  )

  // =========================================================================
  console.log('\nand the other answer is a decision, not a deletion')

  const dropped = (
    await one(
      `select public.decide_output(app.test_office(), ${lit(outputId)}::uuid, 'rejected', 'not what I meant') as r`,
    )
  ).r as { ok?: boolean; was?: string; now?: string }
  const stillThere = Number(
    (
      await one(
        `select count(*)::int as n from public.outputs where output_id = ${lit(outputId)}::uuid`,
      )
    ).n,
  )
  check(
    'dropping records the decision and keeps the row',
    `${JSON.stringify(dropped)} · ${String(stillThere)} row(s) left`,
    dropped.ok === true && dropped.now === 'rejected' && stillThere === 1,
  )
  const undone = (
    await one(
      `select public.decide_output(app.test_office(), ${lit(outputId)}::uuid, 'pending') as r`,
    )
  ).r as { ok?: boolean; now?: string }
  check('and it can be undone', JSON.stringify(undone), undone.now === 'pending')

  /*
    `approved` is deliberately not settable this way. A button that set the
    status alone would leave an output marked approved with nothing in the
    project — the half-built gate this whole Issue is about.
  */
  const sneaky = (
    await one(
      `select public.decide_output(app.test_office(), ${lit(outputId)}::uuid, 'approved') as r`,
    )
  ).r as { ok?: boolean; error?: string }
  check(
    'CONTROL: approval cannot be set without importing, which is what creates the document',
    JSON.stringify(sneaky),
    sneaky.ok === false && String(sneaky.error).includes('import it'),
  )

  // =========================================================================
  console.log('\nand it refuses rather than guessing')

  const ghost = (
    await one(
      `select public.import_output(app.test_office(), '00000000-0000-0000-0000-000000000000'::uuid) as r`,
    )
  ).r as { ok?: boolean; error?: string }
  check(
    'an output that does not exist is refused',
    JSON.stringify(ghost),
    ghost.ok === false && String(ghost.error).includes('no such output'),
  )
  const badSource = (
    await one(`
      select public.import_output(app.test_office(), ${lit(outputId)}::uuid, null, null, null,
        '00000000-0000-0000-0000-000000000000'::uuid) as r
    `)
  ).r as { ok?: boolean; error?: string }
  check(
    'and a source that is not this project is refused, rather than stored as a dangling edge',
    JSON.stringify(badSource).slice(0, 100),
    badSource.ok === false && String(badSource.error).includes('does not belong'),
  )
  // =========================================================================
  console.log('\nthe structure is read before the prose (#130)')
  // =========================================================================

  /*
    #130's title, in one sentence: *the import step is parsing English*. It
    was, in the one place that mattered — the document's title came from
    `split_part(body, E'\n', 1)`, the first line, which works until an answer
    opens with "Here is the summary you asked for:".

    `public.output_shapes` has declared `draft_document` with a required
    `title` since 0272 and nothing read it. 0417 does. Both directions are
    checked here, because a reader that ALWAYS prefers the structure would
    lose the title on the 3,240 outputs that declare none.
  */
  const declaredId = String(
    (
      await one(`
        insert into public.outputs (job_id, staff_id, body, confidence, evidence, sources,
                                    shape, facts)
        values (${lit(jobId)}::uuid,
                (select staff_id from public.staff where slug = 'research-director'),
                ${lit(`Here is the summary you asked for:\n\nIt is all fine ${run}.`)},
                'medium', 'inferred', '[]'::jsonb,
                'draft_document',
                ${lit(JSON.stringify({ title: `The pricing note ${run}`, markdown: '#' }))}::jsonb)
        returning output_id::text as id
      `)
    ).id,
  )
  const declared = (
    await one(`select public.import_output(app.test_office(), ${lit(declaredId)}::uuid) as r`)
  ).r as {
    ok?: boolean
    title?: string
    title_from_structure?: boolean
  }
  check(
    'a title the output DECLARED beats the first line of its prose',
    `${String(declared.title)} (from structure: ${String(declared.title_from_structure)})`,
    declared.ok === true &&
      declared.title === `The pricing note ${run}` &&
      declared.title_from_structure === true,
  )

  /*
    THE CONTROL, and it is the half that stops this being a regression. Most
    outputs declare nothing, and for those the first line is still the best
    guess available — removing the fallback would trade a sometimes-wrong
    title for no title at all.
  */
  const plainId = String(
    (
      await one(`
        insert into public.outputs (job_id, staff_id, body, confidence, evidence, sources)
        values (${lit(jobId)}::uuid,
                (select staff_id from public.staff where slug = 'research-director'),
                ${lit(`A plain first line ${run}\nand more below it.`)},
                'medium', 'inferred', '[]'::jsonb)
        returning output_id::text as id
      `)
    ).id,
  )
  const plain = (
    await one(`select public.import_output(app.test_office(), ${lit(plainId)}::uuid) as r`)
  ).r as {
    ok?: boolean
    title?: string
    title_from_structure?: boolean
  }
  check(
    'CONTROL: an output that declares nothing still takes its first line',
    `${String(plain.title)} (from structure: ${String(plain.title_from_structure)})`,
    plain.ok === true &&
      plain.title === `A plain first line ${run}` &&
      plain.title_from_structure === false,
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
    await db.execute(`
      update public.documents set produced_by_job = null, mirrors_document_id = null
       where project_id = ${lit(projectId)}::uuid
    `)
    await db.execute(`delete from public.documents where project_id = ${lit(projectId)}::uuid`)
    if (outputId !== '') {
      await db.execute(`delete from public.outputs where output_id = ${lit(outputId)}::uuid`)
    }
    /*
      The job cannot be deleted — `job_state_transitions` is append-only and
      holds a foreign key (ADR-0022) — and `project_delete` refuses a project
      that still holds one. So it is unlinked, which is what `verify:proposes`
      settled on, and then the project goes.
    */
    if (jobId !== '') {
      /*
        Unlinked only. This job is already `complete`, which is TERMINAL —
        `enforce_job_transition` refuses complete -> cancelled and says so
        ("Allowed from complete: none — terminal"), which is right: a finished
        job did not later get cancelled and the ledger should not say it did.

        Cancelling is the correct teardown for a job left QUEUED. Reaching for
        it here was copying the shape of another suite's teardown without
        checking which state this one leaves behind.
      */
      await db.execute(`
        update public.jobs set project_id = null where job_id = ${lit(jobId)}::uuid
      `)
    }
    await db.execute(`select app.project_delete(${lit(SLUG)}, true)`)
  }
  const left = Number(
    (await one(`select count(*)::int as n from public.projects where slug = ${lit(SLUG)}`)).n,
  )
  const live =
    jobId === ''
      ? 0
      : Number(
          (
            await one(`
              select count(*)::int as n from public.jobs
               where job_id = ${lit(jobId)}::uuid
                 and state not in ('complete', 'cancelled', 'failed')
            `)
          ).n,
        )
  check(
    'teardown — no fixture project and no live job',
    `${String(left)} project(s), ${String(live)} live job(s)`,
    left === 0 && live === 0 && projectId !== '',
  )
}

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)

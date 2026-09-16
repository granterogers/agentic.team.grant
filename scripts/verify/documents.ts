/**
 * A document is a row you can edit (#152).
 *
 *   npm run verify:documents
 *
 * Grant: *"A document opens, and that is all it does. You can read it and talk
 * about it. You cannot rename or retitle it, move it to another dashboard
 * project, mark it superseded by a newer one, or say this one is the important
 * one."*
 *
 * ## Why this is SQL and not a browser
 *
 * The controls draw only for a document with a real id and only for a writer,
 * and the studio's own prototype documents are invented and have no id — so
 * there is nothing for a local browser run to press, and making the prototype
 * pretend would be offering a control that cannot work. What a browser CAN
 * prove about this is that the sheet draws nothing for a reader, which
 * `verify:controls` already covers by pressing everything it can see.
 *
 * Every call runs inside `begin … rollback`. These are real writes against
 * Grant's real documents: a rename that escaped would be his document with the
 * suite's name on it, and CLAUDE.md records what happened the one time a suite
 * called a real function outside a transaction.
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

/** One statement, really run, then unrun. */
const rolled = async (sql: string): Promise<Record<string, unknown>> =>
  await one(`begin; ${sql} rollback;`)

console.log('#152 — rename, move, supersede and pin a document\n')

const subject = await one(`
  select d.document_id::text as id, d.title, d.project_id::text as project
    from public.documents d
    join public.projects p on p.project_id = d.project_id
   where p.status = 'active' and not p.is_fixture
   order by d.created_at desc limit 1`)

if (subject.id === undefined) {
  console.log('  --   no document on an active project to work with')
  process.exit(0)
}
console.log(`  subject: ${String(subject.title).slice(0, 48)}\n`)

{
  const r = await rolled(
    `select (app.rename_document('${String(subject.id)}'::uuid, 'A name the suite chose'))::text as r;`,
  )
  const said = JSON.parse(String(r.r ?? '{}')) as { ok?: boolean; was?: string; undo?: string }
  check(
    'renaming works and says what it was',
    `was "${String(said.was).slice(0, 30)}"`,
    said.ok === true,
  )
  check(
    'and offers an undo, which is what the issue asks for',
    said.undo === undefined ? 'NO UNDO OFFERED' : 'an undo id came back',
    typeof said.undo === 'string' && said.undo.length > 0,
  )
}

{
  const r = await rolled(
    `select (app.rename_document('${String(subject.id)}'::uuid, '   '))::text as r;`,
  )
  const said = JSON.parse(String(r.r ?? '{}')) as { ok?: boolean; error?: string }
  check('an empty name is refused', said.error ?? '(accepted!)', said.ok === false)
}

{
  const other = await one(`
    select project_id::text as id, name from public.projects
     where status = 'active' and not is_fixture and project_id <> '${String(subject.project)}'::uuid
     limit 1`)
  if (other.id === undefined) {
    console.log('  --   only one active project, so the move cannot be exercised')
  } else {
    const r = await rolled(
      `select (app.hq_document_move('${String(subject.id)}'::uuid, '${String(other.id)}'::uuid))::text as r;`,
    )
    const said = JSON.parse(String(r.r ?? '{}')) as {
      moved?: boolean
      to?: string
      undo?: string
      error?: string
    }
    check(
      'moving works and names where it went',
      said.error ?? `to ${String(said.to)}`,
      said.moved === true && typeof said.undo === 'string',
    )
  }
}

{
  /*
    The orphan rule, which is the one the issue names as a constraint.

    A collection belongs to a project, so a document moved out of that project
    while a collection still holds it leaves a membership nothing can draw. The
    check makes one, tries the move, and expects a refusal that names the
    holder — built and abandoned inside the same transaction.
  */
  const other = await one(`
    select project_id::text as id from public.projects
     where status = 'active' and not is_fixture and project_id <> '${String(subject.project)}'::uuid
     limit 1`)
  if (other.id === undefined) {
    console.log('  --   only one active project, so the orphan rule cannot be exercised')
  } else {
    const r = await rolled(`
      insert into public.collections (project_id, name)
      values ('${String(subject.project)}'::uuid, 'suite collection 0382');
      insert into public.document_collections (document_id, collection_id)
      select '${String(subject.id)}'::uuid, collection_id from public.collections
       where name = 'suite collection 0382';
      select (app.hq_document_move('${String(subject.id)}'::uuid, '${String(other.id)}'::uuid))::text as r;`)
    const said = JSON.parse(String(r.r ?? '{}')) as { error?: string; moved?: boolean }
    check(
      'a move that would orphan a collection membership is refused, by name',
      said.error ?? '(IT MOVED)',
      said.moved !== true && String(said.error ?? '').includes('collection'),
    )
  }
}

{
  const second = await one(`
    select document_id::text as id from public.documents
     where project_id = '${String(subject.project)}'::uuid
       and document_id <> '${String(subject.id)}'::uuid limit 1`)
  if (second.id === undefined) {
    console.log('  --   the project has only one document, so superseding cannot be exercised')
  } else {
    const r = await rolled(`
      select (app.hq_document_supersede('${String(subject.id)}'::uuid, '${String(second.id)}'::uuid))::text as r;`)
    const said = JSON.parse(String(r.r ?? '{}')) as { superseded?: boolean; undo?: string }
    check(
      'superseding works and can be taken back',
      said.superseded === true ? 'marked' : 'NOT MARKED',
      said.superseded === true && typeof said.undo === 'string',
    )

    const state = await rolled(`
      select app.hq_document_supersede('${String(subject.id)}'::uuid, '${String(second.id)}'::uuid);
      select d.state || ' / ' || coalesce(d.superseded_by::text, 'null') as r
        from public.documents d where d.document_id = '${String(subject.id)}'::uuid;`)
    /*
      'archived', not 'superseded'.

      The first draft of this check asserted a word `documents_state_check` does
      not allow, and 0382 wrote the same word into the function — so the suite
      and the product agreed with each other and both disagreed with the
      column. Widening the constraint would have given the product two words
      for "no longer current"; 0384 uses the one already there, and
      `superseded_by` says why.
    */
    check(
      'and it is recorded in state AND in its own column, not in mirrors_document_id',
      String(state.r),
      String(state.r).startsWith('archived /') && !String(state.r).endsWith('null'),
    )

    const mirrors = await rolled(`
      select app.hq_document_supersede('${String(subject.id)}'::uuid, '${String(second.id)}'::uuid);
      select coalesce(d.mirrors_document_id::text, 'untouched') as r
        from public.documents d where d.document_id = '${String(subject.id)}'::uuid;`)
    check(
      'CONTROL: superseding leaves mirrors_document_id alone, so #154 can still filter on it',
      String(mirrors.r),
      String(mirrors.r) === 'untouched',
    )
  }
}

{
  const r = await rolled(`
    select app.hq_document_pin('${String(subject.id)}'::uuid, true);
    select (case when d.pinned then 'pinned' else 'NOT PINNED' end) as r
      from public.documents d where d.document_id = '${String(subject.id)}'::uuid;`)
  check('pinning is a flag on the row', String(r.r), String(r.r) === 'pinned')
}

{
  const r = await rolled(
    `select (app.hq_document_supersede('${String(subject.id)}'::uuid, '${String(subject.id)}'::uuid))::text as r;`,
  )
  const said = JSON.parse(String(r.r ?? '{}')) as { error?: string }
  check('a document cannot supersede itself', said.error ?? '(ACCEPTED)', said.error !== undefined)
}

{
  const now = await one(`
    select title || ' / ' || (case when pinned then 'pinned' else 'not pinned' end)
           || ' / ' || coalesce(state, 'live') as r
      from public.documents where document_id = '${String(subject.id)}'::uuid`)
  check(
    'and the real document is exactly as it was found',
    String(now.r).slice(0, 70),
    String(now.r).startsWith(String(subject.title)) && String(now.r).includes('not pinned'),
  )
}

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length ? 0 : 1)

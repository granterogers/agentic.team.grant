/**
 * Can a project be given a Drive folder, and does the office ask rather than act?
 *
 *   npm run verify:drive
 *
 * Issue #62. Exercises 0194 and 0195 against the real database.
 *
 * The checks that matter are the restraints. Anyone can store a folder id; the
 * question is whether the design refuses the four things that would make this
 * feature worse than not having it:
 *
 *   * a first pass that reports two hundred historical files as arrivals
 *   * one question per file instead of one question per drop
 *   * two projects watching one folder and both asking
 *   * a stale cursor surviving a detach and re-attach
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { describeKind } from '../../src/google/drive.ts'

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
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const FOLDER = `1AbCdEfGhIjKlMnOp${run}`

console.log('drive —')

// --- the system level -------------------------------------------------------

{
  const c = await one(
    `select enabled, automated from public.knowledge_connectors where connector = 'drive'`,
  )
  ok('Drive is registered as a place documents come from', c.enabled === true)
  const g = await one(`select scopes from public.google_services where slug = 'drive'`)
  ok(
    'and the scope it needs is read-only, so nothing can write to his Drive',
    String(g.scopes ?? '').includes('drive.readonly'),
    String(g.scopes ?? ''),
  )
}

// --- whatever he pastes -----------------------------------------------------
//
// He will paste the address bar, and the address bar has a query string on it
// half the time. Every caller deriving the id itself is three regexes that
// drift, so there is one function and this is what it must survive.

for (const [what, input] of [
  ['a share link', `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`],
  ['a plain folder link', `https://drive.google.com/drive/folders/${FOLDER}`],
  ['an open link', `https://drive.google.com/open?id=${FOLDER}`],
  ['the bare id', FOLDER],
  ['a link with a trailing slash and space', ` https://drive.google.com/drive/folders/${FOLDER}/ `],
] as const) {
  const got = await one(`select public.folder_id_from(${lit(input)}) as id`)
  ok(`the id comes out of ${what}`, String(got.id ?? '') === FOLDER, String(got.id ?? 'null'))
}

for (const [what, input] of [
  ['a document link, not a folder', 'https://docs.google.com/document/d/1abcdefghij/edit'],
  ['nothing', ''],
  ['a sentence', 'the folder I mentioned'],
] as const) {
  const got = await one(`select public.folder_id_from(${lit(input)}) as id`)
  // A document link is NOT a folder and must not silently become one — that
  // would attach a watch to a file and never fire.
  ok(
    `${what} is refused rather than guessed at`,
    got.id === null || String(got.id) !== FOLDER,
    String(got.id ?? 'null'),
  )
}

// --- attaching --------------------------------------------------------------

/*
  A REAL project, not a fixture, and the slug is why.

  `projects.is_fixture` is GENERATED from the slug, and
  `app.drive_folders_to_check` excludes fixtures — correctly, and for the third
  time today that rule has been the thing a suite tripped over. A subject named
  `verify-%` is invisible to the function under test, so "an active project IS
  watched" could never pass.

  So the subject is real and is removed at the end, in ADR-0014's order:
  archive, then attachments, then the project. The trigger fires on the
  attachment delete, so any other order fails with a message about
  attachments rather than about what you were doing.
*/
const proj = await one(`
  insert into public.projects (slug, name, purpose, status)
  values (${lit(`driveproof-${run}`)}, 'Drive verification', 'Thrown away', 'paused')
  returning project_id
`)
const pid = String(proj.project_id)

{
  const bad = await one(`
    select public.attach_drive_folder(${lit(pid)}::uuid, 'not a link at all') as r
  `)
  ok(
    'a link that is not one is refused, with the shape of a real one',
    String((bad.r as { error?: string })?.error ?? '') !== '' &&
      String((bad.r as { hint?: string })?.hint ?? '').includes('drive.google.com'),
  )
}

const attached = await one(`
  select public.attach_drive_folder(${lit(pid)}::uuid,
    ${lit(`https://drive.google.com/drive/folders/${FOLDER}?usp=drive_link`)},
    'Course material') as r
`)
const rec = attached.r as { attachment_id?: string; folder_id?: string; url?: string }
ok('a project can be given a folder', String(rec.attachment_id ?? '') !== '')
ok('and the id is taken out of the pasted link', rec.folder_id === FOLDER)
ok(
  'and it is stored as an ordinary project attachment, not a new model',
  (
    await all(
      `select 1 from public.project_attachments
        where attachment_id = ${lit(String(rec.attachment_id))}::uuid
          and connector = 'drive' and ref_kind = 'folder' and enabled`,
    )
  ).length === 1,
)
ok(
  'and the decision to use Drive on this project is on the record',
  (
    await all(
      `select 1 from public.project_connector_choices
        where project_id = ${lit(pid)}::uuid and connector = 'drive' and choice = 'wanted'`,
    )
  ).length === 1,
)

{
  const again = await one(`
    select public.attach_drive_folder(${lit(pid)}::uuid,
      ${lit(`https://drive.google.com/drive/folders/${FOLDER}`)}) as r
  `)
  ok(
    'attaching the same folder twice does not make a second one',
    String((again.r as { attachment_id?: string })?.attachment_id ?? '') ===
      String(rec.attachment_id ?? ''),
  )
}

{
  const other = await one(`
    insert into public.projects (slug, name, purpose, status)
    values (${lit(`driveproof-other-${run}`)}, 'Other', 'Thrown away', 'paused')
    returning project_id
  `)
  const clash = await one(`
    select public.attach_drive_folder(${lit(String(other.project_id))}::uuid,
      ${lit(`https://drive.google.com/drive/folders/${FOLDER}`)}) as r
  `)
  // Two projects watching one folder would both ask about every arrival, which
  // is the repetition he has complained about twice.
  ok(
    'and another project cannot watch the same folder',
    String((clash.r as { error?: string })?.error ?? '').includes('already watched'),
  )
  await db.execute(
    `delete from public.projects where project_id = ${lit(String(other.project_id))}::uuid`,
  )
}

// --- the first pass reports nothing -----------------------------------------

{
  const w = await one(
    `select primed, page_token from public.drive_watch
      where attachment_id = ${lit(String(rec.attachment_id))}::uuid`,
  )
  ok(
    'a newly attached folder is not primed, so its history is not reported as arrivals',
    w.primed === false && w.page_token === null,
  )
}

// --- which folders get looked at --------------------------------------------

{
  // The project is `paused`, so it must not be polled — a paused project is
  // one Grant has stepped away from.
  const due = await all(
    `select folder_id from app.drive_folders_to_check(0) where folder_id = ${lit(FOLDER)}`,
  )
  ok('a paused project is not watched', due.length === 0)

  await db.execute(
    `update public.projects set status = 'active' where project_id = ${lit(pid)}::uuid`,
  )
  const nowDue = await all(
    `select folder_id, primed from app.drive_folders_to_check(0) where folder_id = ${lit(FOLDER)}`,
  )
  ok('an active one is', nowDue.length === 1)

  // The rule that has had to be written down three times today.
  const anyFixture = await all(`
    select 1 from app.drive_folders_to_check(0) f
     join public.projects p on p.project_id = f.project_id where p.is_fixture
  `)
  ok('and no fixture project is ever watched', anyFixture.length === 0)
}

{
  await db.execute(`
    select app.drive_watch_checked(${lit(String(rec.attachment_id))}::uuid,
      ${lit(`token-${run}`)}, false, null)
  `)
  const w = await one(
    `select primed, page_token, failures from public.drive_watch
      where attachment_id = ${lit(String(rec.attachment_id))}::uuid`,
  )
  ok('taking a start token primes the watch', w.primed === true)
  ok('and stores the cursor', String(w.page_token) === `token-${run}`)

  const notDue = await all(
    `select 1 from app.drive_folders_to_check(10) where folder_id = ${lit(FOLDER)}`,
  )
  ok('and it is not looked at again straight away', notDue.length === 0)
}

{
  for (let i = 0; i < 5; i++) {
    await db.execute(`
      select app.drive_watch_checked(${lit(String(rec.attachment_id))}::uuid, null, false,
        'drive 403: insufficient permissions')
    `)
  }
  const stopped = await all(
    `select 1 from app.drive_folders_to_check(0) where folder_id = ${lit(FOLDER)}`,
  )
  // A folder that cannot be read must stop being polled and say why, rather
  // than burning a request every ten minutes for ever.
  ok('a folder that keeps failing stops being polled', stopped.length === 0)
  const w = await one(
    `select last_error from public.drive_watch
      where attachment_id = ${lit(String(rec.attachment_id))}::uuid`,
  )
  ok('and says why', String(w.last_error ?? '').includes('403'))

  await db.execute(`
    select app.drive_watch_checked(${lit(String(rec.attachment_id))}::uuid,
      ${lit(`token-${run}`)}, false, null)
  `)
  const w2 = await one(
    `select failures from public.drive_watch
      where attachment_id = ${lit(String(rec.attachment_id))}::uuid`,
  )
  ok('and one good pass forgives it', Number(w2.failures) === 0)
}

// --- a re-attach starts afresh ----------------------------------------------

{
  /*
    Archived first, deliberately.

    ADR-0014 refuses an ACTIVE project with no enabled attachment, and the
    trigger fires on the attachment delete — so detaching from a live project
    raises a message about attachments rather than about the detach. That is
    also the real product behaviour worth knowing: a project's last attachment
    cannot simply be removed while it is live, and any UI offering "detach"
    has to say so.
  */
  await db.execute(
    `update public.projects set status = 'archived' where project_id = ${lit(pid)}::uuid`,
  )
  await db.execute(`
    delete from public.project_attachments
     where attachment_id = ${lit(String(rec.attachment_id))}::uuid
  `)
  const gone = await all(
    `select 1 from public.drive_watch
      where attachment_id = ${lit(String(rec.attachment_id))}::uuid`,
  )
  // The cursor cascades with the attachment. A stale token surviving a
  // re-attach would silently skip everything dropped in between — the worst
  // failure available to a watcher, because it keeps working.
  ok('detaching a folder takes its cursor with it', gone.length === 0)

  const back = await one(`
    select public.attach_drive_folder(${lit(pid)}::uuid,
      ${lit(`https://drive.google.com/drive/folders/${FOLDER}`)}) as r
  `)
  const fresh = await one(`
    select primed from public.drive_watch
     where attachment_id = ${lit(String((back.r as { attachment_id?: string }).attachment_id))}::uuid
  `)
  ok('and re-attaching starts the watch afresh rather than resuming', fresh.primed === false)
}

// --- the words a person reads -----------------------------------------------

for (const [mime, expected] of [
  ['application/vnd.google-apps.document', 'Google Doc'],
  ['application/pdf', 'PDF'],
  ['video/mp4', 'video'],
  ['application/octet-stream', 'file'],
] as const) {
  ok(`a ${expected} is called a ${expected}`, describeKind(mime) === expected, describeKind(mime))
}

// --- attaching by clicking, not only by RPC (#62) ----------------------------
//
// `hq_attach` is what the build page calls. It refused anything outside a
// hardcoded list of four connectors, so a Drive folder could be attached by RPC
// and not by clicking — for no reason but a second copy of an answer that
// `knowledge_connectors` already holds.

{
  await db.execute(
    `update public.projects set status = 'active' where project_id = ${lit(pid)}::uuid`,
  )
  const viaPage = await one(`
    select app.hq_attach(app.test_office(), ${lit(`driveproof-${run}`)}, 'drive',
      ${lit(`https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`)},
      'source', null, 'Course material') as r
  `)
  const got = viaPage.r as { attachment_id?: string; folder_id?: string; error?: string }
  ok(
    'the page can attach a Drive folder',
    String(got.attachment_id ?? '') !== '',
    String(got.error ?? ''),
  )
  ok('and it reads the folder id out of the pasted link', got.folder_id === FOLDER)

  // The reason it delegates rather than inserting: an attachment with no watch
  // row is a folder nobody looks at, and that is indistinguishable from one
  // being watched until nothing is ever reported from it.
  const watched = await all(`
    select 1 from public.drive_watch
     where attachment_id = ${lit(String(got.attachment_id))}::uuid
  `)
  ok('and starts the watch, so it is actually looked at', watched.length === 1)
}

{
  const unknown = await one(
    `select app.hq_attach(app.test_office(), ${lit(`driveproof-${run}`)}, 'dropbox', 'x') as r`,
  )
  const r = unknown.r as { error?: string; connectors?: string[] }
  ok('a connector this office does not have is refused', String(r.error ?? '').includes('dropbox'))
  // Naming them, because "not a connector" leaves him guessing what is.
  ok(
    'and it says which ones there are',
    (r.connectors ?? []).includes('drive') && (r.connectors ?? []).includes('notion'),
    (r.connectors ?? []).join(', '),
  )
}

// --- the duty exists --------------------------------------------------------

{
  const duty = await one(`
    select r.period_minutes, r.enabled, s.slug as who
      from public.responsibilities r join public.staff s on s.staff_id = r.staff_id
     where r.slug = 'drive-watch'
  `)
  ok('something actually looks at the folders', duty.enabled === true)
  ok('every ten minutes, not every one', Number(duty.period_minutes) === 10)
  // He said "chief of staff is like, oh, we see that a file has been dropped".
  ok('and it belongs to the chief of staff', String(duty.who ?? '') === 'chief-of-staff')
}

// --- tidy up ----------------------------------------------------------------
//
// ADR-0014's order: archive, then attachments, then the project. The trigger
// fires on the attachment delete, so deleting attachments from an ACTIVE
// project fails with a message about attachments rather than about what you
// were actually doing — which is how six real projects were once left behind.

await db.execute(`
  update public.projects set status = 'archived', updated_at = app.now_utc()
   where slug like ${lit(`driveproof-%${run}`)} or slug = ${lit(`driveproof-${run}`)}
`)
await db.execute(`
  delete from public.project_attachments
   where project_id in (select project_id from public.projects
                         where slug like ${lit(`driveproof%${run}`)})
`)
await db.execute(`delete from public.projects where slug like ${lit(`driveproof%${run}`)}`)
{
  const left = await all(
    `select slug from public.projects where slug like ${lit(`driveproof%${run}`)}`,
  )
  // Asserted, because a teardown that silently matches nothing looks exactly
  // like one that worked — and left six real projects in Grant's list once.
  ok(
    'the suite leaves nothing behind',
    left.length === 0,
    left.map((r) => String(r.slug)).join(', '),
  )
}

/*
  --------------------------------------- a file Grant deleted in Drive (0503)

  The run mandate narrows Drive to a one-way knowledge source and names what
  that has to include: changes and deletions must update the index. Deletions
  did not — `changesIn` discarded every `removed` and `trashed` change, with a
  comment saying a file leaving is not something to ask Grant about. True of
  ASKING, and false of the INDEX: the office would go on answering from a
  document he deleted weeks ago, with nothing able to notice.

  Almost nothing new was needed. `app.reconcile_vanished` has been a complete
  connector-agnostic tombstoner since 0465, with a blast-radius guard and a
  two-strike rule; what was missing was a caller and a folder listing. So what
  this section proves is that the WIRING is real and correctly bounded, and
  that both directions work — a file that leaves, and a file that comes back.

  One rolled-back statement, results into a temp table, selected before the
  rollback. The same shape the rest of this suite uses.
*/
{
  const g = `drive-gone-${run}`
  const rows = ((
    await db.execute(`
    begin;
      create temp table gone_res (k text, v jsonb) on commit drop;
      insert into public.projects (slug, name, status)
        values (${lit(g)}, 'Drive tombstone proof', 'active');
      insert into public.project_attachments
        (project_id, connector, external_ref, display_name, role)
      select project_id, 'drive', ${lit(`folder-${run}`)}, 'A watched folder', 'source'
        from public.projects where slug = ${lit(g)};
      insert into public.drive_watch (attachment_id, folder_id, page_token, primed, failures)
      select attachment_id, ${lit(`folder-${run}`)}, 'tok-1', true, 0
        from public.project_attachments
       where connector = 'drive' and external_ref = ${lit(`folder-${run}`)};
      insert into public.documents
        (project_id, connector, external_parent_ref, external_ref, title, doc_type,
         content, content_fingerprint, content_chars, fetched_at, origin, added_by, state)
      select project_id, 'drive', ${lit(`folder-${run}`)}, x.ref, x.t, 'file',
             x.t, encode(extensions.digest(x.t, 'sha256'), 'hex'), length(x.t),
             app.now_utc(), 'source', 'chief-of-staff', 'approved'
        from public.projects p,
             /*
               Six, not three, and the reason is the guard.

               The first draft used three documents and removed two of them,
               which is 67% of the corpus — over the 50% the blast-radius guard
               may act on, so it correctly REFUSED and the archive check failed
               against a mechanism that works. Validate the test before
               believing the finding, which is the most-used rule in CLAUDE.md
               and was needed here within a minute of writing this section.

               Four bystanders keep the two departures at 33%.
             */
             (values (${lit(`f-stays-${run}`)}, 'The one that stays'),
                     (${lit(`f-stays2-${run}`)}, 'Another that stays'),
                     (${lit(`f-stays3-${run}`)}, 'A third that stays'),
                     (${lit(`f-stays4-${run}`)}, 'A fourth that stays'),
                     (${lit(`f-goes-${run}`)}, 'The one Grant deletes'),
                     (${lit(`f-back-${run}`)}, 'The one that comes back')) as x(ref, t)
       where p.slug = ${lit(g)};

      -- Due, because the office holds documents for this folder and has never
      -- listed it. The EXISTS in drive_folders_to_check is what this proves.
      insert into gone_res
      select 'due', jsonb_agg(jsonb_build_object('folder', folder_id, 'due', reconcile_due))
        from app.drive_folders_to_check(0) where folder_id = ${lit(`folder-${run}`)};

      -- Pass one: two of the three are still there. Marked, never hidden.
      insert into gone_res
      select 'pass1', jsonb_build_array(app.drive_reconcile(
        (select attachment_id from public.drive_watch where folder_id = ${lit(`folder-${run}`)}),
        ${lit(`folder-${run}`)},
        array[${lit(`f-stays-${run}`)}, ${lit(`f-stays2-${run}`)}, ${lit(`f-stays3-${run}`)}, ${lit(`f-stays4-${run}`)}]::text[]));
      insert into gone_res
      select 'after1', jsonb_agg(jsonb_build_object(
        'ref', external_ref, 'state', state, 'missing', missing_since is not null))
        from public.documents where external_parent_ref = ${lit(`folder-${run}`)};

      -- Pass two: still absent. Strike two archives it.
      insert into gone_res
      select 'pass2', jsonb_build_array(app.drive_reconcile(
        (select attachment_id from public.drive_watch where folder_id = ${lit(`folder-${run}`)}),
        ${lit(`folder-${run}`)},
        array[${lit(`f-stays-${run}`)}, ${lit(`f-stays2-${run}`)}, ${lit(`f-stays3-${run}`)}, ${lit(`f-stays4-${run}`)}]::text[]));
      insert into gone_res
      select 'after2', jsonb_agg(jsonb_build_object(
        'ref', external_ref, 'state', state, 'missing', missing_since is not null))
        from public.documents where external_parent_ref = ${lit(`folder-${run}`)};

      -- And back from the dead. Converging is symmetric or it is not
      -- converging, which 0465 learned by driving it.
      insert into gone_res
      select 'pass3', jsonb_build_array(app.drive_reconcile(
        (select attachment_id from public.drive_watch where folder_id = ${lit(`folder-${run}`)}),
        ${lit(`folder-${run}`)},
        array[${lit(`f-stays-${run}`)}, ${lit(`f-stays2-${run}`)}, ${lit(`f-stays3-${run}`)}, ${lit(`f-stays4-${run}`)}, ${lit(`f-back-${run}`)}]::text[]));
      insert into gone_res
      select 'after3', jsonb_agg(jsonb_build_object(
        'ref', external_ref, 'state', state, 'missing', missing_since is not null))
        from public.documents where external_parent_ref = ${lit(`folder-${run}`)};

      -- A listing that FAILED is not an empty folder.
      insert into gone_res
      select 'failed', jsonb_build_array(app.drive_reconcile(
        (select attachment_id from public.drive_watch where folder_id = ${lit(`folder-${run}`)}),
        ${lit(`folder-${run}`)}, array[]::text[], 'drive 503: unavailable'));
      insert into gone_res
      select 'afterfail', jsonb_agg(jsonb_build_object('ref', external_ref, 'state', state))
        from public.documents where external_parent_ref = ${lit(`folder-${run}`)};

      -- The blast-radius guard, on an honest but empty listing.
      insert into gone_res
      select 'wipe', jsonb_build_array(app.drive_reconcile(
        (select attachment_id from public.drive_watch where folder_id = ${lit(`folder-${run}`)}),
        ${lit(`folder-${run}`)}, array[]::text[]));
      insert into gone_res
      select 'note', jsonb_build_array(jsonb_build_object(
        'note', (select last_reconcile_note from public.drive_watch
                  where folder_id = ${lit(`folder-${run}`)}),
        'at', (select last_reconciled_at is not null from public.drive_watch
                where folder_id = ${lit(`folder-${run}`)})));

      -- And no longer due, now that it has been listed today.
      insert into gone_res
      select 'due2', jsonb_agg(jsonb_build_object('due', reconcile_due))
        from app.drive_folders_to_check(0) where folder_id = ${lit(`folder-${run}`)};

      select k, v from gone_res;
    rollback;
  `)
  ).rows ?? []) as Record<string, unknown>[]

  const got = (k: string): Record<string, unknown>[] => {
    const raw = rows.find((r: Record<string, unknown>) => String(r.k) === k)?.v
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : []
  }
  const doc = (k: string, ref: string): Record<string, unknown> | undefined =>
    got(k).find((x) => String(x.ref) === `${ref}-${run}`)
  const verdict = (k: string): Record<string, unknown> => got(k)[0] ?? {}

  ok(
    'a folder the office holds documents for is due a listing',
    got('due')[0]?.due === true,
    JSON.stringify(got('due')),
  )
  ok(
    'strike one MARKS an absent file and does not hide it',
    doc('after1', 'f-goes')?.missing === true && doc('after1', 'f-goes')?.state === 'approved',
    JSON.stringify(doc('after1', 'f-goes')),
  )
  ok(
    'strike two archives it, so it stops being an answer',
    doc('after2', 'f-goes')?.state === 'archived',
    JSON.stringify(doc('after2', 'f-goes')),
  )
  ok(
    'CONTROL: the file that never left is untouched throughout',
    doc('after2', 'f-stays')?.state === 'approved' && doc('after2', 'f-stays')?.missing === false,
    JSON.stringify(doc('after2', 'f-stays')),
  )
  /*
    The symmetric half, which is the one 0465 shipped without and had to be
    told about by driving it: a source that came BACK stayed archived for ever.
  */
  ok(
    'CONTROL: the returning file really was archived first, so the next check means something',
    doc('after2', 'f-back')?.state === 'archived',
    JSON.stringify(doc('after2', 'f-back')),
  )
  ok(
    'a file that comes back is answerable again',
    doc('after3', 'f-back')?.state === 'approved' && doc('after3', 'f-back')?.missing === false,
    JSON.stringify(doc('after3', 'f-back')),
  )
  ok(
    'and the one that did not come back stays archived',
    doc('after3', 'f-goes')?.state === 'archived',
    JSON.stringify(doc('after3', 'f-goes')),
  )
  ok(
    'a FAILED listing changes nothing, rather than deleting the folder',
    verdict('failed').ok === false &&
      got('afterfail').every(
        (d) => String(d.state) !== 'archived' || String(d.ref).includes('goes'),
      ),
    JSON.stringify(verdict('failed')),
  )
  ok(
    'and it says so in the record, so a quiet failure is visible',
    String(verdict('note').note ?? '').includes('could not list') ||
      String(verdict('note').note ?? '').includes('more than'),
    String(verdict('note').note ?? '(none)').slice(0, 70),
  )
  /*
    The blast-radius guard. An honest listing that comes back empty is far
    likelier to be a broken request than a folder somebody emptied, and acting
    on it would archive a whole project's Drive corpus in one pass.
  */
  ok(
    'an empty listing is REFUSED rather than acted on',
    verdict('wipe').ok === false && verdict('wipe').refused === true,
    String(verdict('wipe').error ?? '(no error)').slice(0, 80),
  )
  ok(
    'the timestamp is stamped even on a refusal, so it is not retried every pass',
    verdict('note').at === true,
  )
  ok(
    'and the folder is no longer due today',
    got('due2').length === 0 || got('due2')[0]?.due === false,
    JSON.stringify(got('due2')),
  )
}

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)

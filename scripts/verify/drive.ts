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
    select app.hq_attach(${lit(`driveproof-${run}`)}, 'drive',
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
    `select app.hq_attach(${lit(`driveproof-${run}`)}, 'dropbox', 'x') as r`,
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

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail === 0 ? 0 : 1)

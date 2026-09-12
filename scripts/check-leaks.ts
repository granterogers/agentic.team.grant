/**
 * A verify suite that leaves a real project behind is caught.
 *
 *   npm run check:leaks
 *
 * Issue #45. `public.projects` held 36 non-fixture rows and four were Grant's.
 * The other 32 were debris from verification runs — 23 `newsroom-<run>`, five
 * `gate4-probe-<n>`, two `untitled-notebook-<hex>`, and a handful of one-offs.
 *
 * ## Why `purge:fixtures` will never collect them
 *
 * `projects.is_fixture` is a GENERATED column matching `fixture-%`, `verify-%`
 * and `ledger-proof-%`. These are none of those, because a suite testing
 * anything that EXCLUDES fixtures has to use a real name — `resolve_project_by_name`
 * filters `not is_fixture`, which is the trap that cost `verify:identity` eleven
 * failing checks on a feature that worked.
 *
 * So the convention is: **use a real subject and tear it down yourself.** This
 * check is what makes that convention true rather than aspirational.
 *
 * ## Why it does not simply demand zero
 *
 * Nineteen of the thirty carry a job each, and a job can never be deleted —
 * `job_state_transitions` is append-only by §6 and has a foreign key to `jobs`.
 * Those rows are history now (ADR-0022) and no check can ever make them go
 * away. A check that demands the impossible is a check somebody switches off.
 *
 * So a leak is debris that **can still be swept**: no documents, no jobs, and
 * therefore removable by `app.project_delete`. Debris pinned by a job is
 * reported and does not fail, because nothing can ever make it go away.
 *
 * That definition is also self-clearing. Sweep the removable ones and the check
 * is green; the next suite that leaves one turns it red the same day.
 *
 * ## The same leak one level down: harness DOCUMENTS in a real corpus
 *
 * Found while working #19. Three rows titled `Verification page <run>`, 45
 * characters each, created inside 300ms on 2026-09-11, are sitting in Grant's
 * Legacy Coaching Course corpus. `verify:notion` creates a page in Notion and
 * syncs it into a FIXTURE project, which is correct — but the page stays shared
 * in his workspace, so `duty:notion-sync` picks it up on its next real pass and
 * `upsertDocument`'s `project_id = excluded.project_id` moves the row onto the
 * real project. The suite's teardown archives the page it made this run; the
 * three that predate that teardown were never archived and keep coming back.
 *
 * Which is why this half reports and never sweeps, even behind the flag:
 * deleting the rows fixes nothing, because the next sync restores them. The fix
 * is in Grant's Notion workspace and it is his to authorise.
 */

import { ManagementApiExecutor } from '../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('check:leaks needs SUPABASE_ACCESS_TOKEN')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

interface Debris {
  slug: string
  status: string
  docs: number
  jobs: number
  removable: boolean
  age_days: number
}

const rows = (
  await db.execute(`
    select d.*,
           (extract(epoch from (app.now_utc() - p.created_at)) / 86400)::int as age_days
      from app.project_debris() d
      join public.projects p on p.slug = d.slug
     order by age_days asc, d.slug
  `)
).rows as unknown as Debris[]

/*
  And the other half of #45: a real project that is ACTIVE and looks like a
  probe. That is a live leak rather than a tidy-up — it appears in Grant's
  project switcher, which is the thing he would actually notice.
*/
const live = (
  await db.execute(`
    select slug from public.projects
     where not is_fixture and status = 'active'
       and (slug like 'newsroom-%' or slug like 'gate4-probe-%' or slug like 'clash-%'
            or slug like 'untitled-notebook-%' or slug like 'dbg-%' or slug like 'probe-%')
     order by slug
  `)
).rows as { slug: string }[]

/*
  Harness documents in a real project's corpus.

  Matched on the exact title `verify:notion` writes plus the size it writes, and
  only in a NON-fixture project — a fixture corpus is meant to hold these. Two
  facts rather than one because a title alone would one day match something
  Grant wrote about verification.
*/
const corpus = (
  await db.execute(`
    select p.slug, d.title, d.content_chars,
           to_char(d.created_at, 'YYYY-MM-DD') as made
      from public.documents d
      join public.projects p on p.project_id = d.project_id
     where not p.is_fixture
       and d.title like 'Verification page %'
       and coalesce(d.content_chars, 0) < 200
     order by d.created_at
  `)
).rows as { slug: string; title: string; content_chars: number; made: string }[]

/*
  The sweep, behind an explicit flag.

  Grant: *"You should always check before making any destructive action with
  me."* These are empty archived probe rows with no documents and no jobs, so
  there is nothing of his in them — and it is still a delete on real rows, so it
  happens because somebody typed the flag and not because a check ran.
*/
if (process.argv.includes('--sweep')) {
  const go = rows.filter((r) => r.removable)
  console.log(`\nsweeping ${String(go.length)} removable debris project(s)…`)
  for (const r of go) {
    const said = (
      await db.execute(`select public.project_delete('${r.slug.replace(/'/g, "''")}') as r`)
    ).rows[0] as { r: { ok?: boolean; error?: string } }
    console.log(`  ${r.slug}: ${said.r.ok === true ? 'gone' : String(said.r.error)}`)
  }
  const left = (
    await db.execute('select count(*)::int as n from app.project_debris() where removable')
  ).rows[0] as { n: number }
  console.log(`\n${String(left.n)} removable debris project(s) left.`)
  process.exit(Number(left.n) === 0 ? 0 : 1)
}

const sweepable = rows.filter((r) => r.removable)
const pinned = rows.filter((r) => !r.removable)

console.log(`\ncheck:leaks — ${String(rows.length)} archived debris project(s)`)
if (pinned.length > 0) {
  console.log(
    `  ${String(pinned.length)} carry a job and can never be deleted (ADR-0022) — history, not a leak`,
  )
}
for (const r of sweepable) {
  console.log(`  LEAK  ${r.slug} — ${String(r.age_days)} day(s) old, removable`)
}
for (const r of live) console.log(`  LIVE  ${r.slug} — ACTIVE, and named like a probe`)
for (const d of corpus) {
  console.log(`  CORPUS  ${d.slug} — "${d.title}", ${String(d.content_chars)} chars, ${d.made}`)
}

if (sweepable.length === 0 && live.length === 0 && corpus.length === 0) {
  console.log('  nothing a suite should have removed.')
}

/*
  A project left ACTIVE is always a failure: it is in Grant's switcher right
  now. Removable archived debris is a failure because it CAN be swept, which
  makes the check self-clearing — sweep it and this is green, and the next suite
  that leaves one turns it red the same day.
*/
if (corpus.length > 0) {
  /*
    Reported and not swept, by design. The row is a symptom: the page is still
    shared in Grant's Notion, so the next `duty:notion-sync` writes it back. It
    also does not fail the check on its own — a failure nothing here can clear
    is a check somebody switches off, which is the same reasoning as the pinned
    projects above.
  */
  console.log(
    `\n  ${String(corpus.length)} harness document(s) in a real corpus. Deleting the rows\n` +
      '  will not help: the pages are still shared in Notion and the next sync\n' +
      "  restores them. Archiving them is a change to Grant's workspace.",
  )
}

if (sweepable.length > 0 || live.length > 0) {
  console.error(
    `\ncheck:leaks FAILED — ${String(sweepable.length + live.length)} project(s) a suite should have removed.\n` +
      'A suite that creates a real project must tear it down: archive, then attachments,\n' +
      'then the project (ADR-0014 forces that order), or call app.project_delete(slug).\n' +
      'And assert the teardown matched something — one that matches nothing looks\n' +
      'exactly like one that worked.\n\n' +
      'To sweep what is listed above:  npm run check:leaks -- --sweep',
  )
  process.exit(1)
}

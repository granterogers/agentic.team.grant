/**
 * Retire projects created by verification scripts.
 *
 *   npm run purge:fixtures          # report only
 *   npm run purge:fixtures -- --go  # actually retire them
 *
 * ## Why this exists
 *
 * Every live verification script needs a project to work against, and several
 * of them created one and left it behind. By the time Phase 4 generated its
 * first briefs, `projects` held eight active rows and **not one of them was a
 * real project** — five `ledger-proof-*`, one `gate4-probe-*`, and two from a
 * sync fixture. The brief generator dutifully wrote a brief about one.
 *
 * That is worse than untidy. §12's dashboard lists projects, and a list where
 * most entries are test debris is a list nobody trusts. The failure mode is
 * quiet: each script's own cleanup looked correct in isolation, and a script
 * that crashed before its cleanup left no trace of having skipped it.
 *
 * ## The convention this enforces
 *
 * A fixture project's slug **must** start with one of `FIXTURE_PREFIXES`. That
 * is the whole contract: a verification script picks a prefixed slug, and this
 * purge can find it afterwards whether or not the script survived to clean up.
 *
 * Retiring means `status = 'archived'` and `notebook_ref = null`, never a
 * DELETE. Migration 0002 grants no DELETE on `projects` on purpose — a project
 * is retired by status, and its ledger history stays attributable. Nulling
 * `notebook_ref` also frees the notebook so a real project can claim it later.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

/**
 * Slug prefixes reserved for test fixtures.
 *
 * A prefix, not a suffix or an embedded marker, so the check is anchored: a
 * real project called "Gate 4 Retrospective" must not be swept up by a pattern
 * that matches anywhere in the slug.
 */
export const FIXTURE_PREFIXES = [
  'verify-',
  'gate2-probe-',
  'gate4-probe-',
  'ledger-proof-',
  'jobs-proof-',
  'fixture-',
] as const

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const go = process.argv.includes('--go')
const predicate = FIXTURE_PREFIXES.map((p) => `slug like '${p}%'`).join(' or ')

const found = await db.execute(`
  select p.slug, p.name, p.status,
         (select count(*)::int from public.jobs j
           where j.project_id = p.project_id
             and j.state not in ('complete', 'cancelled', 'failed')) as live_jobs,
         (select count(*)::int from public.documents s where s.project_id = p.project_id) as sources,
         (select count(*)::int from public.project_briefs b where b.project_id = p.project_id) as briefs
  from public.projects p
  where (${predicate}) and p.status = 'active'
  order by p.slug
`)

if (found.rows.length === 0) {
  console.log('no active fixture projects.')
} else {
  console.log(`${String(found.rows.length)} active fixture project(s):`)
  for (const r of found.rows) {
    console.log(
      `  ${String(r.slug)} — ${String(r.sources)} source(s), ${String(r.briefs)} brief(s), ` +
        `${String(r.live_jobs)} live job(s)`,
    )
  }
}

// A real project that happens to look like a fixture would be a disaster to
// archive silently, so the report above is printed before anything is written
// and `--go` is required. The prefixes are anchored and reserved, which makes
// a collision unlikely rather than impossible.
if (!go) {
  if (found.rows.length > 0) console.log('\nreport only. Pass --go to retire them.')
  process.exit(0)
}

if (found.rows.length > 0) {
  // Briefs and cached sources go first: they are derived data with no value
  // once the fixture is retired, and a brief about a fixture is exactly the
  // thing that made this script necessary.
  await db.execute(`
    delete from public.project_briefs where project_id in (
      select project_id from public.projects where (${predicate})
    )
  `)
  await db.execute(`
    delete from public.documents where project_id in (
      select project_id from public.projects where (${predicate})
    )
  `)
  // Jobs first, and this was missing until it mattered. Archiving a project
  // left its jobs LIVE, so every verification run added a few more to a set
  // that only ever grew: by the time the briefing generator ran for real it
  // reported 63 jobs in flight, all of them debris. Today, Needs Me and the
  // briefings all read live jobs, so fixture leakage does not just clutter a
  // table - it makes every summary in the system wrong.
  //
  // Terminated along legal transitions. `failed` is reachable from every
  // non-terminal state and is the honest label for work abandoned mid-flight;
  // `cancelled` is not reachable from `committing`, which is how the first
  // version of this discovered the transition guard the hard way.
  await db.execute(`
    update public.jobs set state = 'failed', finished_at = app.now_utc(),
      state_reason = 'fixture project retired by purge:fixtures'
    where state not in ('complete', 'cancelled', 'failed')
      and project_id in (select project_id from public.projects where (${predicate}))
  `)
  await db.execute(`
    update public.projects set status = 'archived', notebook_ref = null
    where (${predicate}) and status = 'active'
  `)
  console.log(`\nretired ${String(found.rows.length)} fixture project(s).`)
}

// Temporary specialists occupy a small global cap, so one left behind by a
// crashed verification script blocks the next run rather than merely
// cluttering. Deactivated, never deleted: their outputs and consultations
// reference them, and a dangling author is worse than an inactive one.
const staffLeft = await db.execute(`
  update public.staff set active = false
  where not permanent and slug like 'fixture-%' and active
  returning slug
`)
if (staffLeft.rows.length > 0) {
  console.log(
    `\nretired ${String(staffLeft.rows.length)} leftover specialist(s): ` +
      staffLeft.rows.map((r) => String(r.slug)).join(', '),
  )
}

// Orphans: fixture jobs whose project was archived by an earlier run that did
// not know to terminate them. Matched by the project's slug, so a real
// project's jobs are never in scope.
const orphans = await db.execute(`
  update public.jobs set state = 'failed', finished_at = app.now_utc(),
    state_reason = 'orphaned fixture job retired by purge:fixtures'
  where state not in ('complete', 'cancelled', 'failed')
    and project_id in (select project_id from public.projects where (${predicate}))
  returning job_id
`)
if (orphans.rows.length > 0) {
  console.log(`\nretired ${String(orphans.rows.length)} orphaned fixture job(s).`)
}

// Delivery debris. Every `verify:*` dedupe key belongs to a verification run,
// and a `job:*` key whose job belongs to a retired fixture project does too.
//
// Left alone until now, and it had reached 86 rows. That is not merely untidy:
// `delivery_health` counts claimed leases and failed sends, and a report whose
// numbers are mostly debris is a report nobody can act on — the same way
// leaked fixture jobs made every "how busy are we" summary wrong in the
// direction of "looks busy".
const deliveries = await db.execute(`
  delete from public.deliveries
  where dedupe_key like 'verify:%'
     or job_id in (
       select job_id from public.jobs
       where project_id in (select project_id from public.projects where (${predicate}))
     )
  returning delivery_id
`)
if (deliveries.rows.length > 0) {
  console.log(`\nretired ${String(deliveries.rows.length)} fixture delivery record(s).`)
}

// Chats no human ever spoke from. A real chat is registered by the webhook and
// has a positive id (a Telegram user id); every fixture here uses the
// supergroup-shaped negative range, which no private chat can have.
const chats = await db.execute(`
  delete from public.telegram_chats
  where chat_type = 'private' and chat_id like '-100%'
  returning chat_id
`)
if (chats.rows.length > 0) {
  console.log(`retired ${String(chats.rows.length)} fixture telegram chat(s).`)
}

const health = await db.execute(`select * from public.delivery_health order by channel, state`)
if (health.rows.length > 0) {
  console.log('\ndeliveries remaining:')
  for (const r of health.rows) {
    console.log(
      `  ${String(r.channel)} ${String(r.state)}: ${String(r.deliveries)}` +
        (Number(r.leases_expired) > 0 ? ` (${String(r.leases_expired)} lease(s) expired)` : ''),
    )
  }
}

const remaining = await db.execute(`
  select p.slug, p.name,
         (select count(*)::int from public.documents s where s.project_id = p.project_id) as sources
  from public.projects p where p.status = 'active' order by p.slug
`)
console.log(`\n${String(remaining.rows.length)} active project(s) remain:`)
for (const r of remaining.rows) {
  console.log(`  ${String(r.slug)} — ${String(r.name)} (${String(r.sources)} source(s))`)
}

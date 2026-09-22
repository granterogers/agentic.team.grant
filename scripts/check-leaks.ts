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
  decisions: number
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
  /*
    One project's failure must not abandon the other ten.

    0360's sweep died five projects into eleven on a raw 23503 out of
    `project_delete` — a project that had ever had a Slack channel could not be
    removed, and the throw took the rest of the run with it. 0360 fixes the
    function so it REFUSES rather than raises; this is the belt to that braces.
    A sweep that stops early looks exactly like a sweep that finished, which is
    CLAUDE.md's teardown trap wearing the other face.
  */
  let stopped = 0
  for (const r of go) {
    try {
      const said = (
        await db.execute(`select public.project_delete('${r.slug.replace(/'/g, "''")}') as r`)
      ).rows[0] as { r: { ok?: boolean; error?: string } }
      console.log(`  ${r.slug}: ${said.r.ok === true ? 'gone' : String(said.r.error)}`)
      if (said.r.ok !== true) stopped += 1
    } catch (error) {
      stopped += 1
      console.log(`  ${r.slug}: THREW — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (stopped > 0) {
    console.log(
      `\n${String(stopped)} project(s) could not be removed. The sweep continued past each.`,
    )
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
    /*
      A job OR a decision (0510). Both are append-only by section 6 and both
      make the project permanent, and saying only "carry a job" about a row
      pinned by a decision sends somebody looking for a job that is not there.
    */
    `  ${String(pinned.length)} carry a job or a recorded decision and can never be deleted ` +
      `(ADR-0022) — history, not a leak` +
      (pinned.some((r) => Number(r.decisions ?? 0) > 0)
        ? ` (${String(pinned.filter((r) => Number(r.decisions ?? 0) > 0).length)} of them a decision)`
        : ''),
  )
}
for (const r of sweepable) {
  console.log(`  LEAK  ${r.slug} — ${String(r.age_days)} day(s) old, removable`)
}
for (const r of live) console.log(`  LIVE  ${r.slug} — ACTIVE, and named like a probe`)
for (const d of corpus) {
  console.log(`  CORPUS  ${d.slug} — "${d.title}", ${String(d.content_chars)} chars, ${d.made}`)
}

/*
  Documents that are really CONTAINERS (#272, #283).

  `app.containers_stored_as_documents` has existed since 0283 taught syncNotion
  to skip Notion containers, and nothing has ever called it — a hygiene query
  with no sweep to report into. This is that sweep: the same command Grant runs
  to find what a suite left behind is the right place to find what an importer
  left behind.

  Reported and never removed. A container stored as a document is a symptom of
  the importer, and deleting the row would hide it until the next sync wrote it
  back — the same reasoning the corpus rows above carry.
*/
const containers = (await db.execute('select * from app.containers_stored_as_documents()'))
  .rows as { slug?: string; title?: string; connector?: string }[]
for (const c of containers) {
  console.log(
    `  CONTAINER  ${String(c.slug ?? '?')} — "${String(c.title ?? '')}" ` +
      `came in through ${String(c.connector ?? '?')} and is a folder, not a document`,
  )
}

if (sweepable.length === 0 && live.length === 0 && corpus.length === 0 && containers.length === 0) {
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

/*
  The three other piles, counted so none of them can rebuild silently
  (#181, #241, #266).

  Four times now this repository has found harness traffic sitting on a table
  Grant reads, and each time it was harmless until a new reader looked without
  the filter. The fix each time was correct and local; what was missing was
  anything that would notice the pile forming again.

  Reported as a COUNT with a name, not swept here: two of the three are swept
  by `purge:fixtures` and the third is the office's memory, which must not be
  deleted. And the assertion is a PROPERTY — nothing harness-shaped reaches a
  reader Grant looks at — because a number goes stale the next time a suite
  runs and a property does not.
*/
const piles = await db.execute(`
  select
    (select count(*) from public.tasks where is_fixture) as fixture_tasks,
    /*
      The sixth debris class, and the one the witness above could not see
      (0530, 0531, 0532). public.tasks.is_fixture is GENERATED from added_by,
      and app.my_task_add hardcodes added_by to grant -- correctly, for a
      personal task -- so twenty-six tasks written by suites through the real
      product path sat on Grant's list while this file reported zero fixture
      tasks.

      DERIVED, the way 0355 derives it for jobs: a task whose JOB is a harness
      job is harness traffic, whatever the row says about who added it. This
      one FAILS the check, because it can only ever exclude and so cannot hide
      a task of his.
    */
    (select count(*) from public.tasks t
      where t.assigned_to_human and t.state <> 'done'
        and t.job_id is not null and app.harness_job(t.job_id)) as harness_tasks_on_his_list,
    /*
      And a REPORTED count beside it, which deliberately does not fail.

      Every suite here builds its run token as eight characters of base 36, so
      a title carrying a standalone eight-character word that mixes letters and
      digits is probably a suite's. Probably is the operative word: an order
      number would match, and a check that hides Grant's own work is worse than
      the debris it removes. So it is a number with a name, for a person to
      look at -- never a filter, and never a failure.
    */
    (select count(*) from public.tasks t
      where t.assigned_to_human and t.state <> 'done' and t.job_id is null
        and t.title ~ '\\m[a-z0-9]{8}\\M' and t.title ~ '\\m[a-z]*[0-9][a-z0-9]*\\M')
      as tasks_with_a_run_token,
    (select jsonb_array_length((app.hq_governance(400))->'lessons')) as live_lessons,
    /*
      Counted on the PAGE, not in the view (0389).

      A first draft asked the lessons_live view, which is also what lessons_for
      hands to an agent about to work. No backticks in this comment: it lives
      inside a template literal, and one here ends the string. A suite writing a lesson under a verify
      name and asserting it is retrieved is testing the right thing. The
      property that matters is that harness traffic does not reach the screen
      Grant reads, not that it does not exist.
    */
    (select count(*) from jsonb_array_elements((app.hq_governance(400))->'lessons') x
      where coalesce(x->>'by', '') like 'verify%'
         or coalesce(x->>'learned_by', '') like 'verify%') as harness_lessons,
    /*
      The PILE, which nothing counted.

      public.lessons is append-only - it rejects DELETE, UPDATE and TRUNCATE -
      and app.retract_lesson withdraws by INSERTING a retraction row. So the
      333 harness lessons standing on 22 September cannot be removed, and
      sweeping them would add 333 more permanent rows to a table that can
      never shrink, for no behavioural gain: 0539 keeps them out of every
      prompt and the counter above keeps them off the Governance page, and
      both report zero.

      So this one is DELIBERATELY reported and not failed. It exists because
      a debris class with no witness is one that comes back, and because a
      number that starts growing is the signal that a filter has stopped
      holding - which is a thing to notice before it reaches a screen rather
      than after.
    */
    (select count(*) from public.lessons l where l.is_fixture and l.row_kind = 'lesson'
       and not exists (select 1 from public.lessons r where r.supersedes = l.lesson_id))
      as harness_lessons_stored,
    (select count(*) from public.provider_health where provider like 'probe\\_%') as probe_providers,
    /*
      Fixture CONNECTORS, which had no witness at all until 0505.

      The studio settings payload builds Grant's Connections page straight from
      this table, and five rows named "Fixture connector" sat on it for two
      days -- five of twelve cards -- left by crashed runs of the connectors
      suite. Nothing counted them, which is why nobody knew.

      The reader filters them now, so this is no longer a defect Grant can SEE;
      it is a pile that grows quietly, which is the other half of the same
      problem and the reason this line exists rather than only the filter.

      No backticks in this comment: it is a SQL comment inside a template
      literal, and one here ends the string. Written wrongly on the first try,
      having recorded the trap an hour earlier.
    */
    (select count(*) from public.knowledge_connectors
      where connector like 'fixture\\_%') as fixture_connectors,
    /*
      AN OFFER A HARNESS MADE, sitting on his Governance page.

      New the moment #290 routed an unmarked preference through #147's
      offer instead of storing it: the route is right, and it meant a
      Shadow Grant sentence could be proposed to him as a standing rule.
      0543 filters the reader; this counts what the reader is hiding, so
      the pile cannot grow unwatched. A debris class with no witness is
      one that comes back - five tables have proved it.
    */
    (select count(*) from public.suggestions g
      where app.harness_suggestion(g.offer_args)) as harness_offers,
    /*
      AN AUTONOMY SETTING ON A PROJECT NOBODY CAN SEE.

      The project_id foreign key on autonomy_settings is NO ACTION, not
      CASCADE, so the row
      survives its project and — worse — BLOCKS the project delete, which sends
      a teardown down its archive branch while the check reports nothing left.
      Forty-nine accumulated in one afternoon before anything was counting, and
      a debris class with no witness is one that comes back: this is the sixth
      table to prove it.

      Counted for a fixture or archived project, because those are the two ways
      a project stops being one Grant can act on. A row on a live project of his
      is a SETTING, not debris, however it got there.

      AND OLDER THAN FIFTEEN MINUTES, because a suite that is RUNNING has set
      one and not yet swept it. Without the age this went red on a live
      verify:composes four minutes in -- a check that fires on work in progress
      is a check somebody learns to ignore, which is the failure mode the
      token-shape list in verify:hq already cost this repository once. Fifteen
      minutes is 0419's own number for the same question: long enough that
      nothing legitimate is still holding it.
    */
    (select count(*) from public.autonomy_settings a
       join public.projects p on p.project_id = a.project_id
      where (p.is_fixture or p.status = 'archived')
        and a.set_at < app.now_utc() - interval '15 minutes') as stranded_autonomy,
    /*
      The roster Grant looks at, asked the way he sees it (#269).

      Counted on hq_team's OUTPUT rather than on public.staff, for the same
      reason the lessons count is taken from the page: the property that
      matters is that a harness specialist does not reach the screen, not that
      no such row exists. A suite convening a temporary specialist mid-run is
      correct and must not turn this red.

      And counted as a PROPERTY - no name on the team page matching a harness
      prefix - rather than as "the roster is eight". Eight is true today and
      goes stale the first time Grant hires somebody, which is the assertion
      that came back three times in this repository already.
    */
    (select count(*) from jsonb_array_elements((app.hq_team())->'staff') x
      where coalesce(x->>'slug', '') ~ '^(fixture|verify|probe)-') as harness_on_team,
    /*
      Harness tools in the registry, which reach every prompt (0472's evening).

      No backticks in this comment: it lives inside a template literal, and one
      here ends the string -- the trap this file already carries once, forty
      lines above.

      capabilityBrief is built from tool_permissions and is prepended to EVERY
      answer. Three fixture tools left behind by teardowns that died on a 429
      pushed it to 4,118 characters against the 4,000 ceiling that
      verify:capability has asserted all along -- so harness debris was not
      merely sitting in a table, it was in front of the model on every real
      turn, and the suite that would have said so is not in the gate.

      A property, not a count: no tool whose name is a harness name. The real
      registry is twenty-six and will grow.
    */
    (select count(*) from public.tool_permissions
      where tool ~ '^(verification|fixture|probe|verify)[._-]') as harness_tools,
    (select count(*) from public.staff where is_fixture and not active) as retired_fixture_staff,
    /*
      The eighth class, and the only one that is a SECURITY regression rather
      than clutter.

      0523 made app.claim_delivery default-deny for harness traffic: a
      fixture job may only be delivered to a destination registered in
      public.test_destinations. The table stood empty for a day and a half
      and that was correct -- until two suites had to start registering their
      own fabricated destinations, because the guard had quietly turned nine
      of verify:transport's checks and one of verify:chaos's red about a
      thing that was not broken.

      No backticks in this comment, deliberately: it lives inside a template
      literal and a backtick here ends the string. CLAUDE.md records that trap
      five times and it was hit again writing this very block.

      A registration a crashed run leaves behind does not merely clutter a
      table. It permanently widens the hole 0523 closed, for that destination,
      for ever, and nothing else would ever mention it. Every other debris
      class here costs tidiness; this one costs the invariant.

      Counted rather than swept, on purpose. A row here was put there
      deliberately by somebody, and 0523's own argument is that what may
      receive harness traffic is a decision rather than a default — so this
      names it and stops, exactly as it does for a pinned project.
    */
    (select count(*) from public.test_destinations) as registered_test_destinations
`)
const pile = (piles.rows[0] ?? {}) as Record<string, number>
const noisy: string[] = []
if (Number(pile.registered_test_destinations ?? 0) > 0) {
  noisy.push(
    `${String(pile.registered_test_destinations)} destination(s) still registered in ` +
      'public.test_destinations — a suite registers one so its fixture job can be ' +
      'delivered at all (0523) and removes it in teardown, so a row at rest means a ' +
      'crashed run left the default-deny guard open for that destination',
  )
}
if (Number(pile.fixture_tasks ?? 0) > 0) {
  noisy.push(`${String(pile.fixture_tasks)} fixture task(s) — npm run purge:fixtures -- --go`)
}
if (Number(pile.harness_tasks_on_his_list ?? 0) > 0) {
  noisy.push(
    `${String(pile.harness_tasks_on_his_list)} task(s) on Grant's personal list were made by a ` +
      'harness job — the suite that wrote them is not tearing down (0530)',
  )
}
if (Number(pile.harness_lessons ?? 0) > 0) {
  noisy.push(
    `${String(pile.harness_lessons)} harness lesson(s) on the Governance page — the ` +
      'generated is_fixture on public.lessons is not catching a new writer name',
  )
}
if (Number(pile.harness_on_team ?? 0) > 0) {
  noisy.push(
    `${String(pile.harness_on_team)} harness specialist(s) on Grant's Team page — ` +
      'hq_team has stopped filtering them',
  )
}
if (Number(pile.retired_fixture_staff ?? 0) > 0) {
  noisy.push(
    `${String(pile.retired_fixture_staff)} retired harness specialist(s) in public.staff — ` +
      'npm run purge:fixtures -- --go',
  )
}
if (Number(pile.harness_tools ?? 0) > 0) {
  noisy.push(
    `${String(pile.harness_tools)} harness tool(s) in tool_permissions — they are in ` +
      'capabilityBrief, which goes in front of every answer',
  )
}
if (Number(pile.probe_providers ?? 0) > 0) {
  noisy.push(
    `${String(pile.probe_providers)} probe provider(s) in provider_health — a circuit ` +
      'breaker suite is not clearing up after itself',
  )
}
if (Number(pile.stranded_autonomy ?? 0) > 0) {
  noisy.push(
    `${String(pile.stranded_autonomy)} autonomy setting(s) on a fixture or archived ` +
      'project — the foreign key is NO ACTION, so each one also blocks its ' +
      "project's delete and sends a teardown quietly down its archive branch",
  )
}
if (Number(pile.fixture_connectors ?? 0) > 0) {
  noisy.push(
    `${String(pile.fixture_connectors)} fixture connector(s) in knowledge_connectors — ` +
      'the reader hides them from Grant (0505) and the pile still grows; ' +
      'verify:connectors is not tearing down',
  )
}
console.log(
  `\n  lessons on the Governance page: ${String(pile.live_lessons)} · ` +
    `fixture tasks: ${String(pile.fixture_tasks)} · ` +
    `harness tasks on his list: ${String(pile.harness_tasks_on_his_list)} · ` +
    `personal tasks carrying a run token: ${String(pile.tasks_with_a_run_token)} · ` +
    `probe providers: ${String(pile.probe_providers)} · ` +
    `fixture connectors: ${String(pile.fixture_connectors)} · ` +
    `stranded autonomy rows: ${String(pile.stranded_autonomy)} · ` +
    `test destinations registered: ${String(pile.registered_test_destinations)} · ` +
    `harness tools in the registry: ${String(pile.harness_tools)} · ` +
    `harness offers on the Governance page: ${String(pile.harness_offers)} · ` +
    `harness lessons stored (reported, not swept - see the comment): ${String(pile.harness_lessons_stored)} · ` +
    `roster: ${String(pile.retired_fixture_staff)} retired fixture specialist(s)`,
)
/*
  And what this sweep can NEVER remove (0494).

  `check:leaks` is built around what it can delete, and reports a project a
  suite should have torn down. An active fixture project that has gathered a
  JOB is a different animal: a job can never be deleted, so
  `app.project_delete` refuses that project for ever. It cannot be swept, it
  cannot be failed on usefully, and it sits in Grant's switcher.

  Ten of them reached him — one per gate run of `verify:recovers`, over two
  days, before anybody looked. So the sweep now NAMES them. A warning rather
  than a failure, deliberately: failing on something nobody can fix is how a
  check gets ignored, and the fix belongs in the suite that created it.

  This is also the caller `app.stuck_fixture_projects()` needs. It was
  committed without one, and `check:callers` caught it before the merge —
  which is the defect that function's own migration was written about, one
  layer up.
*/
const stuck = (await db.execute('select * from app.stuck_fixture_projects()')).rows as {
  slug: string
  jobs: number
  age: string
}[]
if (stuck.length > 0) {
  console.log(
    `\n  ${String(stuck.length)} active fixture project(s) hold a job and can therefore ` +
      'never be deleted — archive them and fix the suite that made them:',
  )
  for (const p of stuck) {
    console.log(`    ${p.slug} — ${String(p.jobs)} job(s), ${String(p.age).split('.')[0]} old`)
  }
}

/*
  THE ONE THIS CHECK COULD NOT SEE, and the reason Grant got a test reminder.

  Everything above asks whether the database is CLEAN NOW. A delivery is not a
  row that lingers — it is an event that already happened, 0.26 seconds after
  the output was written and long before any teardown could run. So the
  previous run reported "no QA debris" truthfully while 162 harness messages
  had been SENT to real destinations across 42 runs, 87 of them to Grant.

  "Clean now" and "no synthetic side effect ever escaped" are different claims.
  Only the first was ever being made. This makes the second one.

  It counts ATTEMPTS as well as sends, because 0523's guard suppresses rather
  than raising: a suite that keeps aiming at a production destination is a
  suite about to escape the day somebody widens the registry, and a guard
  nobody can measure is one nobody notices decaying.
*/
const guard = (
  (await db.execute('select app.harness_escapes() as v')).rows[0] as { v?: unknown } | undefined
)?.v
const esc = (typeof guard === 'string' ? JSON.parse(guard) : (guard ?? {})) as {
  since?: string
  escaped?: { channel?: string; target?: string; by?: string; at?: string }[]
  refused?: number
  before_the_guard?: number
}
const got = esc.escaped ?? []
console.log(
  `\n  harness traffic that reached a real destination SINCE the guard: ${String(got.length)}` +
    ` · refused by it: ${String(esc.refused ?? 0)}` +
    ` · before it existed: ${String(esc.before_the_guard ?? 0)}`,
)

if (got.length > 0) {
  console.error(
    [
      ``,
      `check:leaks FAILED — ${String(got.length)} harness delivery(s) REACHED a real destination.`,
      ...got
        .slice(0, 6)
        .map((g) => `  ${String(g.by)} -> ${String(g.channel)} ${String(g.target)}`),
      ``,
      'This is the defect that put "Reminder: Remind me khgkowx8." on his phone.',
      '0523 makes a production destination structurally unreachable from a harness',
      'job, so a send getting through means something bypassed app.claim_delivery or',
      'a real destination was registered in public.test_destinations. Neither is a',
      'cleanup problem and neither is fixed by a teardown.',
    ].join('\n'),
  )
  process.exit(1)
}

if (noisy.length > 0) {
  console.error(`\ncheck:leaks FAILED — harness traffic on a table Grant reads:`)
  for (const n of noisy) console.error(`  ${n}`)
  process.exit(1)
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

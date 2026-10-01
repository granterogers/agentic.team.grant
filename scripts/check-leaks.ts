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
import {
  ADAPTER_SHAPE,
  harnessDocSql,
  ignoredOriginSql,
  offShapeSql,
  provenanceSql,
  testDestinationAtSend,
} from './leak-witness.ts'

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
    /*
      AND THE ONES WHOSE TOKEN HAPPENED TO HOLD NO DIGIT, NAMED RATHER THAN
      COUNTED.

      A run token is eight characters of base 36, so roughly one in fifteen
      contains no digit at all and is invisible to the count above.
      "Chase the printers gmzvgkuw" sat on Grant's real open list that way --
      a containment violation of the kind the brief names by name, a task he
      can see, written by a suite -- while this file reported "personal tasks
      carrying a run token: 0".

      The digit was there for a reason and it stays: without it the pattern
      also matches "printers", and a check that hides his own work is worse
      than the debris it removes. So the looser reading PRINTS THE TITLES
      instead of counting them. A person can tell a run token from a word in
      one glance and cannot do anything with a number.

      Why the source cannot be fixed instead: app.my_task_add takes a title,
      a detail, a date and a time, and nothing that says who is asking -- it
      is Grant's own door, so added_by is his by construction. A suite
      driving the feature therefore CANNOT mark its row, and
      tasks.is_fixture is generated from exactly that column. The row is
      swept by the suite and named here when a crash stops it.

      No backticks in this comment: it lives inside a template literal.
    */
    (select coalesce(jsonb_agg(t.title order by t.created_at desc), '[]'::jsonb)
       from public.tasks t
      where t.assigned_to_human and t.state <> 'done' and t.job_id is null
        and t.title ~ '\\m[a-z0-9]{8}$')
      as tasks_ending_in_a_tokenish_word,
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
    /*
      AND THE ONE THAT IS NOT A PILE BUT A BREACH (0545).

      The line above counts harness lessons that EXIST, which is tolerable -
      they are append-only and hq_governance knows what they are. This one
      counts harness lessons that reach a real PROMPT, which is not
      tolerable at any number.

      0539 filtered on lessons.is_fixture, which is GENERATED from
      learned_by and therefore cannot see that the JOB was harness traffic:
      a session driving the real enqueue path records learned_by as grant.
      12 of the 15 lessons in every real prompt were that kind, including
      two contradictory prices for Grant's middle tier, one of them a figure
      the office had invented.

      Asked through the READER rather than by restating its predicate, so a
      future change to what harness means cannot leave this check agreeing
      with a stale copy of the rule.

      No backticks in this comment: it lives inside a template literal.
    */
    (select count(*)
       from app.lessons_for(null, 'chief-of-staff', 'office.instruction', 500) f
       join public.lessons l on l.lesson_id = f.lesson_id
      where l.from_job is not null and app.harness_job(l.from_job))
      as harness_lessons_in_a_real_prompt,
    /*
      THE CONTROL FOR THE LINE ABOVE, and not optional.

      Its happy path is zero, which is the one shape indistinguishable from
      a check that cannot fire. The same join through the same reader with
      the harness door OPEN must come back positive; if it does not, there
      are no harness-taught lessons to detect and the zero above says
      nothing about the filter.
    */
    (select count(*)
       from app.lessons_for(null, 'chief-of-staff', 'office.instruction', 500, true) f
       join public.lessons l on l.lesson_id = f.lesson_id
      where l.from_job is not null and app.harness_job(l.from_job))
      as harness_lessons_the_filter_removes,
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
    (select count(*) from public.test_destinations t
      where not (to_jsonb(t) ? 'retired_at') or (to_jsonb(t) ->> 'retired_at') is null) as registered_test_destinations,
    /*
      AND HIS ACTIVITY PANEL (#356).

      app.hq_studio_lately answers the studio's "what has the office been
      doing" panel. Its COUNTERS already asked app.harness_job; its FEED
      filtered only fixture PROJECTS — and #45 sends any suite testing a
      fixture filter to use a REAL project, so 73 of 125 items were suites.
      This check passed throughout, because it did not know the reader existed.
    */
    (select count(*)
       from jsonb_array_elements(app.hq_studio_lately(app.sole_person_office(), 200) -> 'office') e,
            jsonb_to_record(e) as x(who text)
      where app.harness_label(x.who)) as harness_on_his_activity_panel,
    /*
      HARNESS CONTACTS, which had no witness until 24 September.

      A contact is the one row on this board that is a PERSON, and the office
      held five of them named "Acceptance contact <run> (corrected)" on one of
      Grant's real projects -- an acceptance run's subjects, archived rather
      than removed, so the board said "Nobody is recorded against this project
      yet" while the table said five. Archived is not swept: it is debris the
      UI happens to hide, and the next reader that does not filter the
      archived_at column puts strangers on his screen.

      Named by CLASS rather than by a run's own prefix, because a teardown
      keyed on its own token can never collect an earlier crashed run's -- the
      defect that let five accumulate. The real project's people are named
      after people.
    */
    (select count(*) from public.contacts
      where name ~* '^(acceptance|face|fixture|probe|verify)[ ._-]') as harness_contacts
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
if (Number(pile.harness_on_his_activity_panel ?? 0) > 0) {
  noisy.push(
    `${String(pile.harness_on_his_activity_panel)} suite row(s) on his Recent activity ` +
      'panel (app.hq_studio_lately) — the feed filters fixture PROJECTS and #45 sends ' +
      'suites to real ones, so filter the ACTOR with app.harness_label (0586)',
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
if (Number(pile.harness_contacts ?? 0) > 0) {
  noisy.push(
    `${String(pile.harness_contacts)} harness contact(s) in public.contacts — a suite ` +
      'left a person behind on a real project; archiving one is not sweeping it',
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
/*
  Named, not counted: a person can tell a run token from a word at a glance
  and cannot do anything with a number. Reported, never a failure, for the
  reason the query's comment gives.
*/
const tokenish = (pile.tasks_ending_in_a_tokenish_word ?? []) as string[]
if (tokenish.length > 0) {
  console.log(
    `\n  personal tasks ending in a token-shaped word — look at these, they may be a suite's:`,
  )
  for (const title of tokenish) console.log(`    ${title}`)
}

console.log(
  `\n  lessons on the Governance page: ${String(pile.live_lessons)} · ` +
    `fixture tasks: ${String(pile.fixture_tasks)} · ` +
    `harness tasks on his list: ${String(pile.harness_tasks_on_his_list)} · ` +
    `personal tasks carrying a run token: ${String(pile.tasks_with_a_run_token)} · ` +
    `probe providers: ${String(pile.probe_providers)} · ` +
    `harness contacts: ${String(pile.harness_contacts)} · ` +
    `fixture connectors: ${String(pile.fixture_connectors)} · ` +
    `stranded autonomy rows: ${String(pile.stranded_autonomy)} · ` +
    `test destinations registered: ${String(pile.registered_test_destinations)} · ` +
    `harness tools in the registry: ${String(pile.harness_tools)} · ` +
    `harness offers on the Governance page: ${String(pile.harness_offers)} · ` +
    `harness lessons stored (reported, not swept - see the comment): ${String(pile.harness_lessons_stored)} · ` +
    `harness lessons REACHING A REAL PROMPT: ${String(pile.harness_lessons_in_a_real_prompt)} ` +
    `(the filter removes ${String(pile.harness_lessons_the_filter_removes)}, which is what makes the zero mean something) · ` +
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
  A SUITE THAT SIGNS ITS MESSAGES IN A NAMESPACE NOBODY RECOGNISES (#348).

  `inbound_commands.dedupe_key` is written by the adapter that received the
  turn, and the namespaces separate completely: `teamhq`, `slack`, `telegram`
  and `voice` are the real ones, each used on its own channel, and `verify` is
  a suite impersonating three of them. 0574 taught `app.harness_job` to read
  it - which removed 35 suite turns from what the office called Grant's
  conversation, and closed the same blind spot in `app.claim_delivery`, which
  asks that function before allowing a real destination.

  What can still go wrong is a NEW namespace: the next suite writes
  `probe:...` or `sim:...`, nothing recognises it, and its traffic is counted
  as his again - and may be delivered to him. So this asserts the property
  rather than the list: every namespace is either a real channel or one the
  harness predicate already knows about.
*/
const spaces = (
  await db.execute(`
    select split_part(c.dedupe_key, ':', 1) as space,
           count(*)::int as n,
           count(*) filter (where app.harness_job(j.job_id))::int as seen_as_harness
      from public.inbound_commands c
      join public.jobs j on j.pinned_config ->> 'command_id' = c.command_id::text
     where c.dedupe_key is not null
     group by 1`)
).rows as { space: string; n: number; seen_as_harness: number }[]

if (spaces.length === 0) {
  console.error('\ncheck:leaks could not read any dedupe namespaces — fix the query')
  process.exitCode = 1
}
/*
  Namespaces that are Grant's own, each classified deliberately.

  `asset` was not in the first version of this list and the check found it on
  its first run: `asset:document:<uuid>:review:2` on teamhq, a real message of
  his from the dashboard asking the office to review a document he had
  uploaded. The check was right to stop on a namespace nobody had classified;
  the answer was to classify it, not to call it harness.

  That is the whole design. It fails on anything UNCLASSIFIED rather than
  guessing, so the next suite that invents `probe:` or `sim:` stops the gate
  until somebody says which it is — and a wrong guess here would either hide
  test traffic in his numbers or suppress a message he is waiting for.
*/
/*
  A JOB WHOSE ORIGIN A SUITE DELETED (#349).

  Only suite teardowns delete `public.inbound_commands` — there is no product
  path, no retention sweep and no SQL function that does. A job can never be
  deleted, so what survives is a job with no evidence of whose turn it was,
  counted as Grant's for ever. 68 of them are, spanning 7 September onward.

  0575 stamps the dedupe namespace onto the job in a BEFORE DELETE trigger, so
  the evidence outlives the row that carried it. The 68 already stranded
  cannot be recovered — the evidence is gone, and guessing would be the
  fabrication this office exists not to do.

  So this asserts the PROPERTY rather than a number: nothing orphaned since
  the trigger exists may be counted as real. A magic baseline of 68 would go
  stale the first time somebody legitimately reclassified one.
*/
const orphans = (
  await db.execute(`
    select count(*)::int as since_the_trigger
      from public.jobs j
     where j.pinned_config ? 'command_id'
       and not app.harness_job(j.job_id)
       and j.created_at > (select max(applied_at) from app.schema_migrations
                            where name like '0575_%')
       and not exists (select 1 from public.inbound_commands c
                        where c.command_id = (j.pinned_config ->> 'command_id')::uuid)`)
).rows[0] as { since_the_trigger: number }

if (Number(orphans.since_the_trigger) > 0) {
  noisy.push(
    `${String(orphans.since_the_trigger)} job(s) counted as Grant's have had their origin ` +
      'deleted since 0575 — the trigger that preserves the dedupe namespace is not firing',
  )
}

const REAL_CHANNELS = new Set([
  'teamhq',
  'slack',
  'telegram',
  'voice',
  // A review he asked for on a document, raised from the dashboard.
  'asset',
])
for (const sp of spaces) {
  if (REAL_CHANNELS.has(sp.space)) continue
  if (sp.seen_as_harness === sp.n) continue
  noisy.push(
    `${String(sp.n - sp.seen_as_harness)} message(s) in the "${sp.space}" dedupe namespace are ` +
      "counted as Grant's own — no real adapter writes that namespace, so teach " +
      'app.harness_job about it (0574 did this for "verify")',
  )
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
type Escape = { channel?: string; target?: string; by?: string; at?: string; issue?: string }
const esc = (typeof guard === 'string' ? JSON.parse(guard) : (guard ?? {})) as {
  since?: string
  escaped?: Escape[]
  known?: Escape[]
  new?: Escape[]
  refused?: number
  before_the_guard?: number
}
/*
  KNOWN and NEW, reported apart (0566).

  #298 deliberately kept two escaped deliveries as the record of a defect, so
  this gate exited 1 for ever on evidence somebody chose to preserve — and a
  fresh session read that red exit as a live containment failure and filed a
  duplicate (#323). A gate red by design is one people learn to skip, which is
  the only failure mode this one cannot survive.

  The total is still printed, because the honest number is the whole one. Only
  an UNACKNOWLEDGED escape fails the run, and an acknowledgement names a single
  `delivery_id` with its issue and reason — it can never pre-approve an escape
  that has not happened yet.
*/
const got = esc.escaped ?? []
const known = esc.known ?? []
const fresh = esc.new ?? []
console.log(
  `\n  harness traffic that reached a real destination SINCE the guard: ${String(got.length)}` +
    ` (known historical escapes: ${String(known.length)}` +
    ` · new escapes since containment fix: ${String(fresh.length)})` +
    ` · refused by it: ${String(esc.refused ?? 0)}` +
    ` · before it existed: ${String(esc.before_the_guard ?? 0)}`,
)
for (const k of known) {
  console.log(
    `    known ${String(k.issue)}: ${String(k.by)} -> ${String(k.channel)} ${String(k.target)}`,
  )
}

/*
  AND THE WITNESS MUST NOT SHARE THE GUARD'S BLIND SPOT (#354).

  `app.claim_delivery` refuses a harness job a production destination, and this
  check reports when one got through. BOTH ask `app.harness_job`, so a job that
  predicate cannot recognise is invisible to the guard AND to the report — they
  agree with each other and are both wrong, which is the one failure shape a
  witness cannot survive.

  That is exactly what happened. 0574 read the inbound command's dedupe key with
  `split_part(key, ':', 1) = 'verify'`, which sees the FIRST segment only, and a
  voice turn's key is `voice:turn:<who>`. A suite driving the live voice webhook
  produced `voice:turn:verify-basecamp-live-...`, sat in the third segment, and
  14 jobs answered as Grant's own voice notes and delivered 20 messages to his
  real Telegram and Slack while this check reported "new escapes: 0".

  So the property is asserted directly, against the OTHER predicate: a command
  carrying a harness label may not belong to a job that reads as real traffic.
  Two independent statements of the same fact, which is what makes a
  disagreement mean something — and unlike a count, it survives the next suite.
*/
const disagreeRows = (
  await db.execute(`
    select count(*)::int as n,
           coalesce(max(left(c.dedupe_key, 70)), '') as sample
      from public.jobs j
      join public.inbound_commands c
        on c.command_id = (j.pinned_config ->> 'command_id')::uuid
     where app.harness_label(c.dedupe_key)
       and not app.harness_job(j.job_id)
  `)
).rows as { n: number; sample: string }[]
const disagree = disagreeRows[0] ?? { n: 0, sample: '' }

if (disagree.n > 0) {
  console.error(
    [
      ``,
      `check:leaks FAILED — ${String(disagree.n)} job(s) carry a harness label and read as REAL traffic.`,
      `  e.g. ${disagree.sample}`,
      ``,
      'app.harness_label says harness and app.harness_job says real, so the',
      'containment guard cannot see them either — it asks app.harness_job. This is',
      '#354: the two predicates must not disagree, or a suite delivers to his phone',
      'and this check reports clean. Teach app.harness_job the signal, do not',
      'narrow app.harness_label.',
    ].join('\n'),
  )
  process.exit(1)
}

/*
  A WITNESS THAT DOES NOT ASK app.harness_job (ledger R37).

  Every check above, and the guard itself, decide "harness" with the same
  predicate, so a harness it cannot see is invisible to all of them at once:
  on 24 September this repository's own `verify:scenario-a` delivered six
  messages to Grant while this check said "new escapes: 0", and on 21 September
  `verify:escapes`' positive control was run by the deployed worker and
  delivered twice to his Slack. Neither was ever counted.

  So this asks something else: on the three external doors, a production
  adapter writes a dedupe key of a KNOWN SHAPE (Telegram numeric chat and
  message, Slack channel and timestamp, the dashboard page's own voice
  session). A turn delivered to a real destination whose key no adapter writes
  was not sent by Grant, whatever the attribution says. The eleven found when
  this was written are acknowledged below as evidence, never deleted.
*/
const ACKNOWLEDGED_OFF_SHAPE = new Set([
  // #354 / R37 — verify:escapes' positive control, run by the deployed worker
  'telegram:message:escapes-37qp9xjj-real',
  'telegram:message:escapes-h3cp3sg2-real',
  // #354 / R37 — deploy:voice probes, sessions not named verify-
  'voice:turn:deploy1790157906882.mudxspg1',
  'voice:turn:deploy1790159346743.mudynkfx',
  'voice:turn:deploy1790159389467.mudyohe2',
  'voice:turn:deploy1790203507600.mueoy344',
  // #354 / R37 — verify:scenario-a, 24 Sep 22:12, the remediation session's own run
  'voice:turn:scenario-a-mug35frh.mug37s8n',
  'voice:turn:scenario-a-mug35frh.mug37ud5',
  'voice:turn:scenario-a-mug35frh.mug37vak',
  'voice:turn:scenario-a-mug35frh.mug37vru',
  // #354 / R37 — a hand probe
  'voice:turn:uxfix1.mue3aakx',
])
const offShape = (await db.execute(offShapeSql)).rows as { key: string }[]
// The second witness: a document a harness added, whose child delivered (R37).
const ACKNOWLEDGED_HARNESS_DOC = new Set([
  // R37: verify:scenario-a's knowledge.read_source child, 24 Sep 22:11, Slack
  // C0BV7ULTCJ1. Found by this witness on its first run; kept as evidence.
  'c8f7ea92-fc26-4391-9f14-a6149f660a0f',
])
const harnessDocAll = (await db.execute(harnessDocSql)).rows as {
  key: string
  delivery_id: string
}[]
const harnessDoc = harnessDocAll.filter((r) => !ACKNOWLEDGED_HARNESS_DOC.has(r.delivery_id))
console.log(
  `  delivered from a document a harness added: ${String(harnessDocAll.length)} (acknowledged: ${String(harnessDocAll.length - harnessDoc.length)} · new: ${String(harnessDoc.length)})`,
)
if (harnessDoc.length > 0) {
  console.error(
    [
      ``,
      `check:leaks FAILED — ${String(harnessDoc.length)} delivery(s) came from work a harness-added document started.`,
      ...harnessDoc.slice(0, 6).map((r) => `  added_by ${r.key} -> delivery ${r.delivery_id}`),
      '',
      'The document insert trigger composes requested_by from the connector reference,',
      'so label the reference :verify-... in the suite (R37).',
    ].join('\n'),
  )
  process.exit(1)
}
// The control: the shape must still admit a real key of each door, and refuse an escaped one.
const shapeRe = new RegExp(ADAPTER_SHAPE)
if (
  ![
    'telegram:message:8412:1386648496:512',
    'slack:message:C0C2DAPDN02:1790000000.1234',
    'voice:turn:s9czo3u0fw2.mufvdj1',
  ].every((k) => shapeRe.test(k)) ||
  ['voice:turn:scenario-a-x.1', 'telegram:message:escapes-x-real'].some((k) => shapeRe.test(k))
) {
  console.error(
    'check:leaks CANNOT RUN — the adapter-shape witness does not tell a real key from an escape.',
  )
  process.exit(2)
}
const offNew = offShape.filter((r) => !ACKNOWLEDGED_OFF_SHAPE.has(r.key))
console.log(
  `  delivered by a turn whose key no production adapter writes: ${String(offShape.length)} (acknowledged: ${String(offShape.length - offNew.length)} · new: ${String(offNew.length)})`,
)
if (offNew.length > 0) {
  console.error(
    [
      ``,
      `check:leaks FAILED — ${String(offNew.length)} turn(s) reached a real destination under a key no production adapter writes.`,
      ...offNew.slice(0, 6).map((r) => `  ${r.key}`),
      ``,
      'Whatever app.harness_job says, Grant did not send these. Find the script that',
      'posts to that door, name its identity verify-..., and teach app.harness_job',
      'the signal (0583, 0598).',
    ].join('\n'),
  )
  process.exit(1)
}

/*
  EVERY SENT MESSAGE, RECONCILED AGAINST WHAT CAUSED IT (#378).

  Everything above either asks app.harness_job or starts from a delivery's
  job_id, and #378 was a delivery with no job_id sent by a guard that allowed
  a null job: 381 harness narrations reached Slack and every check here said
  clean. provenanceSql attributes a row to a job from the row or from its key,
  walks the lineage with rules of its own, and names two breaches. See
  scripts/leak-witness.ts; scripts/isolated/witness-independence.ts proves it
  catches every shape with app.harness_job deliberately broken.

  It FAILS on breaches after 0601 (the fix) was applied, and until then reports
  history, because history is evidence and is not deleted.
*/
const fixedAt = (
  (
    await db.execute(
      `select applied_at::text as t from app.schema_migrations where name like '0601\\_%' limit 1`,
    )
  ).rows[0] as { t?: string } | undefined
)?.t
const since = fixedAt === undefined ? 'app.harness_guard_since()' : `'${fixedAt}'::timestamptz`
// #381's declarations exist only once 0605 is applied; before that there are none to honour.
const declarations =
  (
    (await db.execute(`select to_regclass('public.test_origins') is not null as t`)).rows[0] as
      | { t?: boolean }
      | undefined
  )?.t === true
// 0606's retirement column exists only once 0606 is applied.
const retirement =
  (
    (
      await db.execute(`select exists (select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'test_destinations'
           and column_name = 'retired_at') as t`)
    ).rows[0] as { t?: boolean } | undefined
  )?.t === true
const traced = (await db.execute(provenanceSql(since, { declarations, retirement }))).rows as {
  key: string
  channel: string
  target_ref: string
  sent_at: string
  breach: string | null
  harness: boolean
  guard_says_harness: boolean
  known: boolean
}[]
const population = Number(
  (
    (
      await db.execute(`select count(*)::int as n from public.deliveries d
         where d.state = 'sent' and d.sent_at >= ${since}
           and not ${testDestinationAtSend('d', retirement)}`)
    ).rows[0] as { n?: number } | undefined
  )?.n ?? -1,
)
if (population !== traced.length) {
  console.error(
    `check:leaks CANNOT RUN — the provenance witness examined ${String(traced.length)} of ${String(population)} sent messages.`,
  )
  process.exit(2)
}
// Acknowledged sends (public.known_escapes) are reported, and never fail the run.
const knownBreaches = traced.filter((r) => r.breach !== null && r.known)
const breaches = traced.filter((r) => r.breach !== null && !r.known)
const byClass = (c: string) => breaches.filter((r) => r.breach === c).length
const disagreements = traced.filter((r) => r.harness !== r.guard_says_harness)
console.log(
  `  every sent message traced to its cause ${fixedAt === undefined ? '(since the guard; 0601 not applied, so HISTORY — reported, not failed)' : `(since 0601, ${fixedAt})`}: ` +
    `${String(traced.length)} examined · harness sent ${String(byClass('HARNESS_SENT'))} · unprovenanced ${String(byClass('UNPROVENANCED'))} · unknown origin ${String(byClass('UNKNOWN_SENT'))}` +
    ` · declared test origin sent ${String(byClass('TEST_ORIGIN_SENT'))} · undeclared door origin sent ${String(byClass('UNREGISTERED_ORIGIN_SENT'))}` +
    ` · witness and app.harness_job disagree on ${String(disagreements.length)}` +
    ` · acknowledged (known, not new): ${String(knownBreaches.length)}`,
)
if (fixedAt !== undefined && breaches.length > 0) {
  console.error(
    [
      ``,
      `check:leaks FAILED — ${String(breaches.length)} message(s) sent since 0601 that nothing should have let through.`,
      ...breaches
        .slice(0, 8)
        .map((r) => `  ${r.breach}  ${r.key} -> ${r.channel} ${r.target_ref} at ${r.sent_at}`),
      ``,
      "HARNESS_SENT: the lineage is harness by the witness's own rules. UNKNOWN_SENT: the root is",
      'nothing a production door or the office itself makes (#379). UNPROVENANCED: no job,',
      'and not an operator notice. TEST_ORIGIN_SENT: the root is in a conversation a run',
      'declared as a test (#381). UNREGISTERED_ORIGIN_SENT: an adapter-exact turn from a',
      'conversation no real person uses - a suite that drove a real door without declaring it.',
      'Either way app.claim_delivery allowed it (#378).',
    ].join('\n'),
  )
  process.exit(1)
}

/*
  #381: a declaration that was not honoured, whether or not anything was sent.
  The door wrote a turn in a conversation a run declared, and the turn is not
  synthetic: the stamp did not see the declaration, so everything downstream
  would treat the test as Grant.
*/
if (declarations) {
  const ignored = (await db.execute(ignoredOriginSql)).rows as {
    key: string
    run_token: string
    channel: string
    conversation: string
  }[]
  console.log(`  declared test origins that the door ignored: ${String(ignored.length)}`)
  if (ignored.length > 0) {
    console.error(
      [
        ``,
        `check:leaks FAILED — ${String(ignored.length)} turn(s) arrived in a declared test conversation and were NOT marked synthetic.`,
        ...ignored
          .slice(0, 8)
          .map((r) => `  ${r.channel} ${r.conversation} (run ${r.run_token}): ${r.key}`),
      ].join('\n'),
    )
    process.exit(1)
  }
}

if (fresh.length > 0) {
  console.error(
    [
      ``,
      `check:leaks FAILED — ${String(fresh.length)} NEW harness delivery(s) REACHED a real destination.`,
      ...fresh
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

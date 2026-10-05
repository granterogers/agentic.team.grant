/**
 * A name finds the right project, and an ambiguous one finds nobody.
 *
 *   npm run verify:identity
 *
 * ## What this is checking, and why it is worth a harness
 *
 * Grant described a specific failure: he referred conversationally to a
 * wellness project when a related one already existed, and the system made a
 * duplicate. The audit found two causes meeting each other —
 * `app.resolve_project` could not resolve a name at all, and
 * `app.hq_create_project` treated a name collision as a slug collision and
 * appended a number. `ai-learning-2` is still in the table.
 *
 * 0153 closed both. The reason it needs a live harness rather than unit tests
 * is that all of it is SQL: trigram similarity, a generated normalised column,
 * a global uniqueness constraint, and a resolution order with four steps in it.
 * None of that can be exercised from Node, and every one of those pieces has a
 * way of being subtly wrong that still returns rows.
 *
 * ## The two thresholds, and why they differ
 *
 * Creating asks at **0.55** and resolving acts at **0.90**, deliberately.
 * Getting the create path wrong asks Grant a needless question. Getting the
 * resolve path wrong files work against the wrong project without telling
 * anyone. The costs are not symmetric, so the numbers are not either — and the
 * checks below assert both, because a later tidy-up that unified them would
 * look like a simplification and be a regression.
 *
 * ## Fixtures
 *
 * ## Subjects
 *
 * The projects this creates are REAL, not fixtures, because the function under
 * test excludes fixtures by design. They are named `Identity proof <run>` and
 * removed at the end. See the note on SUBJECT below.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

/*
  The subjects of this suite are NOT fixture projects, and that is the point.

  `app.resolve_project_by_name` deliberately excludes fixtures:

      live as (select p.* from public.projects p
                where p.status = 'active' and not p.is_fixture)

  and `projects.is_fixture` is GENERATED from the slug — 'fixture-%', 'verify-%',
  'ledger-proof-%'. So every subject named `fixture-identity-…` was invisible to
  the very function under test, and eleven checks failed against a feature that
  works. Verified directly against a real project:

      hq_create_project('Legacy Coaching Course', …)
        -> needs_confirmation: true, 1 candidate, nothing created
      hq_create_project('legacy coaching', …)
        -> needs_confirmation: true, 0.743 near match, nothing created

  Making resolution see fixtures would be changing the product to suit the test.
  So the subjects are real projects with a distinctive name, removed at the end.

  **The slug is derived from the NAME, not from `p_ref`.** `p_ref` is the
  connector reference. Getting that backwards is how a teardown keyed on the
  reference matched nothing and left six real, active projects in Grant's
  project list. Everything that has to find these rows again keys on SLUG.
*/
const SUBJECT = `identityproof-${run}`
/** What `app.hq_create_project` will actually derive from those names. */
const SLUG = `identity-proof-${run}`
const SLUG_OTHER = `identity-proof-other-${run}`

const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

/*
  A RUN THAT DIES BEFORE ITS TEARDOWN LEAVES ACTIVE PROJECTS, AND THE NEXT RUN IS THE ONLY THING THAT WILL EVER MEET THEM.
  Eight `identity-proof-*` projects sat active in the quarantine test office from two runs a minute apart on 2 October
  (neither reached the teardown at the bottom). They are not Grant's - this suite always acts in `app.test_office()` - but a
  teardown that only runs on success is not a teardown. So every run first archives what an earlier run left: the TEST
  office only, the `identity-proof-` slug only, and only projects older than ten minutes so a concurrent run is untouched.
  Archived, never deleted: each carries a job, and a job cannot be removed.
*/
await db.execute(`
  update public.projects set status = 'archived', updated_at = app.now_utc()
   where office_id = app.test_office() and status = 'active'
     and slug like 'identity-proof-%' and created_at < app.now_utc() - interval '10 minutes'`)

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

// ===========================================================================
// Normalising
// ===========================================================================
//
// The cases are the ones people actually produce: a leading "the", a trailing
// "app", an ampersand, and inconsistent spacing. Asserted as EQUALITIES between
// phrases rather than against literal expected strings, because what matters is
// that two ways of saying one thing agree — not what they agree on.

for (const [a, b, why] of [
  ['Money Mastery', 'money mastery', 'case'],
  ['Money Mastery app', 'Money Mastery', 'a trailing "app"'],
  ['The Money Mastery Project', 'money mastery', 'a leading "the" and a trailing "project"'],
  ['Wellness  &  Health', 'wellness health', 'punctuation and doubled spaces'],
] as const) {
  const row = await one(
    `select app.normalise_name(${lit(a)}) = app.normalise_name(${lit(b)}) as same,
            app.normalise_name(${lit(a)}) as n`,
  )
  record(`“${a}” and “${b}” are the same name — ${why}`, String(row?.n), row?.same === true)
}

// And the thing it must NOT do: collapse an interior word away. "Personal
// finance" and "finance" are different projects, and a normaliser loose enough
// to merge them would resolve confidently to the wrong one.
{
  const row = await one(
    `select app.normalise_name('Personal finance') = app.normalise_name('finance') as same`,
  )
  record(
    '“Personal finance” is NOT “finance”',
    row?.same === false ? 'kept apart' : 'collapsed together',
    row?.same === false,
  )
}

// ===========================================================================
// Every real project answers to its own name
// ===========================================================================

{
  // Projects whose name is theirs alone. Two projects CAN share a name — that
  // is what forcing a create means — and then the phrase belongs to whichever
  // claimed it, by design: one phrase, one project. Asserting over the shared
  // ones would be asserting that the uniqueness rule does not hold.
  /*
    And not fixtures, because `resolve_project_by_name` filters them BY DESIGN.

    `is_fixture` is GENERATED from the slug, and the resolver excludes fixtures
    so harness projects can never be routed to. Asserting that one resolves
    from its own name is asserting the opposite of the feature under test —
    and it fired on `ledger-proof-mtyxxxuc`, an active fixture left by
    `verify:ledger`, reporting a working resolver as broken.

    The property is "every active project GRANT CAN BE ROUTED TO answers to its
    own name". A fixture is not one of those, so it is not in the population.
    Same correction as #45's, from the other side.
  */
  const missing = await all(`
    select o.slug, o.name
      from public.projects o
     where o.status = 'active'
       and not o.is_fixture
       and not exists (
         select 1 from public.projects q
          where q.status = 'active' and q.project_id <> o.project_id
            and q.office_id = o.office_id
            and app.normalise_name(q.name) = app.normalise_name(o.name)
       )
       and not exists (
         select 1 from app.resolve_project_by_name(o.office_id, o.name) r
          where r.project_id = o.project_id and r.confidence >= 0.90
       )
  `)
  record(
    'every active project resolves from its own name',
    missing.length === 0
      ? `${String((await all(`select 1 from public.projects where status = 'active' and not is_fixture`)).length)} projects`
      : `${String(missing.length)} do not: ${missing.map((m) => String(m.slug)).join(', ')}`,
    missing.length === 0,
  )
}

// ===========================================================================
// Fixtures
// ===========================================================================

const created = await one(`
  select app.hq_create_project(app.test_office(), 
    ${lit(`Identity proof ${run}`)}, 'upload', ${lit(`${SUBJECT}`)}, null, true
  ) as r
`)
const madeRaw = (created?.r ?? {}) as { project_id?: string; error?: string }
const projectId = String(madeRaw.project_id ?? '')
record(
  'a forced create makes the project',
  madeRaw.error === undefined ? `project ${projectId.slice(0, 8)}…` : String(madeRaw.error),
  projectId !== '',
)
if (projectId === '') {
  console.error('\nNo fixture project, so the rest cannot be asked. Stopping.')
  process.exit(1)
}

// A new project answers to its own name immediately — 0153 adds the alias in
// the create path, and without it the very next sentence about the project
// would not resolve.
{
  const rows = await all(
    `select r.confidence::float8 c from app.resolve_project_by_name(app.test_office(), ${lit(`Identity proof ${run}`)}) r
      where r.project_id = ${lit(projectId)}::uuid`,
  )
  record(
    'and it answers to its own name from the moment it exists',
    rows[0] === undefined ? 'it does not' : `confidence ${String(rows[0].c)}`,
    Number(rows[0]?.c ?? 0) >= 0.9,
  )
}

// ===========================================================================
// Teaching it a name
// ===========================================================================

const alias = `the ${run} thing`
{
  const added = (
    await one(
      `select app.add_project_alias(app.test_office(), ${lit(projectId)}::uuid, ${lit(alias)}) as r`,
    )
  )?.r as { ok?: boolean; error?: string }
  record(
    'an alias can be taught',
    added?.ok === true ? `“${alias}”` : String(added?.error),
    added?.ok === true,
  )

  // ORDER BY, because the function's `distinct on (project_id)` obliges it to
  // order by project_id — the rows come back in id order, not best-first. The
  // first version of this check omitted it, read an arbitrary row, and reported
  // a working alias as broken.
  const found = await all(
    `select r.project_id::text p, r.confidence::float8 c, r.how
       from app.resolve_project_by_name(app.test_office(), ${lit(alias)}) r
      order by r.confidence desc`,
  )
  record(
    'and the project is then found by it',
    found[0] === undefined ? 'not found' : `${String(found[0].how)} at ${String(found[0].c)}`,
    String(found[0]?.p) === projectId && Number(found[0]?.c ?? 0) >= 0.9,
  )
  // Something Grant said himself must outrank a guess, or a stray inference
  // quietly beats his own words.
  record(
    'and it says he is the one who calls it that',
    String(found[0]?.how),
    String(found[0]?.how) === 'you call it that',
  )
}

// One phrase, one project. The whole point: two projects both answering to
// "the finance thing" is the ambiguity that made the duplicate.
{
  const second = await one(`
    select app.hq_create_project(app.test_office(), ${lit(`Identity proof other ${run}`)}, 'upload',
      ${lit(`${SUBJECT}-other`)}, null, true) as r
  `)
  const otherId = String(((second?.r ?? {}) as { project_id?: string }).project_id ?? '')
  const clash = (
    await one(
      `select app.add_project_alias(app.test_office(), ${lit(otherId)}::uuid, ${lit(alias)}) as r`,
    )
  )?.r as { error?: string; conflicts_with?: string }
  record(
    'the same phrase cannot mean two projects',
    clash?.error === undefined ? 'it was allowed' : String(clash.error),
    clash?.error !== undefined && String(clash.conflicts_with) === projectId,
  )
  // Naming the owner rather than raising a constraint violation: the caller has
  // to be able to say WHICH project already means it.
  record(
    'and the refusal names the project that already means it',
    String(clash?.conflicts_with ?? 'nothing').slice(0, 8),
    String(clash?.conflicts_with) === projectId,
  )
}

// ===========================================================================
// Creating stops assuming
// ===========================================================================

{
  const attempt = (
    await one(`
    select app.hq_create_project(app.test_office(), ${lit(`Identity proof ${run}`)}, 'upload',
      ${lit(`${SUBJECT}-dup`)}) as r
  `)
  )?.r as { needs_confirmation?: boolean; candidates?: unknown[]; project_id?: string }

  record(
    'creating a project by a name that already exists asks first',
    attempt?.needs_confirmation === true
      ? `${String(attempt.candidates?.length ?? 0)} candidate(s)`
      : `it created ${String(attempt?.project_id)}`,
    attempt?.needs_confirmation === true && attempt.project_id === undefined,
  )

  // The assertion that actually matters. `ai-learning-2` exists because the old
  // path answered this question by making a second project.
  const dupes = await all(
    `select project_id from public.projects where slug like ${lit(`${SLUG}%`)}`,
  )
  record(
    'and no second project was made behind the question',
    `${String(dupes.length)} project(s) by that slug`,
    dupes.length === 1,
  )
}

// A near miss is asked about too — this is the wellness case, where the words
// are not the name but obviously mean it.
{
  const near = (
    await one(`
    select app.hq_create_project(app.test_office(), ${lit(`identity proof ${run} tracker`)}, 'upload',
      ${lit(`${SUBJECT}-near`)}) as r
  `)
  )?.r as { needs_confirmation?: boolean; candidates?: { name?: string }[] }
  record(
    'a name that is merely close is asked about, not created',
    near?.needs_confirmation === true
      ? String(near.candidates?.[0]?.name)
      : 'it went ahead and created one',
    near?.needs_confirmation === true,
  )
}

// And "no, it really is new" still works, because §4 is about not creating
// duplicates rather than about refusing to create.
{
  const forced = (
    await one(`
    select app.hq_create_project(app.test_office(), ${lit(`Identity proof ${run}`)}, 'upload',
      ${lit(`${SUBJECT}-forced`)}, null, true) as r
  `)
  )?.r as { project_id?: string }
  record(
    'saying it really is new still creates it',
    forced?.project_id === undefined
      ? 'it refused'
      : `project ${String(forced.project_id).slice(0, 8)}…`,
    forced?.project_id !== undefined,
  )
}

// ===========================================================================
// Resolution order
// ===========================================================================

{
  const scope = `verify-identity-${run}`

  // Nothing said, no switch, no mapping: null, meaning ask. Unchanged by 0153
  // and asserted so, because the new step must not have turned "I do not know"
  // into a guess.
  const blank = await one(
    `select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scope)}, null, null)::text as p`,
  )
  record('with nothing to go on it still asks', String(blank?.p ?? 'null'), blank?.p === null)

  // A name on its own resolves it.
  const bare = await one(
    `select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scope)}, null, ${lit(alias)})::text as p`,
  )
  record(
    'a name on its own resolves the project',
    String(bare?.p ?? 'null').slice(0, 8),
    String(bare?.p) === projectId,
  )

  // And a name INSIDE a sentence, which is the only way anybody actually says
  // it. This is what 0156 exists for: the first version matched the whole
  // utterance as one string, so "the wellness thing" worked and "have a look at
  // the wellness thing" found nothing.
  const inSentence = await one(`
    select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scope)}, null,
      ${lit(`can you have a look at ${alias} before tomorrow`)})::text as p
  `)
  record(
    'and a name buried in a sentence resolves it too',
    String(inSentence?.p ?? 'null').slice(0, 8),
    String(inSentence?.p) === projectId,
  )

  // But a short one does not get found by accident inside unrelated words.
  const shortAlias = await one(
    `select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scope)}, null,
       'we should talk about the hq and the roadmap')::text as p`,
  )
  record(
    'and a stray word in a sentence does not resolve anything',
    String(shortAlias?.p ?? 'null'),
    shortAlias?.p === null,
  )

  // The guard against guessing, tested at the level where it can actually fire.
  //
  // The first version of this check tried to construct two confident matches
  // for one phrase and could not — which turned out to be the interesting
  // result. Every route that clears 0.90 goes through a globally unique key:
  // slug is unique, and `project_aliases.normalised` is unique across the whole
  // table. A project's own name is an alias row, so the phrase is claimed the
  // moment the project exists. **At most one project can reach 0.90 on any
  // phrase, by construction** — and that is a better property than handling the
  // ambiguity gracefully.
  //
  // What remains reachable, and is the realistic failure, is a phrase with no
  // confident match and several plausible ones. The temptation there is to take
  // the best fuzzy candidate. That is precisely how work lands in the wrong
  // project while looking entirely reasonable, so it must return null.
  const vague = `identity proof`
  const close = await all(
    `select r.confidence::float8 c from app.resolve_project_by_name(app.test_office(), ${lit(vague)}) r
      order by r.confidence desc`,
  )
  const confident = close.filter((c) => Number(c.c) >= 0.9)
  const plausible = close.filter((c) => Number(c.c) >= 0.55)
  const guessed = await one(`
    select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scope)}, null, ${lit(vague)})::text as p
  `)
  record(
    'a phrase with no confident match resolves to nobody, however plausible the near misses',
    `${String(plausible.length)} plausible, ${String(confident.length)} confident → ${String(guessed?.p ?? 'null')}`,
    confident.length === 0 && plausible.length > 0 && guessed?.p === null,
  )

  /*
    And the invariant that makes the two-confident-match case unreachable.

    This used to assert that `project_aliases_normalised_uniq` existed BY NAME,
    with a comment saying a future change that dropped it should fail here
    rather than silently reintroduce the coin toss. It did exactly that when
    0282 dropped it — and the drop was correct, so the check was right to fire
    and wrong in what it asked.

    The property itself is already covered above: *"the same phrase cannot mean
    two projects"*, through `add_project_alias`, which is the sanctioned writer
    and names the owner rather than raising a constraint. A second copy of that
    would be a second thing to keep in step.

    What is NOT covered is the half 0282 was actually for. A global unique index
    counted ARCHIVED projects, so thirty-two retired probes held 561 routing
    phrases that live projects should have had — the same table whose missing
    rows caused #44. The trigger that replaced it checks only among projects
    Grant can be routed to, and that behaviour is new, so it is what gets a
    check.

    Asserted through `add_project_alias` rather than a raw insert, for the
    reason the first attempt at this demonstrated twice: a raw insert failed on
    a generated column and then on a check constraint, and the FIRST of those
    was reported as a PASS. A refusal for the wrong reason looks exactly like
    the rule working.
  */
  const taken = `identity proof ${run} uniqueness probe`
  /*
    Named so the RUN comes before the word, because the teardown at the bottom
    matches `identity-proof-<run>%` and a slug of `identity-proof-rival-<run>`
    falls outside it. Three of these leaked into Grant's project switcher before
    that was noticed, which is the cheapest possible reminder that a teardown
    matching a prefix only covers subjects named to fall under it.
  */
  const rival = await one(`
    select app.hq_create_project(app.test_office(), ${lit(`Identity proof ${run} rival`)}, 'upload',
      ${lit(`${SUBJECT}-rival`)}, null, true) as r
  `)
  const rivalId = String(((rival?.r ?? {}) as { project_id?: string }).project_id ?? '')

  await one(
    `select app.add_project_alias(app.test_office(), ${lit(projectId)}::uuid, ${lit(taken)}) as r`,
  )
  const blocked = (
    await one(
      `select app.add_project_alias(app.test_office(), ${lit(rivalId)}::uuid, ${lit(taken)}) as r`,
    )
  )?.r as { error?: string; conflicts_with?: string }
  record(
    'CONTROL: while the holder is active, the phrase is not free',
    blocked?.error === undefined ? 'it was allowed' : String(blocked.error).slice(0, 80),
    String(blocked?.conflicts_with) === projectId,
  )

  await db.execute(`
    update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid
  `)
  const freed = (
    await one(
      `select app.add_project_alias(app.test_office(), ${lit(rivalId)}::uuid, ${lit(taken)}) as r`,
    )
  )?.r as { error?: string }
  record(
    'and an archived project stops holding a phrase a live one should get',
    freed?.error === undefined ? 'the phrase was released' : String(freed.error).slice(0, 80),
    freed?.error === undefined,
  )
  await db.execute(`
    update public.projects set status = 'active' where project_id = ${lit(projectId)}::uuid
  `)

  /*
    An identifier in the words outranks the switch.

    The failure this closes, exactly: Grant sent the Chief of Staff a brief
    opening "Take the Legacy Coaching Course notebook (id 8c9022a1-…)" and the
    work was filed against "AI learning", because that was the current project
    for his chat. The message carried the exact id of an attached notebook and
    the resolver never looked at it (0162).
  */
  // The notebook is the suite's OWN, in the test office: the resolver reads only the speaker's office, so a notebook borrowed
  // from whichever office had one attached (a person's real project, as this used to) is correctly invisible to it.
  const ownNotebook = crypto.randomUUID()
  await db.execute(`
    insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled)
    values (${lit(rivalId)}::uuid, 'notebooklm', ${lit(ownNotebook)}, 'identity proof notebook', 'source', true)
    on conflict do nothing
  `)
  const attachedRef = (await one(`
      select a.external_ref, p.project_id::text pid
        from public.project_attachments a
        join public.projects p using (project_id)
       where p.project_id = ${lit(rivalId)}::uuid and a.enabled and a.connector = 'notebooklm'
       limit 1
    `)) as { external_ref?: string; pid?: string } | undefined

  if (attachedRef?.external_ref === undefined) {
    record('an id in the message outranks the switch', 'no attached notebook to test with', false)
  } else {
    // The switch points at the fixture; the sentence names a different
    // project's notebook by id. The id must win.
    await db.execute(`
      insert into public.project_switches (office_id, scope_kind, scope_ref, project_id, switched_by, reason)
      values (app.test_office(), 'telegram_chat', ${lit(scope)}, ${lit(projectId)}::uuid, 'verify', 'verify:identity')
    `)
    const byRef = await one(`
      select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scope)}, null,
        ${lit(`have a look at the notebook (id ${attachedRef.external_ref}) and tell me what is in it`)}
      )::text as p
    `)
    record(
      'an identifier in the message outranks the current project',
      `switch=${projectId.slice(0, 8)} → resolved=${String(byRef?.p ?? 'null').slice(0, 8)}`,
      String(byRef?.p) === String(attachedRef.pid) && String(byRef?.p) !== projectId,
    )

    // And a sentence with no identifier still respects the switch, or the fix
    // has simply broken the thing it sits above.
    const noRef = await one(
      `select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scope)}, null, 'how is that going')::text as p`,
    )
    record(
      'and a sentence with no identifier still respects the switch',
      String(noRef?.p ?? 'null').slice(0, 8),
      String(noRef?.p) === projectId,
    )
    await db.execute(`delete from public.project_switches where scope_ref = ${lit(scope)}`)
  }

  // An identifier we do not hold resolves to nothing — it never invents.
  const unknown = await all(
    `select 1 from app.references_in(app.test_office(), 'look at 11111111-2222-3333-4444-555555555555')`,
  )
  record(
    'an identifier we are not attached to resolves to nothing',
    `${String(unknown.length)} match(es)`,
    unknown.length === 0,
  )

  // An explicit id still wins over everything, including a contradicting name.
  const explicit = await one(`
    select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scope)}, ${lit(projectId)}::uuid,
      'something else entirely')::text as p
  `)
  record(
    'an explicit project still outranks the words',
    String(explicit?.p ?? 'null').slice(0, 8),
    String(explicit?.p) === projectId,
  )

  // And a deliberate switch outranks a passing mention, so "let's look at X"
  // inside a project's own chat does not repoint the chat.
  await db.execute(`
    insert into public.project_switches (office_id, scope_kind, scope_ref, project_id, switched_by, reason)
    values (app.test_office(), 'telegram_chat', ${lit(scope)}, ${lit(projectId)}::uuid, 'verify', 'verify:identity')
  `)
  const switched = await one(`
    select app.resolve_project(app.test_office(), 'telegram_chat', ${lit(scope)}, null,
      'while we are here, what about something else') ::text as p
  `)
  record(
    'a deliberate switch outranks a passing mention',
    String(switched?.p ?? 'null').slice(0, 8),
    String(switched?.p) === projectId,
  )
  await db.execute(`delete from public.project_switches where scope_ref = ${lit(scope)}`)
}

// ===========================================================================
// #224 — create, near-duplicate, rename, and what the OLD name does afterwards
//
// The readiness report of 14 September put Projects at Partial with exactly
// this gap: name resolution and ambiguity were well covered, and creating,
// renaming and the behaviour of a name after it stops being current were not
// proven as one arc.
//
// Rename matters more than it looks. Grant refers to a project by whatever he
// called it last, often weeks later and usually in a voice note. A rename that
// leaves the old name resolving to NOTHING loses him the project. A rename that
// leaves it resolving to something ELSE is worse, because the work lands
// somewhere plausible and wrong.
// ===========================================================================

/*
  RENAME RUNS INSIDE A ROLLBACK, and finding out why cost a real project.

  `app.hq_rename_project` ENQUEUES an `office.rename_channels` job — sensibly,
  because the Slack channel has to be renamed too. But a job can never be
  deleted (`job_state_transitions` is append-only by §6), and `project_delete`
  refuses a project holding one. So renaming a REAL project makes it permanently
  undeletable, and the first draft of this arc left three archived projects
  behind on its first run, which is CLAUDE.md's twenty-five-permanent-projects
  pile being rebuilt by the suite written to close a coverage gap.

  A fixture project is not the answer either: `resolve_project_by_name` filters
  `not is_fixture`, so the name assertions below would pass for the wrong reason
  against one. #45's question has to be asked about the SPECIFIC reader.

  So the whole arc is one statement ending in `rollback`. The rename happens,
  the job is enqueued, every question is asked of the uncommitted state — which
  is exactly the state a caller would see — and then none of it happened.
*/
const RENAMED = `Identity proof ${run} renamed`
const OTHER_NAME = `Identity proof other ${run}`

const resolves = (name: string, alias: string): string => `
  (select coalesce(
     (select (array_agg(r.project_id))[1]::text
        from app.resolve_project_by_name(app.test_office(), ${lit(name)}) r
       where r.confidence >= 0.90), 'null')) as ${alias}`

const arc = await one(`
begin;
create temp table _dupe as select app.hq_create_project(app.test_office(), 
  ${lit(`Identity proof ${run}`)}, 'upload', ${lit(`${SUBJECT}-dupe`)}, null, false) as r;
create temp table _ren as select app.hq_rename_project(app.test_office(), ${lit(SLUG)}, ${lit(RENAMED)}) as r;
create temp table _mid as
  select (select name from public.projects where project_id = ${lit(projectId)}::uuid) as nm,
         ${resolves(`Identity proof ${run}`, 'old_goes')},
         ${resolves(RENAMED, 'new_goes')};
create temp table _clash as
  select app.hq_rename_project(app.test_office(), ${lit(SLUG)}, ${lit(OTHER_NAME)}) as r;
update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid;
create temp table _arch as select ${resolves(RENAMED, 'after_archive')};
create temp table _out as
  select (select r::text from _dupe)  as dupe,
         (select r::text from _ren)   as ren,
         (select nm from _mid)        as nm,
         (select old_goes from _mid)  as old_goes,
         (select new_goes from _mid)  as new_goes,
         (select r::text from _clash) as clash,
         (select after_archive from _arch) as after_archive;
select * from _out;
rollback;`)

type Said = {
  project_id?: string
  ok?: boolean
  error?: string
  question?: string
  needs_confirmation?: boolean
  candidates?: { slug?: string; name?: string }[]
}
const said = (raw: unknown): Said => {
  try {
    return JSON.parse(String(raw ?? '{}')) as Said
  } catch {
    return {}
  }
}

/*
  The first draft asserted an ERROR here and was wrong about the contract, in the
  direction worth recording: the office does something BETTER than refusing. It
  returns `needs_confirmation` with a question and the candidates it matched —

      There is already something by that name. Did you mean one of these, or is
      'Identity proof …' genuinely new?

  which is Grant's standing instruction implemented rather than merely obeyed:
  "Please don't assume I wish to create a new project - this is a large task and
  should always be confirmed." A check asserting `error` would have gone red on
  correct behaviour and invited somebody to 'fix' the asking away.

  So the property is: nothing was created, and the question names what it
  collided with. Not the mechanism, and not the wording.
*/
const dupeSaid = said(arc?.dupe)
record(
  'creating a project whose name already exists does not silently duplicate it',
  dupeSaid.project_id === undefined
    ? 'nothing was created'
    : `IT WAS CREATED: ${String(dupeSaid.project_id).slice(0, 8)}`,
  dupeSaid.project_id === undefined,
)
record(
  'and it ASKS, naming the project it matched, rather than deciding for him',
  dupeSaid.needs_confirmation === true
    ? `asked, ${String(dupeSaid.candidates?.length ?? 0)} candidate(s): ${String(dupeSaid.candidates?.[0]?.slug)}`
    : `no question asked: ${String(dupeSaid.error ?? JSON.stringify(dupeSaid)).slice(0, 60)}`,
  dupeSaid.needs_confirmation === true &&
    (dupeSaid.candidates ?? []).some((c) => /identity-proof/i.test(String(c.slug))),
)

const renameSaid = said(arc?.ren)
record(
  'a project can be renamed through the path the page uses',
  renameSaid.error === undefined ? 'renamed' : String(renameSaid.error).slice(0, 80),
  renameSaid.error === undefined,
)
record(
  'the new name is what the row then carries',
  `name=${String(arc?.nm)}`,
  String(arc?.nm) === RENAMED,
)

/*
  THE ONE THAT MATTERS. What does the OLD name do afterwards?

  Three outcomes and only one is a failure. The same project is ideal — he
  called it that for weeks. NOTHING is acceptable and honest, because null means
  ASK. A DIFFERENT project is the quiet disaster: the work lands somewhere
  plausible and he does not find out for a fortnight.

  Asserted as that property, never as the mechanism. Whether the office keeps
  the old name as an alias is a design decision nobody has made; whether it can
  route Grant somewhere wrong is not a decision at all.
*/
const oldGoesTo = String(arc?.old_goes ?? 'null')
record(
  'the OLD name never routes to a DIFFERENT project — the same one, or nothing',
  oldGoesTo === 'null'
    ? 'nothing, which means ask, and is honest'
    : oldGoesTo === projectId
      ? 'still the same project, so the old name was kept'
      : `WRONG PROJECT: ${oldGoesTo.slice(0, 8)}`,
  oldGoesTo === 'null' || oldGoesTo === projectId,
)
record(
  'and the NEW name resolves to it, so the rename did not trade one lost project for another',
  String(arc?.new_goes).slice(0, 8),
  String(arc?.new_goes) === projectId,
)

/*
  Renaming ONTO a name a live project already holds.

  `hq_create_project` refuses this. `hq_rename_project` does not — the same
  collision, one door apart, and only one of them checks. That is CLAUDE.md's
  pre-check rule with the sign flipped: not a constraint loosened without its
  pre-check, but a pre-check that only ever existed on one of the two writers.
  Fixed in 0365.
*/
const clashSaid = said(arc?.clash)
record(
  'renaming onto a name a live project already holds is refused',
  clashSaid.error === undefined
    ? 'IT WAS ALLOWED — two projects would answer to one name'
    : String(clashSaid.error).slice(0, 80),
  clashSaid.error !== undefined,
)

record(
  'an ARCHIVED project stops answering to its own name',
  String(arc?.after_archive) === 'null'
    ? 'nothing resolves, which is right'
    : `STILL RESOLVES: ${String(arc?.after_archive).slice(0, 8)}`,
  String(arc?.after_archive) === 'null',
)

/*
  And the rollback took the enqueued rename job with it, which is the assertion
  that makes the whole approach honest rather than merely tidy.
*/
const renameDebris = await one(`
  select count(*)::int as n from public.jobs
   where kind = 'office.rename_channels'
     and project_id = ${lit(projectId)}::uuid`)
record(
  'and the rename job the rollback discarded left nothing behind',
  `${String(renameDebris?.n)} rename job(s)`,
  Number(renameDebris?.n) === 0,
)

// ===========================================================================
// Tidy up
// ===========================================================================

/*
  These are REAL projects, not fixtures, so `purge:fixtures` will never collect
  them and leaving them behind means leaving them in Grant's project list.
  Archiving alone is not enough either: an abandoned archived project still
  holds its rows on the globally unique alias table, and the next run would
  find its own name already taken.

  The order is forced by ADR-0014 — an ACTIVE project must have an enabled
  attachment, and the trigger fires on the attachment delete. Archive first,
  then the attachments, then the project. Aliases cascade with the project;
  documents do not (#43), but this suite creates none.

  Matched on the derived slug, scoped to this run, so a concurrent run is
  untouched.
*/
const mine = `(slug like ${lit(`${SLUG}%`)} or slug like ${lit(`${SLUG_OTHER}%`)})`
await db.execute(`update public.projects set status = 'archived', updated_at = app.now_utc()
                   where ${mine}`)
await db.execute(`delete from public.project_attachments
                   where project_id in (select project_id from public.projects where ${mine})`)
await db.execute(`delete from public.projects where ${mine}`)

// Prove it. A teardown that silently matches nothing is how this went wrong.
const left = await all(`select slug from public.projects where ${mine}`)
record(
  'the suite leaves nothing of its own behind',
  left.length === 0 ? 'clean' : left.map((r) => String(r.slug)).join(', '),
  left.length === 0,
)

const passed = checks.filter((c) => c.passed).length
console.log(`\n| check | outcome | |`)
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)

process.exit(passed === checks.length ? 0 : 1)

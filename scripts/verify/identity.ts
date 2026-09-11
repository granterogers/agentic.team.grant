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
  const missing = await all(`
    select p.slug, p.name
      from public.projects p
     where p.status = 'active'
       and not exists (
         select 1 from public.projects q
          where q.status = 'active' and q.project_id <> p.project_id
            and app.normalise_name(q.name) = app.normalise_name(p.name)
       )
       and not exists (
         select 1 from app.resolve_project_by_name(p.name) r
          where r.project_id = p.project_id and r.confidence >= 0.90
       )
  `)
  record(
    'every active project resolves from its own name',
    missing.length === 0
      ? `${String((await all(`select 1 from public.projects where status = 'active'`)).length)} projects`
      : `${String(missing.length)} do not: ${missing.map((m) => String(m.slug)).join(', ')}`,
    missing.length === 0,
  )
}

// ===========================================================================
// Fixtures
// ===========================================================================

const created = await one(`
  select app.hq_create_project(
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
    `select r.confidence::float8 c from app.resolve_project_by_name(${lit(`Identity proof ${run}`)}) r
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
    await one(`select app.add_project_alias(${lit(projectId)}::uuid, ${lit(alias)}) as r`)
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
       from app.resolve_project_by_name(${lit(alias)}) r
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
    select app.hq_create_project(${lit(`Identity proof other ${run}`)}, 'upload',
      ${lit(`${SUBJECT}-other`)}, null, true) as r
  `)
  const otherId = String(((second?.r ?? {}) as { project_id?: string }).project_id ?? '')
  const clash = (
    await one(`select app.add_project_alias(${lit(otherId)}::uuid, ${lit(alias)}) as r`)
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
    select app.hq_create_project(${lit(`Identity proof ${run}`)}, 'upload',
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
    select app.hq_create_project(${lit(`identity proof ${run} tracker`)}, 'upload',
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
    select app.hq_create_project(${lit(`Identity proof ${run}`)}, 'upload',
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
    `select app.resolve_project('telegram_chat', ${lit(scope)}, null, null)::text as p`,
  )
  record('with nothing to go on it still asks', String(blank?.p ?? 'null'), blank?.p === null)

  // A name on its own resolves it.
  const bare = await one(
    `select app.resolve_project('telegram_chat', ${lit(scope)}, null, ${lit(alias)})::text as p`,
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
    select app.resolve_project('telegram_chat', ${lit(scope)}, null,
      ${lit(`can you have a look at ${alias} before tomorrow`)})::text as p
  `)
  record(
    'and a name buried in a sentence resolves it too',
    String(inSentence?.p ?? 'null').slice(0, 8),
    String(inSentence?.p) === projectId,
  )

  // But a short one does not get found by accident inside unrelated words.
  const shortAlias = await one(
    `select app.resolve_project('telegram_chat', ${lit(scope)}, null,
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
    `select r.confidence::float8 c from app.resolve_project_by_name(${lit(vague)}) r
      order by r.confidence desc`,
  )
  const confident = close.filter((c) => Number(c.c) >= 0.9)
  const plausible = close.filter((c) => Number(c.c) >= 0.55)
  const guessed = await one(`
    select app.resolve_project('telegram_chat', ${lit(scope)}, null, ${lit(vague)})::text as p
  `)
  record(
    'a phrase with no confident match resolves to nobody, however plausible the near misses',
    `${String(plausible.length)} plausible, ${String(confident.length)} confident → ${String(guessed?.p ?? 'null')}`,
    confident.length === 0 && plausible.length > 0 && guessed?.p === null,
  )

  // And the invariant that makes the two-confident-match case unreachable, so a
  // future change that drops the unique index fails here rather than silently
  // reintroducing the coin toss.
  const uniq = await one(`
    select count(*) n from pg_indexes
     where schemaname = 'public' and indexname = 'project_aliases_normalised_uniq'
  `)
  record(
    'and one phrase can still only ever mean one project',
    Number(uniq?.n) === 1 ? 'the global uniqueness index is in place' : 'THE UNIQUE INDEX IS GONE',
    Number(uniq?.n) === 1,
  )

  /*
    An identifier in the words outranks the switch.

    The failure this closes, exactly: Grant sent the Chief of Staff a brief
    opening "Take the Legacy Coaching Course notebook (id 8c9022a1-…)" and the
    work was filed against "AI learning", because that was the current project
    for his chat. The message carried the exact id of an attached notebook and
    the resolver never looked at it (0162).
  */
  const attachedRef = (await one(`
      select a.external_ref, p.project_id::text pid
        from public.project_attachments a
        join public.projects p using (project_id)
       where p.status = 'active' and a.enabled and a.connector = 'notebooklm'
       limit 1
    `)) as { external_ref?: string; pid?: string } | undefined

  if (attachedRef?.external_ref === undefined) {
    record('an id in the message outranks the switch', 'no attached notebook to test with', false)
  } else {
    // The switch points at the fixture; the sentence names a different
    // project's notebook by id. The id must win.
    await db.execute(`
      insert into public.project_switches (scope_kind, scope_ref, project_id, switched_by, reason)
      values ('telegram_chat', ${lit(scope)}, ${lit(projectId)}::uuid, 'verify', 'verify:identity')
    `)
    const byRef = await one(`
      select app.resolve_project('telegram_chat', ${lit(scope)}, null,
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
      `select app.resolve_project('telegram_chat', ${lit(scope)}, null, 'how is that going')::text as p`,
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
    `select 1 from app.references_in('look at 11111111-2222-3333-4444-555555555555')`,
  )
  record(
    'an identifier we are not attached to resolves to nothing',
    `${String(unknown.length)} match(es)`,
    unknown.length === 0,
  )

  // An explicit id still wins over everything, including a contradicting name.
  const explicit = await one(`
    select app.resolve_project('telegram_chat', ${lit(scope)}, ${lit(projectId)}::uuid,
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
    insert into public.project_switches (scope_kind, scope_ref, project_id, switched_by, reason)
    values ('telegram_chat', ${lit(scope)}, ${lit(projectId)}::uuid, 'verify', 'verify:identity')
  `)
  const switched = await one(`
    select app.resolve_project('telegram_chat', ${lit(scope)}, null,
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

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
 * Every project this creates is named `fixture-identity-<run>` and archived at
 * the end. Nothing is deleted — the ledger refuses deletes anyway (§16) — and
 * `purge:fixtures` sweeps the archived rows.
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
  const missing = await all(`
    select p.slug, p.name
      from public.projects p
     where p.status = 'active'
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
    ${lit(`Fixture identity ${run}`)}, 'upload', ${lit(`fixture-identity-${run}`)}, null, true
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
    `select r.confidence::float8 c from app.resolve_project_by_name(${lit(`Fixture identity ${run}`)}) r
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

  const found = await all(
    `select r.project_id::text p, r.confidence::float8 c, r.how from app.resolve_project_by_name(${lit(alias)}) r`,
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
    select app.hq_create_project(${lit(`Fixture identity other ${run}`)}, 'upload',
      ${lit(`fixture-identity-other-${run}`)}, null, true) as r
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
    select app.hq_create_project(${lit(`Fixture identity ${run}`)}, 'upload',
      ${lit(`fixture-identity-dup-${run}`)}) as r
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
    `select project_id from public.projects where slug like ${lit(`fixture-identity-${run}%`)}`,
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
    select app.hq_create_project(${lit(`fixture identity ${run} tracker`)}, 'upload',
      ${lit(`fixture-identity-near-${run}`)}) as r
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
    select app.hq_create_project(${lit(`Fixture identity ${run}`)}, 'upload',
      ${lit(`fixture-identity-forced-${run}`)}, null, true) as r
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

  // An unambiguous name in the message resolves it.
  const named = await one(
    `select app.resolve_project('telegram_chat', ${lit(scope)}, null, ${lit(`have a look at the ${run} thing`)})::text as p`,
  )
  record(
    'an unambiguous name in the message resolves it',
    String(named?.p ?? 'null').slice(0, 8),
    String(named?.p) === projectId,
  )

  // Two confident matches must NOT resolve. A coin toss here is the failure
  // this whole migration exists to prevent, and it is the assertion most likely
  // to rot if the thresholds are ever "tidied up".
  const ambiguous = await one(`
    select app.resolve_project('telegram_chat', ${lit(scope)}, null,
      ${lit(`Fixture identity ${run}`)})::text as p
  `)
  const matches = await all(
    `select 1 from app.resolve_project_by_name(${lit(`Fixture identity ${run}`)}) r where r.confidence >= 0.90`,
  )
  record(
    'a name that matches two projects resolves to neither',
    `${String(matches.length)} confident matches → ${String(ambiguous?.p ?? 'null')}`,
    matches.length > 1 && ambiguous?.p === null,
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

await db.execute(`
  update public.projects set status = 'archived', updated_at = app.now_utc()
   where slug like ${lit(`fixture-identity-%${run}`)} or slug like ${lit(`fixture-identity-${run}%`)}
`)

const passed = checks.filter((c) => c.passed).length
console.log(`\n| check | outcome | |`)
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)

process.exit(passed === checks.length ? 0 : 1)

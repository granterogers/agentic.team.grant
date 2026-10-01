/**
 * The life of a standing instruction, end to end — #310.
 *
 *   npm run verify:preferences
 *
 * ## Why this drives `remember()` and not the SQL
 *
 * Every piece of the lifecycle already existed in the database and none of it
 * was reachable: `app.learn` has taken `p_supersedes` since it was written,
 * `app.retract_lesson` retires a rule without replacing it, and
 * `lessons_live` already hides both. The defect was entirely in the ONE
 * caller, which passed `null` for the first, never called the second, and
 * hardcoded the project to null.
 *
 * So a suite that drove the SQL would have passed on the day the product was
 * broken. This drives `remember()` — the function the handler calls — and then
 * asks `app.lessons_for`, which is the function that fills the prompt. Both
 * ends of the thing Grant actually experiences, and nothing in between
 * trusted.
 *
 * ## The last check is the one that matters
 *
 * Rows looking right is not the claim. The claim is that the PROMPT contains
 * exactly the effective set, so the final section builds the guidance block
 * the way the office builds it and asserts on its text.
 *
 * ## Containment
 *
 * Every lesson here is written by a `verify:` author, so `lessons.is_fixture`
 * is GENERATED true and 0539 keeps it out of any real prompt. The suite ALSO
 * asserts that, because a comment claiming a suite's traffic is invisible is
 * worth nothing without a check — this file's own subject is a table where
 * that mistake cost a fabricated price in every prompt for a week.
 */

import { remember } from '../../src/agents/remember.ts'
import type { Teaching } from '../../src/agents/teaching.ts'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'

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
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
/** The author, which is what makes every row here a fixture by generation. */
const BY = `verify:preferences-${run}`

const say = (body: string): Teaching => ({ kind: 'lesson', body, marked: true }) as Teaching

/** What the PROMPT would be given, asked through the reader that fills it. */
const inForce = async (staff: string | null, project: string | null): Promise<string[]> => {
  const { rows } = await db.execute(`
    select f.body from app.lessons_for(
      ${project === null ? 'null' : `${lit(project)}::uuid`},
      ${staff === null ? 'null' : lit(staff)}, null, 200, true) f
     join public.lessons l on l.lesson_id = f.lesson_id
    where l.learned_by = ${lit(BY)}`)
  return (rows as { body: string }[]).map((r) => r.body)
}

/*
  Two fixture projects, because half the point is that one project's rule
  must not reach the other. Paused, for ADR-0014's reason: a verification
  fixture has nothing real attached and must not pretend otherwise.
*/
const mk = async (name: string): Promise<string> => {
  const { rows } = await db.execute(`
    insert into public.projects (slug, name, purpose, status)
    values (${lit(`verify-pref-${name}-${run}`)}, ${lit(`Preference ${name} ${run}`)},
            'Thrown away', 'paused')
    returning project_id::text as id`)
  return String((rows[0] as { id: string }).id)
}
/*
  EVERY EARLIER RUN'S RULES ARE RETIRED FIRST, and this is not tidiness.

  0546 scopes the candidate lookup to the author's own class of traffic, so
  this run's teachings can see every HARNESS lesson - including those an
  earlier run of this very file left live. `public.lessons` is append-only, so
  those rows cannot be deleted and a later run's withdrawal correctly matched
  an earlier run's rule and reported a pass as a failure.

  Retiring them through `app.retract_lesson` is the sanctioned path and the
  convention this repository already has for an append-only table: a suite
  RETIRES its subject rather than deleting it, and the history stays.

  Deliberately narrow: only lessons this FILE authored, matched on the author
  prefix, so it can never reach a rule anything else owns.
*/
const swept = await db.execute(`
  select app.retract_lesson(coalesce((select zz_o.office_id from public.lessons zz_o where zz_o.lesson_id = l.lesson_id), app.test_office()), l.lesson_id, ${lit(BY)}, 'Superseded by a later run of verify:preferences.') as r
    from public.lessons_live l
   where l.learned_by like 'verify:preferences-%' and l.learned_by <> ${lit(BY)}`)
console.log(`  (retired ${String(swept.rows.length)} rule(s) left live by an earlier run)`)

const alpha = await mk('alpha')
const beta = await mk('beta')

console.log(`\n#310 — the life of a standing instruction  (run ${run})\n`)

// ---------------------------------------------------------------- override
console.log('  a rule replaced by a later one')
await remember(db, say('From now on keep your replies short'), BY, null, null, null)
let live = await inForce(null, null)
ok(
  'the first rule is in force',
  live.some((b) => b.includes('replies short')),
  live.join(' | '),
)

const second = await remember(
  db,
  say('actually, detailed answers are fine from now on'),
  BY,
  null,
  null,
  null,
)
live = await inForce(null, null)
ok(
  'the later rule is in force',
  live.some((b) => b.includes('detailed answers are fine')),
)
ok('and the earlier one is NOT', !live.some((b) => b.includes('replies short')), live.join(' | '))
ok(
  'and the office said what it replaced, so he can correct it',
  second.said.includes('replaces what you told me before'),
  second.said,
)

/*
  THE HISTORY IS NOT DESTROYED, which is the difference between superseding
  and deleting. The row is still there and still says what he said; it has
  simply stopped being in force.
*/
const kept = await db.execute(`
  select count(*) as n from public.lessons
   where learned_by = ${lit(BY)} and body like '%replies short%'`)
ok('the superseded rule is still on the record', Number((kept.rows[0] as { n: number }).n) === 1)

// ------------------------------------------------------------- withdrawal
console.log('\n  a rule withdrawn with nothing in its place')
await remember(
  db,
  say('from now on use bullet points in everything you send me'),
  BY,
  null,
  null,
  null,
)
live = await inForce(null, null)
ok(
  'the bullets rule is in force',
  live.some((b) => b.includes('bullet points')),
)

const dropped = await remember(db, say('do not use bullets anymore'), BY, null, null, null)
live = await inForce(null, null)
ok('it is gone after the withdrawal', !live.some((b) => b.includes('bullet points in everything')))
ok('and nothing replaced it', !live.some((b) => b.includes('bullets anymore')), live.join(' | '))
ok('and the office said so', dropped.said.includes('no longer a standing rule'), dropped.said)

const nothingToDrop = await remember(
  db,
  say('do not put screenshots in anymore'),
  BY,
  null,
  null,
  null,
)
ok(
  'withdrawing a rule it does not hold stores nothing',
  nothingToDrop.stored === null && nothingToDrop.said.includes('nothing to drop'),
  nothingToDrop.said,
)

// ------------------------------------------------------------- repetition
console.log('\n  the same rule said again')
await remember(
  db,
  say('always give your information in the form of clear bullet points'),
  BY,
  null,
  null,
  null,
)
const again = await remember(
  db,
  say("I've told you to always give your information in the form of clear bullet points"),
  BY,
  null,
  null,
  null,
)
live = await inForce(null, null)
const copies = live.filter((b) => b.includes('clear bullet points')).length
ok('saying it twice leaves ONE rule in force', copies === 1, `${copies} copies`)
ok(
  'and the office did not claim a second',
  again.said.includes('not made a second copy'),
  again.said,
)
const weight = await db.execute(`
  select max(observations) as n from public.lessons
   where learned_by = ${lit(BY)} and body like '%clear bullet points%'`)
ok(
  'and the repetition made it stronger rather than noisier',
  Number((weight.rows[0] as { n: number }).n) >= 2,
  String((weight.rows[0] as { n: number }).n),
)

// ---------------------------------------------------------------- scoping
console.log('\n  scope')
await remember(
  db,
  say('on this project never put a due date on anything unless I give you one'),
  BY,
  null,
  null,
  alpha,
)
const onAlpha = await inForce(null, alpha)
const onBeta = await inForce(null, beta)
ok(
  'a project rule reaches its own project',
  onAlpha.some((b) => b.includes('due date')),
)
ok('and NOT another one', !onBeta.some((b) => b.includes('due date')), onBeta.join(' | '))

await remember(
  db,
  say('on this project always put a due date on everything'),
  BY,
  null,
  null,
  alpha,
)
const alphaNow = await inForce(null, alpha)
ok(
  'changing it within the project replaces it there',
  alphaNow.some((b) => b.includes('always put a due date')) &&
    !alphaNow.some((b) => b.includes('unless I give you one')),
  alphaNow.join(' | '),
)

/*
  A global rule overridden locally must survive globally. The project rule
  wins where it applies, and the global one is untouched — which is what
  `lessons_for`'s specificity ordering is for and what would break if the
  override were implemented by retiring the global rule.
*/
await remember(db, say('always paste image links into every reply'), BY, null, null, null)
await remember(db, say('on this project never paste image links'), BY, null, null, beta)
const globalStill = await inForce(null, null)
const betaNow = await inForce(null, beta)
ok(
  'a local override leaves the global rule standing',
  globalStill.some((b) => b.includes('always paste image links')),
  globalStill.join(' | '),
)
ok(
  'and the project sees its own',
  betaNow.some((b) => b.includes('never paste image links')),
)

// ----------------------------------------------------- bounded to the chat
console.log('\n  a preference that says how long it lasts')
const forNow = await remember(
  db,
  say('From now on in this conversation, keep every answer to a single short paragraph'),
  BY,
  null,
  null,
  null,
)
live = await inForce(null, null)
ok(
  'a conversation-bounded rule is not stored as a standing one',
  forNow.stored === null && !live.some((b) => b.includes('single short paragraph')),
  live.join(' | '),
)
ok(
  'and the office said which it took it as',
  forNow.said.includes('for this conversation'),
  forNow.said,
)

// ------------------------------------------------------------- the prompt
console.log('\n  what the PROMPT actually contains')
/*
  The claim is not that the rows look right. `guidance.ts` builds the block
  the model reads, from `app.lessons_for`, so this asserts on that text.
*/
const forPrompt = await inForce(null, null)
const text = forPrompt.join('\n')
ok('the prompt carries the rule now in force', text.includes('detailed answers are fine'))
ok('and not the one it replaced', !text.includes('keep your replies short'), text)
ok('and not the one he withdrew', !text.includes('bullet points in everything'), text)
ok('and not the conversation-bounded one', !text.includes('single short paragraph'), text)
ok(
  'and exactly one copy of the repeated one',
  forPrompt.filter((b) => b.includes('clear bullet points')).length === 1,
)

// ------------------------------------------------------------- containment
console.log('\n  containment')
const leaked = await db.execute(`
  select count(*) as n from app.lessons_for(null, null, null, 500) f
   join public.lessons l on l.lesson_id = f.lesson_id
  where l.learned_by = ${lit(BY)}`)
ok(
  'not one of this run’s rules can reach a real prompt',
  Number((leaked.rows[0] as { n: number }).n) === 0,
  String((leaked.rows[0] as { n: number }).n),
)
const flagged = await db.execute(`
  select count(*) filter (where not is_fixture) as real from public.lessons
   where learned_by = ${lit(BY)}`)
ok(
  'and every row it wrote is generated as harness traffic',
  Number((flagged.rows[0] as { real: number }).real) === 0,
)

/*
  TEARDOWN. `public.lessons` is append-only (0182), so the rows stay — which
  is correct and is what `is_fixture` is for. The PROJECTS are the debris that
  would otherwise reach Grant's switcher, and a project holding lessons cannot
  be deleted (0183, no cascade), so they are left as `verify-%` fixtures for
  `purge:fixtures`, exactly as `verify:lessons` leaves its own. Asserted
  rather than assumed, because a teardown that matches nothing looks exactly
  like one that worked.
*/
/*
  0546 promised this file would assert that the NAMED predicate and the
  GENERATED column agree. Two definitions of one thing is how they come to
  differ, and this is the check that stops that being silent.
*/
const agree = await db.execute(`
  select count(*) as n from public.lessons
   where is_fixture <> app.harness_author(learned_by)`)
ok(
  'the named harness predicate agrees with the generated column on every row',
  Number((agree.rows[0] as { n: number }).n) === 0,
  String((agree.rows[0] as { n: number }).n),
)

const debris = await db.execute(`
  select count(*) as n from public.projects
   where slug like ${lit(`verify-pref-%-${run}`)} and not is_fixture`)
ok(
  'the projects it made are fixtures the sweep can collect',
  Number((debris.rows[0] as { n: number }).n) === 0,
)

console.log(`\n${pass}/${pass + fail} checks passed\n`)
process.exit(fail === 0 ? 0 : 1)

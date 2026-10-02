/**
 * Recent activity, read the way Grant reads it.
 *
 *   npm run verify:lately
 *
 * Issue #14, migration 0412.
 *
 * ## What this exists to stop coming back
 *
 * Measured on the live office on 16 September: 285 of that day's 372 events
 * were `finding.committed` from the noticing pass, one every ten minutes, and
 * the forty rows the page holds were forty of them. Everything else the office
 * did that day — six tool requests, two grants, two revocations, a skill
 * written, seventy-four things learned — was below a fold nobody reaches.
 *
 * Nothing was broken. Every row was true, the function returned in
 * milliseconds, and no suite had anything to say, because "the page is
 * illegible" is not overflow, not low contrast, not small type and not a dead
 * control. It is the shape of defect this repository keeps finding by looking.
 *
 * ## The properties, not the numbers
 *
 * A count would go red the next time the noticing pass changes its period. So:
 * at most two individual rows per (who, what, project), a folded row says how
 * many and offers no undo, a kept row that is reversible keeps its undo, and
 * no row Grant sees belongs to a fixture project. Each of those survives the
 * office getting busier or quieter.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

type Row = {
  id: string | null
  who: string
  verb: string
  what: string
  project: string | null
  times?: number
  reversible: boolean
  undo_with: string | null
  at: string
}

console.log('\nverify:lately\n')

const page = (
  (await db.execute(`select app.hq_studio_lately(app.operator_office(), 40) as v`)).rows[0] as {
    v: Record<string, unknown>
  }
).v
const office = (page.office ?? []) as Row[]
const today = (page.today ?? {}) as Record<string, number>

/*
  The control first. Every assertion below is of the form "no row is like
  this", and a reader returning nothing satisfies all of them — the found-
  nothing trap this repository has recorded twice.
*/
check(
  'CONTROL: the page has rows at all, so the rest of this is about something',
  `${String(office.length)} row(s)`,
  office.length > 0,
)

// --- the folding rule -------------------------------------------------------

/*
  Keyed on what the row SAYS, not on the action type behind it.

  The first draft keyed on who and what and reported eight rows of
  "grant · a tool" as a violation. They are eight different action types —
  requested, granted, declined, revoked, wanted — which the fold groups
  separately and correctly, and which read differently on the page because the
  VERB differs. Leaving the verb out of the key made the check disagree with
  the page about what a repeat is, and the page is the thing under test.

  It also keeps the stricter property: two action types that happened to render
  the same verb and the same noun would be a repeat to a reader, and this now
  catches that even though the SQL would not fold them.
*/
const key = (r: Row): string => `${r.who}::${r.verb}::${r.what}::${r.project ?? ''}`
const individually = new Map<string, number>()
for (const r of office) {
  if (r.times !== undefined) continue
  individually.set(key(r), (individually.get(key(r)) ?? 0) + 1)
}
const worst = [...individually.entries()].sort((a, b) => b[1] - a[1])[0]
check(
  'no one thing appears more than twice as itself',
  worst === undefined
    ? 'nothing repeats'
    : `the most repeated is "${worst[0]}" at ${String(worst[1])}`,
  worst === undefined || worst[1] <= 2,
)

const folded = office.filter((r) => r.times !== undefined)
/*
  And that the fold FIRED. Without this the check above passes on an office
  that simply has not repeated itself yet, and would go on passing through the
  day the noticing pass floods the page again.
*/
check(
  'CONTROL: something was actually folded, so the rule is doing work',
  folded.length === 0
    ? 'NOTHING FOLDED — either the office is unusually varied today or the fold is inert'
    : `${String(folded.length)} folded row(s), largest ${String(Math.max(...folded.map((f) => f.times ?? 0)))}`,
  folded.length > 0,
)

check(
  'a folded row says how many, and offers no undo for them',
  folded.every((f) => (f.times ?? 0) >= 1 && f.reversible === false && f.undo_with === null)
    ? 'every folded row: a count, not reversible, no reversal method'
    : 'A FOLDED ROW OFFERS AN UNDO, which belongs to one event and not to a hundred',
  folded.every((f) => (f.times ?? 0) >= 1 && f.reversible === false && f.undo_with === null),
)

/*
  The other direction, and it is the one that matters: folding must not have
  taken undo away from the rows that still have one. `events.reversible` is the
  only actionable column on a page of things that already happened.
*/
const reversible = office.filter((r) => r.times === undefined && r.reversible === true)
check(
  'and a row that was kept keeps its undo',
  reversible.length === 0
    ? 'no reversible row on the page right now — nothing to prove either way'
    : `${String(reversible.length)} reversible row(s), ${String(reversible.filter((r) => r.undo_with !== null && r.id !== null).length)} of them with a reversal method and an id`,
  reversible.every((r) => r.undo_with !== null && r.id !== null),
)

// --- harness traffic --------------------------------------------------------

/*
  Asserted as a PROPERTY, never as a count: 0355's lesson, in its own words —
  "no row the reader shows Grant belongs to a fixture project" survives the
  next harness run, and a number does not, which is precisely how it came back.
*/
const onFixtures = (
  await db.execute(`
    select count(*)::int as n
      from jsonb_array_elements(app.hq_studio_lately(app.operator_office(), 40) -> 'office') r
      join public.projects p on p.name = (r ->> 'project')
     where p.is_fixture
  `)
).rows[0] as { n: number }
check(
  'no row on the page belongs to a fixture project',
  `${String(onFixtures.n)} row(s) on fixture projects`,
  onFixtures.n === 0,
)

/*
  The day's counts, restated independently. A disagreement means one of the two
  is wrong and the failure says which numbers disagree rather than asserting a
  constant — the same pattern verify:transport uses, and the reason that suite
  caught 0355 changing the definition underneath it.
*/
const mine = (
  await db.execute(`
    select
      count(*) filter (where j.state = 'complete')::int as done,
      count(*) filter (where j.state = 'failed')::int as failed
      from public.jobs j
     where j.updated_at > app.now_utc() - interval '24 hours'
       and not app.harness_job(j.job_id)
  `)
).rows[0] as { done: number; failed: number }
check(
  "the day's finished count excludes harness traffic",
  `page says ${String(today.jobs_done)}, an independent query says ${String(mine.done)}`,
  Number(today.jobs_done) === mine.done,
)
check(
  "and so does the day's failed count",
  `page says ${String(today.jobs_failed)}, an independent query says ${String(mine.failed)}`,
  Number(today.jobs_failed) === mine.failed,
)

/*
  And the reason the counts are worth checking at all: the flag-based filter
  they used to use cannot see a job whose PROJECT is a fixture, because
  `jobs.is_fixture` is GENERATED and may only reference its own row.
*/
const drift = (
  await db.execute(`
    select count(*)::int as n
      from public.jobs j
     where j.updated_at > app.now_utc() - interval '7 days'
       and not j.is_fixture and app.harness_job(j.job_id)
  `)
).rows[0] as { n: number }
console.log(
  `\n  (for reference: ${String(drift.n)} job(s) in the last week that the generated flag ` +
    'calls real and app.harness_job calls harness — the gap 0412 closed here.)',
)

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)

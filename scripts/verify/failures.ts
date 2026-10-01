/**
 * A failure the office recognises.
 *
 *   npm run verify:failures
 *
 * Issue #132, migrations 0274-0275.
 *
 * ## What it is written against
 *
 * One `notebook.collect_artifact` failure sat in the window. It would be
 * retried, it would fail the same way, and nothing about the next attempt would
 * be different — because the office could not recognise a failure it had
 * already seen. A flat error log has no memory.
 *
 * ## Four properties
 *
 *   1. **A repeat is one row with a count.** Eleven attempts at the same problem
 *      make one signature, not eleven rows. If that fails, this is the flat log
 *      with extra steps.
 *   2. **The classification is stable.** A signature is only useful if the same
 *      failure produces the same row, and an error message carries ids,
 *      timestamps and quoted input. Two messages describing one problem must
 *      land on one class.
 *   3. **It is provably free of payload.** #132 is explicit: never the document,
 *      never the prompt. Asserted by attacking it — a whole prompt, a
 *      credential-shaped string and a paragraph are pushed into the subject and
 *      must not be stored.
 *   4. **It reaches somebody.** A table nobody reads is #72's shape, and this
 *      repository has produced that three times this week. `app.notice()` must
 *      surface a recurring signature.
 *
 * ## The control
 *
 * A failure seen ONCE must not be raised. A noticing pass that reports every
 * first failure is a pager that gets muted, and a check that only ever looks at
 * the recurring case cannot tell a working threshold from an absent one.
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
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/*
  A kind of our own, so nothing here touches a real signature. `verification.`
  is the prefix `jobs.is_fixture` already recognises, and the same convention
  keeps this out of anything that reads the office's real failures.
*/
const KIND = 'verification.failures'
const ONCE = 'verification.failures_once'
await db.execute(
  `delete from public.failure_signatures where job_kind in (${lit(KIND)}, ${lit(ONCE)})`,
)

const seen = async (message: string, subject?: string): Promise<Record<string, unknown>> =>
  ((
    await one(
      `select app.failure_seen(${lit(KIND)}, ${lit(message)}, ${subject === undefined ? 'null' : lit(subject)}) as r`,
    )
  ).r ?? {}) as Record<string, unknown>

// ===========================================================================
// 1. A repeat is one row with a count
// ===========================================================================

console.log('\na repeat is one row with a count, not eleven rows')

const first = await seen('Request timed out after 30000ms')
check(
  'the first time is recorded, and says it is the first',
  `${String(first.class)} · ${String(first.note)}`,
  first.seen === 1 && String(first.note).startsWith('first'),
)

for (const attempt of [2, 3, 4]) {
  await seen(`Request timed out after ${String(attempt * 1000)}ms`)
}
const again = await seen('Request timed out, deadline exceeded')
check(
  'and five attempts at the same problem make ONE row',
  `seen=${String(again.seen)}`,
  again.seen === 5,
)
const rows = await one(`
  select count(*)::int as n from public.failure_signatures where job_kind = ${lit(KIND)}
`)
check(
  'and the table holds one signature, not five',
  `${String(rows.n)} row(s)`,
  Number(rows.n) === 1,
)
check(
  'and it can say how long it has been going on',
  String(again.note),
  String(again.note).includes('5 times since'),
)

// ===========================================================================
// 2. The classification is stable, and coarse on purpose
// ===========================================================================

console.log('\nand two ways of saying the same thing land on one class')

const classOf = async (message: string): Promise<string> =>
  String((await one(`select app.classify_failure(${lit(message)}) as c`)).c)

const SAME: readonly (readonly [string, string, string])[] = [
  ['timeout', 'Request timed out after 30000ms', 'AbortError: deadline exceeded'],
  ['not_found', 'no such document 4f2a', 'that source is no longer in the corpus'],
  ['auth', 'HTTP 401 Unauthorized', 'invalid token supplied'],
  ['quota', 'the notebook usage limit is spent', 'HTTP 429 too many requests'],
  ['no_credential', 'no NotebookLM credential in the vault', 'the connector is not configured'],
  ['unreachable', 'fetch failed: ECONNREFUSED', 'HTTP 503 from the upstream'],
  ['bad_shape', 'unexpected shape', 'a research_summary output is missing sources'],
]
const drifted: string[] = []
for (const [want, a, b] of SAME) {
  const [ca, cb] = [await classOf(a), await classOf(b)]
  if (ca !== want || cb !== want) drifted.push(`${want}: got ${ca} and ${cb}`)
}
check(
  'seven kinds of failure, each recognised from two different wordings',
  drifted.length === 0 ? `${String(SAME.length)} classes agree` : drifted.join(' | '),
  drifted.length === 0,
)

/*
  The specific-before-general ordering, which is the part that breaks silently.
  "quota exceeded, request refused" contains both words; quota is the useful
  answer and refused is the one that tells you nothing.
*/
check(
  'a message matching two patterns takes the specific one',
  await classOf('quota exceeded, so the request was refused'),
  (await classOf('quota exceeded, so the request was refused')) === 'quota',
)
check(
  'and something unrecognisable is counted rather than dropped',
  await classOf('the flurb went sideways'),
  (await classOf('the flurb went sideways')) === 'unknown',
)

// ===========================================================================
// 3. Provably free of payload
// ===========================================================================

console.log('\nand there is nowhere for a payload to go')

/*
  Attacked rather than asserted. #132: never the document, never the prompt.

  The guarantee is structural -- the table has no text column an error message
  could be written into -- so the only way in is `subject`, and these push at it:
  a whole prompt, a paragraph, and a credential-shaped string. All three must be
  dropped rather than stored, and the failure must still be counted, because
  refusing the record would mean a failure goes uncounted at exactly the moment
  it matters.
*/
const NASTY: readonly (readonly [string, string])[] = [
  ['a whole prompt', 'You are Emma, Research Director. Read the following and summarise it.'],
  ['a paragraph of content', 'The coaching course covers pricing, objections and referrals.'],
  // secret-scan:allow-shape — a shaped string, deliberately not a real one.
  ['a credential-shaped string', 'xoxb-000000000000-000000000000-AAAAAAAAAAAAAAAAAAAAAAAA'],
]
const leaked: string[] = []
for (const [what, value] of NASTY) {
  const said = await seen('Request timed out', value)
  if (String(said.subject) !== '') leaked.push(`${what} was STORED`)
}
check(
  'a prompt, a paragraph and a credential-shaped string are all dropped from the subject',
  leaked.length === 0 ? 'all three dropped, the failure still counted' : leaked.join(' | '),
  leaked.length === 0,
)

const stored = (
  await db.execute(`
    select job_kind, error_class, subject from public.failure_signatures
     where job_kind = ${lit(KIND)}
  `)
).rows as { job_kind: string; error_class: string; subject: string }[]
check(
  'and nothing in the table is longer than an id',
  `longest field is ${String(Math.max(...stored.map((r) => Math.max(r.subject.length, r.error_class.length))))} chars`,
  stored.every((r) => r.subject.length <= 64 && r.error_class.length <= 16),
)

/*
  The structural guarantee itself. A future edit adding a `detail text` column
  would pass every check above and reintroduce exactly what #132 forbids, so the
  SHAPE is asserted rather than only its current contents.
*/
const columns = (
  await db.execute(`
    select column_name, data_type, character_maximum_length
      from information_schema.columns
     where table_schema = 'public' and table_name = 'failure_signatures'
  `)
).rows as { column_name: string; data_type: string }[]
const freeText = columns.filter(
  (c) => c.data_type === 'text' && !['job_kind', 'error_class', 'subject'].includes(c.column_name),
)
check(
  'and the table has no free-text column at all, so no future edit can leak into one',
  freeText.length === 0
    ? columns.map((c) => c.column_name).join(', ')
    : `A TEXT COLUMN WAS ADDED: ${freeText.map((c) => c.column_name).join(', ')}`,
  freeText.length === 0,
)

// ===========================================================================
// 4. It reaches somebody
// ===========================================================================

console.log('\nand somebody is told')

const noticed = (
  await db.execute(`
    select kind, subject_ref, body, weight from app.notice(app.test_office(), 40)
     where kind = 'failure_repeats'
  `)
).rows as { kind: string; subject_ref: string; body: string; weight: number }[]
const ours = noticed.find((n) => n.subject_ref.startsWith(KIND))
check(
  'a signature seen five times is surfaced by the noticing pass',
  ours === undefined
    ? `not raised (${String(noticed.length)} failure notices in total)`
    : ours.body.slice(0, 88),
  ours !== undefined,
)
check(
  'and it says how many times and since when, which is what makes it a recommendation',
  ours === undefined ? 'not raised' : ours.body.slice(0, 96),
  ours !== undefined && /\d+ times since/.test(ours.body),
)
/*
  Keyed on the SIGNATURE, not on the job. 0210's dismissal machinery matches on
  `(kind, project_id, subject_ref)`, so a job id here would mean a dismissed
  suggestion comes back the next hour with a new id and the dismissal never
  matches -- which is how a noticing pass becomes something people mute.
*/
check(
  'and it is keyed on the signature, so dismissing it makes it stay dismissed',
  ours === undefined ? 'not raised' : ours.subject_ref,
  ours?.subject_ref === `${KIND}:timeout`,
)
check(
  'and it is weighted below a deadline nobody owns and above a quiet project',
  ours === undefined ? 'not raised' : String(ours.weight),
  ours?.weight === 75,
)

/*
  CONTROL. A failure seen ONCE must not be raised. A pass that reports every
  first failure is a pager that gets muted -- and a check that only ever looks
  at the recurring case cannot tell a working threshold from an absent one.
*/
await db.execute(`select app.failure_seen(${lit(ONCE)}, 'Request timed out')`)
const onceNoticed = (
  await db.execute(`
    select subject_ref from app.notice(app.test_office(), 40) where kind = 'failure_repeats'
  `)
).rows as { subject_ref: string }[]
check(
  'CONTROL: a failure seen once is NOT raised',
  onceNoticed.some((n) => n.subject_ref.startsWith(ONCE))
    ? 'a single failure was raised'
    : 'not raised, correctly',
  !onceNoticed.some((n) => n.subject_ref.startsWith(ONCE)),
)

// ===========================================================================
// 5. Put it back
// ===========================================================================

console.log('\nand the suite leaves nothing behind')

let sweptSaid = ''
let sweptClean = false
try {
  await db.execute(
    `delete from public.failure_signatures where job_kind in (${lit(KIND)}, ${lit(ONCE)})`,
  )
  const left = await one(`
    select count(*)::int as n from public.failure_signatures
     where job_kind in (${lit(KIND)}, ${lit(ONCE)})
  `)
  sweptClean = Number(left.n) === 0
  sweptSaid = `${String(left.n)} signature(s) left behind`
} catch (error) {
  sweptSaid = (error as Error).message.replace(/\s+/g, ' ').slice(0, 140)
}
check('the fixture signatures are gone', sweptSaid, sweptClean)

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
if (passed !== checks.length) process.exit(1)

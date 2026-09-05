/**
 * The text-to-speech budget, against the live database.
 *
 *   npm run verify:tts
 *
 * Chirp 3: HD is free to a million characters a month and priced after that, so
 * the free tier is a budget — and Google exposes no live counter, which makes
 * `tts_usage` (0038) the only figure this system can have. A ledger that is the
 * sole authority has to be right, so the checks here are about the two ways it
 * could be wrong: a reservation that lets two callers spend the same allowance,
 * and an application that can edit the count afterwards.
 *
 * Nothing here calls Google. There is no TTS credential yet, and the acceptance
 * criterion for this feature — *"TTS degrades to text rather than incurring
 * cost"* — is about what happens when synthesis does NOT occur, which is
 * exactly the state the system is in.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { decideVoiceNote, TTS_PROVIDER } from '../../src/voice/notes.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async <T>(sql: string): Promise<T | undefined> =>
  (await db.execute(sql)).rows[0] as T | undefined

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

// A provider name of its own, so the real budget is never touched by a test.
// The alternative — reserving against `google.chirp3-hd` and cleaning up — puts
// a test's characters in the ledger that decides real spending, and a cleanup
// that fails leaves the budget wrong in the expensive direction.
const FIXTURE_PROVIDER = `fixture.tts.${String(Date.now()).slice(-8)}`

const reserve = async (characters: number, ceiling: number): Promise<string | null> => {
  const row = await one<{ id: string | null }>(`
    select app.reserve_tts_characters(${lit(FIXTURE_PROVIDER)}, ${String(characters)},
      ${String(ceiling)}, null, 'probe')::text as id
  `)
  return row?.id ?? null
}

// ---------------------------------------------------------------------------

const first = await reserve(1000, 5000)
record(
  'a reservation within budget succeeds and is counted',
  `usage_id=${first === null ? 'null' : 'set'}`,
  first !== null,
)

const used = await one<{ n: number }>(
  `select app.tts_characters_this_month(${lit(FIXTURE_PROVIDER)}) as n`,
)
record(
  'the month total is our own sum, because there is no counter to read',
  `${String(used?.n)} characters`,
  Number(used?.n) === 1000,
)

const overshoot = await reserve(4500, 5000)
record(
  'a reservation that would exceed the ceiling is refused — and refused, not raised',
  `usage_id=${overshoot === null ? 'null (refused)' : 'SET'}`,
  overshoot === null,
)

const exact = await reserve(4000, 5000)
record(
  'CONTROL: a reservation that exactly fills the ceiling still succeeds, so the refusal is not off-by-one',
  `usage_id=${exact === null ? 'null' : 'set'}`,
  exact !== null,
)

const afterFull = await reserve(1, 5000)
record(
  'and one character past a full budget is refused',
  `usage_id=${afterFull === null ? 'null (refused)' : 'SET'}`,
  afterFull === null,
)

// ---------------------------------------------------------------------------
// The property a single-session test cannot show
// ---------------------------------------------------------------------------

// Eight callers, one thousand characters each, room for three. Without the
// advisory lock in `reserve_tts_characters`, each reads the same SUM before any
// of them writes, and all eight fit. Separate HTTP calls, so these really are
// separate database sessions.
const RACE_PROVIDER = `${FIXTURE_PROVIDER}.race`
const racers = await Promise.all(
  Array.from({ length: 8 }, () =>
    db
      .execute(`
        select app.reserve_tts_characters(${lit(RACE_PROVIDER)}, 1000, 3000, null, 'probe')::text as id
      `)
      .then((r) => (r.rows[0] as { id: string | null }).id)
      .catch(() => 'ERROR'),
  ),
)
const granted = racers.filter((r) => r !== null && r !== 'ERROR').length
const raceTotal = await one<{ n: number }>(
  `select app.tts_characters_this_month(${lit(RACE_PROVIDER)}) as n`,
)
record(
  'eight concurrent reservations against room for three grant EXACTLY three',
  `${String(granted)} granted, ${String(raceTotal?.n)} characters recorded`,
  granted === 3 && Number(raceTotal?.n) === 3000,
)
record(
  'and none of the refused callers errored — a full budget is a normal answer',
  racers.filter((r) => r === 'ERROR').length === 0 ? 'none errored' : 'SOME ERRORED',
  racers.every((r) => r !== 'ERROR'),
)

// ---------------------------------------------------------------------------
// A failed synthesis still costs
// ---------------------------------------------------------------------------

const failed = await one<{ ok: boolean }>(
  `select app.record_tts_failure(${lit(String(first))}::uuid, 'quota_exceeded') as ok`,
)
const stillCounted = await one<{ n: number; failed: boolean }>(`
  select app.tts_characters_this_month(${lit(FIXTURE_PROVIDER)}) as n,
         (select failed from public.tts_usage where usage_id = ${lit(String(first))}::uuid) as failed
`)
record(
  'a failed synthesis is flagged and its characters STAY counted',
  `flagged=${String(stillCounted?.failed)} month total=${String(stillCounted?.n)}`,
  failed?.ok === true && stillCounted?.failed === true && Number(stillCounted?.n) === 5000,
)

// ---------------------------------------------------------------------------
// The decision layer, against the real ledger
// ---------------------------------------------------------------------------

const withoutCredential = await decideVoiceNote(
  db,
  { text: 'A short reviewed sentence worth hearing.', reviewed: true },
  { credentialAvailable: false },
)
record(
  'with no TTS credential the note degrades to text, and says which reason it was',
  `speak=${String(withoutCredential.speak)} because=${String(withoutCredential.silentBecause)} text length=${String(withoutCredential.text.length)}`,
  !withoutCredential.speak &&
    withoutCredential.silentBecause === 'no_credential' &&
    withoutCredential.text.length > 0,
)

const unreviewed = await decideVoiceNote(
  db,
  { text: 'An unreviewed finding.', reviewed: false },
  { credentialAvailable: true },
)
record(
  'an unreviewed output is never spoken — audio has no margin to print "not reviewed" in',
  `because=${String(unreviewed.silentBecause)}`,
  unreviewed.silentBecause === 'unreviewed',
)

const budgetExhausted = await decideVoiceNote(
  db,
  { text: 'A short reviewed sentence worth hearing.', reviewed: true },
  { credentialAvailable: true, ceiling: 0 },
)
record(
  'a spent budget degrades to text through the ledger, not through a guess',
  `because=${String(budgetExhausted.silentBecause)} usage=${String(budgetExhausted.usageId)}`,
  budgetExhausted.silentBecause === 'over_budget' && budgetExhausted.usageId === null,
)

// ---------------------------------------------------------------------------
// What the application role may do
// ---------------------------------------------------------------------------

const asApp = async (sql: string): Promise<string> => {
  try {
    await db.execute(`set local role ai_team_app; ${sql}`)
    return '(no error — it was ACCEPTED)'
  } catch (error) {
    return (error as Error).message.replace(/\s+/g, ' ').slice(0, 160)
  }
}
const directInsert = await asApp(`
  insert into public.tts_usage (provider, characters) values (${lit(FIXTURE_PROVIDER)}, 1)
`)
record(
  'the app role cannot write the ledger directly — the count is evidence about money',
  directInsert.slice(0, 110),
  directInsert.includes('permission denied'),
)
const directUpdate = await asApp(
  `update public.tts_usage set characters = 0 where provider = ${lit(FIXTURE_PROVIDER)}`,
)
record(
  'nor edit it afterwards, which would make a bill disappear',
  directUpdate.slice(0, 110),
  directUpdate.includes('permission denied'),
)
const viaFunction = await asApp(
  `select app.reserve_tts_characters(${lit(FIXTURE_PROVIDER)}, 1, 999999, null, 'probe')`,
)
record(
  'CONTROL: but it CAN reserve through the function, so the feature is not locked out',
  viaFunction.slice(0, 80),
  viaFunction.includes('no error'),
)

// ---------------------------------------------------------------------------

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failedChecks = checks.filter((c) => !c.passed)
console.log(
  `\n${String(checks.length - failedChecks.length)}/${String(checks.length)} checks passed`,
)

try {
  await db.execute(
    `delete from public.tts_usage where provider like ${lit(`${FIXTURE_PROVIDER}%`)}`,
  )
  const real = await one<{ n: number }>(
    `select app.tts_characters_this_month(${lit(TTS_PROVIDER)}) as n`,
  )
  console.log(
    `\nfixtures retired. Real ${TTS_PROVIDER} spend this month: ${String(real?.n)} chars.`,
  )
} catch (error) {
  console.log(`\ncleanup did not complete: ${(error as Error).message.slice(0, 160)}`)
}

if (failedChecks.length > 0) process.exit(1)

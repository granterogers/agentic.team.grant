/**
 * Assert that the job transition allow-list in the database and the one in
 * TypeScript are identical.
 *
 *   npm run verify:transitions
 *
 * Both copies exist deliberately, because each covers a gap the other cannot:
 * `src/jobs/states.ts` catches an illegal transition at the call site with a
 * useful stack trace, and `app.job_transitions_allowed` catches the direct SQL
 * write that never went through TypeScript at all — a migration, a psql
 * session, the Management API.
 *
 * Two copies of a rule is a liability only if they can drift apart in silence.
 * This is what stops that.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { ALLOWED_TRANSITIONS, JOB_STATES } from '../../src/jobs/states.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const fromTypeScript = new Set<string>()
for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
  for (const to of targets) fromTypeScript.add(`${from}->${to}`)
}

const { rows } = await db.execute(
  `select from_state::text as f, to_state::text as t from app.job_transitions_allowed`,
)
const fromDatabase = new Set(rows.map((r) => `${String(r.f)}->${String(r.t)}`))

const onlyInDatabase = [...fromDatabase].filter((t) => !fromTypeScript.has(t)).sort()
const onlyInTypeScript = [...fromTypeScript].filter((t) => !fromDatabase.has(t)).sort()

// The enum must carry the same fourteen states, or the allow-lists could agree
// about transitions between states that do not both exist.
const enumStates = (
  await db.execute(
    `select enumlabel from pg_enum e
     join pg_type t on t.oid = e.enumtypid
     where t.typname = 'job_state' order by e.enumsortorder`,
  )
).rows.map((r) => String(r.enumlabel))

const enumMatches =
  enumStates.length === JOB_STATES.length && enumStates.every((s, i) => s === JOB_STATES[i])

console.log(`job_state enum:      ${enumStates.length} values`)
console.log(`JOB_STATES:          ${JOB_STATES.length} values`)
console.log(`enum order matches:  ${enumMatches ? '✅' : '❌'}`)
console.log(`transitions in DB:   ${fromDatabase.size}`)
console.log(`transitions in TS:   ${fromTypeScript.size}`)
console.log(
  `only in DB:          ${onlyInDatabase.length === 0 ? 'none ✅' : onlyInDatabase.join(', ')}`,
)
console.log(
  `only in TS:          ${onlyInTypeScript.length === 0 ? 'none ✅' : onlyInTypeScript.join(', ')}`,
)

if (!enumMatches || onlyInDatabase.length > 0 || onlyInTypeScript.length > 0) {
  console.error('\nThe database and TypeScript state machines have DRIFTED.')
  process.exit(1)
}
console.log('\nThe two state machines are identical.')

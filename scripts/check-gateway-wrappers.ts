/*
 * EVERY FUNCTION THE GATEWAY CALLS HAS A PUBLIC WRAPPER.
 *
 *   npm run check:gateway-wrappers
 *
 * WHY THIS EXISTS, and it is a defect that had been live for a long time.
 *
 * PostgREST only exposes `public`. The gateway reaches the database through it,
 * so an `app.*` function with no `public` wrapper is unreachable from any
 * browser — and the gateway reports that as a 502 "upstream failed", which
 * looks like an outage rather than a missing three-line wrapper.
 *
 * `section=pulse` returned 502 on EVERY page load of the dashboard. The RPC
 * behind it, `app.hq_pulse`, works perfectly when called directly, and:
 *
 *   - `verify:pulse` passed 11/11, because it calls `app.hq_pulse()` in SQL
 *     and never goes near the gateway. CLAUDE.md already records this exact
 *     shape from `verify:search`: a suite that skips the layer it exists for
 *     is worse than no suite.
 *   - `verify:wrappers` passed 43/43, because it checks a HARDCODED list of
 *     functions and `hq_pulse` was never on it. A list of the things somebody
 *     thought of is not a property.
 *
 * So this asks the question as a property instead: the gateway's own SECTIONS
 * and ACTIONS maps ARE the list of functions a browser can reach, and every one
 * of them must exist in `public`. A section added tomorrow is covered the day
 * it is added, without anybody remembering to write it down.
 *
 * It reads the deployed function's SOURCE for the names and the DATABASE for
 * what exists, so it cannot pass by agreeing with itself.
 */
import '../src/safety/require-production-checks.ts'
import { readFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const GATEWAY = 'supabase/functions/hq-api/index.ts'

const src = await readFile(GATEWAY, 'utf8')

/*
  The names, taken from the two maps the gateway routes on. Anchored on the
  `fn:` key rather than on a list of section names, because the section name
  and the function name differ often enough that matching the wrong one would
  quietly cover nothing.
*/
const named = [...src.matchAll(/\bfn:\s*'([a-z0-9_]+)'/g)].map((m) => m[1] as string)
const wanted = [...new Set(named)].sort()
if (wanted.length === 0) {
  console.error(
    `no fn: entries found in ${GATEWAY} — the check cannot have looked at the right file`,
  )
  process.exit(2)
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set — this check asks the database what exists')
  process.exit(2)
}
const db = new ManagementApiExecutor(ref, accessToken)

const rows = (
  await db.execute(
    `select p.proname as name
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'`,
  )
).rows as { name: string }[]
const inPublic = new Set(rows.map((r) => String(r.name)))

const missing = wanted.filter((fn) => !inPublic.has(fn))

console.log(
  `the gateway routes to ${String(wanted.length)} distinct function(s); ${String(inPublic.size)} exist in public`,
)
if (missing.length === 0) {
  console.log(
    'check:gateway-wrappers clean — every function the gateway calls is reachable through PostgREST',
  )
  process.exit(0)
}
console.log('')
console.log(
  `check:gateway-wrappers FAILED — ${String(missing.length)} function(s) the gateway calls have no public wrapper.`,
)
console.log('A browser asking for these gets 502 "upstream failed", which reads as an outage:')
for (const fn of missing) console.log(`  ${fn}`)
process.exit(1)

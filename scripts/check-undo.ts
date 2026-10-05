/**
 * An undo the office offers is one it can perform (#346).
 *
 *   npm run check:undo
 *
 * `app.hq_undo` dispatches on `reversal ->> 'action'` through a CLOSED case
 * and raises `no way to perform the reversal %` on anything else. Four action
 * names the writers had always recorded were missing from it -
 * `contact_archive`, `contact_photo_set`, `contact_update`, `document_rename`
 * - so thirty-four recorded reversals raised out of a SECURITY DEFINER
 * function when pressed. 0572 taught it the four.
 *
 * This is what stops the fifth. BOTH SIDES ARE DERIVED: the names the writers
 * pass, read out of the writers; the names the press performs, read out of
 * `hq_undo`. A list maintained by hand would be the third place for the same
 * fact to rot, which is what 0310 exists to warn about.
 *
 * It reads the WRITERS rather than the recorded rows on purpose - a writer
 * added today has no rows yet, and would be invisible to a check that only
 * looked at what had already happened.
 */
import '../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const { rows: writers } = await db.execute(`
  select p.proname, pg_get_functiondef(p.oid) as src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and pg_get_functiondef(p.oid) ~ 'undo_offer\\s*\\('
     and p.proname <> 'undo_offer'`)

const { rows: press } = await db.execute(`select pg_get_functiondef('app.hq_undo'::regproc) as src`)
const dispatch = String((press[0] as { src: string }).src)
const performs = new Set([...dispatch.matchAll(/when '([a-z_]+)' then/g)].map((m) => m[1] ?? ''))

/* `jsonb_build_object('action', 'contact_update', …)` — the name a writer records. */
const offered = new Map<string, string>()
for (const w of writers as { proname: string; src: string }[]) {
  for (const m of w.src.matchAll(/'action'\s*,\s*'([a-z_]+)'/g)) {
    offered.set(m[1] ?? '', w.proname)
  }
}

/* A found-nothing check proves nothing until its subject is non-empty. */
if (offered.size === 0 || performs.size === 0) {
  console.error(
    `check:undo could not read its subjects — ${String(offered.size)} offered, ` +
      `${String(performs.size)} performed. Fix the query before trusting a pass.`,
  )
  process.exit(1)
}

const orphans = [...offered].filter(([name]) => !performs.has(name))
console.log(
  `${String(offered.size)} reversal(s) offered by ${String(writers.length)} writer(s); ` +
    `hq_undo performs ${String(performs.size)}`,
)
if (orphans.length > 0) {
  console.error('\ncheck:undo FAILED — offered but not performable:')
  for (const [name, who] of orphans) {
    console.error(`  ${name.padEnd(24)} recorded by app.${who}`)
  }
  console.error('\nTeach app.hq_undo the verb in the same migration that starts offering it.')
  process.exit(1)
}

/*
  THE CONTROL. A name the press cannot possibly know must be reported, or this
  check is the vacuous kind that passes because it compares nothing.
*/
const canary = 'zz_reversal_that_cannot_exist'
if (performs.has(canary)) {
  console.error('the control name is somehow handled — pick another')
  process.exit(1)
}
console.log('every reversal the office offers, it can perform')

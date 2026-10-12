/**
 * Turn the unified activity ledger on for chosen offices, for every office, or off, the way stage D of
 * docs/activity-ledger/MIGRATION-PLAN.md says. FAIL CLOSED: only an explicit, valid setting turns an office on.
 *
 *   npm run activity:switch                                      status: what is set and who it covers (writes nothing)
 *   npm run activity:switch -- --canary <office-id>[,<id>...]    plan: ONLY these offices (written before the master is turned on)
 *   npm run activity:switch -- --add <id>[,<id>...]              plan: add offices to the existing canary list
 *   npm run activity:switch -- --remove <id>[,<id>...]           plan: take offices out of the canary list
 *   npm run activity:switch -- --off                             plan: the kill switch (master off for every office)
 *   npm run activity:switch -- --all-offices --confirm="ALL OFFICES"   plan: EVERY OFFICE (global activation)
 *   ... add --apply to run a plan. Without --apply nothing is written, whatever else is on the line.
 *
 * Every run needs ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1, set by a person for this one operation (the gate import below
 * refuses otherwise, even for a plan). Each statement is guarded by the value that was read, so a change between the plan and the apply
 * stops the apply instead of overwriting it. Any unknown option is refused. The planner is src/activity/switch.ts, the command line
 * src/activity/switch-cli.ts; both are unit tested and the statements are applied to a real database in activity-office-scope.
 */
import '../../src/safety/require-production-writes.ts'
import { applyPlan, planSwitch, readStored } from '../../src/activity/switch.ts'
import { parseSwitchArgs } from '../../src/activity/switch-cli.ts'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'

const parsed = parseSwitchArgs(process.argv.slice(2))
if (!parsed.ok) {
  console.error(`refused: ${parsed.refusal}`)
  process.exit(2)
}

let db: SqlExecutor
const url = process.env.SUPABASE_DB_URL ?? ''
if (url !== '') {
  const pg = new PgExecutor(url)
  await pg.connect()
  db = pg
} else {
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (token === '') {
    console.error('SUPABASE_DB_URL or SUPABASE_ACCESS_TOKEN is required')
    process.exit(2)
  }
  db = new ManagementApiExecutor(process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg', token)
}

let code = 0
const { request, apply } = parsed
const state = await readStored(db)
const plan = planSwitch(request, state)
if (!plan.ok) {
  console.error(`refused: ${plan.refusal}`)
  code = 1
} else {
  console.log(plan.headline)
  console.log(`  CURRENT : ${plan.current}`)
  console.log(`  PROPOSED: ${plan.proposed}`)
  if (state.allowlist.kind === 'invalid')
    console.log(
      '  NOTE    : the stored allowlist is INVALID and ignored (no office is on because of it)',
    )
  if (request.kind !== 'status') {
    if (plan.noop) console.log('  nothing to change: the settings already say this')
    for (const s of plan.statements) console.log(`  - ${s.why}\n      ${s.sql};`)
    if (!apply) {
      if (!plan.noop) console.log('(plan only: nothing was written. Add --apply to run it.)')
    } else if (!plan.noop) {
      const result = await applyPlan(db, plan)
      console.log(result.detail)
      const now = planSwitch({ kind: 'status' }, await readStored(db))
      console.log(`  NOW     : ${now.ok ? now.current : ''}`)
      if (result.stoppedAt !== null) code = 1
    }
  }
}
if (db instanceof PgExecutor) await db.end()
process.exit(code)

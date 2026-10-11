/**
 * Turn the unified activity ledger on, off or onto chosen offices, the way stage D of docs/activity-ledger/MIGRATION-PLAN.md says.
 *
 *   npm run activity:switch                                    # print what is set now and what each command would do (a plan; writes nothing)
 *   npm run activity:switch -- --canary <office-id>[,<id>...]  # plan: allowlist those offices, then turn the master on
 *   npm run activity:switch -- --add <office-id>[,<id>...]     # plan: add offices to an existing allowlist
 *   npm run activity:switch -- --all                           # plan: every office (removes the allowlist, master on)
 *   npm run activity:switch -- --off                           # plan: master off (the kill switch)
 *   ... add --apply to run the plan, with ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 set by a person for this one operation
 *
 * Without --apply nothing is written, so a plan can be read first. The planner is src/activity/switch.ts (pure, unit tested): the
 * allowlist is written before the master is turned on, and off writes the master only. Connection: SUPABASE_DB_URL (direct) or the
 * Management API token. Whether the office ids exist is checked against public.offices before anything is applied.
 */
import '../../src/safety/require-production-writes.ts'
import { planSwitch, readState, type SwitchRequest } from '../../src/activity/switch.ts'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const flagValues = (flag: string): string[] | null => {
  const i = argv.indexOf(flag)
  if (i < 0) return null
  return (argv[i + 1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
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

const read = async (key: string): Promise<{ value: unknown } | null> => {
  const r = await db.execute(`select value from public.system_config where key = '${key}'`)
  const row = r.rows[0] as { value: unknown } | undefined
  return row === undefined
    ? null
    : { value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value }
}

const master = await read('activity.ledger_enabled')
const state = readState(master?.value, await read('activity.ledger_offices'))
console.log(
  `now: master ${state.master ? 'ON' : 'off'}; ${state.allowlist === null ? 'no allowlist (every office the master covers)' : `allowlist of ${String(state.allowlist.length)} office(s)`}`,
)

const request: SwitchRequest | null =
  flagValues('--canary') !== null
    ? { kind: 'canary', offices: flagValues('--canary') ?? [] }
    : flagValues('--add') !== null
      ? { kind: 'add', offices: flagValues('--add') ?? [] }
      : argv.includes('--all')
        ? { kind: 'all' }
        : argv.includes('--off')
          ? { kind: 'off' }
          : null

let code = 0
if (request === null) {
  console.log(
    'nothing requested. Use --canary <ids>, --add <ids>, --all or --off (plans only; add --apply to run).',
  )
} else {
  const plan = planSwitch(request, state)
  if (!plan.ok) {
    console.error(`refused: ${plan.refusal}`)
    code = 1
  } else {
    if (request.kind === 'canary' || request.kind === 'add') {
      const found = await db.execute(
        `select office_id::text as id from public.offices where state = 'active' and office_id = any (array[${request.offices.map((o) => `'${o}'`).join(',')}]::uuid[])`,
      )
      const have = new Set((found.rows as { id: string }[]).map((r) => r.id))
      const missing = request.offices.filter((o) => !have.has(o))
      if (missing.length > 0) {
        console.error(
          `refused: ${String(missing.length)} office id(s) are not active offices: ${missing.join(', ')}`,
        )
        code = 1
      }
    }
    if (code === 0) {
      console.log(plan.note)
      for (const s of plan.statements) console.log(`  ${s};`)
      if (!apply) console.log('(plan only; nothing was written. Add --apply to run it.)')
      else {
        for (const s of plan.statements) await db.execute(s)
        const after = readState(
          (await read('activity.ledger_enabled'))?.value,
          await read('activity.ledger_offices'),
        )
        console.log(
          `after: master ${after.master ? 'ON' : 'off'}; ${after.allowlist === null ? 'no allowlist' : `allowlist of ${String(after.allowlist.length)}`}`,
        )
      }
    }
  }
}
if (db instanceof PgExecutor) await db.end()
process.exit(code)

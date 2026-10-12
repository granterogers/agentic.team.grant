/**
 * Build the access paths the unified activity read model leans on, without stopping the office.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npm run activity:indexes          # a person sets both, for this one operation
 *   npm run activity:indexes -- --status                                                   # read-only: which are missing or invalid
 *
 * Each index is its own CREATE INDEX CONCURRENTLY, which takes no lock that blocks a write. It is idempotent and resumable: a
 * run that is interrupted leaves, at worst, an INVALID index, which the next run drops and builds again. It never drops a valid one.
 *
 * Connection: SUPABASE_DB_URL (a direct session, preferred: lock_timeout then applies to every statement) or, failing that, the
 * Management API with SUPABASE_ACCESS_TOKEN. Whether the Management API accepts CREATE INDEX CONCURRENTLY has NOT been verified;
 * if it answers 25001 ("cannot run inside a transaction block") use the direct connection or the SQL editor, one statement at a time
 * (`createStatement` in src/activity/indexes.ts prints the exact text).
 */
import '../../src/safety/require-production-writes.ts'
import {
  ACTIVITY_INDEXES,
  createStatement,
  ensureActivityIndexes,
  inspectActivityIndexes,
} from '../../src/activity/indexes.ts'
import { ManagementApiExecutor, type SqlExecutor } from '../../src/db/executor.ts'
import { PgExecutor } from '../../src/db/pg-executor.ts'

const statusOnly = process.argv.includes('--status')
const print = process.argv.includes('--print')

if (print) {
  for (const i of ACTIVITY_INDEXES) console.log(`${createStatement(i)};`)
  process.exit(0)
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

const show = async (): Promise<number> => {
  let gaps = 0
  for (const s of await inspectActivityIndexes(db)) {
    const state = !s.present ? 'MISSING' : s.valid ? 'valid' : 'INVALID'
    if (state !== 'valid') gaps++
    console.log(`  ${s.name.padEnd(40)} ${state}`)
  }
  return gaps
}

let code = 0
if (statusOnly) {
  code = (await show()) === 0 ? 0 : 1
} else {
  const results = await ensureActivityIndexes(db, { log: (l) => console.log(l) })
  for (const r of results) console.log(`  ${r.name.padEnd(40)} ${r.outcome}`)
  const gaps = await show()
  code = gaps === 0 ? 0 : 1
  console.log(
    gaps === 0 ? 'all activity indexes are valid' : `${String(gaps)} index(es) still missing`,
  )
}
if (db instanceof PgExecutor) await db.end()
process.exit(code)

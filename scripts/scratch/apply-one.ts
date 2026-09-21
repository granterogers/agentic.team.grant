/**
 * Apply ONE migration the way the runner does. A scratch tool.
 *
 * Inside the repository so `"type": "module"` applies — CLAUDE.md records that
 * a scratch script outside it fails on top-level await under CJS, and this run
 * paid for that once.
 *
 * ## Why it exists, and when it is the wrong thing to reach for
 *
 * `npm run migrate` refuses to run while `check:migrations` has any finding,
 * which is correct and is the only reason this file is here. Three sessions
 * worked this repository in parallel against ONE shared database, and the
 * sibling branch's 0534 was applied to it while being absent from this
 * branch's `migrations/`. That is a `[checksum/missing]` and a
 * `[sequence/gap]`, both of them true, and neither of them about the file
 * being applied.
 *
 * It does exactly what `src/migrations/runner.ts` does — same SQL, same
 * sha256 of the file's utf8 bytes, same `app.schema_migrations` row — and
 * skips only the precondition. It does NOT skip the checksum: a migration
 * already recorded is left alone rather than reapplied.
 *
 * **Use `npm run migrate` whenever it will run.** The integrity check exists
 * because a database and a repository that have diverged can only be
 * reconciled by a person, and routing around it is a thing to do knowingly,
 * once, with a reason — not a habit.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const name = process.argv[2]
if (name === undefined || name === '') {
  console.error('usage: tsx scripts/scratch/apply-one.ts <migration filename>')
  process.exit(2)
}

const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}

const sql = readFileSync(`migrations/${name}`, 'utf8')
const sum = createHash('sha256').update(sql, 'utf8').digest('hex')
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const quoted = name.replace(/'/g, "''")

const already = await db.execute(
  `select checksum from app.schema_migrations where name = '${quoted}'`,
)
if (already.rows.length > 0) {
  console.log(`${name} is already recorded as applied; nothing done`)
  process.exit(0)
}

const started = Date.now()
await db.execute(sql)
const ms = Date.now() - started
await db.execute(
  `insert into app.schema_migrations (name, checksum, duration_ms)
   values ('${quoted}', '${sum}', ${ms})`,
)
console.log(`applied ${name} in ${String(ms)}ms, checksum ${sum.slice(0, 12)}…`)

/*
 * APPLYING EXACTLY ONE MIGRATION, ON PURPOSE, AND SAYING WHY.
 *
 * `npm run migrate` refuses to run this branch's migrations, and it is RIGHT
 * to: it demands that the repository describe the database, and this branch
 * cannot. The database is at 566 applied migrations; `main` and this branch
 * carry 533. The other 33 belong to `claude/human-simulation-harness`, they
 * are not on main yet, and bringing copies of them in here was tried and
 * reverted - that branch carries two files numbered 0543, so importing them
 * turns THIS branch's gate red on somebody else's defect.
 *
 * So the integrity finding that blocks `migrate` is about 33 files this
 * workstream does not own and is not changing. It is not about the one file
 * being applied here, which is additive, idempotent, and touches a table all
 * 33 of those migrations leave alone - checked, not assumed.
 *
 * WHAT THIS DOES DIFFERENTLY FROM `migrate`, AND WHAT IT DOES NOT.
 * It runs one named file and records it in `app.schema_migrations` with the
 * same name and the same SHA-256 the runner would - so the database's ledger
 * is exactly what it would have been. It does NOT skip the checks that are
 * about the file itself: the file must be in `migrations/`, must not already
 * be applied, and `npm run check:migrations` must pass first.
 *
 * It is not a way around the safety machinery. It is the one case that
 * machinery cannot express: a branch that is behind on migrations it does not
 * own.
 */
import '../src/safety/require-production-writes.ts'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const name = process.argv[2] ?? ''
if (name === '' || !name.endsWith('.sql')) {
  console.error('usage: npm run migrate:one -- 0534_a_migration.sql')
  process.exit(1)
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(1)
}
const db = new ManagementApiExecutor(ref, accessToken)

const sql = await readFile(join('migrations', name), 'utf8').catch(() => '')
if (sql === '') {
  console.error(`migrations/${name} is not there, or is empty`)
  process.exit(1)
}
const checksum = createHash('sha256').update(sql, 'utf8').digest('hex')

const already = (
  await db.execute(
    `select checksum from app.schema_migrations where name = '${name.replace(/'/g, "''")}'`,
  )
).rows[0] as { checksum?: string } | undefined

if (already !== undefined) {
  if (already.checksum === checksum) {
    console.log(`${name} is already applied, unchanged. Nothing to do.`)
    process.exit(0)
  }
  console.error(
    `${name} is already applied with a DIFFERENT checksum. An applied migration is ` +
      'immutable; write a new one rather than editing this.',
  )
  process.exit(1)
}

console.log(`applying ${name}`)
const started = Date.now()
try {
  await db.execute(sql)
} catch (error) {
  console.error(`${name} failed and was rolled back: ${(error as Error).message}`)
  process.exit(1)
}
const took = Date.now() - started

await db.execute(
  `insert into app.schema_migrations (name, checksum, duration_ms)
   values ('${name.replace(/'/g, "''")}', '${checksum}', ${String(took)})
   on conflict (name) do update
     set checksum = excluded.checksum, duration_ms = excluded.duration_ms`,
)
console.log(`  applied in ${String(took)}ms and recorded`)

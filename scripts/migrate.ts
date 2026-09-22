/**
 * Apply pending migrations.
 *
 *   npm run migrate           apply everything pending
 *   npm run migrate -- --dry  list what would be applied, change nothing
 *
 * Uses the Supabase Management API, because a Claude Code session cannot reach
 * Postgres (ADR-0007). Writes migrations/applied.json afterwards so CI can
 * enforce that applied history is never edited.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import { resolveProjectRef } from '../src/fresh/project-ref.ts'
import type { MigrationFile } from '../src/migrations/check.ts'
import { ledgerExists, readApplied, runMigrations } from '../src/migrations/runner.ts'

const MIGRATIONS_DIR = 'migrations'
const APPLIED_LEDGER = join(MIGRATIONS_DIR, 'applied.json')

const sha256 = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex')

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error(
    'SUPABASE_ACCESS_TOKEN is not set.\n' +
      'Create one at https://supabase.com/dashboard/account/tokens — see ADR-0007 for why\n' +
      'a database connection string cannot be used from a build session.',
  )
  process.exit(2)
}

const names = await readdir(MIGRATIONS_DIR)
const files: MigrationFile[] = await Promise.all(
  names
    .filter((n) => n.toLowerCase().endsWith('.sql'))
    .map(async (name) => ({ name, sql: await readFile(join(MIGRATIONS_DIR, name), 'utf8') })),
)

/*
  Say which project this is about to change.

  The default is load-bearing — a session starts with no environment and every
  command in this repository would stop without it — and it is also the quietest
  way for a second person to apply this schema to somebody else's database.
  `resolveProjectRef` keeps the default and says, once, that it used it.
*/
const executor = new ManagementApiExecutor(
  resolveProjectRef({ forWhat: 'the migration runner' }),
  token,
)

if (process.argv.includes('--dry')) {
  const present = await ledgerExists(executor)
  const applied = new Set(present ? (await readApplied(executor)).map((a) => a.name) : [])
  const pending = files
    .map((f) => f.name)
    .filter((n) => !applied.has(n))
    .sort()
  console.log(`ledger present: ${present}`)
  console.log(`already applied: ${applied.size}`)
  console.log(pending.length === 0 ? 'nothing pending' : `would apply:\n  ${pending.join('\n  ')}`)
  process.exit(0)
}

const result = await runMigrations(files, executor, sha256, (m) => {
  console.log(m)
})

// Rewrite the on-disk ledger from what the DATABASE reports, not from what we
// think we just did. If the two ever disagree, the database is right.
const applied = await readApplied(executor)
const ledger = Object.fromEntries(applied.map((a) => [a.name, a.checksum]))
await writeFile(APPLIED_LEDGER, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')

console.log(
  `\nApplied ${result.applied.length}, skipped ${result.skipped.length}. ` +
    `${applied.length} migration(s) recorded in app.schema_migrations.`,
)

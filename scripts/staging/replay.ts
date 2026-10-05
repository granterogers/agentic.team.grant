/**
 * Replay the WHOLE migration history into the STAGING Supabase project, in repository order, nothing skipped.
 *
 *   npm run staging:replay            # applies every migration not yet recorded in the staging project
 *   npm run staging:replay -- --dry   # says what would be applied
 *
 * Why not `npm run migrate`: on a fresh project the pre-0592 history cannot be applied one atomic request per file
 * (29 of those files end in a self-check that needs production rows), and the 0584 sequence collision is recorded only in
 * the PRODUCTION ledger. src/migrations/fresh.ts replays those files a statement at a time and tolerates ONLY the
 * messages listed per file in docs/testing/fresh-replay-tolerances.json; everything from 0592 on is atomic and tolerates
 * nothing. The same code replayed into a local database gave a schema identical to the psql-built replica.
 *
 * Refuses unless the staging preflight passes (the attestation binds the project), and writes its ledger to
 * .staging/applied.json - never to migrations/applied.json, which is production's.
 */
import '../../src/safety/require-production-writes.ts'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { MigrationFile } from '../../src/migrations/check.ts'
import { applyFresh, type Tolerances } from '../../src/migrations/fresh.ts'
import { ledgerExists, readApplied, runMigrations } from '../../src/migrations/runner.ts'
import {
  BUILTIN_DENYLIST,
  type Denylist,
  evaluate,
  mergeDenylists,
} from '../../src/staging/preflight.ts'

const file = process.env.STAGING_DENYLIST_FILE ?? '.staging/production-identifiers.json'
const found = existsSync(file)
const local = found ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<Denylist>) : {}
const report = evaluate(process.env, mergeDenylists(BUILTIN_DENYLIST, local), {
  denylistFileFound: found,
})
if (process.env.TARGET_ENVIRONMENT?.trim() !== 'staging' || !report.ok) {
  for (const c of report.checks.filter((x) => !x.ok)) console.error(`FAIL ${c.id}: ${c.detail}`)
  console.error('\nREFUSED: this is not a passing staging preflight, so nothing was changed.')
  process.exit(1)
}
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const ref = process.env.SUPABASE_PROJECT_REF ?? ''
if (token === '' || ref === '') {
  console.error(
    'SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (staging) are required; neither is printed.',
  )
  process.exit(2)
}
const db = new ManagementApiExecutor(ref, token)
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const files: MigrationFile[] = readdirSync('migrations')
  .filter((n) => n.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(`migrations/${name}`, 'utf8') }))
const tolerances = (
  JSON.parse(readFileSync('docs/testing/fresh-replay-tolerances.json', 'utf8')) as {
    files: Tolerances
  }
).files

if (process.argv.includes('--dry')) {
  const done = new Set((await ledgerExists(db)) ? (await readApplied(db)).map((a) => a.name) : [])
  const pending = files.map((f) => f.name).filter((n) => !done.has(n))
  console.log(`already applied: ${done.size}\nwould apply: ${pending.length}`)
  process.exit(0)
}

let tolerated = 0
const result = await runMigrations(files, db, sha, (m) => console.log(m), {
  knownHistory: JSON.parse(readFileSync('migrations/applied.json', 'utf8')) as Record<
    string,
    string
  >,
  apply: async (f, executor) => {
    tolerated += (await applyFresh(f, executor, tolerances)).tolerated.length
  },
})
const applied = await readApplied(db)
await mkdir('.staging', { recursive: true })
await writeFile(
  '.staging/applied.json',
  `${JSON.stringify(Object.fromEntries(applied.map((a) => [a.name, a.checksum])), null, 2)}\n`,
  'utf8',
)
console.log(
  `\nApplied ${result.applied.length}, skipped ${result.skipped.length}, tolerated ${tolerated} listed error(s). ${applied.length} recorded.`,
)

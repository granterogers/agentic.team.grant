/**
 * Replay the WHOLE migration history into an empty local database the way `npm run staging:replay` does it on a fresh
 * project (src/migrations/fresh.ts): one atomic request per file, and a statement at a time, tolerating only the listed
 * errors, for the history before 0592 that ends in a check needing production rows.
 *
 *   npx tsx scripts/isolated/fresh-replay.ts <empty-database> [--discover]
 *
 * `--discover` tolerates every error in every pre-0592 file and writes what it found to docs/testing/fresh-replay-tolerances.json
 * (that file is reviewed by a person; it is the only thing that may ever be tolerated). Without it the committed list is
 * enforced and any other failure stops the replay. The database must be empty apart from the platform schemas.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { MigrationFile } from '../../src/migrations/check.ts'
import { ATOMIC_FROM, applyFresh, type Tolerances } from '../../src/migrations/fresh.ts'
import { runMigrations } from '../../src/migrations/runner.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'fresh_replay')
const discover = process.argv.includes('--discover')
const TOL = 'docs/testing/fresh-replay-tolerances.json'
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

const files: MigrationFile[] = readdirSync('migrations')
  .filter((n) => n.endsWith('.sql'))
  .map((name) => ({ name, sql: readFileSync(`migrations/${name}`, 'utf8') }))

const found: Record<string, string[]> = {}
const strict: Tolerances = discover
  ? {}
  : (JSON.parse(readFileSync(TOL, 'utf8')) as { files: Tolerances }).files
let tolerated = 0
let current = ''
const result = await runMigrations(
  files,
  db,
  sha,
  (m) => {
    if (m.startsWith('applying')) {
      current = m
      if (process.env.FRESH_TRACE) console.log(`${new Date().toISOString().slice(11, 19)} ${m}`)
    } else console.log(m)
  },
  {
    knownHistory: JSON.parse(readFileSync('migrations/applied.json', 'utf8')) as Record<
      string,
      string
    >,
    apply: async (file, executor) => {
      if (discover && file.name.slice(0, 4) < ATOMIC_FROM) {
        const r = await applyFresh(file, executor, { [file.name]: [''] })
        if (r.tolerated.length > 0)
          found[file.name] = r.tolerated.map((t) => t.replace(/\s+/g, ' ').slice(0, 120))
        return
      }
      const r = await applyFresh(file, executor, strict)
      tolerated += r.tolerated.length
    },
  },
).catch((e) => {
  console.error(`FAILED at ${current}: ${e instanceof Error ? e.message.slice(0, 400) : String(e)}`)
  process.exit(1)
})
if (discover) {
  const out = Object.fromEntries(
    Object.entries(found)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([f, msgs]) => [
        f,
        [...new Set(msgs.map((m) => m.replace(/^ERROR:\s*/, '').slice(0, 60)))],
      ]),
  )
  writeFileSync(
    TOL,
    `${JSON.stringify({ _comment: 'Pre-0592 migrations that end in a self-check needing production rows. On a FRESH project each fails on an empty table, and ONLY the messages listed here (a substring of the error) may be tolerated, per file, when the file is replayed a statement at a time (src/migrations/fresh.ts). Discovered by scripts/isolated/fresh-replay.ts --discover and reviewed by a person. Everything from 0592 on is atomic and tolerates nothing.', files: out }, null, 2)}\n`,
  )
  console.log(`discovered ${Object.keys(out).length} file(s) with tolerated errors -> ${TOL}`)
} else {
  console.log(`tolerated ${tolerated} listed error(s)`)
}
console.log(`applied ${result.applied.length} migration(s)`)
await db.end()

/**
 * R1c (LOCAL ONLY): run the catalogue fingerprints of docs/audit/V1-R1C-CATALOGUE-FINGERPRINTS-2026-10-09.sql against an isolated replica, in the
 * same shape the production read prints, so the two can be compared.
 *
 *   env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL npx tsx scripts/release/r1c-catalogue.ts <database> [--full]
 *
 * The database must be a marked replica on the local socket (scripts/isolated/guard.ts refuses anything else). Reads the catalogue only.
 */
import { readFileSync } from 'node:fs'
import { isolated } from '../isolated/guard.ts'
import { isPlainSelect, parsePreflight } from './plain-select.ts'

const database = process.argv[2]
if (database === undefined) {
  console.error('usage: r1c-catalogue.ts <database> [--full]')
  process.exit(2)
}
const full = process.argv.includes('--full')
const db = await isolated(database)
const statements = parsePreflight(
  readFileSync('docs/audit/V1-R1C-CATALOGUE-FINGERPRINTS-2026-10-09.sql', 'utf8'),
)
for (const s of statements) {
  if (!isPlainSelect(s.sql)) {
    console.log(`\n${s.id} BLOCKED: not a single plain select (not run)`)
    continue
  }
  const { rows } = await db.execute(s.sql)
  const text = JSON.stringify(rows)
  console.log(
    `\n${s.id}\n${full || text.length < 14000 ? text : `${text.slice(0, 14000)} ...[clipped]`}`,
  )
}
await db.end()

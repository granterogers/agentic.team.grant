/**
 * Bring migrations/applied.json up to what production has applied (multi-user P3).
 *   npx tsx scripts/p3/sync-applied.ts          # report only
 *   npx tsx scripts/p3/sync-applied.ts --write  # add the entries whose checksum matches the file in this checkout
 *
 * A migration is recorded only when production's checksum equals the sha256 of the local file: a mismatch is reported
 * and never written, because recording it would make the repository claim content nobody ran.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const ledger = JSON.parse(readFileSync('migrations/applied.json', 'utf8')) as Record<string, string>
const { rows } = await db.execute(`select name, checksum from app.schema_migrations order by name`)
const added: string[] = []
const mismatched: string[] = []
const missing: string[] = []
for (const r of rows as { name: string; checksum: string }[]) {
  if (ledger[r.name] !== undefined) continue
  const file = `migrations/${r.name}`
  if (!existsSync(file)) {
    missing.push(r.name)
    continue
  }
  const sum = createHash('sha256').update(readFileSync(file)).digest('hex')
  if (sum === r.checksum) {
    ledger[r.name] = sum
    added.push(r.name)
  } else mismatched.push(r.name)
}
console.log(
  `to add: ${String(added.length)}, checksum mismatch: ${String(mismatched.length)}, no local file: ${String(missing.length)}`,
)
for (const m of mismatched) console.log(`  MISMATCH ${m}`)
for (const m of missing) console.log(`  NO FILE  ${m}`)
if (process.argv.includes('--write')) {
  const sorted = Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync('migrations/applied.json', `${JSON.stringify(sorted, null, 2)}\n`)
  console.log('migrations/applied.json written')
}

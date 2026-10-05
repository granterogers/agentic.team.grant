/**
 * Run one SQL file against production through the Management API and print the answer or the whole error.
 *
 *   npx tsx scripts/p2/run-file.ts /tmp/chain.sql
 *
 * The P2 waves are 20-170 KB, which does not fit on a command line, and a dry run ends in an exception on purpose
 * (the report rides in its message), so the error is printed whole rather than as a stack. One request is one
 * transaction on the server: if it raises, nothing it did survives.
 */
import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const file = process.argv[2] ?? ''
if (file === '') {
  console.error('usage: tsx scripts/p2/run-file.ts <file.sql>')
  process.exit(2)
}
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const started = Date.now()
try {
  const r = await db.execute(readFileSync(file, 'utf8'))
  for (const row of r.rows as Record<string, unknown>[]) console.log(Object.values(row).join(' | '))
  console.log(`-- ok in ${String(Date.now() - started)} ms`)
} catch (e) {
  console.log(String((e as Error).message))
  console.log(`-- raised after ${String(Date.now() - started)} ms`)
  process.exit(1)
}

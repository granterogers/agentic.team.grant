/**
 * Run one SQL file against the database. A scratch tool for sabotage controls.
 *
 * Inside the repository so `"type": "module"` applies — CLAUDE.md records that
 * a scratch script outside it fails on top-level await under CJS.
 */
import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const path = process.argv[2]
if (path === undefined) {
  console.error('usage: tsx scripts/scratch/exec.ts <file.sql>')
  process.exit(2)
}
await db.execute(readFileSync(path, 'utf8'))
console.log(`applied ${path}`)

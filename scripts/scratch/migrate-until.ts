// Deployment helper (#381): apply pending migrations up to and including ONE
// named file, through the repository's own runner, so each can be checked
// before the next. `npm run migrate` afterwards rewrites migrations/applied.json.
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { runMigrations } from '../../src/migrations/runner.ts'

const target = process.argv[2] ?? ''
if (!/^\d{4}_/.test(target)) throw new Error('name the migration file to stop at')
const names = (await readdir('migrations')).filter((n) => n.endsWith('.sql') && n <= target)
if (!names.includes(target)) throw new Error(`${target} is not in migrations/`)
const files = await Promise.all(
  names.map(async (name) => ({ name, sql: await readFile(join('migrations', name), 'utf8') })),
)
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const r = await runMigrations(
  files,
  db,
  (s: string) => createHash('sha256').update(s, 'utf8').digest('hex'),
  (m) => console.log(m),
)
console.log(`applied: ${r.applied.join(', ') || 'none'}`)

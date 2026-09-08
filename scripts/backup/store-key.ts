/**
 * Put the Supabase service role key in the vault, without printing it.
 *
 *   SUPABASE_SERVICE_ROLE_KEY='…' npm run backup:store-key
 *
 * Storage is the only thing that needs this key and §15 says the vault is
 * where a secret lives. It arrives through the environment rather than as an
 * argument, because argv is world-readable in `ps`, and it is never echoed —
 * the script confirms the length and the last four characters and nothing
 * more, which is enough to tell a paste error from a wrong key.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
if (key === '') {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required (through the environment, not argv)')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
await db.execute(`
  select app.store_secret('supabase.service_role_key', ${lit(key)},
    'Storage access for the nightly backup. Nothing else uses it.')
`)
console.log(
  `stored: ${String(key.length)} characters ending …${key.slice(-4)}. ` +
    'Run `npm run backup:now` to take the first copy.',
)

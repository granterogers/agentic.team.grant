/**
 * Print the session-pooler URI for pg_dump. Used by the backup workflow.
 *
 * The caller MUST mask the output — it contains the database password. The
 * workflow does so with `::add-mask::` before the value is used anywhere.
 */
import { buildPoolerUri, fetchPoolerConfig } from './resolve-connection.ts'

const directUrl = process.env.SUPABASE_DB_URL
const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'

if (directUrl === undefined || directUrl === '') {
  console.error('SUPABASE_DB_URL is not set')
  process.exit(2)
}
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}

const pooler = await fetchPoolerConfig(ref, token)
process.stdout.write(buildPoolerUri(directUrl, pooler))

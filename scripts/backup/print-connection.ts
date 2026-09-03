/**
 * Print the session-pooler URI for pg_dump. Used by the backup workflow.
 *
 * The caller MUST mask the output — it contains the database password. The
 * workflow does so with `::add-mask::` before the value is used anywhere.
 */
import { buildPoolerUri, fetchPoolerConfig } from './resolve-connection.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'

// The password comes from SUPABASE_DB_PASSWORD (loaded from the vault) or, as a
// fallback for a local run, extracted from SUPABASE_DB_URL. Accepting either
// means this works in CI, where only the vault path exists, and from a session
// that still has the URL in its environment.
const password =
  process.env.SUPABASE_DB_PASSWORD ??
  (process.env.SUPABASE_DB_URL === undefined || process.env.SUPABASE_DB_URL === ''
    ? undefined
    : decodeURIComponent(new URL(process.env.SUPABASE_DB_URL).password))

if (password === undefined || password === '') {
  console.error('neither SUPABASE_DB_PASSWORD nor SUPABASE_DB_URL is available')
  process.exit(2)
}
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}

const pooler = await fetchPoolerConfig(ref, token)
// buildPoolerUri takes a URL for convenience; hand it a minimal one carrying
// just the password, since that is the only part of it that is ever used.
process.stdout.write(
  buildPoolerUri(`postgresql://x:${encodeURIComponent(password)}@placeholder/postgres`, pooler),
)

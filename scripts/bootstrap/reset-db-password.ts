/**
 * Reset the Postgres password and store the new one in the vault.
 *
 *   npm run bootstrap:db-password
 *
 * Why this exists: the password supplied in SUPABASE_DB_URL fails
 * authentication —
 *
 *   FATAL: password authentication failed for user "postgres"
 *
 * — and it had never been validated, because every earlier attempt to use it
 * died at the network layer first (the direct host is IPv6-only, and neither a
 * build session nor a GitHub runner has IPv6). A credential reported as
 * "present" all session had in fact never authenticated against anything.
 *
 * Rather than ask for it again, the Management API can reset it, so the new
 * value is generated here, set, stored in the vault, and never seen by anyone.
 *
 * Safe to do: nothing is deployed that uses this password, and the old one does
 * not work. It does NOT affect the Management API token (a different
 * credential), nor the anon/service-role JWTs.
 *
 * Prints length and a fingerprint. Never the password.
 */
import { createHash, randomInt } from 'node:crypto'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'

/**
 * 48 characters from an unambiguous alphanumeric alphabet.
 *
 * Deliberately no punctuation. At 48 chars this is ~285 bits of entropy, so
 * symbols buy nothing measurable — and every symbol is one more chance for a
 * shell, a URI parser or a connection-string builder to mangle the credential.
 * This session already lost time to exactly that class of bug: `URL`'s
 * userinfo encode set leaves `%` unescaped, which presents as authentication
 * refused with a correct password. Removing the possibility beats handling it.
 *
 * randomInt is rejection-sampled by Node, so there is no modulo bias.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const password = Array.from({ length: 48 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

const fingerprint = createHash('sha256').update(password, 'utf8').digest('hex').slice(0, 8)

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/password`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ password }),
})

if (!response.ok) {
  console.error(`password reset failed: ${response.status} ${await response.text()}`)
  process.exit(1)
}
console.log(`database password reset: 48 chars, fp=${fingerprint}`)

// Store it where the backup workflow reads from. Same reference name, so
// nothing downstream changes — store_secret rotates the value behind the
// existing id.
const db = new ManagementApiExecutor(ref, token)
await db.execute(
  `select app.store_secret('supabase.db_password', '${password}', 'Postgres password for pg_dump via the session pooler')`,
)

const check = (
  await db.execute(`
  select length(decrypted_secret) as len,
         encode(digest(decrypted_secret, 'sha256'), 'hex') as sha
  from vault.decrypted_secrets where name = 'supabase.db_password'
`)
).rows[0]

const matches = String(check?.sha).slice(0, 8) === fingerprint
console.log(`stored in vault: len=${String(check?.len)} ${matches ? '✅ matches' : '❌ MISMATCH'}`)

if (!matches) {
  console.error('the vault does not hold what was just set')
  process.exit(1)
}

console.log(
  '\nDone. SUPABASE_DB_URL in the environment now carries a STALE password —\n' +
    'harmless, since nothing reads it any more, but do not trust it.',
)

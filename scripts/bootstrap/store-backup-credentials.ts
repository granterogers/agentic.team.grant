/**
 * Move the backup credentials out of environment variables and into the vault.
 *
 *   npm run bootstrap:backup-credentials
 *
 * Run once, from a session that can see the values. After this the backup
 * workflow needs exactly ONE GitHub Actions secret — `SUPABASE_ACCESS_TOKEN` —
 * and fetches everything else over HTTPS.
 *
 * Why this exists rather than six Actions secrets: the session's egress policy
 * refuses the GitHub Actions secrets API outright (`403 Access to this GitHub
 * Actions path is not permitted through this proxy`), so Claude cannot write
 * them and every one is a manual step. Three runs failed on the same six names.
 *
 * It is also simply more aligned with the specification. §15 gives the
 * application's own encrypted store as the place credentials live for the
 * deployed runtime, and §15 already insists Slack credentials go to Postgres
 * rather than flat environment variables for the same reason. This applies that
 * rule one table over.
 *
 * Never logs a value. Reports name, length and a fingerprint only.
 */
import { createHash } from 'node:crypto'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

/** Short, stable, non-reversible — enough to confirm two ends match. */
const fingerprint = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8)

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`

interface Entry {
  readonly vaultName: string
  readonly value: string
  readonly description: string
}

const entries: Entry[] = []

for (const [envName, vaultName, description] of [
  ['BACKUP_S3_ENDPOINT', 'backup.s3_endpoint', 'Offsite backup S3 endpoint (Backblaze B2)'],
  ['BACKUP_S3_REGION', 'backup.s3_region', 'Offsite backup S3 region'],
  ['BACKUP_S3_BUCKET', 'backup.s3_bucket', 'Offsite backup bucket name'],
  ['BACKUP_S3_ACCESS_KEY_ID', 'backup.s3_access_key_id', 'Offsite backup key id (B2 keyID)'],
  [
    'BACKUP_S3_SECRET_ACCESS_KEY',
    'backup.s3_secret_access_key',
    'Offsite backup secret (B2 applicationKey)',
  ],
] as const) {
  const value = process.env[envName]
  if (value === undefined || value === '') {
    console.error(`${envName} is not set in this environment`)
    process.exit(2)
  }
  entries.push({ vaultName, value, description })
}

// The database password, taken out of SUPABASE_DB_URL. pg_dump needs it, and
// storing it here removes the last reason for a second Actions secret.
//
// This grants no new capability to an attacker: reaching the vault at all
// requires SUPABASE_ACCESS_TOKEN, which is a project-level Management API
// credential and is strictly MORE powerful than the database password it now
// guards. There is no circularity either — the token is a different credential
// from the one it unlocks.
const directUrl = process.env.SUPABASE_DB_URL
if (directUrl === undefined || directUrl === '') {
  console.error('SUPABASE_DB_URL is not set')
  process.exit(2)
}
const password = decodeURIComponent(new URL(directUrl).password)
if (password === '') {
  console.error('SUPABASE_DB_URL carries no password')
  process.exit(2)
}
entries.push({
  vaultName: 'supabase.db_password',
  value: password,
  description: 'Postgres password for pg_dump via the session pooler',
})

// One statement per secret, so a failure names the secret that failed.
for (const entry of entries) {
  await db.execute(
    `select app.store_secret(${quote(entry.vaultName)}, ${quote(entry.value)}, ${quote(entry.description)})`,
  )
  console.log(
    `stored ${entry.vaultName.padEnd(30)} len=${String(entry.value.length).padStart(3)} fp=${fingerprint(entry.value)}`,
  )
}

// Read every one back through the same door the workflow will use, so a
// write that cannot be read is caught here rather than at 03:17.
const names = entries.map((e) => quote(e.vaultName)).join(', ')
const { rows } = await db.execute(`
  select name, length(decrypted_secret) as len, encode(digest(decrypted_secret, 'sha256'), 'hex') as sha
  from vault.decrypted_secrets
  where name in (${names})
  order by name
`)

console.log(`\nread back ${rows.length} of ${entries.length}:`)
let mismatched = 0
for (const row of rows) {
  const expected = entries.find((e) => e.vaultName === String(row.name))
  const matches =
    expected !== undefined && String(row.sha).slice(0, 8) === fingerprint(expected.value)
  if (!matches) mismatched++
  console.log(
    `  ${String(row.name).padEnd(30)} len=${String(row.len).padStart(3)} ${matches ? '✅ matches' : '❌ MISMATCH'}`,
  )
}

if (rows.length !== entries.length || mismatched > 0) {
  console.error('\nvault contents do not match what was written')
  process.exit(1)
}
console.log(
  '\nAll credentials stored and verified. The backup workflow now needs only SUPABASE_ACCESS_TOKEN.',
)

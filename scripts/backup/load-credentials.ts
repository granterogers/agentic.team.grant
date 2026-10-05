/**
 * Load the backup credentials from the vault into the workflow environment.
 *
 * Runs inside GitHub Actions. Reads the vault over HTTPS using the single
 * Actions secret that exists — `SUPABASE_ACCESS_TOKEN` — and writes the values
 * to `$GITHUB_ENV` for later steps.
 *
 * Masking is emitted BEFORE any value is written. Actions redacts a masked
 * string from every subsequent log line, so a later step that fails while
 * echoing a command cannot leak a credential. Emitting the mask afterwards
 * would leave a window, and that window is exactly where these things escape.
 */
import '../../src/safety/require-production-checks.ts'
import { appendFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
const githubEnv = process.env.GITHUB_ENV
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
if (githubEnv === undefined) {
  console.error('GITHUB_ENV is not set — this is meant to run inside GitHub Actions')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

/** vault secret name -> environment variable the workflow expects. */
const WANTED: ReadonlyArray<readonly [string, string]> = [
  ['backup.s3_endpoint', 'BACKUP_S3_ENDPOINT'],
  ['backup.s3_region', 'BACKUP_S3_REGION'],
  ['backup.s3_bucket', 'BACKUP_S3_BUCKET'],
  ['backup.s3_access_key_id', 'BACKUP_S3_ACCESS_KEY_ID'],
  ['backup.s3_secret_access_key', 'BACKUP_S3_SECRET_ACCESS_KEY'],
  ['supabase.db_password', 'SUPABASE_DB_PASSWORD'],
]

const names = WANTED.map(([name]) => `'${name}'`).join(', ')
const { rows } = await db.execute(
  `select name, decrypted_secret from vault.decrypted_secrets where name in (${names})`,
)

const found = new Map(rows.map((r) => [String(r.name), String(r.decrypted_secret)]))

const missing = WANTED.filter(([name]) => !found.has(name)).map(([name]) => name)
if (missing.length > 0) {
  console.error(
    `missing from the vault: ${missing.join(', ')}\n` +
      'Run `npm run bootstrap:backup-credentials` from a session that can see the values.',
  )
  process.exit(1)
}

const lines: string[] = []
for (const [vaultName, envName] of WANTED) {
  const value = found.get(vaultName) as string
  // Mask first. Never print the value itself.
  console.log(`::add-mask::${value}`)
  lines.push(`${envName}=${value}`)
  console.log(`loaded ${envName} (${value.length} chars) from ${vaultName}`)
}

appendFileSync(githubEnv, `${lines.join('\n')}\n`, 'utf8')
console.log(`\n${WANTED.length} credentials loaded from the vault.`)

/**
 * Turn Grant's one-time EmbeddedSetup token into a durable, vaulted credential.
 *
 *   npm run notebook:bootstrap
 *
 * Reads `NOTEBOOK_ACCOUNT_EMAIL` and `NOTEBOOK_OAUTH_TOKEN`, exchanges them for
 * a master token plus a freshly minted cookie jar, checks the jar actually
 * authenticates, and vaults both.
 *
 * The master token is what makes this worth doing: it re-mints the cookie jar
 * with no browser whenever `__Secure-1PSIDTS` rotates. A cookie export cannot,
 * which is why the export path died within the hour.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { operatorOffice } from '../../src/db/office.ts'
import { recordProbe } from '../../src/notebook/sync-queue.ts'

const run = promisify(execFile)

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const email = (process.env.NOTEBOOK_ACCOUNT_EMAIL ?? '').trim()
const oauthToken = (process.env.NOTEBOOK_OAUTH_TOKEN ?? '').trim()
if (email === '' || oauthToken === '') {
  console.error(
    'NOTEBOOK_ACCOUNT_EMAIL and NOTEBOOK_OAUTH_TOKEN are required.\n' +
      'See docs/poc/gate-2-notebook/01-what-grant-does.md',
  )
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

interface BootstrapOutput {
  ok?: boolean
  detail?: string
  master_token?: string | null
  android_id?: string | null
  storage_state?: string | null
  account?: string | null
  /** Set when the exchange succeeded but a read-back failed: the minted files
   *  are still on disk at this path rather than cleaned up, because the
   *  oauth_token that bought them is single-use and cannot be spent twice. */
  recovery_dir?: string | null
  /** Set when the exchange itself failed because the token was already used. */
  spent?: boolean
}

console.log(`exchanging the one-time token for ${email}...`)

let output: BootstrapOutput
try {
  const { stdout } = await run('python3', ['scripts/notebook/bootstrap-master-token.py'], {
    // Through the environment, never argv: argv is world-readable in `ps`, and
    // both of these are full-account credentials.
    env: { ...process.env },
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180_000,
  })
  const lines = stdout
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '')
  output = JSON.parse(String(lines[lines.length - 1])) as BootstrapOutput
} catch (error) {
  console.error(`the bootstrap could not run: ${(error as Error).message.slice(0, 400)}`)
  process.exit(1)
}

console.log(`  ${output.detail ?? ''}`)

if (typeof output.recovery_dir === 'string' && output.recovery_dir !== '') {
  // The exchange succeeded and something after it did not. The files have
  // deliberately NOT been cleaned up: the token that paid for them is spent.
  console.log(
    `\n⚠ the minted credential is still on disk at ${output.recovery_dir}\n` +
      '  It was NOT deleted, because the oauth_token that bought it is single-use.',
  )
}

if (output.ok !== true || typeof output.storage_state !== 'string') {
  console.error(
    output.spent === true
      ? '\nnothing was minted; the token needs replacing before retrying.'
      : '\nnothing was stored.',
  )
  process.exit(1)
}

const storageState = output.storage_state
const masterToken = output.master_token

// --- does the minted jar authenticate? ------------------------------------
// The same gate the cookie import has, for the same reason: a credential that
// was produced without error is not a credential that works, and this build
// has confused those five times.
{
  let alive = false
  let detail = ''
  try {
    const { stdout } = await run('python3', ['scripts/notebook/liveness.py'], {
      env: { ...process.env, NOTEBOOK_CANDIDATE_STATE: storageState },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 90_000,
    })
    const parsed = JSON.parse(stdout.trim()) as { alive?: boolean; detail?: string }
    alive = parsed.alive === true
    detail = String(parsed.detail ?? '')
  } catch (error) {
    detail = `the liveness check could not run: ${(error as Error).message.slice(0, 150)}`
  }
  console.log(`  liveness: ${detail}`)
  if (!alive) {
    console.error(
      '\nthe minted jar does not authenticate, so nothing has been stored.\n' +
        '  The exchange succeeded but the resulting session is unusable, which\n' +
        '  points at the account rather than at the token.',
    )
    process.exit(1)
  }
}

// --- vault both -----------------------------------------------------------
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

await db.execute(`
  select app.store_secret('notebook.storage_state', ${lit(storageState)},
    'NotebookLM cookie jar, minted from the master token. Re-mintable without a browser.')
`)

if (typeof masterToken === 'string' && masterToken !== '') {
  await db.execute(`
    select app.store_secret('notebook.master_token', ${lit(masterToken)},
      'Durable Google master token (aas_et/) for the dedicated NotebookLM account. Full-account and long-lived - dedicated account only.')
  `)
  if (typeof output.android_id === 'string' && output.android_id !== '') {
    // Needed alongside the token to re-mint: the token is bound to the device
    // id it was issued for, so storing one without the other is storing a
    // credential that cannot be used.
    await db.execute(`
      select app.store_secret('notebook.android_id', ${lit(output.android_id)},
        'Device id the master token is bound to. Re-minting needs both.')
    `)
  }
}

const stored = await db.execute(`
  select name, length(decrypted_secret) as len
  from vault.decrypted_secrets where name like 'notebook.%' order by name
`)
console.log('\nvaulted:')
for (const row of stored.rows) {
  console.log(`  ${String(row.name)} (${String(row.len)} chars)`)
}

if (typeof masterToken !== 'string' || masterToken === '') {
  console.log(
    '\n⚠ no master token was persisted. The cookie jar works now but cannot\n' +
      '  re-mint itself, so it will die when 1PSIDTS rotates - which is the\n' +
      '  problem this path exists to solve. Worth investigating before relying on it.',
  )
}

await recordProbe(
  db,
  {
    state: 'auth_required',
    capabilities: [],
    adapter: 'notebooklm-py',
    adapterVersion: null,
    detectedTier: null,
    notebookLimit: null,
    sourceLimit: null,
    detail: 'a master-token-minted jar was vaulted; no NotebookLM call has been made with it yet',
    latencyMs: null,
  },
  await operatorOffice(db, process.env.OFFICE_ID),
)

console.log('\nNext: `npm run notebook:probe`, then `npm run poc:gate-2`.')
console.log('The adapter stays auth_required until a real NotebookLM call succeeds.')

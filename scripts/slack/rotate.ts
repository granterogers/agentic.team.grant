/**
 * Rotate the Slack config-token pair and persist it in the vault.
 *
 *   npm run slack:rotate             rotate if within an hour of expiry
 *   npm run slack:rotate -- --force  rotate regardless
 *   npm run slack:rotate -- --status only report
 *
 * Reads the pair from the vault, falling back to the bootstrap environment on
 * first run — exactly §15's split: the human-provided pair enters through the
 * bootstrap store once, and its rotating state lives in the database after.
 *
 * The refresh token is single-use, so the order of operations is the design:
 * persist what we have, rotate, persist the new pair, and only THEN verify.
 * Verifying before persisting is the natural order and is wrong — a
 * verification failure after a successful rotation would leave the new pair
 * only in memory, and only a human could recover.
 *
 * Never logs a token: length, expiry and an 8-char fingerprint only.
 */
import { createHash } from 'node:crypto'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { RotationError, TokenPair } from '../../src/slack/rotation.ts'
import { rotateTokens, secondsUntilExpiry, shouldRotate } from '../../src/slack/rotation.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const APP_ID = 'A0BUFRVSSLD'
const fp = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex').slice(0, 8)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const store = async (name: string, value: string, description: string): Promise<void> => {
  await db.execute(`select app.store_secret(${lit(name)}, ${lit(value)}, ${lit(description)})`)
}
const read = async (name: string): Promise<string | null> => {
  const { rows } = await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = ${lit(name)}`,
  )
  return rows[0]?.v === undefined ? null : String(rows[0].v)
}

const stateRow = (
  await db.execute(`
  select config_token_expires_at, rotation_failures
  from public.slack_app_credentials where slack_app_id = '${APP_ID}'
`)
).rows[0]

let refreshToken = await read('slack.config_refresh_token')
let source = 'vault'
if (refreshToken === null) {
  refreshToken = process.env.SLACK_APP_CONFIG_REFRESH_TOKEN ?? null
  source = 'bootstrap environment'
}
if (refreshToken === null || refreshToken === '') {
  console.error(
    'no refresh token in the vault or the environment.\n' +
      'A human must regenerate the pair at https://api.slack.com/apps',
  )
  process.exit(1)
}

const expiresAt =
  stateRow?.config_token_expires_at === undefined || stateRow.config_token_expires_at === null
    ? 0
    : Math.floor(new Date(String(stateRow.config_token_expires_at)).getTime() / 1000)

console.log(`refresh token source: ${source} (len ${refreshToken.length}, fp ${fp(refreshToken)})`)
console.log(
  expiresAt === 0
    ? 'recorded expiry: none — never rotated through this path'
    : `recorded expiry: ${new Date(expiresAt * 1000).toISOString()} (${String(secondsUntilExpiry(expiresAt))}s away)`,
)
console.log(`rotation failures so far: ${String(stateRow?.rotation_failures ?? 0)}`)

if (process.argv.includes('--status')) process.exit(0)
if (expiresAt !== 0 && !shouldRotate(expiresAt) && !process.argv.includes('--force')) {
  console.log('\nnot due yet; pass --force to rotate anyway')
  process.exit(0)
}

// 1. Durable copy BEFORE consuming a single-use credential. Costs nothing.
await store(
  'slack.config_refresh_token',
  refreshToken,
  'Slack config refresh token (pre-rotation copy)',
)
console.log('\ncurrent refresh token persisted before rotating')

// 2. Rotate.
let pair: TokenPair
try {
  pair = await rotateTokens(refreshToken)
} catch (error) {
  const rotation = error as RotationError
  await db.execute(`
    update public.slack_app_credentials
    set rotation_failures = rotation_failures + 1,
        last_rotation_error = ${lit(rotation.message.slice(0, 400))}
    where slack_app_id = '${APP_ID}'
  `)
  console.error(`\nrotation FAILED: ${rotation.message}`)
  if (rotation.needsHuman) {
    console.error(
      'Unrecoverable by retry — the refresh token itself is dead.\n' +
        'A human must regenerate the pair: https://api.slack.com/apps → Your App Configuration Tokens',
    )
  }
  process.exit(1)
}

// 3. Persist the new pair immediately, before touching anything else.
await store('slack.config_token', pair.accessToken, 'Slack config access token (rotates ~12h)')
await store('slack.config_refresh_token', pair.refreshToken, 'Slack config refresh token')

const refFor = async (name: string): Promise<string> =>
  String(
    (await db.execute(`select id::text as id from vault.secrets where name = ${lit(name)}`)).rows[0]
      ?.id,
  )

await db.execute(`
  insert into public.slack_app_credentials
    (slack_app_id, team_id, app_name, config_token_ref, config_refresh_ref,
     config_token_expires_at, config_token_rotated_at, rotation_failures, last_rotation_error)
  values ('${APP_ID}', 'T0BUCJ2L5FD', 'AI Team HQ',
          '${await refFor('slack.config_token')}'::app.vault_secret_ref,
          '${await refFor('slack.config_refresh_token')}'::app.vault_secret_ref,
          to_timestamp(${pair.expiresAt}), now(), 0, null)
  on conflict (slack_app_id) do update
    set config_token_ref = excluded.config_token_ref,
        config_refresh_ref = excluded.config_refresh_ref,
        config_token_expires_at = excluded.config_token_expires_at,
        config_token_rotated_at = now(),
        rotation_failures = 0,
        last_rotation_error = null
`)

console.log(
  `rotated and persisted: access len ${pair.accessToken.length} fp ${fp(pair.accessToken)}, ` +
    `refresh len ${pair.refreshToken.length} fp ${fp(pair.refreshToken)}`,
)
console.log(
  `new expiry: ${new Date(pair.expiresAt * 1000).toISOString()} ` +
    `(${String(Math.round(secondsUntilExpiry(pair.expiresAt) / 3600))}h away)`,
)

// 4. Only now verify.
const check = await fetch('https://slack.com/api/apps.manifest.export', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${pair.accessToken}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({ app_id: APP_ID }).toString(),
})
const verified = (await check.json()) as {
  ok: boolean
  error?: string
  manifest?: { display_information?: { name?: string } }
}
if (!verified.ok) {
  console.error(`\npersisted, but the rotated token does not work: ${verified.error ?? '?'}`)
  process.exit(1)
}
console.log(
  `\nverified: apps.manifest.export ok, app "${verified.manifest?.display_information?.name ?? '?'}"`,
)

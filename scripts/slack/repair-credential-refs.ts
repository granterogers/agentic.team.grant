/**
 * Point the Slack credential references at secrets that exist.
 *
 *   npm run slack:repair-refs
 *
 * ## What was wrong
 *
 * `slack_app_credentials.bot_token_ref` held a uuid for a vault secret that had
 * been replaced, so the reference pointed at nothing. `signing_secret_ref` was
 * null while `slack.signing_secret` sat in the vault unlinked. Rotation refused
 * to proceed, correctly — a foreign key onto the vault is exactly the check
 * that should stop this.
 *
 * `public.credential_health` had been reporting `DANGLING` for that row the
 * whole time. Nobody read it. That is the same shape as the backup rehearsal
 * that failed twelve nights running: **a health view nobody looks at is not a
 * health check**, and the durable fix is not this script — it is the assertion
 * added to `verify:credentials` so the next one is caught rather than
 * discovered.
 *
 * Idempotent: it stores the current value, repoints the reference, and says
 * what it changed. Running it twice changes nothing the second time.
 */

import '../../src/safety/require-production-writes.ts'
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
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const APP = process.env.SLACK_APP_ID ?? 'A0BUFRVSSLD'

/** Store (or update) a secret and return its id. `store_secret` is idempotent by name. */
const store = async (name: string, value: string, description: string): Promise<string> => {
  await db.execute(`select app.store_secret(${lit(name)}, ${lit(value)}, ${lit(description)})`)
  const { rows } = await db.execute(
    `select id::text as id from vault.secrets where name = ${lit(name)}`,
  )
  return String((rows[0] as { id?: string } | undefined)?.id)
}

const repairs: string[] = []

for (const [column, envName, secretName, description] of [
  [
    'bot_token_ref',
    'SLACK_BOT_TOKEN',
    'slack.bot_token',
    'Bot user OAuth token for the AI Team HQ app. §15: per-app credentials live in Postgres, one row per app.',
  ],
  [
    'signing_secret_ref',
    'SLACK_SIGNING_SECRET',
    'slack.signing_secret',
    'X-Slack-Signature verification — the only authentication the events endpoint has',
  ],
  [
    'client_secret_ref',
    'SLACK_CLIENT_SECRET',
    'slack.client_secret',
    'OAuth client secret for the AI Team HQ app',
  ],
] as const) {
  const value = process.env[envName] ?? ''
  const { rows } = await db.execute(`
    select ${column}::text as ref,
           (${column} is not null and not exists (
              select 1 from vault.secrets s where s.id = ${column}
           )) as dangling
    from public.slack_app_credentials where slack_app_id = ${lit(APP)}
  `)
  const state = rows[0] as { ref: string | null; dangling: boolean } | undefined
  const needsWork = state === undefined || state.ref === null || state.dangling

  if (!needsWork) {
    console.log(`  ${column}: already linked`)
    continue
  }
  if (value === '') {
    console.log(
      `  ${column}: ${state?.dangling === true ? 'DANGLING' : 'unset'}, and ${envName} is not available — left alone`,
    )
    continue
  }

  const id = await store(secretName, value, description)
  await db.execute(`
    update public.slack_app_credentials
       set ${column} = ${lit(id)}::uuid
     where slack_app_id = ${lit(APP)}
  `)
  repairs.push(`${column} → ${secretName}`)
  console.log(
    `  ${column}: ${state?.dangling === true ? 'was DANGLING' : 'was unset'} → now ${secretName}`,
  )
}

const health = await db.execute(`
  select column_name, status from public.credential_health
  where slack_app_id = ${lit(APP)} order by column_name
`)
console.log('\ncredential_health:')
for (const r of health.rows) console.log(`  ${String(r.column_name)}: ${String(r.status)}`)
const bad = health.rows.filter((r) => r.status === 'DANGLING')
console.log(
  `\n${repairs.length === 0 ? 'nothing to repair' : `repaired ${String(repairs.length)}: ${repairs.join(', ')}`}`,
)
if (bad.length > 0) process.exit(1)

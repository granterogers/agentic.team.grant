import { ManagementApiExecutor } from './src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const token = String(
  (
    await db.execute(`select app.resolve_secret(bot_token_ref) as t
       from public.slack_app_credentials where enabled and revoked_at is null limit 1`)
  ).rows[0]?.t,
)
const r = (await (
  await fetch('https://slack.com/api/auth.test', {
    headers: { Authorization: `Bearer ${token}` },
  })
).json()) as Record<string, unknown>
console.log(
  'scopes:',
  (
    await (
      await fetch('https://slack.com/api/apps.permissions.scopes.list', {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).text()
  ).slice(0, 200),
)
console.log('auth:', JSON.stringify(r).slice(0, 200))

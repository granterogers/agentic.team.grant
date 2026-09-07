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
const user = String(
  (
    await db.execute(
      "select value #>> '{}' as u from public.system_config where key = 'slack.subject_user_id'",
    )
  ).rows[0]?.u,
)
const open = (await (
  await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: user }),
  })
).json()) as { ok?: boolean; error?: string; channel?: { id?: string } }
console.log('conversations.open:', open.ok, open.error ?? open.channel?.id)

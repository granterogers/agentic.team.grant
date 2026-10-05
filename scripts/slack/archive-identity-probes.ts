/**
 * Archive the six channels 0416 created by accident (#187).
 *
 * `verify:identity` builds its subjects through `app.hq_create_project` with
 * deliberately non-fixture names — #45's rule — and 0416 provisioned a channel
 * for each. Two runs produced six real rooms in Grant's workspace. Slack has
 * no delete outside Enterprise Grid, so archiving is the whole of what can be
 * done, and the mapping is deactivated so nothing here points at them.
 *
 * Narrow on purpose: it touches channels named `identity_proof_%` and nothing
 * else, and it says what it did to each one.
 */
import '../../src/safety/require-production-writes.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)

const botToken = String(
  (
    await db.execute(
      `select app.resolve_secret(bot_token_ref) as t
         from public.slack_app_credentials where enabled and revoked_at is null limit 1`,
    )
  ).rows[0]?.t ?? '',
)
if (botToken === '') {
  console.error('no Slack bot token — nothing can be archived from here')
  process.exit(1)
}

const call = async (method: string, body: unknown): Promise<Record<string, unknown>> => {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })
  return (await r.json()) as Record<string, unknown>
}

const rows = (
  await db.execute(`
    select channel_id, channel_name from public.slack_channel_map
     where channel_name like 'identity\\_proof\\_%' and active
     order by channel_name`)
).rows as { channel_id: string; channel_name: string }[]

if (rows.length === 0) {
  console.log('nothing to archive — no live identity_proof channel is mapped.')
  process.exit(0)
}

for (const row of rows) {
  const done = await call('conversations.archive', { channel: row.channel_id })
  const ok = done.ok === true || done.error === 'already_archived'
  console.log(
    `  ${ok ? 'archived' : 'COULD NOT ARCHIVE'} #${row.channel_name}${
      ok ? '' : ` — ${String(done.error)}`
    }`,
  )
  if (ok) {
    /*
      Both columns, because `slack_channel_map_active_iff_not_archived` holds
      them together: `active = false` is only true of a row that says WHEN it
      was archived. The first attempt set one and was refused, which is the
      constraint doing its job — a row claiming to be inactive with no archive
      date is a row nobody can explain later.
    */
    await db.execute(`
      update public.slack_channel_map
         set active = false, archived_at = app.now_utc()
       where channel_id = '${row.channel_id.replace(/'/g, "''")}'`)
  }
}

const left = (
  await db.execute(`
    select count(*)::int as n from public.slack_channel_map
     where channel_name like 'identity\\_proof\\_%' and active`)
).rows[0] as { n: number }
console.log(`\n${String(left.n)} still mapped and active.`)

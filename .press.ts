import { ManagementApiExecutor } from './src/db/executor.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, process.env.SUPABASE_ACCESS_TOKEN ?? '')
const q = async (s: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(s)).rows as Record<string, unknown>[]
const d = (
  await q(`select d.target_ref, d.message_ref, d.correlation_id::text as correlation_id,
      d.account_ref
    from public.deliveries d join public.blockers b on b.job_id = d.job_id
   where d.channel = 'telegram' and d.state = 'sent' and b.state = 'open'
   order by d.created_at desc limit 1`)
)[0]
if (d === undefined) throw new Error('no open request delivered to telegram')
const secret = String(
  (
    await q(
      "select decrypted_secret as s from vault.decrypted_secrets where name = 'telegram.webhook_secret'",
    )
  )[0]?.s ?? '',
)
const res = await fetch(
  `https://${ref}.supabase.co/functions/v1/telegram-webhook?bot=${String(d.account_ref)}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify({
      update_id: Math.floor(Date.now() / 1000),
      callback_query: {
        id: `press-${String(Date.now())}`,
        data: `approve:${String(d.correlation_id)}`,
        from: { id: Number(d.target_ref) },
        message: {
          message_id: Number(d.message_ref),
          chat: { id: Number(d.target_ref), type: 'private' },
        },
      },
    }),
  },
)
console.log(res.status, (await res.text()).slice(0, 110))

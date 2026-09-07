import { ManagementApiExecutor } from './src/db/executor.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, process.env.SUPABASE_ACCESS_TOKEN ?? '')
const q = async (s: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(s)).rows as Record<string, unknown>[]
const secret = String(
  (
    await q(
      "select decrypted_secret as s from vault.decrypted_secrets where name = 'telegram.webhook_secret'",
    )
  )[0]?.s ?? '',
)
const chat = String(
  (await q("select chat_id from public.telegram_chats where subject = 'grant' limit 1"))[0]
    ?.chat_id ?? '',
)
const res = await fetch(
  `https://${ref}.supabase.co/functions/v1/telegram-webhook?bot=${String(process.env.BOT ?? '8842154625')}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify({
      update_id: Math.floor(Date.now() / 1000),
      message: {
        message_id: Math.floor(Date.now() / 1000) % 1_000_000,
        date: Math.floor(Date.now() / 1000),
        chat: { id: Number(chat), type: 'private' },
        from: { id: Number(chat), is_bot: false, first_name: 'Grant' },
        text: process.argv[2] ?? '',
      },
    }),
  },
)
console.log(res.status, (await res.text()).slice(0, 150))

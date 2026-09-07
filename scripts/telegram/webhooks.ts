/**
 * Point every staff bot at the webhook, so they can all hear.
 *
 *   npm run telegram:webhooks
 *
 * Grant asked for a bot per role and for those bots to be two-way. Only the
 * Chief of Staff had a webhook: the other six could send and could not hear,
 * which is half a colleague.
 *
 * One Edge Function serves all of them. Telegram lets each bot register its own
 * URL, so the bot id travels in the query string and the function looks it up
 * (0072) — never trusts it, because the query string would otherwise be a way
 * to file an instruction as any staff member.
 *
 * Idempotent: `setWebhook` is a set, so re-running changes nothing that is
 * already right. Reports what each bot's webhook actually is afterwards, read
 * back with `getWebhookInfo` rather than assumed from the call that set it.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { roster } from '../../src/telegram/roster.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, supabase)
const base = `https://${ref}.supabase.co/functions/v1/telegram-webhook`

const secret = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets
        where name = 'telegram.webhook_secret'`,
    )
  ).rows[0]?.v ?? '',
)
if (secret === '') {
  console.error('no telegram.webhook_secret in the vault; run npm run telegram:configure first')
  process.exit(1)
}

const entries = (await roster(db)).filter((e) => e.enabled && e.hasToken)
console.log(`| | bot | speaks for | webhook |`)
console.log(`|---|---|---|---|`)

let ok = 0
for (const entry of entries) {
  const token = String(
    (
      await db.execute(
        `select app.resolve_secret(token_ref) as t from public.telegram_bots
          where bot_id = '${entry.botId.replace(/'/g, "''")}'`,
      )
    ).rows[0]?.t,
  )
  const url = `${base}?bot=${entry.botId}`

  const set = (await (
    await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret_token: secret,
        // Text and button presses. Deliberately not `edited_message`: an edit
        // is not a new instruction, and treating it as one would carry out the
        // same request twice.
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
      }),
    })
  ).json()) as { ok?: boolean; description?: string }

  // Read back rather than trust the set. A 200 from setWebhook and a webhook
  // Telegram is actually delivering to are different facts.
  const info = (await (
    await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
  ).json()) as {
    result?: { url?: string; last_error_message?: string; pending_update_count?: number }
  }

  const live = info.result?.url === url
  if (live) ok += 1
  console.log(
    `| ${live ? '✅' : '❌'} | @${entry.username} | ${entry.staffSlug ?? '*the pager*'} | ` +
      `${live ? 'listening' : String(set.description ?? info.result?.url ?? 'not set')}` +
      `${info.result?.last_error_message === undefined ? '' : ` — last error: ${info.result.last_error_message}`} |`,
  )
}

console.log(`\n**${String(ok)} of ${String(entries.length)} bots listening.**`)
if (ok < entries.length) process.exit(1)

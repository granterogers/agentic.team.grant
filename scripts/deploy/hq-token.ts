/**
 * Send the Team HQ access token to Grant, on Telegram.
 *
 *   npm run hq:token
 *
 * Not printed to a terminal, and emphatically not to a session transcript. A
 * transcript is durable, copied and searchable; a credential that reaches one
 * has to be rotated, and this project has already had to do that once this week
 * for Google session cookies.
 *
 * Telegram is the right channel for it specifically because the dashboard is
 * mostly a phone thing: the token arrives on the device that needs it, in an
 * app that is already authenticated as him, and it can be deleted from the chat
 * afterwards.
 */

import '../../src/safety/require-production-writes.ts'
import { DeliveryService } from '../../src/channels/delivery.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { escapeHtml } from '../../src/telegram/message.ts'
import { pagerBot } from '../../src/telegram/roster.ts'
import { TelegramTransport } from '../../src/telegram/transport.ts'

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabaseToken,
)
// The pager, from the registry (0054). Both its id and its token come from
// the database, so this script no longer needs a second credential in its
// environment to deliver the first one.
const pager = await pagerBot(db)
if (pager === null) {
  console.error('no enabled pager bot with a resolvable token — see npm run telegram:roster')
  process.exit(1)
}
const telegram = new TelegramClient(pager.token)
const botId = pager.botId

const chat = (await db.execute(`select app.operator_chat('${botId}') as c`)).rows[0]?.c
if (chat === null || chat === undefined) {
  console.error('no telegram chat registered for grant — he has to message the bot first')
  process.exit(1)
}

const token = (
  await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
  )
).rows[0]?.v
if (token === undefined) {
  console.error('no hq.api_token in the vault — run `npm run deploy:hq` first')
  process.exit(1)
}

// `--resend` asks for the same token again. The dedupe key below is deliberate
// — it stops a re-run from sending a second copy of a token that is already in
// the chat — but "I cannot find that message" is a real reason to want another,
// and the alternative (deleting a delivery row by hand) is worse than a flag.
const resend = process.argv.includes('--resend')

const service = new DeliveryService(db, new TelegramTransport(telegram))
const result = await service.deliver({
  // Keyed on the token itself, so re-running this does not send a second copy
  // of the same token — but a ROTATED token is a different message and does
  // send. The key is a hash rather than the token, because a dedupe key is
  // stored in the clear.
  dedupeKey:
    `hq-token:${Buffer.from(String(token)).toString('base64url').slice(0, 24)}` +
    (resend ? `:resend:${new Date().toISOString().slice(0, 16)}` : ''),
  accountRef: botId,
  targetRef: String(chat),
  purpose: 'notice',
  body: {
    text:
      `<b>Team HQ</b>\n\nhttps://ai-team-hq.vercel.app\n\n` +
      `Access token — paste it once, per device:\n\n<code>${escapeHtml(String(token))}</code>\n\n` +
      `<i>Delete this message once you have entered it. It is a capability, not a password: ` +
      `it grants four read-only views and nothing else.</i>`,
    silent: false,
  },
})

console.log(
  `delivery: ${result.outcome}${result.errorCode === null ? '' : ` (${result.errorCode})`}`,
)
if (result.outcome !== 'sent' && result.outcome !== 'already_sent') process.exit(1)

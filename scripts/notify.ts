/**
 * Reach Grant's phone, from a build session.
 *
 *   npm run notify -- "the prototype is ready to look at"
 *   npm run notify -- --decision "React or vanilla — I need a steer"
 *
 * ## Why this exists
 *
 * Grant: *"I want you to set up notifications in this session so that it will
 * prompt me in the iPhone when you need me. So rather me having to launch into
 * Claude, you send a push notification."*
 *
 * The office can already reach him — that is what the pager bot is for — but
 * only for work the office did. A build session had no way to say "I am
 * blocked" or "this is worth looking at" without him first opening the terminal
 * to find out, which is the exact inversion he is objecting to.
 *
 * ## Why Telegram and not the terminal's own notification
 *
 * Both are used; this is the half that survives him closing the laptop. The
 * terminal's push depends on Remote Control being connected, and the whole
 * point is the case where he is not at the machine. Telegram is already on his
 * phone, already authenticated, already the channel the team uses, and already
 * governed by `telegram.only_chief_speaks` — so this goes out as the pager,
 * the same bot that carries everything else he actually reads.
 *
 * ## Deliberately not chatty
 *
 * It goes through `DeliveryService`, so it is deduped, recorded in `deliveries`
 * and visible in the dashboard like every other message. A notification nobody
 * can audit is a notification that quietly becomes noise.
 */

import { DeliveryService } from '../src/channels/delivery.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'
import { TelegramClient } from '../src/telegram/api.ts'
import { escapeHtml } from '../src/telegram/message.ts'
import { pagerBot } from '../src/telegram/roster.ts'
import { TelegramTransport } from '../src/telegram/transport.ts'

const args = process.argv.slice(2)
const needsDecision = args.includes('--decision')
const message = args
  .filter((a) => !a.startsWith('--'))
  .join(' ')
  .trim()

if (message === '') {
  console.error('usage: npm run notify -- [--decision] "what you need to say"')
  process.exit(2)
}

const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN
if (supabaseToken === undefined || supabaseToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabaseToken,
)

const pager = await pagerBot(db)
if (pager === null) {
  console.error('no enabled pager bot — see npm run telegram:roster')
  process.exit(1)
}

const chat = (await db.execute(`select app.operator_chat('${pager.botId}') as c`)).rows[0]?.c
if (chat === null || chat === undefined) {
  console.error('no telegram chat registered for grant')
  process.exit(1)
}

const service = new DeliveryService(db, new TelegramTransport(new TelegramClient(pager.token)))
const result = await service.deliver({
  // Keyed on the minute, so a retry of the same message does not double-send
  // but the same words an hour later do.
  dedupeKey: `build:notify:${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}:${Buffer.from(
    message,
  )
    .toString('base64url')
    .slice(0, 20)}`,
  accountRef: pager.botId,
  targetRef: String(chat),
  purpose: 'notice',
  body: {
    text: needsDecision
      ? `<b>Needs you</b>\n\n${escapeHtml(message)}\n\n<i>Everything else carries on — reply when you can.</i>`
      : `<b>Build</b>\n\n${escapeHtml(message)}`,
    // A decision is worth a buzz. Progress is not.
    silent: !needsDecision,
  },
})

console.log(`notify: ${result.outcome}${result.errorCode === null ? '' : ` (${result.errorCode})`}`)
if (result.outcome !== 'sent' && result.outcome !== 'already_sent') process.exit(1)

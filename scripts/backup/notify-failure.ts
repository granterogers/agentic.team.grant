/**
 * Page Grant when a backup or its rehearsal fails.
 *
 *   npm run backup:notify -- "<what failed>" "<run url>"
 *
 * ## Why this exists
 *
 * The backup workflow failed **twelve times in a row** — every run since it was
 * written — and nobody found out until somebody happened to list the runs while
 * investigating something else. The dumps were landing, so the visible symptom
 * was nothing at all.
 *
 * That is the worst version of this project's recurring defect. Usually the
 * problem is a check that passes without measuring anything. Here the check was
 * FAILING, correctly, loudly, in a place no human ever looks. A red light in an
 * empty room is not a safety mechanism.
 *
 * §16 calls the nightly dump "mandatory infrastructure" and the restore
 * rehearsal "continuous evidence rather than a one-off". Evidence nobody reads
 * is not evidence.
 *
 * ## Why Telegram
 *
 * §12 makes it the pager, this is precisely a pager event, and the bot token is
 * already in the vault — so this needs no new Actions secret, which matters
 * because the whole point is that it must not be the thing that also breaks.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { TelegramClient } from '../../src/telegram/api.ts'
import { escapeHtml } from '../../src/telegram/message.ts'
import { pagerBot } from '../../src/telegram/roster.ts'

const [what, runUrl] = process.argv.slice(2)
const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set; cannot reach the vault to notify')
  process.exit(1)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
// The registry (0054) is where the pager's identity lives now, and the vault
// is where its token lives. The environment is a fallback for a runner that
// has one and no database reachable — not the source of truth, because a copy
// of a rotating credential is a stale copy waiting to be believed.
const pager = await pagerBot(db)
const botToken = pager?.token ?? process.env.TELEGRAM_CHIEF_BOT_TOKEN ?? ''
if (botToken === '') {
  // Say so on stdout and exit 0. A notifier that fails the build it is
  // reporting on turns one problem into two, and the build has already failed.
  console.log('no telegram bot token available; cannot page. The failure stands.')
  process.exit(0)
}

const telegram = new TelegramClient(botToken)
const botId = String(((await telegram.call('getMe')).result as { id: number }).id)
const chat = (await db.execute(`select app.operator_chat('${botId}') as c`)).rows[0]?.c
if (chat === null || chat === undefined) {
  console.log('no telegram chat registered; cannot page. The failure stands.')
  process.exit(0)
}

// Sent directly rather than through DeliveryService: this fires when things are
// broken, and it must not depend on the delivery tables being reachable or
// intact — a backup failure and a database problem are correlated events.
await telegram.call('sendMessage', {
  chat_id: chat,
  parse_mode: 'HTML',
  text:
    `🔴 <b>Backup failed</b>\n\n${escapeHtml(what ?? 'unknown step')}\n\n` +
    `Supabase Free has no backups of its own, so this is the only copy.\n\n` +
    (runUrl === undefined ? '' : `${escapeHtml(runUrl)}`),
  link_preview_options: { is_disabled: true },
})
console.log('paged.')

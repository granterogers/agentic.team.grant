/**
 * What each staff bot is, and whether it works.
 *
 *   npm run telegram:roster
 *
 * Probes every registered bot against Telegram's own `getMe`, so the answer is
 * "this token authenticates right now" rather than "a row exists". Same
 * principle as `npm run inventory`: a status that is stored is a status that
 * drifts.
 *
 * Prints usernames and ids, which are public. Never a token.
 */

import '../../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { roster } from '../../src/telegram/roster.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const entries = await roster(db)

console.log('| | Staff | Bot | Live check |')
console.log('|---|---|---|---|')

let live = 0
for (const entry of entries) {
  let state = '⬜'
  let detail: string
  if (!entry.hasToken) {
    detail = entry.disabledReason ?? 'no token'
  } else if (!entry.enabled) {
    state = '⏸'
    detail = entry.disabledReason ?? 'turned off'
  } else {
    const token = String(
      (
        await db.execute(
          `select app.resolve_secret(token_ref) as t from public.telegram_bots
            where bot_id = '${entry.botId.replace(/'/g, "''")}'`,
        )
      ).rows[0]?.t,
    )
    const me = (await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json()) as {
      ok?: boolean
      result?: { username?: string }
      description?: string
    }
    if (me.ok === true) {
      state = '✅'
      live += 1
      detail = `@${String(me.result?.username)} answers`
    } else {
      state = '⛔'
      detail = String(me.description)
    }
  }
  console.log(`| ${state} | ${entry.staffSlug ?? '*the pager*'} | @${entry.username} | ${detail} |`)
}

const expected = entries.length
console.log(
  `\n**${String(live)} of ${String(expected)} bots answering.**` +
    (live === expected
      ? ''
      : ' The missing ones are made in BotFather (docs/telegram-bot-roster.md) — nothing else waits on them.'),
)

/**
 * Find the private chats that 0097's bug threw away, by asking Telegram.
 *
 *   npm run telegram:recover-chats           # who is reachable, change nothing
 *   npm run telegram:recover-chats -- --go   # write the rows back
 *
 * Grant pressed Start on all seven director bots. Every one of those updates
 * reached the webhook and registered successfully — into the same row, because
 * `telegram_chats` was keyed on `chat_id` alone and a private chat id is the
 * user's id, identical across every bot (0097). Six presses overwrote the
 * seventh and the table ended with one row.
 *
 * 0097 fixes the key. It cannot recover the rows: the updates are gone, and the
 * alternative is asking him to press Start seven more times.
 *
 * ## This does not seed the table
 *
 * 0041's rule — a row here is evidence a human spoke to the bot — still holds,
 * and this obeys it rather than working around it. `getChat` succeeds only for
 * a chat the bot is actually in; for a bot Grant has never opened it returns
 * "chat not found". So the row is written on Telegram's own confirmation that
 * the conversation exists, which is the same fact the webhook would have
 * recorded. What is being replaced is the delivery mechanism, not the evidence.
 *
 * Only chat ids we already hold are probed, and only against bots in our own
 * roster. It cannot discover a chat, and pointing it at someone else's would
 * need a chat id it has no way to obtain.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'

const go = process.argv.includes('--go')
const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Every chat we know of, and every bot that might also hold it. */
const known = (
  await db.execute(`
    select distinct chat_id, subject from public.telegram_chats
     where chat_type = 'private' and subject is not null
  `)
).rows as { chat_id: string; subject: string }[]

const bots = (
  await db.execute(`
    select b.bot_id, b.username, app.resolve_secret(b.token_ref) as token,
           coalesce(s.name, 'the pager') as who
      from public.telegram_bots b
      left join public.staff s on s.slug = b.staff_slug
     where b.enabled and b.token_ref is not null
     order by b.username
  `)
).rows as { bot_id: string; username: string; token: string; who: string }[]

console.log('| | bot | who | chat |')
console.log('|---|---|---|---|')

let recovered = 0
for (const bot of bots) {
  for (const chat of known) {
    const already = (
      await db.execute(`
        select 1 as x from public.telegram_chats
         where bot_id = ${lit(bot.bot_id)} and chat_id = ${lit(chat.chat_id)}
      `)
    ).rows[0]
    if (already !== undefined) {
      console.log(`| · | @${bot.username} | ${bot.who} | already registered |`)
      continue
    }

    // Telegram's own answer to "are you two talking". Not a guess and not a
    // send: `getChat` writes nothing and messages nobody.
    const answer = (await (
      await fetch(`https://api.telegram.org/bot${bot.token}/getChat?chat_id=${chat.chat_id}`)
    ).json()) as { ok?: boolean; description?: string; result?: { type?: string } }

    if (answer.ok !== true) {
      console.log(`| ❌ | @${bot.username} | ${bot.who} | ${String(answer.description ?? 'no')} |`)
      continue
    }
    if (!go) {
      console.log(`| · | @${bot.username} | ${bot.who} | reachable — would register |`)
      continue
    }

    await db.execute(`
      select app.record_telegram_chat(
        ${lit(chat.chat_id)}, ${lit(String(answer.result?.type ?? 'private'))},
        ${lit(bot.bot_id)}, ${lit(chat.subject)}, null, null, ${lit(chat.chat_id)}
      )
    `)
    recovered += 1
    console.log(`| ✅ | @${bot.username} | ${bot.who} | registered |`)
  }
}

console.log(
  go ? `\n${String(recovered)} chat(s) recovered.` : '\nNothing written. Re-run with --go.',
)

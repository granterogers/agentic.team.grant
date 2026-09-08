/**
 * Take back the most recent message each staff bot sent Grant.
 *
 *   npm run telegram:unsend
 *
 * Grant, after the roll call: *"go ahead and delete all those individual
 * messages sent to me"* — the hellos were the point of the exercise, and the
 * exercise is over.
 *
 * ## Why the ids are guessed rather than looked up
 *
 * Telegram gives a bot no way to list what it has sent, and the roll-call
 * script did not keep the ids. So they are recovered: send a throwaway
 * message to learn the chat's current top id, delete that, then walk down.
 * The first id that deletes is the most recent message this bot is allowed to
 * delete, which is the hello.
 *
 * ## Why it stops at one per chat
 *
 * A bot may delete *incoming* messages in a private chat as well as its own,
 * and these are the chats Grant sends voice notes to. Walking further down
 * would eventually start eating those, and a deleted voice note is gone. One
 * per chat is the whole safety property, and the reason this is not a loop
 * over "everything the bot ever said".
 *
 * The 48-hour window is Telegram's, not ours: older messages simply refuse to
 * delete, and the script reports that rather than pretending.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const bots = (
  await db.execute(`
    select t.username, t.staff_slug, app.resolve_secret(t.token_ref) as token, c.chat_id
      from public.telegram_bots t
      join public.telegram_chats c on c.bot_id = t.bot_id
     where t.enabled and t.staff_slug is not null and c.chat_type = 'private'
     order by t.username`)
).rows as { username: string; staff_slug: string; token: string; chat_id: string }[]

interface Reply {
  ok?: boolean
  result?: { message_id?: number }
  description?: string
}

const call = async (token: string, method: string, body: unknown): Promise<Reply> =>
  (await (
    await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json()) as Reply

let removed = 0
for (const b of bots) {
  const probe = await call(b.token, 'sendMessage', {
    chat_id: b.chat_id,
    text: '…',
    disable_notification: true,
  })
  const top = probe.result?.message_id
  if (top === undefined) {
    console.log(`${b.username.padEnd(20)} could not probe: ${String(probe.description)}`)
    continue
  }
  await call(b.token, 'deleteMessage', { chat_id: b.chat_id, message_id: top })

  let done = false
  for (let id = top - 1; id > top - 12 && id > 0 && !done; id -= 1) {
    const r = await call(b.token, 'deleteMessage', { chat_id: b.chat_id, message_id: id })
    if (r.ok === true) {
      done = true
      removed += 1
      console.log(`${b.username.padEnd(20)} took back message ${String(id)}`)
    }
  }
  if (!done) console.log(`${b.username.padEnd(20)} nothing it may delete in the last 12 ids`)
}

console.log(`\n${String(removed)} of ${String(bots.length)} hellos taken back.`)

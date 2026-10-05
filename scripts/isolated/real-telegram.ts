/**
 * A Telegram turn as the production adapter writes it (#379).
 *
 * `src/channels/telegram.ts` keys a message `telegram:message:<bot>:<chat>:<msg>`,
 * and 0603 trusts it only when <bot> is a bot the office has. The first #378
 * proofs used the four-part key the adapter stopped writing on 7 September, so
 * their "real" controls were not real; this is the one place that says what is.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'

export const BOT = '8967954396'
export const CHAT = '1386648496'

export async function registerBot(db: PgExecutor): Promise<void> {
  /*
    And Grant's chat, as the webhook records it (#381): telegram-webhook calls
    record_telegram_chat for every update BEFORE it normalises anything, so in
    production his chat is always in telegram_chats (for all eight bots on 29
    September). A "real" turn from a chat the office never recorded is the
    shape of a suite that forgot to declare, and the witness says so.
  */
  const recordChat = () =>
    db.execute(`insert into public.telegram_chats (office_id, chat_id, chat_type, bot_id, subject)
      values (app.operator_office(), '${CHAT}', 'private', '${BOT}', 'grant') on conflict do nothing`)
  const exists = await db.execute(`select 1 from public.telegram_bots where bot_id = '${BOT}'`)
  if (exists.rows.length > 0) {
    await recordChat()
    return
  }
  const secret = await db.execute(
    `insert into vault.secrets (name, secret) values ('isolated.chief.bot.${Date.now().toString(36)}', 'isolated-fake-telegram-token') returning id::text as id`,
  )
  const ref = String((secret.rows[0] as { id: string }).id)
  await db.execute(`insert into public.telegram_bots (bot_id, username, staff_slug, is_pager, token_ref)
    values ('${BOT}', 'isolated_chief_bot', 'chief-of-staff', true, '${ref}') on conflict do nothing`)
  await recordChat()
}

/** A fresh message key from Grant's chat, in the adapter's shape. */
export const realTelegramKey = (): string =>
  `telegram:message:${BOT}:${CHAT}:${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`

/**
 * A real turn from Grant's chat, through a production door, enqueued the way
 * the webhook enqueues it. Returns its job: the root that makes work under it
 * Grant's own. A job of a kind no door creates is made as a CHILD of this,
 * which is how production makes one.
 */
export async function realParent(db: PgExecutor): Promise<string> {
  await registerBot(db)
  const key = realTelegramKey()
  const cmd = await db.execute(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (app.operator_office(), app.unnamed_project(app.operator_office()), 'telegram', '${CHAT}:${key.split(':').pop() ?? '1'}', '${CHAT}', 'A real turn for an isolated proof', '${key}', 'grant')
    returning command_id::text as id`)
  const id = String((cmd.rows[0] as { id: string }).id)
  const enq = await db.execute(`set local application_name = 'PostgREST 14.5';
    select public.enqueue_inbound('${id}'::uuid) as v`)
  const v = (enq.rows[0] as { v: unknown }).v
  const parsed = (typeof v === 'string' ? JSON.parse(v) : v) as { job_id?: string }
  if (typeof parsed.job_id !== 'string') throw new Error('the real turn made no job')
  return parsed.job_id
}

/**
 * Fixtures for the approval, authority and question-binding proofs, written with the product's own door and shapes.
 *
 * Every table a turn touches carries a NOT NULL `office_id` now (and an inbound command a `project_id`), and a turn is
 * trusted only when its dedupe key is the shape a production adapter writes (`app.adapter_key_ok`, 0603/1023). The
 * older fixtures inserted rows without either and used keys no adapter writes, so they failed on the first INSERT or
 * were rightly read as "no recognised door". These helpers keep the proofs honest by building the same rows the
 * webhook and `app.say_in_project` build:
 *
 *   - a Telegram turn: `telegram:message:<bot>:<chat>:<msg>` from a registered bot (real-telegram.ts), through the
 *     PostgREST door (`application_name`), enqueued by `public.enqueue_inbound`;
 *   - a dashboard turn: `teamhq:message:<32 hex>`, actor `app.office_actor(office)`;
 *   - a "this question reached him" delivery, with its office.
 *
 * All of it is the OPERATOR office (Grant's own, locally), the office whose roster grants and standing rules the
 * approval policy reads. Nothing here is exported for production use.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'
import { BOT, registerBot } from './real-telegram.ts'

export const OP = 'app.operator_office()'
export const DOOR = "set local application_name = 'PostgREST 14.5';"
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

export interface RealTurn {
  readonly command: string
  readonly job: string
}

/** A turn from a person, through a production door, enqueued the way the adapter enqueues it. */
export async function realTurn(
  db: PgExecutor,
  o: {
    readonly channel: 'telegram' | 'teamhq'
    readonly text: string
    /** The conversation: a numeric Telegram chat id. Ignored for the dashboard, whose conversation is its channel. */
    readonly chat?: string | undefined
    readonly context?: Record<string, unknown> | undefined
  },
): Promise<RealTurn> {
  const context = lit(JSON.stringify(o.context ?? {}))
  let key: string
  let ref: string
  let actor: string
  if (o.channel === 'telegram') {
    await registerBot(db)
    const chat = o.chat ?? '1386648496'
    const msg = String(Math.floor(Math.random() * 9_000_000) + 1_000_000)
    key = `telegram:message:${BOT}:${chat}:${msg}`
    ref = `${chat}:${msg}`
    actor = chat
  } else {
    key = `teamhq:message:${crypto.randomUUID().replace(/-/g, '')}`
    ref = key
    actor = 'app.office_actor(app.operator_office())'
  }
  const subject = o.channel === 'telegram' ? "'grant'" : 'null'
  const cmd = await db.execute(`${DOOR}
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context)
    values (${OP}, app.unnamed_project(${OP}), ${lit(o.channel)}, ${lit(ref)}, ${o.channel === 'telegram' ? lit(actor) : actor},
            ${lit(o.text)}, ${lit(key)}, ${subject}, ${context}::jsonb)
    returning command_id::text as id`)
  const id = String((cmd.rows[0] as { id: string }).id)
  const enq = await db.execute(`${DOOR} select public.enqueue_inbound(${lit(id)}::uuid) as v`)
  const raw = (enq.rows[0] as { v: unknown }).v
  const v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { job_id?: string }
  if (typeof v.job_id !== 'string') throw new Error(`enqueue refused: ${JSON.stringify(raw)}`)
  return { command: id, job: v.job_id }
}

/**
 * "The question reached him" (0622, #394): a `sent` delivery of the job to the chat the reply comes from, naming the
 * job's newest question (0623). The office-carrying copy of shown.ts, which predates `deliveries.office_id`.
 */
export async function markShown(
  db: PgExecutor,
  channel: string,
  chat: string,
  jobId: string,
): Promise<void> {
  if (channel !== 'telegram' && channel !== 'slack') return
  await db.execute(`insert into public.deliveries
    (office_id, channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, lease_expires_at, sent_at, message_ref)
    values (${OP}, ${lit(channel)}, 'shown-${crypto.randomUUID()}', ${lit(channel === 'telegram' ? BOT : 'isolated')}, ${lit(chat)}, 'blocker',
            '${jobId}'::uuid, 'sent', app.now_utc() + interval '1 hour', app.now_utc(), '4242')`)
  await db.execute(`update public.deliveries d set blocker_id = b.blocker_id
      from (select blocker_id from public.blockers where job_id = '${jobId}'::uuid order by created_at desc limit 1) b
     where d.job_id = '${jobId}'::uuid and d.blocker_id is null and d.dedupe_key like 'shown-%'`)
}

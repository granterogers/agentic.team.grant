/**
 * Answering where the instruction came from.
 *
 * Grant asked to talk to the team in Telegram and have them act. The acting is
 * `src/handlers/instruction.ts`; this is the answering, and it matters more
 * than it sounds: an instruction sent to Ines and answered by the pager is a
 * colleague replying through a switchboard, which is the opposite of the
 * "as close as possible to humans" this is for.
 *
 * So a job that came from an inbound command replies:
 *
 *   - in the same chat,
 *   - from the same bot, and
 *   - as a reply to the original message, so a long conversation stays legible.
 *
 * A job that did not come from an inbound command is not this channel's
 * business, and it says so rather than inventing a destination — the combined
 * notifier reports every channel's real outcome, and "not mine" is one.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { HandlerOutput, Job, NotifyOutcome } from '../jobs/worker.ts'
import { TelegramClient } from '../telegram/api.ts'
import { escapeHtml } from '../telegram/message.ts'
import { TelegramTransport } from '../telegram/transport.ts'
import { DeliveryService } from './delivery.ts'
import type { ResultContext } from './notify.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

interface Origin {
  readonly channel: string
  readonly chatId: string
  readonly messageId: string | null
  readonly botId: string
  readonly token: string
  readonly staffName: string | null
}

/** Where this job's instruction arrived, or null when it did not. */
async function originOf(db: SqlExecutor, job: Job): Promise<Origin | null> {
  // Up the parent chain, not just this job. Grant asks the Chief of Staff for
  // an audio overview; the instruction job answers "starting it now", and the
  // job that eventually carries the LINK is a grandchild two steps away with no
  // inbound command of its own. Without this it would have nowhere to reply and
  // the one message Grant actually wanted would go only to Slack.
  const { rows } = await db.execute(`
    with recursive lineage as (
      select job_id, parent_job_id, 0 as depth
        from public.jobs where job_id = ${lit(job.jobId)}::uuid
      union all
      select j.job_id, j.parent_job_id, l.depth + 1
        from public.jobs j join lineage l on j.job_id = l.parent_job_id
       where l.depth < 8
    )
    select c.origin_channel, c.origin_ref, c.addressed_to,
           t.bot_id, app.resolve_secret(t.token_ref) as token,
           s.name as staff_name
      from lineage l
      join public.inbound_commands c on c.job_id = l.job_id
      join public.telegram_chats ch
        on ch.chat_id = split_part(c.origin_ref, ':', 1)
      join public.telegram_bots t on t.bot_id = ch.bot_id
      left join public.staff s on s.slug = c.addressed_to
     where c.origin_channel = 'telegram'
       and t.enabled and t.token_ref is not null
     order by l.depth asc, c.received_at desc
     limit 1
  `)
  const r = rows[0] as
    | {
        origin_ref: string
        bot_id: string
        token: string
        staff_name: string | null
      }
    | undefined
  if (r?.token === undefined || r.token === null) return null
  const [chatId, messageId] = String(r.origin_ref).split(':')
  return {
    channel: 'telegram',
    chatId: String(chatId),
    messageId: messageId === undefined || messageId === '' ? null : messageId,
    botId: String(r.bot_id),
    token: String(r.token),
    staffName: r.staff_name,
  }
}

export function replyChannel(db: SqlExecutor): {
  readonly name: string
  readonly surface: string
  readonly notify: (
    job: Job,
    output: HandlerOutput,
    outputId: string,
    context: ResultContext,
  ) => Promise<NotifyOutcome>
} {
  return {
    name: 'reply',
    // Telegram, same as the pager. Declared so the combined notifier can apply
    // its one-message-per-surface rule: this channel goes first, so a job that
    // came in on Telegram is answered here and the pager stays quiet.
    surface: 'telegram',
    notify: async (job, output, _outputId, context): Promise<NotifyOutcome> => {
      const origin = await originOf(db, job)
      if (origin === null) {
        return { delivered: false, note: 'no inbound telegram message to reply to' }
      }

      const telegram = new TelegramClient(origin.token)
      const service = new DeliveryService(db, new TelegramTransport(telegram))

      // No name banner and no project header. This is a reply in a one-to-one
      // chat with the person's own bot: the chat title already says who is
      // speaking, and repeating it every message is what makes a bot feel like
      // a bot.
      const result = await service.deliver({
        dedupeKey: `job:${job.jobId}:reply`,
        accountRef: origin.botId,
        targetRef: origin.chatId,
        threadRef: origin.messageId,
        purpose: 'result',
        correlationId: job.correlationId,
        jobId: job.jobId,
        staffId: null,
        body: {
          text:
            escapeHtml(output.body.trim()) +
            (context.reviewed
              ? ''
              : '\n\n<i>⚠️ not reviewed yet — I would not rely on this as it stands</i>'),
          silent: false,
        },
      })

      return {
        delivered: result.outcome === 'sent' || result.outcome === 'already_sent',
        note: `replied to ${origin.staffName ?? 'the chat'} on telegram: ${result.outcome}`,
      }
    },
  }
}

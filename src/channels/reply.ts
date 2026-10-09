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
import { deliveryKey } from '../jobs/delivery-key.ts'
import type { HandlerOutput, Job, NotifyOutcome } from '../jobs/worker.ts'
import { TelegramClient } from '../telegram/api.ts'
import { escapeHtml, inlineKeyboard } from '../telegram/message.ts'
import { BOT_FOR_INBOUND } from '../telegram/roster.ts'
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
        from public.jobs
       where job_id = ${lit(job.jobId)}::uuid
         and office_id = app.job_office(${lit(job.jobId)}::uuid)
      union all
      select j.job_id, j.parent_job_id, l.depth + 1
        from public.jobs j join lineage l on j.job_id = l.parent_job_id
       where l.depth < 8
         and j.office_id = app.job_office(${lit(job.jobId)}::uuid)
    )
    select c.origin_channel, c.origin_ref, c.addressed_to,
           t.bot_id, app.resolve_secret(t.token_ref) as token,
           s.name as staff_name
      from lineage l
      join public.inbound_commands c
        on c.job_id = l.job_id and c.office_id = app.job_office(${lit(job.jobId)}::uuid)
      ${BOT_FOR_INBOUND}
      join public.telegram_chats ch
        on ch.office_id = app.job_office(${lit(job.jobId)}::uuid)
       and ch.bot_id = t.bot_id
       and ch.chat_id = split_part(c.origin_ref, ':', 1)
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

/**
 * The text of a reply, as the person reads it.
 *
 * A NOTICE IS NOT AN UNREVIEWED ANSWER. The caption says an answer was drafted and nobody checked it; a notice
 * (`HandlerOutput.notice`: the last word a failed turn owes, an incident) is composed in code and drafts nothing, so
 * telling the person not to rely on it was a caption about a thing that is not there (Version 1 acceptance, journey J:
 * the one apology after every provider failed was followed by it). Decided by the output's KIND, as the pager and Slack
 * already do, never by matching the sentence; a genuine unreviewed model answer keeps its caption.
 */
export function replyText(
  output: Pick<HandlerOutput, 'body' | 'notice'>,
  context: Pick<ResultContext, 'reviewed'>,
): string {
  const heading = output.notice?.heading ?? ''
  return (
    (heading === '' ? '' : `<b>${escapeHtml(heading)}</b>\n\n`) +
    escapeHtml(output.body.trim()) +
    (context.reviewed || output.notice !== undefined
      ? ''
      : '\n\n<i>⚠️ not reviewed yet — I would not rely on this as it stands</i>')
  )
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
        dedupeKey: deliveryKey(job, output, 'reply'),
        accountRef: origin.botId,
        targetRef: origin.chatId,
        threadRef: origin.messageId,
        purpose: 'result',
        correlationId: job.correlationId,
        jobId: job.jobId,
        blockerId: context.blockerId,
        staffId: null,
        body: {
          text: replyText(output, context),
          /*
            The buttons, which this path has never sent.

            Grant: *"the message is sent to me by Telegram from my boss have
            that little thumbs up, thumbs down button at the end of them just
            as a means to confirm or to quickly confirm something or to correct
            something."*

            Every piece of §12's six was built — the keyboard builder, the
            callback parser, the handler that writes to `feedback` — and the
            pager renders them. This channel received `context.actions` all
            along and dropped it on the floor.

            It is the worst one to have missed. This channel declares
            `surface: 'telegram'` and runs BEFORE the pager so that a job
            arriving on Telegram is answered here and the pager stays quiet —
            which means buttons appeared only on messages Grant did not ask
            for, and never on the replies to the ones he sent. Exactly
            backwards, and invisible to every test, because the machinery all
            works and the surface he lives in was the one not calling it.

            `context.actions` rather than a list of our own: `resultContext`
            already decides which apply — dropping Undo when there is nothing
            to undo, swapping the six for approve/decline on an approval — and
            a second list here would drift from it within a month.
          */
          keyboard: inlineKeyboard(context.actions, job.correlationId, context.projectUrl),
          /*
            The file rides on this message, not after it (#66).

            Grant, on a voice note that arrived as two messages: *"try to have
            everything self contained."* A twenty-minute audio overview and the
            sentence explaining it, sent separately, is that failure in the
            other direction — so the transport sends one `sendAudio` with the
            words as its caption.
          */
          ...(output.attachAudio === undefined ? {} : { audio: output.attachAudio }),
          /*
            And a generated artifact, the same way (#258).

            Grant asked for a researched PDF back through Telegram and was told
            the office had no means. This line is where the means arrives, and
            it rides on the answer for the reason above rather than as a second
            message.
          */
          ...(output.attachFile === undefined ? {} : { document: output.attachFile }),
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

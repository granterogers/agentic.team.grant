/**
 * The pager: notifying Grant on Telegram when a job finishes.
 *
 * §12 divides the surfaces by what they are FOR — *"Slack = office · Telegram =
 * pager"* — and this file is where that division stops being a slogan. The
 * Slack notifier and this one deliver the same result and deliberately do not
 * deliver the same message: Slack gets the finding, the provenance line, the
 * unresolved disagreement and six buttons; the pager gets a trimmed summary and
 * the same six buttons, because deciding whether to look IS the pager's whole
 * job.
 *
 * ## The rule that keeps this from becoming spam
 *
 * A result that already reached Grant in Slack does not need to also buzz his
 * phone. Paging is therefore **not** the default: it happens when the
 * notification is important enough to interrupt, which is a decision
 * `app.notification_allowed` already owns for every channel. Asking it per
 * channel is the entire mechanism — no second severity rule, no "and also send
 * to Telegram" flag that drifts from the first.
 *
 * ## Where to page, and why it can be nowhere
 *
 * Telegram forbids a bot messaging anyone who has not messaged it first, so the
 * chat id cannot be configured, seeded or guessed — it appears in
 * `telegram_chats` (0041) the moment Grant says anything to the bot. Until then
 * the honest outcome is `no chat registered`, reported rather than logged and
 * forgotten, because "the pager never pages" is otherwise invisible: an absence
 * looks exactly like a quiet week.
 */

import { DeliveryService } from '../channels/delivery.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { deliveryKey } from '../jobs/delivery-key.ts'
import type { HandlerOutput, Job, NotifyOutcome } from '../jobs/worker.ts'
import type { ActionId } from '../slack/blocks.ts'
import type { TelegramClient } from './api.ts'
import { inlineKeyboard, noticeKeyboard, type PagerMessage, pagerText } from './message.ts'
import { TelegramTransport } from './transport.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export type PagerSeverity = 'trivial' | 'routine' | 'important' | 'urgent' | 'blocker'

export interface PagerOptions {
  /** The bot these chats belong to. A chat id means nothing without it. */
  readonly botId: string
  readonly subject?: string
  readonly projectUrlBase?: string | null
  /**
   * Below this, nothing pages regardless of preferences.
   *
   * A floor, not a preference: §12 makes Telegram the interrupting surface, and
   * a routine result that buzzes a phone teaches Grant to ignore the phone.
   * Preferences can make the pager quieter than this; they cannot make it
   * louder.
   */
  readonly floor?: PagerSeverity
}

const RANK: Readonly<Record<PagerSeverity, number>> = {
  trivial: 0,
  routine: 1,
  important: 2,
  urgent: 3,
  blocker: 4,
}

export interface PagerResult extends NotifyOutcome {
  readonly chatId: string | null
}

export class TelegramPager {
  private readonly delivery: DeliveryService

  constructor(
    private readonly db: SqlExecutor,
    telegram: TelegramClient,
    private readonly options: PagerOptions,
  ) {
    this.delivery = new DeliveryService(db, new TelegramTransport(telegram))
  }

  /** The registered chat for this subject, or null if nobody has spoken yet. */
  async chatFor(job: { readonly jobId: string }, subject?: string): Promise<string | null> {
    // The office is the CLAIMED job's, and the subject defaults to that office's own person - not to a literal.
    const office = `app.job_office(${lit(job.jobId)}::uuid)`
    const { rows } = await this.db.execute(
      `select app.telegram_chat_for(${office}, ${subject === undefined && this.options.subject === undefined ? `app.office_actor(${office})` : lit(subject ?? this.options.subject ?? '')}, ${lit(this.options.botId)}) as chat_id`,
    )
    const chatId = (rows[0] as { chat_id?: string | null } | undefined)?.chat_id
    return chatId === undefined ? null : chatId
  }

  /**
   * Page about a finished job.
   *
   * Returns rather than throws for every ordinary reason not to page. A pager
   * that raises when there is nobody to page turns "nobody has set this up yet"
   * into a job failure.
   */
  async page(input: {
    readonly job: Job
    readonly output: HandlerOutput
    readonly outputId: string
    readonly staffName: string | null
    readonly staffTitle: string | null
    /** The author's row id, so the delivery records who it came from. */
    readonly staffId: string | null
    readonly reviewed: boolean
    /** See `ResultContext.routine`. Optional, and absent means a judgement. */
    readonly routine?: boolean
    readonly severity: PagerSeverity
    readonly actions: readonly ActionId[]
    /** The question the buttons belong to (#396); recorded on the delivery. */
    readonly blockerId?: string | null
  }): Promise<PagerResult> {
    // A reply is not an interruption.
    //
    // When Grant messages a staff bot, that bot answers him in the same chat.
    // Paging him about the answer as well means two notifications for one
    // exchange he started — and the pager exists to interrupt him about things
    // he did NOT ask for. Checked before the floor, because it is a stronger
    // reason to stay quiet than severity is.
    const inbound = await this.db.execute(`
      select 1 from public.inbound_commands
       where office_id = app.job_office(${lit(input.job.jobId)}::uuid)
         and job_id = ${lit(input.job.jobId)}::uuid and origin_channel = 'telegram'
       limit 1
    `)
    if (inbound.rows.length > 0) {
      return {
        delivered: false,
        note: 'not paged: this answers a message Grant sent, and he is already in that chat',
        chatId: null,
      }
    }

    const floor = this.options.floor ?? 'important'
    if (RANK[input.severity] < RANK[floor]) {
      return {
        delivered: false,
        note: `not paged: ${input.severity} is below the pager floor (${floor})`,
        chatId: null,
      }
    }

    const subject = this.options.subject
    const chatId = await this.chatFor(input.job, subject)
    if (chatId === null) {
      return {
        delivered: false,
        note: 'not paged: no telegram chat registered — Grant has not messaged the bot',
        chatId: null,
      }
    }

    // The same rule Slack asks, asked for this channel. One implementation of
    // "should Grant be told", consulted twice.
    const { rows } = await this.db.execute(`
      select app.notification_allowed(app.job_office(${lit(input.job.jobId)}::uuid),
        ${subject === undefined ? `app.office_actor(app.job_office(${lit(input.job.jobId)}::uuid))` : lit(subject)}, 'telegram',
        ${lit(input.severity)}::public.notify_severity,
        ${input.job.projectId === null ? 'null' : `${lit(input.job.projectId)}::uuid`}) as allowed
    `)
    if ((rows[0] as { allowed?: boolean } | undefined)?.allowed !== true) {
      await this.recordNotification(input, 'suppressed')
      return { delivered: false, note: 'not paged: suppressed by preferences', chatId }
    }

    const projectUrl =
      this.options.projectUrlBase === null ||
      this.options.projectUrlBase === undefined ||
      input.job.projectId === null
        ? null
        : `${this.options.projectUrlBase.replace(/\/+$/, '')}/projects/${input.job.projectId}`

    // The project's name, read here rather than passed in. One bot speaks for
    // eight people across every project (Grant's choice, and the right one — a
    // bot per role per project is forty bots), so every page has to say what it
    // is about. A caller that had to remember to pass it is a caller that will
    // forget on the one page that matters.
    const projectName =
      input.job.projectId === null
        ? null
        : ((
            (
              await this.db.execute(
                `select name from public.projects
                  where office_id = app.job_office(${lit(input.job.jobId)}::uuid)
                    and project_id = ${lit(input.job.projectId)}::uuid`,
              )
            ).rows[0] as { name?: string } | undefined
          )?.name ?? null)

    const message: PagerMessage = {
      staffName: input.staffName,
      staffTitle: input.staffTitle,
      projectName,
      body: input.output.body,
      metadata: {
        confidence: input.output.confidence,
        evidence: input.output.evidence,
        reviewed: input.reviewed,
        // Passed through since #186: the provenance line is now the same
        // shared English Slack uses, and it names how many sources there were.
        // Empty here would say "nothing cited" about a cited finding.
        sources: input.output.sources,
        contradictions: input.output.contradictions,
        routine: input.routine ?? false,
      },
      correlationId: input.job.correlationId,
      // A notice is not an answer: nothing to rate, undo or mute (#413). The incident layer is what decides when it is
      // said again, so a Mute button on it would only be a second, worse way to say the same thing.
      actions: input.output.notice === undefined ? input.actions : [],
      projectUrl,
      ...(input.output.notice === undefined
        ? {}
        : {
            notice:
              input.output.notice.heading === undefined
                ? {}
                : { heading: input.output.notice.heading },
          }),
    }

    const result = await this.delivery.deliver({
      // A different key from the Slack delivery of the same result: they are
      // two messages, and one key would mean the second channel silently
      // deduplicated against the first.
      dedupeKey: deliveryKey(input.job, input.output, 'pager'),
      accountRef: this.options.botId,
      targetRef: chatId,
      purpose: 'result',
      staffId: input.staffId,
      correlationId: input.job.correlationId,
      jobId: input.job.jobId,
      blockerId: input.blockerId ?? null,
      body: {
        text: pagerText(message),
        keyboard:
          input.output.notice === undefined
            ? inlineKeyboard(input.actions, input.job.correlationId, projectUrl)
            : noticeKeyboard(input.output.notice.link),
        // An `important` result may arrive at 3am. Anything short of urgent
        // goes in silently: it is on the phone when he looks, without the
        // phone asking to be looked at.
        silent: RANK[input.severity] < RANK.urgent,
      },
    })

    if (result.outcome === 'sent' || result.outcome === 'already_sent') {
      await this.recordNotification(input, 'delivered')
      return { delivered: true, note: `paged on telegram (${input.severity})`, chatId }
    }

    // Telegram telling us the chat is unreachable is durable information, not a
    // transient failure: every future page to it would fail the same way, and
    // the registry is where that belongs.
    if (
      result.errorCode === 'blocked_by_user' ||
      result.errorCode === 'kicked_from_chat' ||
      result.errorCode === 'user_deactivated' ||
      result.errorCode === 'chat_not_found'
    ) {
      await this.db.execute(
        // Scoped to this bot (0097). A chat id is the same number across every
        // bot Grant has opened, so an unscoped mark would silence the whole
        // team because one director was blocked.
        // And to the office of the job that was being paged for (0804): a chat belongs to one office.
        `select app.mark_telegram_undeliverable(app.job_office(${lit(input.job.jobId)}::uuid), ${lit(chatId)}, ${lit(result.errorCode)}, ${lit(this.options.botId)}) as marked`,
      )
    }

    return {
      delivered: false,
      note: `pager ${result.outcome}${result.errorCode === null ? '' : `: ${result.errorCode}`}`,
      chatId,
    }
  }

  private async recordNotification(
    input: { readonly job: Job; readonly outputId: string; readonly severity: PagerSeverity },
    outcome: 'delivered' | 'suppressed',
  ): Promise<void> {
    await this.db.execute(`
      insert into public.notification_events
        (office_id, channel, severity, project_id, subject_kind, subject_ref, outcome)
      values (app.job_office(${lit(input.job.jobId)}::uuid), 'telegram', ${lit(input.severity)}::public.notify_severity,
              ${input.job.projectId === null ? 'null' : `${lit(input.job.projectId)}::uuid`},
              'output', ${lit(input.outputId)}::uuid, ${lit(outcome)})
    `)
  }
}

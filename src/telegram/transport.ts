/**
 * Telegram as a delivery transport.
 *
 * The short file, and the one honest omission in it is the important part:
 * **there is no `reconcile`.**
 *
 * A Telegram bot cannot read its own sent messages back. There is no history
 * endpoint for a bot, `getUpdates` returns incoming updates only, and a sent
 * message carries no field we could search on even if there were. So after an
 * indeterminate `sendMessage` — the response was lost, the message may or may
 * not exist — the question is not merely unanswered, it is unanswerable.
 *
 * `Transport.reconcile` is therefore optional and this class does not implement
 * it. `DeliveryService` then leaves the delivery parked as `failed` forever and
 * reports `unreconcilable`, which is the correct outcome rather than a
 * limitation to work around: never sending it again is the only guarantee
 * available, and it is the safe one. A page that did not arrive is a page Grant
 * does not get; a page sent twice at 3am is worse, and a system that quietly
 * resends on a guess would do the second one every time.
 *
 * Slack can answer the same question, because a bot CAN read channel history
 * and every post carries its dedupe key in Slack's metadata field. Two channels,
 * one failure mode, one remedy — and pretending the remedy generalises would be
 * the bug.
 */

import {
  type SendRequest,
  type SendResult,
  type Transport,
  TransportError,
} from '../channels/delivery.ts'
import { TelegramApiError, type TelegramClient } from './api.ts'

/** What `TelegramTransport` expects in `SendRequest.body`. */
export interface TelegramMessageBody {
  readonly text: string
  readonly keyboard?: readonly (readonly { text: string; callback_data?: string; url?: string }[])[]
  /** A pager should not also ring. Set for anything below `important`. */
  readonly silent?: boolean
}

export class TelegramTransport implements Transport {
  readonly channel = 'telegram' as const

  constructor(private readonly telegram: TelegramClient) {}

  async send(request: SendRequest): Promise<SendResult> {
    const message = request.body as TelegramMessageBody
    const body: Record<string, unknown> = {
      chat_id: request.targetRef,
      text: message.text,
      parse_mode: 'HTML',
      // A pager that unfurls every link it mentions is a pager showing three
      // preview cards instead of a sentence.
      link_preview_options: { is_disabled: true },
      disable_notification: message.silent === true,
    }
    if (request.threadRef !== null) {
      // A reply, which is Telegram's nearest thing to a thread. `allow_sending
      // _without_reply` because a deleted parent must not lose the message.
      body.reply_parameters = {
        message_id: Number(request.threadRef),
        allow_sending_without_reply: true,
      }
    }
    if (message.keyboard !== undefined && message.keyboard.length > 0) {
      body.reply_markup = { inline_keyboard: message.keyboard }
    }

    try {
      const response = await this.telegram.call('sendMessage', body)
      const result = response.result as { message_id?: number } | undefined
      if (result?.message_id === undefined) {
        // `ok: true` with no message id should not happen, and if it does we
        // cannot address the message afterwards — which is the same position an
        // indeterminate send leaves us in, so it is reported the same way.
        throw new TransportError('indeterminate:no_message_id', 'indeterminate')
      }
      return { messageRef: String(result.message_id) }
    } catch (error) {
      if (error instanceof TransportError) throw error
      if (error instanceof TelegramApiError) throw new TransportError(error.code, error.kind)
      throw error
    }
  }

  /**
   * Delete a message.
   *
   * Telegram only allows this within 48 hours, which is a real limit on Undo
   * and not one this code can lift. `message_not_found` counts as success: the
   * desired state is "not there".
   */
  async retract(targetRef: string, messageRef: string): Promise<boolean> {
    try {
      await this.telegram.call('deleteMessage', {
        chat_id: targetRef,
        message_id: Number(messageRef),
      })
      return true
    } catch (error) {
      if (error instanceof TelegramApiError && error.code === 'message_not_found') return true
      return false
    }
  }
}

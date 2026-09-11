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
import { inlineKeyboard } from './message.ts'

/** What `TelegramTransport` expects in `SendRequest.body`. */
export interface TelegramMessageBody {
  readonly text: string
  readonly keyboard?: readonly (readonly { text: string; callback_data?: string; url?: string }[])[]
  /** A pager should not also ring. Set for anything below `important`. */
  readonly silent?: boolean
  /**
   * Suppress the default feedback buttons. Rare, and each use says why.
   *
   * Not a general escape hatch: the default exists because Grant asked for
   * these on everything, and a flag that gets set out of habit puts us back
   * where we were.
   */
  readonly noFeedback?: boolean
}

/*
  Purposes that must NOT get thumbs up and down.

  Two kinds, and both would be worse with them:

  - `ack` is "got it, working on it". Asking whether an acknowledgement was
    useful is noise, and it is the most frequent message the office sends.
  - a credential delivery is a one-off operational message; a 👍 on it records
    nothing anyone will read and puts a button under a secret.

  An APPROVAL request is excluded by a different mechanism — `resultContext`
  already swaps the six buttons for approve/decline, so it arrives with a
  keyboard and the default never applies. That is deliberate: 👍 on "may I
  generate this?" answers nothing.
*/
const NO_FEEDBACK_PURPOSES: ReadonlySet<string> = new Set(['ack'])

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
    /*
      Every message to Grant carries the feedback pair, unless it already has
      buttons of its own.

      Issue #59, and specifically his second time asking:

          "ensure that ALL messages sent to me on Telegram come with that
           little thumbs up, thumbs down button at the end to make it easier to
           provide feedback if the message has been understood or if it
           requires correction."

      The first fix added them to `replyChannel`. That was one of six senders:
      the pager had them, and `progress.ts`, `scripts/notify.ts`,
      `hq-token.ts` and `mcp.ts` did not. Patching each is how the seventh
      sender ships without them, so the default lives here — the one place
      every Telegram message passes through, including ones nobody has written
      yet.

      A caller that supplies its own keyboard wins, so approve/decline and the
      full six are untouched. A caller with nothing to say gets the pair.
    */
    const keyboard =
      message.keyboard !== undefined && message.keyboard.length > 0
        ? message.keyboard
        : message.noFeedback === true ||
            NO_FEEDBACK_PURPOSES.has(request.purpose) ||
            request.correlationId === null
          ? undefined
          : inlineKeyboard(['feedback.useful', 'feedback.not_useful'], request.correlationId, null)

    if (keyboard !== undefined && keyboard.length > 0) {
      body.reply_markup = { inline_keyboard: keyboard }
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

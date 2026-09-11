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
   * Send this as a playable audio file rather than as text (#66).
   *
   * `url` when Telegram can fetch it itself, `bytes` when it cannot — which is
   * the case for anything in our private bucket. Telegram caps a bot upload at
   * 50MB and will not say so kindly, so the caller checks first.
   */
  readonly audio?: {
    readonly url?: string
    readonly bytes?: Uint8Array
    readonly filename: string
    readonly title: string
    readonly performer?: string
    readonly durationSeconds?: number
  }
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

    /*
      A file, sent as a file.

      Issue #66. Grant: *"just directly have the audio file sent to me on
      Telegram that I can play it directly in Telegram rather than necessarily
      having to open notebook."* `sendMessage` was the only method this
      transport used, so the best it could do was a link — which is the trip to
      NotebookLM he was trying to avoid, one click further away.

      `sendAudio` rather than `sendVoice`: a voice note is a waveform bubble
      with no title, which is right for a fifteen-second reply and wrong for a
      twenty-minute overview. `sendAudio` shows the title, the duration and a
      scrubber, and it survives being forwarded.
    */
    if (message.audio !== undefined) return await this.sendAudio(request, message)
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
   * Send a playable audio file.
   *
   * Two paths because Telegram offers two, and which one applies is decided by
   * whether the bytes are reachable from the public internet. A URL is one JSON
   * request; bytes are a multipart upload, and the upload is what a private
   * bucket forces.
   */
  private async sendAudio(request: SendRequest, message: TelegramMessageBody): Promise<SendResult> {
    const audio = message.audio
    if (audio === undefined) throw new TransportError('no_audio', 'terminal')

    const fields: Record<string, string> = {
      chat_id: request.targetRef,
      title: audio.title,
      // The caption carries the words that would otherwise have been the whole
      // message, so nothing is lost by sending a file instead of a sentence.
      caption: message.text.slice(0, 1024),
      parse_mode: 'HTML',
      disable_notification: String(message.silent === true),
      ...(audio.performer === undefined ? {} : { performer: audio.performer }),
      ...(audio.durationSeconds === undefined
        ? {}
        : { duration: String(Math.round(audio.durationSeconds)) }),
    }
    if (request.threadRef !== null) {
      fields.reply_to_message_id = String(Number(request.threadRef))
      fields.allow_sending_without_reply = 'true'
    }

    try {
      let response: { result?: unknown }
      if (audio.url !== undefined && audio.url !== '') {
        // Telegram fetches it. One request, and it fails if the URL is not
        // publicly reachable — which is why a private bucket takes the other
        // path rather than trying this first and falling back.
        response = await this.telegram.call('sendAudio', { ...fields, audio: audio.url })
      } else if (audio.bytes !== undefined) {
        const form = new FormData()
        for (const [k, v] of Object.entries(fields)) form.append(k, v)
        form.append(
          'audio',
          // `Uint8Array` into a Blob, not a Buffer: this runs in Deno as well
          // as Node, and Buffer is not a global there. Bitten three times.
          /*
            The array is widened rather than typed.

            `BlobPart` is a DOM lib name and this project runs `tsc` without
            the DOM lib — deliberately, so a real DOM mistake in Node code
            cannot pass. `Blob` and `FormData` are Node 18+ globals and work
            at runtime; only the part type is missing, so it is the one thing
            widened rather than switching the lib on for the whole project.
          */
          new Blob([audio.bytes] as unknown as ConstructorParameters<typeof Blob>[0], {
            type: 'audio/mpeg',
          }),
          audio.filename,
        )
        response = await this.telegram.callForm('sendAudio', form)
      } else {
        throw new TransportError('audio_has_neither_url_nor_bytes', 'terminal')
      }

      const result = response.result as { message_id?: number } | undefined
      if (result?.message_id === undefined) {
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

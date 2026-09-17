/**
 * Slack as a delivery transport.
 *
 * Everything Slack-specific about sending, and nothing else: the claim, the
 * lease and the recording live in `src/channels/delivery.ts`, which knows about
 * none of this.
 *
 * The message metadata is why Slack can reconcile at all. Every post carries
 * its dedupe key in Slack's own `metadata` field, which comes back on
 * `conversations.history` — so after a lost response we can ask the channel
 * whether the message is there. Without a marker the only way to tell a
 * duplicate from a legitimately similar message is to compare text, and two
 * progress updates a minute apart look identical.
 */

import {
  type SendRequest,
  type SendResult,
  type Transport,
  TransportError,
} from '../channels/delivery.ts'
import { SlackApiError, type SlackClient } from './api.ts'

/** Slack message metadata event type, used for reconciliation. */
export const DELIVERY_EVENT_TYPE = 'ai_team_delivery'

/** What `SlackTransport` expects in `SendRequest.body`. */
export interface SlackMessageBody {
  readonly text: string
  readonly blocks: readonly unknown[]
  /** From `chat:write.customize`; absent for a message from no one. */
  readonly username?: string | null
  readonly iconUrl?: string | null
  readonly iconEmoji?: string | null
  /**
   * Show a threaded reply in the channel as well as in its thread.
   *
   * Slack's `reply_broadcast`. Without it a threaded reply is visible only to
   * someone who opens the thread, and the change that started threading
   * answers under Grant's own questions would have made every answer HARDER
   * to see while making the relationship clearer — a net loss, and the exact
   * shape of defect that passes every check because both halves are correct.
   *
   * Set only when we are STARTING a thread on a message of Grant's. Inside a
   * thread he opened himself he is already watching, and broadcasting every
   * reply into the channel is the noise he complained about wearing a
   * different hat.
   */
  readonly broadcast?: boolean
}

export class SlackTransport implements Transport {
  readonly channel = 'slack' as const

  constructor(private readonly slack: SlackClient) {}

  async send(request: SendRequest): Promise<SendResult> {
    const message = request.body as SlackMessageBody
    const body: Record<string, unknown> = {
      channel: request.targetRef,
      text: message.text,
      blocks: message.blocks,
      metadata: {
        event_type: DELIVERY_EVENT_TYPE,
        event_payload: { dedupe_key: request.dedupeKey },
      },
    }
    if (request.threadRef !== null) {
      body.thread_ts = request.threadRef
      if (message.broadcast === true) body.reply_broadcast = true
    }
    if (message.username !== null && message.username !== undefined) {
      body.username = message.username
    }
    if (message.iconUrl !== null && message.iconUrl !== undefined) body.icon_url = message.iconUrl
    if (message.iconEmoji !== null && message.iconEmoji !== undefined) {
      body.icon_emoji = message.iconEmoji
    }

    try {
      const { body: response } = await this.slack.call('chat.postMessage', body)
      return { messageRef: String(response.ts ?? '') }
    } catch (error) {
      throw toTransportError(error)
    }
  }

  async reconcile(
    targetRef: string,
    dedupeKey: string,
    threadRef?: string | null,
  ): Promise<string | null> {
    const method =
      threadRef === null || threadRef === undefined
        ? 'conversations.history'
        : 'conversations.replies'
    const params: Record<string, unknown> = {
      channel: targetRef,
      limit: 50,
      include_all_metadata: true,
    }
    if (threadRef !== null && threadRef !== undefined) params.ts = threadRef

    const { body } = await this.slack.call(method, params)
    const messages = Array.isArray(body.messages) ? body.messages : []
    for (const raw of messages) {
      const message = raw as {
        ts?: string
        metadata?: { event_type?: string; event_payload?: { dedupe_key?: string } }
      }
      if (
        message.metadata?.event_type === DELIVERY_EVENT_TYPE &&
        message.metadata.event_payload?.dedupe_key === dedupeKey
      ) {
        return message.ts ?? null
      }
    }
    return null
  }

  /**
   * Delete a message.
   *
   * `message_not_found` counts as success: the desired state is "not there",
   * and it is not there.
   */
  async retract(targetRef: string, messageRef: string): Promise<boolean> {
    try {
      await this.slack.call('chat.delete', { channel: targetRef, ts: messageRef })
      return true
    } catch (error) {
      if (error instanceof SlackApiError && error.code === 'message_not_found') return true
      return false
    }
  }
}

const toTransportError = (error: unknown): TransportError => {
  if (error instanceof SlackApiError) return new TransportError(error.code, error.kind)
  throw error
}

/**
 * Composing and sending into the Slack office.
 *
 * What used to be here — the claim, the lease, the recording, the
 * reconciliation — moved to `src/channels/delivery.ts` when Telegram needed the
 * same guarantees. That is the whole of the change: exactly-once delivery is a
 * property of delivery, not of Slack, and two implementations of it would
 * drift.
 *
 * What is left is the part that genuinely IS Slack: turning a result and a
 * staff member into a `chat.postMessage` body, and the channel bookkeeping that
 * only Slack has — rejoining, renames, membership.
 */

import { type DeliveryPurpose, type DeliveryResult, DeliveryService } from '../channels/delivery.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { avatarBaseUrl } from '../staff/presentation.ts'
import { SlackApiError, type SlackClient } from './api.ts'
import type { ResultMessage } from './blocks.ts'
import { fallbackText, resultBlocks } from './blocks.ts'
import type { IdentityOptions, StaffPresentation } from './identity.ts'
import { identityFor } from './identity.ts'
import { type SlackMessageBody, SlackTransport } from './transport.ts'

export { DELIVERY_EVENT_TYPE } from './transport.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * What came of trying to get back into a channel.
 *
 * `needs_reinstall` and `needs_invite` are both "a human must act", kept apart
 * because the humans and the actions differ: one is Grant re-authorising the
 * app with `channels:join`, the other is anybody in the channel inviting it.
 */
export type RejoinOutcome = 'rejoined' | 'needs_invite' | 'needs_reinstall' | 'failed'

export interface SlackDeliveryRequest {
  readonly dedupeKey: string
  readonly teamId: string
  readonly channelId: string
  readonly threadTs?: string | null
  readonly purpose: DeliveryPurpose
  readonly staff: StaffPresentation | null
  readonly staffId?: string | null
  readonly correlationId?: string | null
  readonly jobId?: string | null
  readonly message: ResultMessage
}

export interface SlackDeliveryResult extends DeliveryResult {
  /**
   * The same value as `messageRef`, under the name Slack uses for it.
   *
   * Kept because "ts" is what every Slack API, every log line and every person
   * reading this calls it, and a caller that has to remember the generic name
   * to address a Slack message is a caller that will get it wrong.
   */
  readonly messageTs: string | null
  /** Which of avatar or emoji was used, so a never-hosted avatar is visible. */
  readonly iconSource: string | null
}

export class SlackOffice {
  private readonly delivery: DeliveryService

  constructor(
    private readonly db: SqlExecutor,
    private readonly slack: SlackClient,
    private readonly identityOptions: IdentityOptions = {},
  ) {
    this.delivery = new DeliveryService(db, new SlackTransport(slack))
  }

  /**
   * Build an office that reads the avatar base from configuration.
   *
   * Preferred over the constructor for anything long-lived. A caller that
   * forgets to pass the base gets a working office that silently shows emoji,
   * which is the failure mode this factory exists to remove.
   */
  static async configured(
    db: SqlExecutor,
    slack: SlackClient,
    overrides: IdentityOptions = {},
  ): Promise<SlackOffice> {
    const base = await avatarBaseUrl(db)
    return new SlackOffice(db, slack, { avatarBaseUrl: base, ...overrides })
  }

  async deliver(request: SlackDeliveryRequest): Promise<SlackDeliveryResult> {
    const identity =
      request.staff === null ? null : identityFor(request.staff, this.identityOptions)

    const body: SlackMessageBody = {
      text: fallbackText(request.message),
      blocks: resultBlocks(request.message),
      username: identity?.username ?? null,
      iconUrl: identity?.iconUrl ?? null,
      iconEmoji: identity?.iconEmoji ?? null,
    }

    const result = await this.delivery.deliver({
      dedupeKey: request.dedupeKey,
      accountRef: request.teamId,
      targetRef: request.channelId,
      threadRef: request.threadTs ?? null,
      purpose: request.purpose,
      staffId: request.staffId ?? null,
      correlationId: request.correlationId ?? null,
      jobId: request.jobId ?? null,
      body,
    })

    return { ...result, messageTs: result.messageRef, iconSource: identity?.iconSource ?? null }
  }

  /** See `DeliveryService.resolveIndeterminate`. */
  async resolveIndeterminate(request: {
    readonly deliveryId: string
    readonly channelId: string
    readonly dedupeKey: string
    readonly threadTs?: string | null
  }): Promise<{ readonly resolution: string; readonly messageTs: string | null }> {
    const { resolution, messageRef } = await this.delivery.resolveIndeterminate({
      deliveryId: request.deliveryId,
      targetRef: request.channelId,
      dedupeKey: request.dedupeKey,
      threadRef: request.threadTs ?? null,
    })
    return { resolution, messageTs: messageRef }
  }

  /** Delete a message that should not have been posted. */
  async retract(channelId: string, messageTs: string): Promise<boolean> {
    return this.delivery.retract(channelId, messageTs)
  }

  /**
   * Try to get back into a channel the bot was removed from.
   *
   * This looked like a one-liner and is not, which the live suite established
   * rather than reasoning. For three days the app was installed without
   * `channels:join`, and in that state a bot removed from a public channel
   * could not get back in at all: `conversations.join` returned
   * `missing_scope`, and `conversations.invite` — which `channels:manage` does
   * cover — returns `not_in_channel` when the inviter is the absent bot itself.
   *
   * The scope is installed now and the ordinary path works. The three failure
   * outcomes stay, because the situations they name are all still reachable —
   * a future reinstall could drop the scope, a private channel still needs an
   * invitation, and both are "a human must act" by different humans. Reporting
   * which one beats returning false, which reads as "transient, try later" and
   * would have a caller retrying something that cannot work.
   */
  async rejoin(channelId: string): Promise<RejoinOutcome> {
    try {
      await this.slack.call('conversations.join', { channel: channelId })
      await this.db.execute(
        `select app.record_slack_membership(${lit(channelId)}, true) as changed`,
      )
      return 'rejoined'
    } catch (error) {
      if (!(error instanceof SlackApiError)) throw error
      if (error.code === 'missing_scope') return 'needs_reinstall'
      if (error.code === 'not_in_channel' || error.code === 'is_archived') return 'needs_invite'
      return 'failed'
    }
  }

  /** Note that Slack told us the bot is no longer in a channel. */
  async recordRemoval(channelId: string): Promise<void> {
    await this.db.execute(`select app.record_slack_membership(${lit(channelId)}, false) as changed`)
  }

  /** Note a rename. The id is the identity; this only corrects the label. */
  async recordRename(channelId: string, newName: string): Promise<boolean> {
    const { rows } = await this.db.execute(
      `select app.record_slack_channel_rename(${lit(channelId)}, ${lit(newName)}) as changed`,
    )
    return (rows[0] as { changed?: boolean } | undefined)?.changed === true
  }
}

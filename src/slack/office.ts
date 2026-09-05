/**
 * Delivering into the office.
 *
 * §12 calls Slack the office and Team HQ the canonical dashboards, and 0014
 * made the second half of that literal: nothing the application needs is
 * stored only in Slack. This module is where a message crosses from the
 * canonical store into the room, and the whole of its design follows from one
 * fact — **`chat.postMessage` cannot be rolled back.**
 *
 * So the sequence is fixed and cannot be reordered:
 *
 *   1. claim in Postgres (`app.claim_slack_delivery`)
 *   2. post to Slack
 *   3. record the outcome (`app.record_slack_sent` / `app.record_slack_failure`)
 *
 * Claiming first costs one round trip and buys the only thing that makes a
 * duplicate delivery harmless. Posting first and recording afterwards is the
 * natural order, and it is wrong: two concurrent deliveries would both post
 * before either recorded.
 *
 * What this module deliberately does NOT do is decide what to say. §5: channel
 * adapters may only translate. The body, the metadata and the buttons arrive
 * already decided; this chooses a channel, honours a claim, and reports what
 * happened.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { SlackApiError, type SlackClient } from './api.ts'
import type { ResultMessage } from './blocks.ts'
import { fallbackText, resultBlocks } from './blocks.ts'
import type { IdentityOptions, StaffPresentation } from './identity.ts'
import { identityFor } from './identity.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const litOrNull = (v: string | null | undefined): string =>
  v === null || v === undefined ? 'null' : lit(v)

/** Slack message metadata event type, used for reconciliation. See `reconcile`. */
export const DELIVERY_EVENT_TYPE = 'ai_team_delivery'

export type DeliveryOutcome =
  | 'sent'
  /** Already posted by someone else, or by an earlier attempt. Not an error. */
  | 'already_sent'
  /** Another live claim holds it. Not an error either. */
  | 'held'
  | 'suppressed'
  /** Posted, then found to have been suppressed. The caller must delete it. */
  | 'suppressed_too_late'
  | 'failed'
  /** Posted or not — unknown. Reconcile before retrying. */
  | 'indeterminate'

/**
 * What came of trying to get back into a channel.
 *
 * `needs_reinstall` and `needs_invite` are both "a human must act", kept apart
 * because the humans and the actions differ: one is Grant re-authorising the
 * app with `channels:join`, the other is anybody in the channel inviting it.
 */
export type RejoinOutcome = 'rejoined' | 'needs_invite' | 'needs_reinstall' | 'failed'

export interface DeliveryRequest {
  readonly dedupeKey: string
  readonly teamId: string
  readonly channelId: string
  readonly threadTs?: string | null
  readonly purpose: 'result' | 'progress' | 'blocker' | 'ack' | 'briefing' | 'notice'
  readonly staff: StaffPresentation | null
  readonly staffId: string | null
  readonly correlationId: string | null
  readonly message: ResultMessage
}

export interface DeliveryResult {
  readonly outcome: DeliveryOutcome
  readonly deliveryId: string | null
  readonly messageTs: string | null
  readonly attempt: number
  /** Slack's error code when there was one, for the record and for humans. */
  readonly errorCode: string | null
  /** Which of avatar or emoji was used, so a never-hosted avatar is visible. */
  readonly iconSource: string | null
}

interface ClaimRow {
  delivery_id: string
  outcome: string
  message_ts: string | null
  attempt: number
}

export class SlackOffice {
  constructor(
    private readonly db: SqlExecutor,
    private readonly slack: SlackClient,
    private readonly identityOptions: IdentityOptions = {},
  ) {}

  /**
   * Post a message, exactly once, or explain why not.
   *
   * Never throws for an ordinary Slack failure: a delivery that could not be
   * made is a fact to record, not an exception to propagate into a job that was
   * otherwise fine. It throws only when the DATABASE will not answer, because
   * then nothing about the claim can be trusted.
   */
  async deliver(request: DeliveryRequest): Promise<DeliveryResult> {
    const claim = await this.claim(request)
    const base = {
      deliveryId: claim.delivery_id,
      attempt: claim.attempt,
      errorCode: null,
      iconSource: null,
    }

    switch (claim.outcome) {
      case 'already_sent':
        return { ...base, outcome: 'already_sent', messageTs: claim.message_ts }
      case 'held':
        return { ...base, outcome: 'held', messageTs: null }
      case 'suppressed':
        return { ...base, outcome: 'suppressed', messageTs: null }
      case 'failed':
        return { ...base, outcome: 'failed', messageTs: null, errorCode: 'previous_attempt_failed' }
      default:
        break // 'claimed' or 'reclaimed' — ours to post.
    }

    const identity =
      request.staff === null ? null : identityFor(request.staff, this.identityOptions)

    const body: Record<string, unknown> = {
      channel: request.channelId,
      text: fallbackText(request.message),
      blocks: resultBlocks(request.message),
      // Metadata is what `reconcile` matches on after an indeterminate post.
      // It rides on the message itself, so reconciliation needs no extra store
      // and works even for a message this process never learned the ts of.
      metadata: {
        event_type: DELIVERY_EVENT_TYPE,
        event_payload: { dedupe_key: request.dedupeKey },
      },
    }
    if (request.threadTs !== null && request.threadTs !== undefined) {
      body.thread_ts = request.threadTs
    }
    if (identity !== null) {
      body.username = identity.username
      if (identity.iconUrl !== null) body.icon_url = identity.iconUrl
      if (identity.iconEmoji !== null) body.icon_emoji = identity.iconEmoji
    }

    let messageTs: string
    try {
      const { body: response } = await this.slack.call('chat.postMessage', body)
      messageTs = String(response.ts ?? '')
    } catch (error) {
      return this.recordFailure(claim, error, identity?.iconSource ?? null)
    }

    const recorded = await this.one<{ outcome: string }>(
      `select app.record_slack_sent(${lit(claim.delivery_id)}::uuid, ${lit(messageTs)}) as outcome`,
    )

    return {
      ...base,
      outcome: recorded?.outcome === 'suppressed_too_late' ? 'suppressed_too_late' : 'sent',
      messageTs,
      iconSource: identity?.iconSource ?? null,
    }
  }

  /**
   * Find out whether an indeterminate post actually landed.
   *
   * Reads the channel's recent history and looks for our own message carrying
   * this dedupe key in its metadata. That is why every post carries it: without
   * a marker, the only way to tell a duplicate from a near-identical legitimate
   * message is to compare text, and two progress updates a minute apart look
   * the same.
   *
   * Returns the message ts if it is there, null if it is provably not, and
   * throws only if the read itself failed — in which case the answer is still
   * unknown and pretending otherwise would be the whole bug.
   */
  async reconcile(
    channelId: string,
    dedupeKey: string,
    threadTs?: string | null,
    limit = 50,
  ): Promise<string | null> {
    const method =
      threadTs === null || threadTs === undefined
        ? 'conversations.history'
        : 'conversations.replies'
    const params: Record<string, unknown> = {
      channel: channelId,
      limit,
      include_all_metadata: true,
    }
    if (threadTs !== null && threadTs !== undefined) params.ts = threadTs

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
   * Reconcile an indeterminate delivery and record the answer.
   *
   * The pair of calls belongs together: reading the channel and then failing to
   * write down what was read leaves the delivery exactly as stuck as before,
   * and the next reconciler pays for the read again. Returns what the database
   * made of it — `sent` when the message was found, `retryable` when it
   * provably is not there, `already_sent`/`not_indeterminate` when the row
   * moved underneath us, which on a sweep is ordinary.
   */
  async resolveIndeterminate(request: {
    readonly deliveryId: string
    readonly channelId: string
    readonly dedupeKey: string
    readonly threadTs?: string | null
  }): Promise<{ readonly resolution: string; readonly messageTs: string | null }> {
    // A failed read leaves the answer unknown, and the row must stay parked.
    // Letting this throw is the point: swallowing it here and treating "we
    // could not look" as "it is not there" is how a duplicate gets posted.
    const found = await this.reconcile(request.channelId, request.dedupeKey, request.threadTs)

    const row = await this.one<{ resolution: string }>(
      `select app.resolve_slack_indeterminate(${lit(request.deliveryId)}::uuid, ${litOrNull(found)}) as resolution`,
    )
    return { resolution: row?.resolution ?? 'unknown', messageTs: found }
  }

  /**
   * Try to get back into a channel the bot was removed from.
   *
   * This looked like a one-liner and is not, which the live suite established
   * rather than reasoning: **with the app's current scopes the bot cannot
   * rejoin a public channel it has left.** `conversations.join` needs
   * `channels:join`, which the installed app does not have; `conversations.invite`
   * — which `channels:manage` does cover — returns `not_in_channel` when the
   * inviter is the absent bot itself. Both were tried against the real
   * workspace. So the only remedy is a human inviting the app back, or a
   * reinstall carrying the extra scope.
   *
   * The method therefore reports which of those it is instead of returning
   * false. A bare false would read as "transient, try later", and a caller
   * retrying it forever would never surface the one fact that matters: this
   * needs a person.
   *
   * It is separated from `deliver` rather than folded into its error path
   * deliberately — a bot that silently rejoins every channel it was removed
   * from is a bot that ignores having been removed.
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
    const row = await this.one<{ changed: boolean }>(
      `select app.record_slack_channel_rename(${lit(channelId)}, ${lit(newName)}) as changed`,
    )
    return row?.changed === true
  }

  /**
   * Delete a message that should not have been posted.
   *
   * Used for `suppressed_too_late`: the undo arrived after the post, so the
   * reversal is a delete rather than a no-op. `message_not_found` counts as
   * success — the desired state is "not there", and it is not there.
   */
  async retract(channelId: string, messageTs: string): Promise<boolean> {
    try {
      await this.slack.call('chat.delete', { channel: channelId, ts: messageTs })
      return true
    } catch (error) {
      if (error instanceof SlackApiError && error.code === 'message_not_found') return true
      return false
    }
  }

  private async claim(request: DeliveryRequest): Promise<ClaimRow> {
    const row = await this.one<ClaimRow>(`
      select delivery_id::text as delivery_id, outcome, message_ts, attempt
      from app.claim_slack_delivery(
        ${lit(request.dedupeKey)},
        ${lit(request.teamId)},
        ${lit(request.channelId)},
        ${lit(request.purpose)},
        ${litOrNull(request.threadTs)},
        ${request.staffId === null ? 'null' : `${lit(request.staffId)}::uuid`},
        ${request.correlationId === null ? 'null' : `${lit(request.correlationId)}::uuid`}
      )
    `)
    if (row === undefined) throw new Error('claim_slack_delivery returned no row')
    return row
  }

  private async recordFailure(
    claim: ClaimRow,
    error: unknown,
    iconSource: string | null,
  ): Promise<DeliveryResult> {
    if (!(error instanceof SlackApiError)) throw error

    // `indeterminate` is NOT recorded as retryable. Releasing the lease would
    // invite exactly the second post the client refused to make. It parks as
    // `failed`, which is terminal and therefore safe, and the only way out is
    // `resolveIndeterminate` — which requires having actually looked (0033).
    if (error.kind === 'indeterminate') {
      await this.db.execute(
        `select app.record_slack_failure(${lit(claim.delivery_id)}::uuid, ${lit(error.code.slice(0, 200))}, false) as outcome`,
      )
      return {
        outcome: 'indeterminate',
        deliveryId: claim.delivery_id,
        messageTs: null,
        attempt: claim.attempt,
        errorCode: error.code,
        iconSource,
      }
    }

    const retryable = error.kind === 'retryable'
    await this.db.execute(
      `select app.record_slack_failure(${lit(claim.delivery_id)}::uuid, ${lit(error.code.slice(0, 200))}, ${retryable ? 'true' : 'false'}) as outcome`,
    )
    return {
      outcome: 'failed',
      deliveryId: claim.delivery_id,
      messageTs: null,
      attempt: claim.attempt,
      errorCode: error.code,
      iconSource,
    }
  }

  private async one<T>(sql: string): Promise<T | undefined> {
    const result = await this.db.execute(sql)
    return result.rows[0] as T | undefined
  }
}

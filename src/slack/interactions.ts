/**
 * Slack interactivity — the six buttons, coming back.
 *
 * `src/slack/blocks.ts` puts §12's buttons on every result. Until something
 * receives the click they are decoration, and a button that does nothing is
 * worse than no button: it teaches that Undo does not work.
 *
 * Three things about interactivity are different from the Events API, and each
 * one is a way to get this wrong:
 *
 * 1. **The payload is form-encoded, not JSON.** Slack POSTs
 *    `application/x-www-form-urlencoded` with a single `payload` field holding
 *    the JSON. A handler that calls `request.json()` gets a parse error for
 *    every button press, and the signature must still be verified over the raw
 *    body — `payload=%7B…` — not over the decoded object.
 * 2. **There is no URL verification handshake.** An interactivity URL is
 *    configured and simply starts receiving traffic, so a broken endpoint is
 *    not discovered at configuration time. It is discovered by a button not
 *    working.
 * 3. **Three seconds, and Slack shows the user an error.** Same budget as
 *    events, but the failure is visible to the person who clicked rather than
 *    quietly retried.
 *
 * The output is the same `CanonicalCommand` the Events API produces, carrying
 * the same six `callback_action` values `inbound_commands` has constrained
 * since 0011 — one vocabulary for a signal, whichever surface it arrived on.
 */

import type { CanonicalCommand } from './events.ts'
import { UnsupportedSlackEventError } from './events.ts'

/** Button `action_id` → the canonical action, which is the §12 vocabulary. */
const ACTION_IDS: Readonly<Record<string, string>> = {
  'feedback.useful': 'useful',
  'feedback.not_useful': 'not_useful',
  undo: 'undo',
  open_project: 'open_project',
  mute_24h: 'mute_24h',
  more_detail: 'more_detail',
}

export interface BlockActionsPayload {
  type: string
  team?: { id?: string }
  user?: { id?: string }
  channel?: { id?: string }
  container?: {
    channel_id?: string
    message_ts?: string
    thread_ts?: string
    is_ephemeral?: boolean
  }
  message?: { ts?: string; thread_ts?: string }
  /** Where an ephemeral acknowledgement may be posted. Slack expires it in 30 min. */
  response_url?: string
  actions?: {
    action_id?: string
    block_id?: string
    value?: string
    action_ts?: string
  }[]
}

/**
 * Pull the payload out of a form-encoded interactivity body.
 *
 * Returns null when the body is not one, so the caller can fall through to the
 * Events API path on the same endpoint rather than having to know in advance
 * which kind of request arrived.
 */
export function parseInteractionBody(rawBody: string): BlockActionsPayload | null {
  if (!rawBody.startsWith('payload=')) return null
  const encoded = new URLSearchParams(rawBody).get('payload')
  if (encoded === null || encoded === '') return null
  try {
    const parsed: unknown = JSON.parse(encoded)
    return typeof parsed === 'object' && parsed !== null ? (parsed as BlockActionsPayload) : null
  } catch {
    return null
  }
}

/** What the button carried: the action, and the work it is about. */
export interface ButtonValue {
  readonly action: string
  readonly correlationId: string | null
}

/**
 * Read a button's `value`.
 *
 * Treated as untrusted input even though we wrote it: the value round-trips
 * through Slack's client, it is visible to anyone who can inspect the message,
 * and §10 forbids free-form input reaching a tool call. So the action is taken
 * from the `action_id` (which Slack controls the delivery of) and the value is
 * used only for the correlation, validated as a uuid before it is believed.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readButtonValue(value: string | undefined): string | null {
  if (value === undefined || value === '') return null
  try {
    const parsed = JSON.parse(value) as { c?: unknown }
    return typeof parsed.c === 'string' && UUID.test(parsed.c) ? parsed.c : null
  } catch {
    return null
  }
}

/**
 * Normalize a button press.
 *
 * @param payload The parsed interactivity payload.
 * @param now Injected so `received_at` is testable.
 */
export function toCanonicalInteraction(
  payload: BlockActionsPayload,
  now: Date = new Date(),
): CanonicalCommand {
  if (payload.type !== 'block_actions') {
    throw new UnsupportedSlackEventError(payload.type, 'only block_actions carries a button press')
  }

  const action = payload.actions?.[0]
  if (action === undefined) {
    throw new UnsupportedSlackEventError(payload.type, 'the payload names no action')
  }
  const canonical = ACTION_IDS[action.action_id ?? '']
  if (canonical === undefined) {
    // Not an error to the user: an unknown action id is our own message being
    // older than our own code, and the right response is 200 and nothing.
    throw new UnsupportedSlackEventError(
      payload.type,
      `action ${String(action.action_id)} has no defined meaning`,
    )
  }

  const channel = payload.channel?.id ?? payload.container?.channel_id ?? 'unknown'
  const messageTs = payload.container?.message_ts ?? payload.message?.ts ?? 'unknown'
  const user = payload.user?.id ?? 'unknown'

  return {
    origin_channel: 'slack',
    origin_ref: `${channel}:${messageTs}`,
    actor: user,
    instruction: '',
    // Same shape as a reaction's key, and for the same reason: a double tap on
    // one button is one signal, and two different buttons on one message are
    // two. Keyed on the message rather than on `action_ts`, which differs per
    // click and would deduplicate nothing.
    dedupe_key: `slack:action:${channel}:${messageTs}:${user}:${canonical}`,
    received_at: now.toISOString(),
    callback_action: canonical,
    // Deliberately null even for Undo. 0011 constrains this to reference
    // `events(event_id)`, and the button carries a CORRELATION, not an event
    // id — the undoable action is found from `undo_offers` by correlation at
    // handling time. Putting the correlation here would satisfy the type and
    // point at the wrong table.
    compensates_event_id: null,
    slack: {
      team_id: payload.team?.id ?? 'unknown',
      channel_id: channel === 'unknown' ? null : channel,
      // The message the button is on. A reply about it belongs in its thread,
      // and for a threaded message that is the parent's ts, not this one's.
      thread_ts: payload.container?.thread_ts ?? payload.message?.thread_ts ?? null,
      is_dm: false,
      reaction: null,
    },
  }
}

/**
 * The correlation a press claims to be about.
 *
 * A hint, and explicitly the weaker of the two available answers. The
 * authoritative one is the message itself: `slack_deliveries` recorded the
 * `message_ts` and the `correlation_id` together when the message was posted,
 * so the handler can look up what the button is attached to without believing
 * anything the client sent. This exists for the case where that row has been
 * purged, and for cross-checking, and a null is a real answer — a press on a
 * message older than the buttons carrying values is a signal with no subject,
 * worth recording and not worth acting on.
 */
export function correlationOf(payload: BlockActionsPayload): string | null {
  return readButtonValue(payload.actions?.[0]?.value)
}

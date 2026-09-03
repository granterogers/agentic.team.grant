/**
 * Telegram inbound verification and update normalization.
 *
 * §5 draws a hard line: *"Channel adapters may only translate. They may never
 * decide."* No intent classification, no agent selection, no task creation, no
 * model call. This module authenticates the request and maps the payload onto
 * the canonical command envelope. That is all it is permitted to do.
 *
 * Two things it must get right, because both are security or correctness
 * boundaries rather than conveniences:
 *
 * 1. **Authenticating the sender.** Telegram's webhook has no signature. The
 *    only mechanism is `secret_token`, echoed in the
 *    `X-Telegram-Bot-Api-Secret-Token` header, so that header IS the
 *    authentication and must be compared in constant time.
 * 2. **Idempotency.** §6 requires duplicate callback deliveries to be harmless,
 *    and is explicit about why it must be structural: Telegram's documented
 *    retry contract is one sentence with no retry count or ordering guarantee,
 *    and duplicate deliveries can be genuinely concurrent.
 */
import { timingSafeEqual } from 'node:crypto'

/**
 * Encode to bytes with `TextEncoder`, not `Buffer`.
 *
 * `Buffer` is a Node global but NOT a Deno one, and this module runs in both:
 * Vitest under Node, and the Telegram webhook under Deno on Supabase Edge
 * Functions. The first version used `Buffer.from()`, passed every unit test,
 * and threw `Buffer is not defined` on every authenticated request in
 * production — visible only because the live round trip returned 500 where the
 * unauthenticated case correctly returned 401, which is exactly the shape of a
 * crash after the early return.
 *
 * `TextEncoder` and `Uint8Array` are web standards present in both runtimes,
 * and `timingSafeEqual` accepts any ArrayBufferView.
 */
const toBytes = (value: string): Uint8Array => new TextEncoder().encode(value)

/**
 * Compare a presented secret against the expected one without leaking length
 * or content through timing.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself be a length
 * oracle, so both sides are hashed to a fixed width first. Returning early on
 * `a.length !== b.length` — the obvious implementation — is the bug this avoids.
 */
export function secretMatches(presented: string | null | undefined, expected: string): boolean {
  if (expected === '') return false
  if (presented === null || presented === undefined || presented === '') return false

  const a = toBytes(presented)
  const b = toBytes(expected)
  if (a.length !== b.length) {
    // Still do a comparison of equal length, so a wrong-length secret costs the
    // same as a wrong-content one.
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

/** The subset of a Telegram update this adapter understands. */
export interface TelegramUpdate {
  readonly update_id: number
  readonly message?: {
    message_id: number
    date: number
    text?: string
    chat: { id: number; type: string }
    from?: { id: number; username?: string; is_bot?: boolean }
  }
  readonly callback_query?: {
    id: string
    data?: string
    from: { id: number; username?: string }
    message?: { message_id: number; chat: { id: number } }
  }
}

/**
 * The canonical command envelope, per `core-invariants.md` §1.
 *
 * `intent_class` is deliberately absent: §5 says the router sets it, not the
 * adapter. A field the adapter cannot fill is a field the adapter cannot decide.
 */
export interface CanonicalCommand {
  readonly origin_channel: 'telegram'
  /** Channel-native locator, so a reply lands back in the right place. */
  readonly origin_ref: string
  readonly actor: string
  readonly instruction: string
  /** Natural key for at-least-once delivery. */
  readonly dedupe_key: string
  readonly received_at: string
  /** Present only for button presses. */
  readonly callback_action: string | null
  /** The event id a callback compensates, if any — §6 keys Undo on this. */
  readonly compensates_event_id: string | null
}

export class UnsupportedUpdateError extends Error {
  constructor(readonly updateId: number) {
    super(`update ${updateId} carries neither a message nor a callback_query`)
    this.name = 'UnsupportedUpdateError'
  }
}

/**
 * Callback data is `action:payload`, e.g. `undo:3f2a…`.
 *
 * §12's buttons are 👍 Useful · 👎 Not useful · ↩ Undo · Open Project · Mute 24h
 * · More Detail. Only these are recognised — an unknown action is rejected
 * rather than passed through, because §10 forbids free-form input reaching a
 * tool call.
 */
export const CALLBACK_ACTIONS = new Set([
  'useful',
  'not_useful',
  'undo',
  'open_project',
  'mute_24h',
  'more_detail',
])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Translate an update into a canonical command. Pure: no database, no network,
 * no decisions.
 *
 * @param update The parsed Telegram update.
 * @param now Injected so `received_at` is testable.
 */
export function toCanonicalCommand(
  update: TelegramUpdate,
  now: Date = new Date(),
): CanonicalCommand {
  const received_at = now.toISOString()

  if (update.callback_query !== undefined) {
    const query = update.callback_query
    const [action, payload] = (query.data ?? '').split(':', 2)

    if (action === undefined || !CALLBACK_ACTIONS.has(action)) {
      throw new UnsupportedUpdateError(update.update_id)
    }

    // Only a well-formed uuid is carried through. §10: never allow free-form
    // input to reach a tool call, and this payload is used to look up an event.
    const compensates =
      action === 'undo' && payload !== undefined && UUID.test(payload) ? payload : null
    if (action === 'undo' && compensates === null) {
      throw new UnsupportedUpdateError(update.update_id)
    }

    return {
      origin_channel: 'telegram',
      origin_ref: `${String(query.message?.chat.id ?? 'unknown')}:${String(query.message?.message_id ?? 'unknown')}`,
      actor: String(query.from.id),
      instruction: '',
      // The callback ID, not the update ID. Telegram may redeliver the same
      // callback under a new update_id, so keying on update_id would let a
      // redelivery through — which is precisely what §6 forbids.
      dedupe_key: `telegram:callback:${query.id}`,
      received_at,
      callback_action: action,
      compensates_event_id: compensates,
    }
  }

  const message = update.message
  if (message === undefined || message.text === undefined || message.text.trim() === '') {
    throw new UnsupportedUpdateError(update.update_id)
  }

  return {
    origin_channel: 'telegram',
    origin_ref: `${String(message.chat.id)}:${String(message.message_id)}`,
    actor: String(message.from?.id ?? 'unknown'),
    // Raw text, never pre-digested. §1: "Never pre-digested by the adapter."
    instruction: message.text,
    // chat+message is stable across redeliveries of the same message, whereas
    // update_id is not.
    dedupe_key: `telegram:message:${String(message.chat.id)}:${String(message.message_id)}`,
    received_at,
    callback_action: null,
    compensates_event_id: null,
  }
}

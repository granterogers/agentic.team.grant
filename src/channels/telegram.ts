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
    /** A caption on a voice/audio message, which Telegram keeps separate. */
    caption?: string
    chat: { id: number; type: string }
    from?: { id: number; username?: string; is_bot?: boolean }
    /** A held-to-record voice note. */
    voice?: { file_id: string; duration?: number; mime_type?: string }
    /** An attached audio file, which people also use to dictate. */
    audio?: { file_id: string; duration?: number; mime_type?: string }
    /** A round video message. Its audio track is the instruction. */
    video_note?: { file_id: string; duration?: number }
  }
  readonly callback_query?: {
    id: string
    data?: string
    from: { id: number; username?: string }
    message?: { message_id: number; chat: { id: number; type?: string } }
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
  /**
   * A recording to transcribe, when the message was spoken rather than typed.
   *
   * Carried, not resolved. §1: *"never pre-digested by the adapter"* — and
   * transcription is the most pre-digesting an adapter could possibly do. The
   * adapter says "there is audio, here is its handle"; the worker turns it into
   * words, because that needs a model, a temp file and a bot token, none of
   * which belong in a pure function.
   */
  readonly voice_file_id: string | null
  readonly voice_seconds: number | null
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
  // 0083: approving a generation. Carries the correlation like the others, and
  // like the others the meaning is resolved from our record of the message
  // rather than from the payload — a button press is client-supplied and §10
  // forbids free-form input reaching a lookup.
  'approve',
  'decline',
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
  botId: string | null = null,
): CanonicalCommand {
  const received_at = now.toISOString()

  if (update.callback_query !== undefined) {
    const query = update.callback_query
    const [action, payload] = (query.data ?? '').split(':', 2)

    if (action === undefined || !CALLBACK_ACTIONS.has(action)) {
      throw new UnsupportedUpdateError(update.update_id)
    }

    // Only a well-formed uuid is carried through. §10: never allow free-form
    // input to reach a tool call, and this payload goes into a lookup.
    const carried = payload !== undefined && UUID.test(payload) ? payload : null
    if (action === 'undo' && carried === null) {
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
      // Scoped to the bot for the same reason as a message's key below. A
      // callback id is long and looks unique, but "looks unique" is what the
      // message key was too.
      dedupe_key: `telegram:callback:${botId ?? 'default'}:${query.id}`,
      received_at,
      voice_file_id: null,
      voice_seconds: null,
      callback_action: action,
      // Deliberately null, including for Undo, and this changed after the
      // button composer existed.
      //
      // The column references `events(event_id)` (0011). The payload a button
      // actually carries is a CORRELATION — that is what identifies the work a
      // message was about, and it is what `undo_offers` is grouped by. Writing
      // it here would satisfy the type, point at the wrong table, and fail the
      // insert with a foreign-key violation — which the webhook would answer
      // with a 503, which Telegram would retry, forever.
      //
      // Nothing is lost: the callback processor resolves the work from the
      // message the button is attached to, via `deliveries`, which is both more
      // reliable and not client-supplied. `src/slack/interactions.ts` reached
      // the same conclusion independently, and the two agreeing is the point.
      compensates_event_id: null,
    }
  }

  const message = update.message
  if (message === undefined) throw new UnsupportedUpdateError(update.update_id)

  // Spoken or typed, in that order of preference. A voice note WITH a caption
  // is one message and the recording is the substance of it — the caption is
  // usually "listen to this" — so the transcript wins and the caption is
  // dropped rather than concatenated into a sentence nobody said.
  const recording = message.voice ?? message.audio ?? message.video_note
  const typed = message.text ?? message.caption ?? ''
  if (recording === undefined && typed.trim() === '') {
    throw new UnsupportedUpdateError(update.update_id)
  }

  return {
    origin_channel: 'telegram',
    origin_ref: `${String(message.chat.id)}:${String(message.message_id)}`,
    actor: String(message.from?.id ?? 'unknown'),
    // Raw text, never pre-digested. §1: "Never pre-digested by the adapter."
    // Empty for a recording: the words do not exist yet, and inventing a
    // placeholder here is how a placeholder ends up being acted on.
    instruction: recording === undefined ? typed : '',
    voice_file_id: recording?.file_id ?? null,
    voice_seconds:
      recording === undefined || recording.duration === undefined ? null : recording.duration,
    // chat+message is stable across redeliveries of the same message, whereas
    // update_id is not.
    //
    // And the BOT, because chat+message is not unique across bots. In a
    // private chat the chat id is the user's id — the same number for every
    // bot — and each bot numbers its own messages from 1. So Grant's first
    // message to each of the eight bots was `telegram:message:1386648496:1`,
    // eight times, and seven of them were discarded as redeliveries by the
    // very index that is supposed to make §6's idempotence structural.
    //
    // It was found by pressing Start on seven bots and getting one row. What it
    // would have gone on doing is worse and quieter: his fifth message to Emma
    // and his fifth to Tom collide, and one of them is silently dropped.
    dedupe_key: `telegram:message:${botId ?? 'default'}:${String(message.chat.id)}:${String(message.message_id)}`,
    received_at,
    callback_action: null,
    compensates_event_id: null,
  }
}

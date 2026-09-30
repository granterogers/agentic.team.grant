/**
 * Slack Events API → canonical command.
 *
 * §13's Gate 4 asks for **command normalization** by name, and core-invariants
 * §1 says the raw instruction is *"never pre-digested by the adapter"*. Those
 * two together define the job precisely: convert Slack's envelope shapes into
 * the one canonical envelope, and change nothing about what was said.
 *
 * Pure. No database, no network, no decisions — the same contract as
 * `src/channels/telegram.ts`, and for the same reason: an adapter that can make
 * a decision is a second place where policy lives.
 */

/** The canonical envelope, identical in shape to Telegram's. */
export interface CanonicalCommand {
  readonly origin_channel: 'slack'
  /** Channel-native locator, so a reply lands back in the right place. */
  readonly origin_ref: string
  readonly actor: string
  readonly instruction: string
  readonly dedupe_key: string
  readonly received_at: string
  /**
   * Always null here, and present anyway.
   *
   * Telegram gained spoken instructions in 0075 and Slack has no equivalent —
   * but §31 requires the canonical row to be identical across interfaces, and
   * a field that exists on one envelope and not the other makes that comparison
   * a matter of which fields somebody remembered to exclude. Declaring it null
   * says "this channel carries no recording" rather than leaving it unsaid.
   */
  readonly voice_file_id: null
  readonly voice_seconds: null
  readonly callback_action: string | null
  readonly compensates_event_id: string | null
  /**
   * How the message arrived, when that is not just his words (#396, #397): the thread root it replies under, and
   * whether it is a SHARED message (Slack's attachment `is_share`/`is_msg_unfurl`, the closest thing the
   * provider exposes to a forward - a plain paste of somebody's text is indistinguishable from typing it).
   */
  readonly context?: { readonly forwarded?: true; readonly thread_ts?: string }
  /** Slack-specific routing the core does not interpret, only carries. */
  readonly slack: {
    readonly team_id: string
    readonly channel_id: string | null
    /** The parent message's ts when this is in a thread, else null. */
    readonly thread_ts: string | null
    readonly is_dm: boolean
    /** Present for reaction events; the emoji name without colons. */
    readonly reaction: string | null
  }
}

/**
 * What a Slack message says about how it arrived. A reply names its thread ROOT (Slack threads are flat), and a
 * message that is itself the root of a thread carries its own ts there, which is not a reply to anything.
 */
const slackContext = (
  event: SlackEventBase,
  ts: string,
): { readonly context?: { readonly forwarded?: true; readonly thread_ts?: string } } => {
  const forwarded = (event.attachments ?? []).some(
    (a) => a.is_share === true || a.is_msg_unfurl === true,
  )
  const threadRoot =
    event.thread_ts !== undefined && event.thread_ts !== '' && event.thread_ts !== ts
      ? event.thread_ts
      : undefined
  if (!forwarded && threadRoot === undefined) return {}
  return {
    context: {
      ...(forwarded ? { forwarded: true as const } : {}),
      ...(threadRoot === undefined ? {} : { thread_ts: threadRoot }),
    },
  }
}

export class UnsupportedSlackEventError extends Error {
  constructor(
    readonly eventType: string,
    readonly why: string,
  ) {
    super(`slack event ${eventType} is not actionable: ${why}`)
    this.name = 'UnsupportedSlackEventError'
  }
}

/** Slack's URL verification handshake, which is not an event at all. */
export interface UrlVerification {
  readonly type: 'url_verification'
  readonly challenge: string
}

interface SlackEventBase {
  type: string
  user?: string
  bot_id?: string
  channel?: string
  channel_type?: string
  ts?: string
  event_ts?: string
  thread_ts?: string
  text?: string
  subtype?: string
  reaction?: string
  item?: { type?: string; channel?: string; ts?: string }
  attachments?: { is_share?: boolean; is_msg_unfurl?: boolean }[]
}

export interface SlackEnvelope {
  type: string
  token?: string
  team_id?: string
  api_app_id?: string
  /** Slack's own idempotency handle. Unique per delivery attempt group. */
  event_id?: string
  event_time?: number
  challenge?: string
  event?: SlackEventBase
  authorizations?: { user_id?: string; is_bot?: boolean }[]
}

/**
 * Reaction names that carry meaning, mapped onto §12's button vocabulary.
 *
 * Deliberately the *same* action strings the Telegram buttons produce, so
 * "Grant found this useful" is one concept with one handler regardless of which
 * surface it arrived on. A separate Slack vocabulary would mean two code paths
 * for one intention, and they would diverge.
 *
 * Anything else is ignored rather than rejected: people react with whatever
 * they like, and an unrecognised emoji is not an error.
 */
export const REACTION_ACTIONS: Readonly<Record<string, string>> = {
  '+1': 'useful',
  thumbsup: 'useful',
  white_check_mark: 'useful',
  heavy_check_mark: 'useful',
  '-1': 'not_useful',
  thumbsdown: 'not_useful',
  mag: 'more_detail',
  eyes: 'more_detail',
  mute: 'mute_24h',
  no_bell: 'mute_24h',
}

/**
 * The message subtypes that are a person saying something - an ALLOW-list (final audit, review R2-5).
 *
 * It was a block-list of the subtypes somebody thought of, so every other one the platform invents - `huddle_thread`,
 * `reminder_add`, `pinned_item`, `channel_archive`, `file_comment`, `slackbot_response` - reached the office as a typed
 * instruction under an admitted user's id. A subtype nobody listed is the platform speaking, not him.
 *
 * `message_changed` and `message_deleted` stay out on purpose: acting on an edit would mean re-running an instruction
 * whose text has changed underneath a job, and there is no defined semantics for that. §6's canonical record is the
 * instruction as first received.
 */
const ACCEPTED_SUBTYPES: ReadonlySet<string> = new Set([
  // A person posting: nothing (no subtype), a reply broadcast to the channel, and a message that carries a file.
  'thread_broadcast',
  'file_share',
])

/** Strip the leading `<@Uxxxx>` mention, keeping everything else verbatim. */
const withoutLeadingMention = (text: string): string => text.replace(/^\s*<@[UWB][A-Z0-9]+>\s*/, '')

/**
 * Is this the handshake rather than an event?
 *
 * Separate from parsing because the endpoint must answer it before it has any
 * idea what the app is for, and answering it wrongly means the app can never be
 * configured at all.
 */
export const asUrlVerification = (body: unknown): UrlVerification | null => {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  return b.type === 'url_verification' && typeof b.challenge === 'string'
    ? { type: 'url_verification', challenge: b.challenge }
    : null
}

/**
 * Normalize an event envelope.
 *
 * @param envelope The parsed Slack envelope.
 * @param botUserId Our own bot user id, so our own messages are not read back
 *   as instructions. Required rather than optional: forgetting it produces an
 *   infinite loop, and a default would let it be forgotten.
 * @param now Injected so `received_at` is testable.
 */
export const toCanonicalCommand = (
  envelope: SlackEnvelope,
  botUserId: string,
  now: Date = new Date(),
): CanonicalCommand => {
  const event = envelope.event
  if (event === undefined) {
    throw new UnsupportedSlackEventError(envelope.type, 'the envelope carries no event')
  }
  const teamId = envelope.team_id ?? 'unknown'
  const received_at = now.toISOString()

  // Our own output, coming back as input. Checked before anything else,
  // because every other branch would happily process it.
  if (event.user === botUserId || event.bot_id !== undefined) {
    throw new UnsupportedSlackEventError(event.type, 'it originated from this app')
  }

  if (event.type === 'reaction_added' || event.type === 'reaction_removed') {
    const reaction = event.reaction ?? ''
    const action = REACTION_ACTIONS[reaction]
    if (action === undefined) {
      throw new UnsupportedSlackEventError(event.type, `:${reaction}: carries no defined meaning`)
    }
    // A removed reaction is not the inverse of adding one — un-thumbs-upping is
    // not "not useful", it is a retraction, and there is no defined handling
    // for retracting a signal that has already been acted on. Ignored, and said
    // so rather than guessed at.
    if (event.type === 'reaction_removed') {
      throw new UnsupportedSlackEventError(event.type, 'a retracted reaction has no defined effect')
    }
    const item = event.item ?? {}
    return {
      origin_channel: 'slack',
      origin_ref: `${String(item.channel ?? 'unknown')}:${String(item.ts ?? 'unknown')}`,
      actor: event.user ?? 'unknown',
      instruction: '',
      // Keyed on who signalled *what meaning* about which message — the
      // mapped action, not the raw emoji. Two reasons, and the second was found
      // by the Gate 4 run rather than reasoned out:
      //
      //   - `inbound_commands.dedupe_key` is constrained to
      //     `[A-Za-z0-9:_.-]+`, and `+` is not in it. The emoji `+1` produced a
      //     key the database refused, which surfaced as a 503 telling Slack to
      //     retry an event that could never be stored.
      //   - It is also the better semantics. Reacting 👍 and then ✅ is one
      //     person saying "useful" twice, and it should collapse to one signal.
      //     Two different meanings (👍 then 🔍) still produce two keys.
      //
      // Not event_id: Slack reuses it across retries, but a genuine double-tap
      // arrives as two ids and would otherwise enqueue the same signal twice.
      dedupe_key: `slack:reaction:${String(item.channel ?? 'x')}:${String(item.ts ?? 'x')}:${event.user ?? 'x'}:${action}`,
      received_at,
      callback_action: action,
      voice_file_id: null,
      voice_seconds: null,
      compensates_event_id: null,
      slack: {
        team_id: teamId,
        channel_id: item.channel ?? null,
        thread_ts: null,
        is_dm: false,
        reaction,
      },
    }
  }

  if (event.type === 'message' || event.type === 'app_mention') {
    if (event.subtype !== undefined && !ACCEPTED_SUBTYPES.has(event.subtype)) {
      throw new UnsupportedSlackEventError(
        event.type,
        `subtype ${event.subtype} is not an instruction`,
      )
    }
    const raw = event.text ?? ''
    // The mention prefix is addressing, not content — "@ai_team_hq summarise
    // this" instructs "summarise this". Everything after it is verbatim: §1's
    // "never pre-digested" is about the instruction, not about the envelope.
    const instruction = withoutLeadingMention(raw)
    if (instruction.trim() === '') {
      throw new UnsupportedSlackEventError(event.type, 'it carries no text')
    }

    const isDm = event.channel_type === 'im'
    const ts = event.ts ?? event.event_ts ?? 'unknown'

    return {
      origin_channel: 'slack',
      // channel:ts, and in a thread the ts is still this message's own — a
      // reply must land on the reply, not on the parent.
      origin_ref: `${String(event.channel ?? 'unknown')}:${ts}`,
      actor: event.user ?? 'unknown',
      instruction,
      // channel+ts is Slack's stable identity for a message. `event_id` is not:
      // Slack documents that a retry carries the same event_id, but an
      // `app_mention` and a `message` for the same text arrive as two events
      // with two ids, and treating them as distinct instructions would run the
      // work twice.
      dedupe_key: `slack:message:${String(event.channel ?? 'x')}:${ts}`,
      received_at,
      callback_action: null,
      voice_file_id: null,
      voice_seconds: null,
      compensates_event_id: null,
      ...slackContext(event, ts),
      slack: {
        team_id: teamId,
        channel_id: event.channel ?? null,
        thread_ts: event.thread_ts ?? null,
        is_dm: isDm,
        reaction: null,
      },
    }
  }

  throw new UnsupportedSlackEventError(event.type, 'no handler for this event type')
}

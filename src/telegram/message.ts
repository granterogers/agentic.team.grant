/**
 * Composing a pager message.
 *
 * §12: **Telegram = pager**. That is a constraint, not a label — a pager says
 * the smallest thing that lets you decide whether to look, and Slack is where
 * the detail lives. So this composer is deliberately more aggressive than
 * Slack's: it trims, it flattens, and it never tries to reproduce a Block Kit
 * layout in plain text.
 *
 * Two mechanical traps, both of which produce a message Telegram REFUSES to
 * send rather than one that looks wrong:
 *
 * 1. **Parse-mode escaping.** MarkdownV2 requires eighteen characters to be
 *    backslash-escaped and rejects the message with `can't parse entities` if
 *    one is missed — and the text here is model output, so it will contain
 *    them. HTML mode needs exactly three characters escaped (`& < >`) and is
 *    used for that reason alone.
 * 2. **The 4096-character limit.** Exceeding it is `message is too long`, a
 *    hard failure. A pager has no business being near it anyway, so the body is
 *    trimmed well short and the message says it was trimmed.
 */

import type { Confidence, Evidence } from '../agents/quality.ts'
import { ACTIONS, type ActionId } from '../slack/blocks.ts'

/** Telegram's hard limit. Ours is far below it, on purpose. */
export const TELEGRAM_MAX_TEXT = 4096
/** What a pager should say. Roughly a phone notification and a glance. */
export const PAGER_BODY_LIMIT = 700
/** Telegram's own cap on inline keyboard button labels being sane. */
export const BUTTON_TEXT_LIMIT = 64
/** Buttons per row. Three is the most that stays readable on a phone. */
export const BUTTONS_PER_ROW = 3
/** Telegram rejects callback_data longer than this, in BYTES. */
export const CALLBACK_DATA_MAX_BYTES = 64

const BUTTON_TEXT: Readonly<Record<ActionId, string>> = {
  'feedback.useful': '👍 Useful',
  'feedback.not_useful': '👎 Not useful',
  undo: '↩ Undo',
  open_project: 'Open project',
  mute_24h: 'Mute 24h',
  more_detail: 'More detail',
}

/** Escape for `parse_mode: HTML`. Exactly three characters, and no more. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface PagerMetadata {
  readonly confidence: Confidence
  readonly evidence: Evidence
  readonly reviewed: boolean
}

export interface PagerMessage {
  readonly staffName: string | null
  readonly staffTitle: string | null
  readonly body: string
  readonly metadata: PagerMetadata | null
  readonly correlationId: string
  readonly actions: readonly ActionId[]
  readonly projectUrl?: string | null
}

/**
 * Trim to a pager's length, on a sentence boundary where there is one.
 *
 * Says it trimmed. A silently truncated finding is a different finding, and the
 * reader has no way to tell.
 */
export function trimForPager(body: string, limit = PAGER_BODY_LIMIT): string {
  const collapsed = body.replace(/\n{3,}/g, '\n\n').trim()
  if (collapsed.length <= limit) return collapsed

  const window = collapsed.slice(0, limit)
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'))
  const cut = lastStop > limit / 2 ? lastStop + 1 : limit
  return `${collapsed.slice(0, cut).trim()}\n\n… trimmed — the full version is in Slack.`
}

/**
 * Callback data for a button.
 *
 * Telegram's limit is 64 BYTES, not characters, and a uuid plus an action name
 * does not fit — `feedback.not_useful` and a uuid alone is 55 characters before
 * any structure. So the action is sent as a short code and the correlation is
 * sent whole, because the correlation is what cannot be reconstructed.
 *
 * The short codes are an internal encoding, mapped back on receipt. They are
 * NOT the canonical vocabulary: §12's six words stay the vocabulary everywhere
 * else, and a wire format leaking into the domain is how a UI rename rewrites
 * history.
 */
const WIRE_CODES: Readonly<Record<ActionId, string>> = {
  'feedback.useful': 'u',
  'feedback.not_useful': 'n',
  undo: 'z',
  open_project: 'p',
  mute_24h: 'm',
  more_detail: 'd',
}

export const WIRE_TO_ACTION: Readonly<Record<string, ActionId>> = Object.fromEntries(
  ACTIONS.map((action) => [WIRE_CODES[action], action]),
)

export class CallbackDataTooLongError extends Error {
  constructor(readonly bytes: number) {
    super(
      `callback_data is ${String(bytes)} bytes; Telegram accepts ${String(CALLBACK_DATA_MAX_BYTES)}`,
    )
    this.name = 'CallbackDataTooLongError'
  }
}

export function callbackData(action: ActionId, correlationId: string): string {
  const data = `${WIRE_CODES[action]}:${correlationId}`
  const bytes = new TextEncoder().encode(data).length
  if (bytes > CALLBACK_DATA_MAX_BYTES) throw new CallbackDataTooLongError(bytes)
  return data
}

export interface InlineButton {
  readonly text: string
  readonly callback_data?: string
  readonly url?: string
}

/** Rows of buttons, three to a row so they stay readable on a phone. */
export function inlineKeyboard(
  actions: readonly ActionId[],
  correlationId: string,
  projectUrl?: string | null,
): readonly (readonly InlineButton[])[] {
  const buttons: InlineButton[] = actions.map((action) =>
    action === 'open_project' && projectUrl !== null && projectUrl !== undefined
      ? // A url button sends no callback, so pressing it tells us nothing. That
        // is Telegram's design and not something to work around by dropping the
        // link — the link is the useful part.
        { text: BUTTON_TEXT[action].slice(0, BUTTON_TEXT_LIMIT), url: projectUrl }
      : {
          text: BUTTON_TEXT[action].slice(0, BUTTON_TEXT_LIMIT),
          callback_data: callbackData(action, correlationId),
        },
  )

  const rows: InlineButton[][] = []
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    rows.push(buttons.slice(i, i + BUTTONS_PER_ROW))
  }
  return rows
}

/**
 * The text of a pager message.
 *
 * Provenance is one short line and always carries confidence WITH evidence, for
 * the reason §12 gives: "high confidence" alone reads as an observation. An
 * unreviewed output is labelled first, before the body, because on a phone the
 * first line is often the only line read.
 */
export function pagerText(message: PagerMessage): string {
  const parts: string[] = []

  if (message.metadata !== null && !message.metadata.reviewed) {
    parts.push('⚠️ <b>Not reviewed</b> — do not rely on this yet')
  }

  const who =
    message.staffName === null
      ? null
      : message.staffTitle === null || message.staffTitle === message.staffName
        ? message.staffName
        : `${message.staffName} · ${message.staffTitle}`
  if (who !== null) parts.push(`<b>${escapeHtml(who)}</b>`)

  parts.push(escapeHtml(trimForPager(message.body)))

  if (message.metadata !== null) {
    parts.push(
      `<i>${escapeHtml(message.metadata.confidence)} confidence · evidence: ${escapeHtml(message.metadata.evidence)}</i>`,
    )
  }

  const text = parts.join('\n\n')
  // Belt and braces. The trim above makes this unreachable for any realistic
  // message, and an unreachable guard on a hard API failure is worth its two
  // lines.
  return text.length <= TELEGRAM_MAX_TEXT ? text : `${text.slice(0, TELEGRAM_MAX_TEXT - 1)}…`
}

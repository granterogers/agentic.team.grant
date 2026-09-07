/**
 * Composing what Grant actually sees in Slack.
 *
 * Pure, like every other adapter module here: blocks in, blocks out, no
 * network and no decisions. What it must get right is not the layout — it is
 * that a message cannot claim more than the work behind it earned, and that
 * Slack's own limits are respected by construction rather than discovered when
 * a 3001-character finding silently fails to post.
 *
 * The limits, all from Slack's documented maxima, all enforced below:
 *
 *   - 50 blocks per message
 *   - 3000 characters per section `text`
 *   - 5 elements per `actions` block  (so §12's SIX buttons need two blocks —
 *     the bug this constant prevents is a sixth button that just disappears)
 *   - 2000 characters per action `value`
 *   - 75 characters per button label
 *   - 150 characters per `context` element
 *
 * The honesty rules are §12's and §16's, and they are enforced here rather
 * than left to whoever writes the calling code:
 *
 *   - unreviewed substantive output is LABELLED unreviewed, always;
 *   - confidence and evidence type appear together, because "high confidence"
 *     without "inferred" beside it reads as an observation;
 *   - a recorded contradiction is shown, not summarised away.
 */

import type { Confidence, Evidence } from '../agents/quality.ts'

export const MAX_BLOCKS = 50
export const MAX_SECTION_TEXT = 3000
export const MAX_ACTION_ELEMENTS = 5
export const MAX_ACTION_VALUE = 2000
export const MAX_BUTTON_TEXT = 75
export const MAX_CONTEXT_TEXT = 150

export interface SlackBlock {
  readonly type: string
  readonly [key: string]: unknown
}

/** The six §12 buttons, by the action id Slack will send back. */
export const ACTIONS = [
  'feedback.useful',
  'feedback.not_useful',
  'undo',
  'open_project',
  'mute_24h',
  'more_detail',
  // 0083. Not part of §12's six, and deliberately in the same list rather than
  // a parallel one: both surfaces render buttons from `ActionId[]`, so adding
  // them here gives Slack and Telegram the same two buttons with no second
  // implementation to diverge. They appear ONLY on an approval request — see
  // `resultContext`, which swaps the six for these two rather than adding to
  // them, because 👍 on "may I generate this?" answers nothing.
  'approve',
  'decline',
] as const
export type ActionId = (typeof ACTIONS)[number]

const BUTTON_TEXT: Readonly<Record<ActionId, string>> = {
  'feedback.useful': '👍 Useful',
  'feedback.not_useful': '👎 Not useful',
  undo: '↩ Undo',
  open_project: 'Open project',
  mute_24h: 'Mute 24h',
  more_detail: 'More detail',
  approve: '✅ Go ahead',
  decline: '🚫 Not now',
}

export interface MessageMetadata {
  readonly confidence: Confidence
  readonly evidence: Evidence
  readonly sources: readonly string[]
  readonly contradictions: string | null
  /**
   * False for anything §10 requires review of that has not had it. It is not
   * a display preference: §16 says unreviewed output must not be relied on, and
   * a reader cannot decline to rely on something they were not told about.
   */
  readonly reviewed: boolean
}

export interface ResultMessage {
  /** Staff title, shown as context. The NAME is carried by `username`. */
  readonly staffTitle: string | null
  readonly body: string
  readonly metadata: MessageMetadata | null
  /** Correlation id, echoed into every button so a click can be attributed. */
  readonly correlationId: string
  /** Which buttons to offer. Undo is only offered when there is one. */
  readonly actions: readonly ActionId[]
  /** Present only when `open_project` is offered. */
  readonly projectUrl?: string | null
}

export class BlockLimitError extends Error {
  constructor(
    readonly limit: string,
    message: string,
  ) {
    super(message)
    this.name = 'BlockLimitError'
  }
}

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`

/**
 * Split body text across section blocks at the 3000-character limit.
 *
 * Splits on paragraph boundaries where it can and mid-text where it cannot,
 * rather than truncating: a finding cut off at 3000 characters is a different
 * finding, and the reader has no way to tell it was cut.
 */
export function splitBody(body: string, max = MAX_SECTION_TEXT): readonly string[] {
  if (body.length <= max) return [body]

  const parts: string[] = []
  let rest = body
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const breakAt = window.lastIndexOf('\n\n')
    const cut = breakAt > max / 2 ? breakAt : max
    parts.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest !== '') parts.push(rest)
  return parts
}

const section = (text: string): SlackBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
})

const context = (elements: readonly string[]): SlackBlock => ({
  type: 'context',
  elements: elements.map((text) => ({
    type: 'mrkdwn',
    text: truncate(text, MAX_CONTEXT_TEXT),
  })),
})

/**
 * The one line that says how much to trust what is above it.
 *
 * Confidence and evidence are never shown apart. "High confidence" alone is
 * the sentence §12 is written to prevent.
 */
export function provenanceLine(m: MessageMetadata): string {
  const parts = [`*${m.confidence}* confidence`, `evidence: *${m.evidence}*`]
  parts.push(
    m.sources.length === 0
      ? 'no sources cited'
      : `${String(m.sources.length)} source${m.sources.length === 1 ? '' : 's'}`,
  )
  if (!m.reviewed) parts.push(':warning: *not reviewed* — do not rely on this yet')
  return parts.join('  ·  ')
}

export function buttonValue(action: ActionId, correlationId: string): string {
  // Compact and parseable, so the interaction handler does not have to guess
  // which message a click belongs to. Kept well inside the 2000-byte limit;
  // the assertion is here because exceeding it is a silent Slack rejection.
  const value = JSON.stringify({ a: action, c: correlationId })
  if (value.length > MAX_ACTION_VALUE) {
    throw new BlockLimitError('action.value', `action value is ${String(value.length)} chars`)
  }
  return value
}

/**
 * Buttons, packed into as many `actions` blocks as the 5-per-block limit needs.
 *
 * §12 lists six buttons. Slack allows five per block. Putting all six in one
 * block does not error — the sixth is dropped — so this is the shape of a bug
 * that only shows up as a missing Undo when somebody wanted one.
 */
export function actionBlocks(
  actions: readonly ActionId[],
  correlationId: string,
  projectUrl?: string | null,
): readonly SlackBlock[] {
  const blocks: SlackBlock[] = []
  for (let i = 0; i < actions.length; i += MAX_ACTION_ELEMENTS) {
    const slice = actions.slice(i, i + MAX_ACTION_ELEMENTS)
    blocks.push({
      type: 'actions',
      block_id: `actions-${String(i / MAX_ACTION_ELEMENTS)}-${correlationId}`,
      elements: slice.map((action) => {
        const element: Record<string, unknown> = {
          type: 'button',
          action_id: action,
          text: { type: 'plain_text', text: truncate(BUTTON_TEXT[action], MAX_BUTTON_TEXT) },
          value: buttonValue(action, correlationId),
        }
        // A destructive style on Undo would be wrong: undo is the SAFE action,
        // and colouring it as danger discourages the thing we want to be easy.
        if (action === 'open_project' && projectUrl !== null && projectUrl !== undefined) {
          element.url = projectUrl
        }
        return element
      }),
    })
  }
  return blocks
}

export function resultBlocks(message: ResultMessage): readonly SlackBlock[] {
  const blocks: SlackBlock[] = []

  if (message.staffTitle !== null && message.staffTitle !== '') {
    blocks.push(context([message.staffTitle]))
  }

  for (const part of splitBody(message.body)) blocks.push(section(part))

  if (message.metadata !== null) {
    blocks.push(context([provenanceLine(message.metadata)]))
    const contradictions = message.metadata.contradictions
    if (contradictions !== null && contradictions.trim() !== '') {
      // Shown in full width rather than as context: a surviving disagreement is
      // content, not footnote. §16 is explicit that it must not be averaged
      // away, and shrinking it to grey 12pt is averaging by typography.
      blocks.push(section(`*Unresolved disagreement*\n${truncate(contradictions, 1000)}`))
    }
  }

  if (message.actions.length > 0) {
    blocks.push(...actionBlocks(message.actions, message.correlationId, message.projectUrl))
  }

  if (blocks.length > MAX_BLOCKS) {
    throw new BlockLimitError(
      'blocks',
      `message would carry ${String(blocks.length)} blocks; Slack accepts ${String(MAX_BLOCKS)}`,
    )
  }
  return blocks
}

/**
 * The plain-text fallback.
 *
 * Not optional. It is what the push notification, the sidebar preview and every
 * screen reader use; a message with blocks and no `text` shows as "This content
 * can't be displayed" on a phone — which is the surface §12 calls the pager.
 */
export function fallbackText(message: ResultMessage): string {
  const first = message.body.split('\n\n')[0] ?? message.body
  const prefix = message.staffTitle === null ? '' : `${message.staffTitle}: `
  const unreviewed =
    message.metadata !== null && !message.metadata.reviewed ? '[not reviewed] ' : ''
  return truncate(`${unreviewed}${prefix}${first.replace(/\s+/g, ' ')}`, 300)
}

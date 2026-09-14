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
import { claimsToHaveRead } from '../agents/quality.ts'

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
  /**
   * True when the output is a mechanical read rather than a judgement.
   *
   * `outputs.deterministic`, carried through rather than guessed at. It is the
   * ONE thing that decides whether the provenance line is worth its three
   * blocks, and it is decided here rather than by the caller so that Slack and
   * Telegram cannot disagree about it.
   *
   * Grant, 13 September, looking at his phone: *"how much space is being taken
   * up... It's really not intuitive or acting like it's a human."* He was
   * looking at messages like these, which are 270, 124 and 110 of the last ten
   * days' traffic respectively:
   *
   *     Looked at 1 Drive folder. Nothing new.
   *     Confident — checked against 1 source.
   *     [ 👍 Useful ] [ 👎 Not useful ] [ ⋯ ]
   *
   * Two thirds of that message is furniture, and neither piece of it is doing
   * any work. §12's honesty rules exist to stop INFERENCE being read as
   * observation — a deterministic output IS observation, so there is nothing
   * to caution about and the caption can only say "checked against 1 source"
   * about a folder listing. #59's feedback exists to correct JUDGEMENT, and
   * there is no judgement in "nothing new" to thumb down.
   *
   * So the rule, and it is a rule about honesty rather than about space: **a
   * message says how much to trust it exactly when there is something to
   * decide.** A finding keeps every word of §12; a status line stops
   * pretending to be one.
   *
   * A contradiction is still shown even here — see `resultBlocks`. A
   * mechanical read should not produce one, and if it does, that is the most
   * interesting thing on the message.
   */
  readonly routine: boolean
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
/*
  Grant, 13 September, looking at his phone:

    "how much space is being taken up ... It's really not intuitive or acting
     like it's a human."

  This line said `*medium* confidence · evidence: *inferred* · 5 sources` — three
  internal field names rendered as a caption. `evidence: inferred` is the single
  most important thing on the message, because it means NOTHING WAS LOOKED UP,
  and it was written in a vocabulary only this repository uses.

  So the same two facts, in English. §12's rule is untouched and is the reason
  they stay in one sentence: how sure, and on what basis, are never shown apart,
  because "fairly sure" on its own reads as an observation.
*/
const HOW_SURE: Readonly<Record<Confidence, string>> = {
  high: 'Confident',
  medium: 'Fairly confident',
  low: 'Not confident',
}

/**
 * On what basis — and `inferred` says so plainly.
 *
 * "Worked out rather than looked up" is the whole of #185 in five words. The
 * old wording could sit under a sentence claiming a database read and not
 * visibly contradict it; this cannot.
 */
const ON_WHAT: Readonly<Record<Evidence, string>> = {
  verified: 'checked against',
  inferred: 'worked out, not looked up',
  speculative: 'a guess',
}

/**
 * Takes everything a provenance line is made of, and nothing else.
 *
 * Narrower than `MessageMetadata` on purpose: `routine` decides WHETHER this
 * line is shown and is no part of composing it, and Telegram's `PagerMetadata`
 * — which carries `routine` as optional — could not otherwise be passed here
 * without either widening its own type or lying about the flag.
 */
export type Provenance = Omit<MessageMetadata, 'routine'>

/**
 * Is there anything here worth a line of Grant's lock screen? (#208)
 *
 * Grant, 14 September, looking at a two-line hello on his phone that carried
 * "Fairly confident — worked out, not looked up, nothing cited.":
 *
 *   "I don't need that confidence text... I'm trying to make a bit more human,
 *    you know, a bit more personable, a bit more personality."
 *
 * He is right, and the fix is placement rather than deletion. §12 says
 * confidence and evidence are never shown APART — it does not say they must be
 * shown on a message that claims nothing. A line whose entire content is two
 * absences ("not looked up, nothing cited") under "I'm here, no need for a
 * meeting" is the product clearing its throat.
 *
 * The suppression is deliberately narrow, because the case it must NOT catch is
 * #185: Claire told Grant five projects existed, in a sentence claiming a
 * database read, with `evidence: inferred` and no sources — the identical
 * metadata to the harmless hello. The only thing separating them is whether the
 * WORDS make a claim, and `claimsToHaveRead` is the existing answer to exactly
 * that question. So the body is consulted, and anything claiming to have read
 * keeps its line.
 *
 * Everything that carries information keeps it too: something verified,
 * something cited, a guess, or anything unreviewed. What goes is the case where
 * the sentence could only ever report that nothing happened.
 */
export function attestsSomething(m: Provenance, body?: string): boolean {
  if (m.evidence !== 'inferred') return true
  if (m.sources.length > 0) return true
  if (!m.reviewed) return true
  // The #185 guard. An inferred answer that SAYS it looked something up is the
  // one message on this list that most needs its provenance beside it.
  return claimsToHaveRead(body ?? '') !== null
}

export function provenanceLine(m: Provenance): string {
  const sure = HOW_SURE[m.confidence]
  const n = m.sources.length
  const sources = `${String(n)} source${n === 1 ? '' : 's'}`

  /*
    Whether anything was cited is said in EVERY branch, never by omission.

    The old line ended in "no sources cited" and the first draft of this one
    dropped that for the inferred case, on the grounds that "worked out, not
    looked up" implies it. It does — to a careful reader. §12's rule is that
    the absence is STATED, and an implication is not a statement; a rule that
    holds only when the reader is paying attention is not a rule.
  */
  let basis: string
  if (m.evidence === 'verified') {
    // `metadataProblems` refuses verified with no sources, so the first branch
    // should be unreachable. Written correctly anyway: a fallback that lies is
    // worse than one that never runs.
    basis = n === 0 ? 'checked against nothing' : `${ON_WHAT.verified} ${sources}`
  } else {
    basis = ON_WHAT[m.evidence]
    basis +=
      n === 0
        ? ', nothing cited'
        : // Sources on an inferred finding are what it drew ON, not what it
          // verified against, and keeping those apart is the distinction #185
          // turns on.
          `, drawing on ${sources}`
  }

  const parts = [`${sure} — ${basis}.`]
  if (!m.reviewed) parts.push(':warning: *Nobody has checked this yet.*')
  return parts.join(' ')
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
 * The actions that go behind a `⋯` rather than taking a row to themselves.
 *
 * Grant, 13 September, on a phone: *"how much space is being taken up"*. Slack
 * stacks buttons FULL WIDTH on mobile, so four of them is most of a screen and
 * two messages is more than a screen of buttons. He was looking at 👍, 👎, Mute
 * 24h and More detail, in four blocks, under three lines of text.
 *
 * These two are the ones that are not peers of a thumbs-up: nobody scans a
 * message for "Mute 24h". They keep working, they stop costing a row each.
 *
 * What deliberately stays a BUTTON: 👍 and 👎, which are the whole of #59's
 * feedback loop and have to be one tap; Undo, because CLAUDE.md already
 * records that undo is the SAFE action and discouraging it is the failure
 * mode — hiding it behind a menu discourages it exactly as much as colouring
 * it red would; Open project, which carries a `url` and so cannot be an
 * overflow option at all; and approve/decline, which ARE the message.
 */
const BEHIND_THE_MENU: ReadonlySet<ActionId> = new Set(['mute_24h', 'more_detail'])

/**
 * Buttons, packed into as many `actions` blocks as the 5-per-block limit needs,
 * with the secondary ones folded into one overflow.
 *
 * §12 lists six buttons. Slack allows five per block. Putting all six in one
 * block does not error — the sixth is dropped — so this is the shape of a bug
 * that only shows up as a missing Undo when somebody wanted one.
 *
 * The overflow counts as ONE element against that five, which is the other
 * reason to use it: it buys back two slots as well as two rows.
 */
export function actionBlocks(
  actions: readonly ActionId[],
  correlationId: string,
  projectUrl?: string | null,
): readonly SlackBlock[] {
  /*
    Only fold when there is something to fold into it.

    A `⋯` next to a single button reads as a menu with one thing in it, which
    is worse than the button it replaced — and an approval request, which has
    exactly two buttons and neither of them secondary, must not grow one.
  */
  const secondary = actions.filter((a) => BEHIND_THE_MENU.has(a))
  const primary = actions.filter((a) => !BEHIND_THE_MENU.has(a))
  const fold = secondary.length >= 2 && primary.length >= 1
  const shown = fold ? primary : actions

  const overflow: SlackBlock[] = fold
    ? [
        {
          type: 'overflow',
          action_id: 'more_actions',
          options: secondary.map((a) => ({
            text: { type: 'plain_text', text: truncate(BUTTON_TEXT[a], MAX_BUTTON_TEXT) },
            // The SAME value a button would carry, so the interaction handler
            // reads one shape whichever control was pressed.
            value: buttonValue(a, correlationId),
          })),
        },
      ]
    : []

  return actionBlocksOf(shown, correlationId, projectUrl, overflow)
}

function actionBlocksOf(
  actions: readonly ActionId[],
  correlationId: string,
  projectUrl: string | null | undefined,
  extra: readonly SlackBlock[],
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
  /*
    The overflow joins the LAST block, so it sits on the same row as the final
    button rather than making a row of its own — which would undo the whole
    point of it.

    Only when there is room: it counts as one of the five, and appending a
    sixth element is the silent-drop bug this function's header is about.
  */
  const last = blocks[blocks.length - 1]
  if (extra.length > 0) {
    const room =
      last !== undefined &&
      (last.elements as unknown[]).length + extra.length <= MAX_ACTION_ELEMENTS
    if (room && last !== undefined) {
      ;(last.elements as unknown[]).push(...extra)
    } else {
      blocks.push({
        type: 'actions',
        block_id: `actions-more-${correlationId}`,
        elements: [...extra],
      })
    }
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
    /*
      A routine read says nothing about how sure it is, because there is
      nothing to be unsure about — see `MessageMetadata.routine`. The
      contradiction below is deliberately OUTSIDE that condition: a mechanical
      read that produced a disagreement is the one case where a status line has
      something a person must see.
    */
    if (!message.metadata.routine) blocks.push(context([provenanceLine(message.metadata)]))
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

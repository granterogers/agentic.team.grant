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
import type { ActionId } from '../slack/blocks.ts'
import { attestsSomething, provenanceLine } from '../slack/blocks.ts'

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
  approve: '✅ Go ahead',
  decline: '🚫 Not now',
}

/** Escape for `parse_mode: HTML`. Exactly three characters, and no more. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface PagerMetadata {
  readonly confidence: Confidence
  readonly evidence: Evidence
  readonly reviewed: boolean
  /**
   * What it drew on, or verified against.
   *
   * Added with #186, when the provenance line became the same shared English
   * Slack uses. It was not here before because the old line never mentioned
   * sources — and defaulting it to empty would have made the pager say
   * "nothing cited" about a finding with five citations, which is precisely
   * the honesty rule that change tightened.
   *
   * The caller has it: `pager.page` receives the whole `HandlerOutput`.
   */
  readonly sources: readonly string[]
  readonly contradictions: string | null
  /**
   * True when the output is a mechanical read rather than a judgement.
   *
   * The same flag Slack carries, for the same reason and read from the same
   * column — see `MessageMetadata.routine` in `src/slack/blocks.ts`. Optional
   * here only so that the several callers that build a page by hand are not
   * all made to say `routine: false`; absent means "a judgement", which is the
   * cautious reading and the one the honesty rules are written for.
   */
  readonly routine?: boolean
}

export interface PagerMessage {
  readonly staffName: string | null
  readonly staffTitle: string | null
  /**
   * Which project this is about.
   *
   * Grant: *"I certainly don't want a different bot per role per project. So a
   * single bot, like it was a human — but obviously their messages should be
   * clear which project they're referring to. So it's probably a good idea that
   * the first line and the last line of each of their messages refers to the
   * project."*
   *
   * Both ends, and both for a reason. The first line is what a lock-screen
   * notification shows, so it is the only line most of these are read at. The
   * last is what remains on screen after a long message pushes the header off
   * the top — the moment you decide whether to act, which is exactly when you
   * need to know what you are acting on.
   */
  readonly projectName?: string | null
  readonly body: string
  readonly metadata: PagerMetadata | null
  readonly correlationId: string
  readonly actions: readonly ActionId[]
  readonly projectUrl?: string | null
  /**
   * Set for an operational notice (#413): a heading above short paragraphs, and none of an answer's furniture.
   * See `HandlerOutput.notice`.
   */
  readonly notice?: { readonly heading?: string }
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
 * The format is `<action>:<correlation>`, which is exactly what
 * `src/channels/telegram.ts` has parsed since Phase 3. That sounds obvious and
 * was not: the first version of this file invented one-character wire codes to
 * save space against Telegram's 64-BYTE limit, and would have produced buttons
 * the deployed webhook rejected as unrecognised — a keyboard of six dead
 * buttons, with every unit test on both sides passing, because neither side was
 * ever tested against the other.
 *
 * The limit turned out not to bind anyway: the longest canonical action is
 * `open_project` at twelve characters, plus a colon and a 36-character uuid,
 * is 49 bytes. The check below stays, because "it fits today" is not the same
 * as "it fits".
 *
 * Treated as untrusted on the way back in even though we wrote it: it
 * round-trips through a client, and §10 forbids free-form input reaching a
 * lookup.
 */
export const CALLBACK_ACTIONS: Readonly<Record<ActionId, string>> = {
  'feedback.useful': 'useful',
  'feedback.not_useful': 'not_useful',
  undo: 'undo',
  open_project: 'open_project',
  mute_24h: 'mute_24h',
  more_detail: 'more_detail',
  approve: 'approve',
  decline: 'decline',
}

export class CallbackDataTooLongError extends Error {
  constructor(readonly bytes: number) {
    super(
      `callback_data is ${String(bytes)} bytes; Telegram accepts ${String(CALLBACK_DATA_MAX_BYTES)}`,
    )
    this.name = 'CallbackDataTooLongError'
  }
}

export function callbackData(action: ActionId, correlationId: string): string {
  const data = `${CALLBACK_ACTIONS[action]}:${correlationId}`
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
 * The keyboard of an operational notice (#413): one URL button when the notice has somewhere to send the person, and no
 * keyboard at all when it has not. A URL button sends no callback, so nothing here needs a handler on the way back.
 */
export function noticeKeyboard(
  link: { readonly label: string; readonly url: string } | undefined,
): readonly (readonly InlineButton[])[] {
  if (link === undefined) return []
  return [[{ text: link.label.slice(0, BUTTON_TEXT_LIMIT), url: link.url }]]
}

/**
 * The text of a pager message.
 *
 * Provenance is one short line and always carries confidence WITH evidence, for
 * the reason §12 gives: "high confidence" alone reads as an observation. An
 * unreviewed output is labelled first, before the body, because on a phone the
 * first line is often the only line read.
 */
/**
 * Slack's `*bold*` into Telegram's `<b>`, and everything else escaped.
 *
 * Escaping FIRST and converting after, so a body containing a literal `<` is
 * still safe and a pair of asterisks still becomes bold. The other way round —
 * convert then escape — turns the tags this just added into visible text.
 */
/**
 * Slack's emoji shortcodes, which Telegram has never heard of.
 *
 * `:warning:` is a name Slack resolves against its own emoji set. Telegram's
 * HTML parse mode resolves nothing, so the eight characters arrive on Grant's
 * phone as eight characters — Slack vocabulary leaking into a surface that
 * does not speak it, which is #208's whole complaint wearing a different hat.
 *
 * Translated generally rather than one shortcode at a time, and anything not
 * on the list is REMOVED rather than passed through: an unknown shortcode is a
 * name only Slack can resolve, so its literal text is never the right answer.
 * Losing a decoration is cheap; showing him a colon-wrapped word is not.
 */
const SLACK_EMOJI: Readonly<Record<string, string>> = {
  warning: '\u26a0\ufe0f',
  white_check_mark: '\u2705',
  heavy_check_mark: '\u2714\ufe0f',
  rotating_light: '\ud83d\udea8',
  bulb: '\ud83d\udca1',
  memo: '\ud83d\udcdd',
  pencil: '\u270f\ufe0f',
  calendar: '\ud83d\udcc5',
  file_folder: '\ud83d\udcc1',
  speech_balloon: '\ud83d\udcac',
  mag: '\ud83d\udd0d',
  microscope: '\ud83d\udd2c',
  books: '\ud83d\udcda',
  compass: '\ud83e\udded',
  gear: '\u2699\ufe0f',
  shield: '\ud83d\udee1\ufe0f',
  abacus: '\ud83e\uddee',
  chart_with_upwards_trend: '\ud83d\udcc8',
  chess_pawn: '\u265f\ufe0f',
  hourglass: '\u23f3',
  information_source: '\u2139\ufe0f',
}

/*
  A shortcode must START with a letter and be at least two characters, and may
  not sit against a word character on either side. That is what keeps "3:2:1"
  and "12:30" out of it — neither has a letter between the colons — while
  still catching a shortcode at the start of a line or in the middle of a
  sentence.
*/
const SHORTCODE = /(?<![A-Za-z0-9_]):([a-z][a-z0-9_+-]+):(?![A-Za-z0-9_])/g

/**
 * What to do with a shortcode nobody has a character for.
 *
 * `strip` for text the OFFICE composes — the provenance line, a header, any
 * furniture. There, an unresolvable name is our own mistake and showing it to
 * Grant is never the right answer.
 *
 * `keep` for the model's own body. Deleting words a message actually said is
 * worse than a stray colon-wrapped one: the reader can see past punctuation,
 * and cannot see past a sentence with a hole in it. A KNOWN shortcode is still
 * translated there, because the emoji is unambiguously what was meant.
 */
export function slackEmojiToUnicode(line: string, unknown: 'strip' | 'keep'): string {
  const out = line.replace(SHORTCODE, (whole, name: string) => {
    const known = SLACK_EMOJI[name]
    if (known !== undefined) return known
    return unknown === 'strip' ? '' : whole
  })
  return unknown === 'strip'
    ? out
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/(^|\n) +/g, '$1')
        .replace(/ +(\n|$)/g, '$1')
    : out
}

/**
 * Slack's bold into Telegram's tags, and everything else escaped.
 *
 * Escaping FIRST and converting after, so a body containing a literal less-than
 * is still safe and a pair of asterisks still becomes bold. The other way round
 * — convert then escape — turns the tags this just added into visible text.
 *
 * Emoji shortcodes go last, on text that is already escaped: every character a
 * shortcode is made of survives escaping unchanged, so the order costs nothing
 * and the unicode it emits is not something to escape.
 */
function slackEmphasisToHtml(line: string): string {
  return slackEmojiToUnicode(escapeHtml(line).replace(/\*([^*]+)\*/g, '<b>$1</b>'), 'strip')
}

export function pagerText(message: PagerMessage): string {
  const parts: string[] = []

  /**
   * What a project is CALLED on a phone (#208).
   *
   * `Unnamed` is the reserved project 0334 created for anything that names no
   * project — Grant's own framing: *"you can just create an untitled or undefined
   * project. Stuff that's not a bit specific project."* It is an excellent
   * internal name and a poor thing to read on a lock screen, because it describes
   * a database row rather than what is in front of you.
   *
   * Grant, 14 September: *"just see conversation rather than unnamed."*
   *
   * Only the reserved one is renamed. A real dashboard project keeps its real
   * name — that name is the answer to "which project is this about", which is the
   * whole reason the header exists.
   */
  const displayProject = (name: string): { label: string; mark: string } =>
    name.toLowerCase() === 'unnamed'
      ? /*
           A speech bubble, not a folder. The header answers "what is this
           about" at a glance, and a filing-cabinet icon on something that is
           explicitly NOT filed anywhere answers it wrongly, which is the same
           mismatch as showing the internal name.
        */
        { label: 'Conversation', mark: '💬' }
      : { label: name, mark: '📁' }

  const project =
    message.projectName === undefined ||
    message.projectName === null ||
    message.projectName.trim() === ''
      ? null
      : displayProject(message.projectName.trim())

  // First line, before even the review warning. One bot speaks across every
  // project, so "which project" is the first question every one of these raises
  // and the lock screen shows one line.
  //
  // ONCE, not twice. It used to be repeated as a footer under the provenance
  // line, on the reasoning that a long message pushes the header off the top —
  // true, and it made a two-line hello say the same word at both ends. Grant,
  // 14 September: "I don't need unnamed to be twice. Certainly don't need to
  // see it twice." (#208)
  if (project !== null) parts.push(`${project.mark} <b>${escapeHtml(project.label)}</b>`)

  const warnedUnreviewed =
    message.notice === undefined && message.metadata !== null && !message.metadata.reviewed
  if (warnedUnreviewed) {
    parts.push('⚠️ <b>Not reviewed</b> — do not rely on this yet')
  }

  /*
    No sender line (#208).

    It used to say "Claire and her title" above every message. Grant, 14
    September: "I don't need to see the contact's name and the message. I
    already have it, so you can remove that."

    Right twice over. `telegram.only_chief_speaks` is true, so it is always
    her; and since #70 the bot IS hers, so the chat is named after her at the
    top of his screen. Repeating it on every message is the product
    introducing itself to somebody who already knows who is talking, which is
    the opposite of the "more human, more personable" he asked for.

    `staffName` and `staffTitle` stay on the type: Slack still shows them, and
    it should, because several people post there.
  */

  /*
    The body goes through the emoji translation too, and keeps what the
    translation does not know (#208). A model that writes a check-mark
    shortcode meant the check mark; a model that writes something only Slack
    could resolve still wrote a word, and removing words from an answer is a
    worse failure than leaving one oddly punctuated.
  */
  if (message.notice !== undefined) {
    /*
      A NOTICE IS NOT AN ANSWER (#413).

      A heading, then the body with its paragraph breaks kept and its `*bold*` markers turned into tags. No provenance
      line (a notice claims nothing to be confident about), no unreviewed warning (nothing was drafted) and no body
      trimming that could cut the one sentence saying what to do: a notice is composed in code, to fit.
    */
    if ((message.notice.heading ?? '') !== '') {
      parts.push(`<b>${escapeHtml(message.notice.heading ?? '')}</b>`)
    }
    parts.push(
      message.body
        .trim()
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.split('\n').map(slackEmphasisToHtml).join('\n'))
        .join('\n\n'),
    )
    const noticeText = parts.join('\n\n')
    return noticeText.length <= TELEGRAM_MAX_TEXT
      ? noticeText
      : `${noticeText.slice(0, TELEGRAM_MAX_TEXT - 1)}…`
  }

  parts.push(slackEmojiToUnicode(escapeHtml(trimForPager(message.body)), 'keep'))

  if (message.metadata !== null) {
    /*
      The same English as Slack (#186), from the same function.

      This said "medium confidence · evidence: inferred" — three internal field
      names — and Slack said exactly the same until Grant looked at his phone
      and called it *"not intuitive or acting like it's a human"*. Fixing one
      surface and leaving the other is how two channels end up describing the
      same output in two vocabularies.

      `provenanceLine` is pure and already shared through `Confidence` and
      `Evidence`, so this is an import rather than a second implementation —
      which is the whole reason the Slack one was worth putting in a function.
      It emits Slack's `*bold*`; Telegram wants tags, so the markers are
      converted rather than the sentence rewritten.
    */
    // Skipped for a mechanical read, exactly as in Slack. A pager line saying
    // "Confident — checked against 1 source" under "Calendar refreshed" spends
    // a line of a lock screen on nothing.
    /*
      And skipped again when the line could only report that nothing happened
      (#208).

      `routine` covers a mechanical read. This covers the other case Grant
      objected to: a message that claims nothing, carrying "Fairly confident —
      worked out, not looked up, nothing cited." Two absences under "I'm here.
      No need for a meeting."

      `attestsSomething` is shared with Slack and is narrow on purpose — it
      consults the BODY, because the metadata on that harmless hello is
      identical to the metadata on #185's five invented projects. What
      separates them is whether the words claim a read, and anything that does
      keeps its provenance beside it.
    */
    if (message.metadata.routine !== true && attestsSomething(message.metadata, message.body)) {
      /*
        Without the unreviewed clause when the header already carried it (#208).

        Those two lines are pushed under exactly the same condition, so the
        warning was reaching Grant twice in every unreviewed message — once in
        bold above the body and once in grey italics below it. The prominent
        one is the one worth keeping: on a phone the first line is often the
        only line read, which is why it is first.
      */
      const line = provenanceLine(message.metadata, { unreviewed: warnedUnreviewed })
      parts.push(`<i>${slackEmphasisToHtml(line)}</i>`)
    }
  }

  const text = parts.join('\n\n')
  // Belt and braces. The trim above makes this unreachable for any realistic
  // message, and an unreachable guard on a hard API failure is worth its two
  // lines.
  return text.length <= TELEGRAM_MAX_TEXT ? text : `${text.slice(0, TELEGRAM_MAX_TEXT - 1)}…`
}

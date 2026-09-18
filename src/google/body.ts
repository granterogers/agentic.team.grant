/**
 * What a message actually said, and the three reasons it may not be held.
 *
 * ADR-0037 decided the office would fetch `format=metadata` and never transfer
 * a body. Grant reopened that deliberately (#172, ADR-0038), so this is the
 * parsing half: Gmail hands back a MIME tree with base64url leaves, and the
 * thing worth storing is one paragraph of that tree with the reply chain taken
 * off.
 *
 * Kept out of `mail.ts` because every decision here is testable without a
 * network, and because `mail.ts` is already the file that talks to Google.
 */

/** Gmail's payload, as much of it as matters here. */
export interface Part {
  readonly mimeType?: string
  readonly filename?: string
  readonly body?: { readonly data?: string; readonly size?: number }
  readonly parts?: readonly Part[]
  readonly headers?: readonly { readonly name?: string; readonly value?: string }[]
}

/**
 * Why a message is held without its words. Null means it is held WITH them.
 *
 * 0304's asymmetry, and the reason this is a union rather than a boolean: a
 * reader that cannot tell "the office chose not to read this" from "the office
 * has not looked yet" will eventually report the first as a fact about the
 * message.
 */
export type Withheld = 'bulk' | 'no text part' | 'too large' | null

/**
 * The ceiling on one stored body.
 *
 * Not a Gmail limit — a disclosure and a budget one. Thirty thousand
 * characters is a long letter and about eight thousand tokens; past that the
 * message is a newsletter, a digest or an attachment somebody pasted, and
 * storing it buys nothing the snippet does not already give.
 */
export const TOO_BIG = 30_000

/**
 * Gmail encodes every leaf as base64url, which is NOT base64: `-` and `_`
 * stand in for `+` and `/`, and the padding is dropped. Feeding it straight to
 * `atob` returns plausible-looking mojibake rather than throwing, which is the
 * failure that does not announce itself.
 */
export function decodeBody(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/')
  const full = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  try {
    // A UTF-8 body decoded as latin-1 gives "â€™" where an apostrophe was, and
    // the PDF tier already records what one wrong encoding costs downstream.
    return new TextDecoder('utf-8').decode(Uint8Array.from(atob(full), (c) => c.charCodeAt(0)))
  } catch {
    return ''
  }
}

/** A crude but honest HTML-to-text, for a message that has no plain part. */
export function textFromHtml(html: string): string {
  return (
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      /*
        The quoted chain, removed while it is still MARKED UP (#172).

        In HTML mail the reply chain lives in a blockquote, and every client
        that matters puts it there. Removing it here rather than after
        conversion is strictly better, because the conversion is what destroys
        the evidence: the tag says "this is quoted" unambiguously, and the
        plain text it becomes says so only by convention.

        Found by running the real inbox. Five of fourteen held bodies still
        contained the attribution line after stripping, and the line-anchored
        matcher in stripQuoted matched NONE of them — zero at line start out of
        five present — because the conversion had left it mid-line. A regex
        that can never match is the trap CLAUDE.md records, and the only thing
        that found it was thirty real messages.
      */
      .replace(/<blockquote[\s\S]*$/gi, ' ')
      .replace(/<div[^>]*gmail_quote[\s\S]*$/gi, ' ')
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      /*
      A closing tag becomes a newline and the NEXT opening tag becomes a space,
      so every line after the first began with one. Harmless to read and not
      harmless to index: a leading space is a character of the 1,500 budget on
      every line, and it makes two identical paragraphs compare unequal.
    */
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * The text of a message, preferring the plain part over the HTML one.
 *
 * An attachment is skipped by its `filename`, not by its MIME type: a PDF
 * arrives as `application/pdf` and is easy, but a forwarded `.txt` arrives as
 * `text/plain` WITH a filename and would otherwise be read as the letter.
 */
export function textOf(payload: Part | undefined): string {
  if (payload === undefined) return ''
  const plain: string[] = []
  const html: string[] = []

  const walk = (part: Part): void => {
    if ((part.filename ?? '') !== '') return
    const type = (part.mimeType ?? '').toLowerCase()
    const data = part.body?.data
    if (data !== undefined && data !== '') {
      if (type === 'text/plain') plain.push(decodeBody(data))
      else if (type === 'text/html') html.push(decodeBody(data))
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(payload)

  if (plain.length > 0) return plain.join('\n').trim()
  if (html.length > 0) return textFromHtml(html.join('\n'))
  return ''
}

/**
 * Where the new words end and the conversation behind them begins.
 *
 * Every reply re-sends the whole thread, so a ten-message thread stored whole
 * holds the first message ten times: three times the corpus, three times the
 * disclosure, and a search that ranks the longest thread rather than the most
 * relevant one. The markers are the ones mail clients actually emit; the
 * earliest one wins, because a chain quoted inside a chain would otherwise
 * keep the outer copy.
 *
 * It errs towards keeping text. A reply with no marker is stored whole, which
 * is redundant; a rule aggressive enough to never miss one would eventually
 * cut a message in half at a line that merely looked like a quote, and losing
 * what somebody actually wrote is the worse direction.
 */
const QUOTE_MARKERS: readonly RegExp[] = [
  /*
    "On 12 September 2026 at 14:03, Jane Smith <jane@x.com> wrote:"

    Refuted TWICE by the real inbox, which is why this comment is long.

    It was `^\\s*On .{6,140}wrote:\\s*$` — a whole line. Thirty live messages
    said five held bodies contained the attribution and **zero of them had it
    at the start of a line**, so the matcher could never have fired. Loosening
    it to a word boundary was the obvious fix, it shipped, and the next live
    run produced *the identical five*: `.` does not match a newline, and a
    plain-text attribution WRAPS — the address ends one line and `wrote:`
    begins the next. Measured rather than guessed: 0 matches for
    `On [^newline]{6,140}wrote:` against 5 for the same pattern with newlines
    allowed.

    `[\\s\\S]` crosses the wrap and the quantifier is LAZY, so the span taken is
    the shortest one that reaches a `wrote:` — which keeps the cut at the real
    attribution rather than at some later one, and bounds how much prose a
    false match could swallow.

    The lesson, and it is one this repository has paid for before: a regex that
    matches nothing is invisible, and the only thing that found this was
    counting how often it fired against real data.
  */
  /(^|\s)On [\s\S]{6,140}?wrote:/m,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  /^\s*_{10,}\s*$/m,
  // Outlook's header block, which has no dashes at all.
  /^\s*From:\s*.+\n\s*Sent:\s*.+$/im,
  /^\s*Sent from my (iPhone|iPad|Android|Samsung)/im,
]

export function stripQuoted(raw: string): string {
  let cut = raw.length
  for (const marker of QUOTE_MARKERS) {
    const found = marker.exec(raw)
    if (found !== null && found.index < cut) cut = found.index
  }
  let text = raw.slice(0, cut)

  /*
    Then the line-wise chain that has no header at all — some clients quote
    with `>` and nothing else. Only a RUN of them at the end is removed, so a
    single `>` used as punctuation mid-letter survives.
  */
  const lines = text.split('\n')
  let end = lines.length
  while (end > 0) {
    const line = (lines[end - 1] ?? '').trim()
    if (line === '' || line.startsWith('>')) end -= 1
    else break
  }
  text = lines.slice(0, end).join('\n')

  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Mail the office keeps knowing about and deliberately does not read.
 *
 * Grant's inbox is mostly newsletters, receipts and clinic mail — the #172
 * comments measured it — and none of that is the office's business. Withholding
 * the body of bulk mail is a privacy narrowing AND a quality one: a corpus
 * without marketing copy in it is a corpus where a body match means something.
 *
 * Decided from Gmail's own classification and the `List-Unsubscribe` header
 * rather than from a word list. A word list would be an enumeration of the
 * shapes marketing takes, which is the thing that goes stale.
 */
export function isBulk(
  labels: readonly string[],
  headers: readonly { readonly name?: string; readonly value?: string }[] = [],
): boolean {
  const CATEGORIES = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'])
  if (labels.some((l) => CATEGORIES.has(l))) return true
  return headers.some((h) => {
    const name = (h.name ?? '').toLowerCase()
    return name === 'list-unsubscribe' || name === 'list-id' || name === 'precedence'
  })
}

export interface Held {
  readonly body: string | null
  readonly withheld: Withheld
}

/**
 * Everything above, in the order the decisions actually have to be made.
 *
 * Bulk is decided FIRST, before any decoding, because the point of withholding
 * it is that the office never holds it — deciding afterwards would mean the
 * newsletter had already been decoded into memory, which is the distinction
 * ADR-0037 drew about `format=metadata` in the first place.
 */
export function heldBody(
  payload: Part | undefined,
  labels: readonly string[],
  headers: readonly { readonly name?: string; readonly value?: string }[] = [],
): Held {
  if (isBulk(labels, headers)) return { body: null, withheld: 'bulk' }
  const text = stripQuoted(textOf(payload))
  if (text === '') return { body: null, withheld: 'no text part' }
  if (text.length > TOO_BIG) return { body: null, withheld: 'too large' }
  return { body: text, withheld: null }
}

/**
 * A report, laid out (#258).
 *
 * `pdf.ts` knows about bytes and `metrics.ts` knows how wide a character is.
 * This is the layer that knows a report has a cover, that a heading with one
 * line under it at the foot of a page is a defect, and that a table needs a
 * rule under its header row.
 *
 * ## The quality bar, restated as code
 *
 * Grant's Issue is explicit that *"generate a PDF" must not mean dumping plain
 * model text into a minimally formatted page*, and lists what it does mean:
 * hierarchy, professional typography, sensible whitespace and pagination,
 * tables and charts where useful, citations, page numbers, no clipped content.
 * Each of those is a thing this module does rather than a thing it hopes for,
 * and the two that are usually left to luck are handled explicitly:
 *
 *   - **nothing overflows**, because every line is measured before it is
 *     placed and a word that cannot fit even alone is recorded as a PROBLEM
 *     rather than drawn past the margin;
 *   - **no heading is stranded**, because a heading that cannot keep two lines
 *     of what follows it moves to the next page with them.
 *
 * `layout` returns the problems it found alongside the pages, and the pipeline
 * refuses to claim success while there are any. That is the Issue's own rule:
 * the office must never claim an artifact was created unless the evidence says
 * it was.
 *
 * ## The type scale
 *
 * Helvetica for structure and Times for prose, which is the oldest working
 * pairing there is and needs no embedded font. Sizes are a ratio rather than a
 * list of numbers somebody liked: 10.5pt body on 15.5pt leading is a 1.48
 * measure, and the headings step by roughly 1.3.
 */

import type { Face } from './metrics.ts'
import { A4, assemble, type DocumentInfo, Page, widthOf } from './pdf.ts'
import { layoutCollisions } from './qa.ts'
import { DEFAULT_THEME, resolveTheme, type StyleProfile, type Theme } from './style.ts'

// --- the design system, such as it is ---------------------------------------

/*
  The colours and type scale live in `style.ts` now, as a THEME: `DEFAULT_THEME` is exactly the look every report had
  before house styles existed, and `layout` swaps in a profile's theme for the duration of one (synchronous) layout.
  Module-level state, deliberately: a theme threaded through eleven helpers is eleven chances to forget it, and this
  runs to completion before anything else can read it.
*/
let T: Theme = DEFAULT_THEME

const MARGIN = { bottom: 64, left: 64, right: 64, top: 72 } as const
const COLUMN = A4.width - MARGIN.left - MARGIN.right

// --- what a report is made of -----------------------------------------------

export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string; readonly lead?: boolean }
  | { readonly kind: 'bullets'; readonly items: readonly string[] }
  | { readonly kind: 'numbers'; readonly items: readonly string[] }
  | { readonly kind: 'quote'; readonly text: string; readonly attribution?: string }
  | {
      readonly kind: 'table'
      readonly columns: readonly string[]
      readonly rows: readonly (readonly string[])[]
      readonly caption?: string
    }
  | {
      readonly kind: 'chart'
      readonly title: string
      readonly bars: readonly { readonly label: string; readonly value: number }[]
      readonly caption?: string
    }
  | { readonly kind: 'pagebreak' }

/**
 * The line under the title on the cover — taken from the DOCUMENT, never from
 * the request that asked for it.
 *
 * Both call sites in `handlers/artifact.ts` passed `brief.slice(0, 400)`, so
 * the cover of every report the office has produced printed Grant's own
 * instruction back at him:
 *
 *     Legacy Coaching Course – Module Status Report
 *     2026-09-17
 *     ──────────
 *     Write me a PDF report on the coaching course modules, from what we hold.
 *
 * …and then two thirds of an empty page, because that was the only body
 * content on it. A request is not a subtitle. It is the thing the document
 * answers, and printing it on the cover is the paper equivalent of a reply
 * that opens by repeating the question.
 *
 * Found by OPENING the PDF. `validatePdf` checks the structure — header,
 * trailer, xref offsets, page count — and every one of those was correct;
 * CLAUDE.md already records that a structural check cannot see a collision,
 * and it cannot see this either.
 *
 * The document's own opening sentence is the honest line: it says what the
 * report found rather than what was asked. An empty string when there is no
 * prose to take it from, which the cover already handles — it is laid out to
 * leave deliberate space, not to need filling.
 */
/**
 * How many lines of lead the cover will carry before it stops being a cover.
 *
 * Six is about a paragraph. Above that the title page has become the first
 * page of the report, which is a different document.
 */
export const COVER_LINES = 6

/**
 * What the cover takes from the document, and whether the body still owes it.
 *
 * ## The repetition this exists to stop
 *
 * `coverLine` took the first SENTENCE of the opening paragraph, and the body
 * then printed that paragraph in full — so the identical sentence appeared
 * twice, an inch apart, on the cover and at the top of page two. Found by
 * rendering a report and looking at it; every structural check passed over it,
 * and CLAUDE.md already records that when two lines are pushed under the same
 * condition, one of them is a repetition.
 *
 * ## Why `consumed` rather than two functions
 *
 * The cover and the body have to agree about this, and two places deciding
 * "did the cover already say it" by eye is how they come to disagree — the
 * defect this file has now produced twice. One answer, two readers.
 *
 * When the whole opening paragraph fits the cover it becomes the standfirst
 * and the body omits it: the cover stops being two thirds empty and the
 * duplication goes. When it does not fit, the cover takes one clause as
 * before and the body keeps the paragraph, because losing text to fit a title
 * page would be the worse trade.
 */
export function coverTakes(blocks: readonly Block[]): {
  readonly line: string
  readonly consumed: boolean
} {
  const first = blocks.find(
    (b): b is Extract<Block, { kind: 'paragraph' }> =>
      b.kind === 'paragraph' && b.text.trim() !== '',
  )
  if (first === undefined) return { consumed: false, line: '' }
  const whole = first.text.trim().replace(/\s+/g, ' ')
  const fits = wrap(whole, T.type.lead.face, T.type.lead.size, COLUMN).lines.length <= COVER_LINES
  return fits ? { consumed: true, line: whole } : { consumed: false, line: coverLine(blocks) }
}

export function coverLine(blocks: readonly Block[]): string {
  const first = blocks.find(
    (b): b is Extract<Block, { kind: 'paragraph' }> =>
      b.kind === 'paragraph' && b.text.trim() !== '',
  )
  if (first === undefined) return ''
  const text = first.text.trim().replace(/\s+/g, ' ')
  /*
    One clause, and cut at a WORD.

    A whole paragraph under a 30pt title is a second paragraph, not a
    subtitle, and the cover has room for about two lines. A semicolon counts
    as an end here because a model writing prose joins two perfectly good
    cover lines with one — the real sentence this was found on runs 214
    characters to its first full stop.

    Cutting at 197 characters produced *"…the coaching focus and client
    enga…"* on the rendered cover. CLAUDE.md: a length cap that cuts mid-word
    is the clipped content a layout is checked for, arriving through the
    guard instead. Worse, the first version of the test asserted the LENGTH
    and the ellipsis, and both were true of that. The test was satisfied by a
    bad output — so it asserts the word boundary now.
  */
  const stop = text.search(/[.!?;](\s|$)/)
  const one = (stop === -1 ? text : text.slice(0, stop + 1)).replace(/;$/, '')
  if (one.length <= 200) return one
  const cut = one.slice(0, 199)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace === -1 ? cut : cut.slice(0, lastSpace)).trimEnd()}…`
}

/** Where a fact in the report came from, which #258 requires on every artifact. */
export interface Citation {
  readonly label: string
  /** The office's own source reference, e.g. `notion:<uuid> Title`. */
  readonly ref: string
}

export interface Report {
  readonly title: string
  readonly subtitle: string
  readonly author: string
  readonly created: Date
  readonly blocks: readonly Block[]
  readonly sources: readonly Citation[]
}

/** What layout produced, and everything wrong with it. */
export interface Laid {
  readonly pages: readonly Page[]
  /** Empty is the only acceptable value. Anything here fails the artifact. */
  readonly problems: readonly string[]
  /** What a house style asked for that was not drawn. Informational: it never fails an artifact. */
  readonly notes: readonly string[]
}

// --- measuring ---------------------------------------------------------------

/**
 * Break a string into lines that fit, and say when one cannot.
 *
 * A word longer than the column is not silently drawn past the margin and not
 * silently dropped: it is broken at the character that stops fitting and the
 * caller is told, because a URL in a citation is exactly such a word and the
 * honest outcome is a hard break rather than a clipped page.
 */
export function wrap(
  text: string,
  face: Face,
  size: number,
  width: number,
): { lines: readonly string[]; broke: readonly string[] } {
  const lines: string[] = []
  const broke: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter((w) => w !== '')) {
      const candidate = line === '' ? word : `${line} ${word}`
      if (widthOf(candidate, face, size) <= width) {
        line = candidate
        continue
      }
      if (line !== '') lines.push(line)
      if (widthOf(word, face, size) <= width) {
        line = word
        continue
      }
      // A single word wider than the column. Break it rather than overflow.
      broke.push(word)
      let piece = ''
      for (const ch of word) {
        if (widthOf(piece + ch, face, size) > width && piece !== '') {
          lines.push(piece)
          piece = ch
          continue
        }
        piece += ch
      }
      line = piece
    }
    lines.push(line)
  }
  return { broke, lines }
}

// --- laying out ---------------------------------------------------------------

/**
 * The cursor, which is the whole layout engine.
 *
 * One page at a time, top down, with `y` falling. Everything that draws first
 * asks `room` whether what it is about to draw fits, and a block that does not
 * fit starts a page rather than running off the bottom. There is no
 * back-tracking and no float, which is why this is four hundred lines and not
 * a browser.
 */
class Flow {
  readonly pages: Page[] = []
  readonly problems: string[] = []
  private page: Page
  private y = 0

  constructor(private readonly title: string) {
    this.page = this.fresh()
  }

  private fresh(): Page {
    const page = new Page(A4.width, A4.height)
    page.rect(0, 0, A4.width, A4.height, T.paper)
    this.pages.push(page)
    this.y = A4.height - MARGIN.top
    return page
  }

  /** Start a new page unless the current one is untouched. */
  break_(): void {
    if (this.y < A4.height - MARGIN.top) this.page = this.fresh()
  }

  /**
   * Start a new page whatever the cursor says.
   *
   * The cover draws at absolute positions and never moves the cursor, so
   * `break_` saw an untouched page and did nothing -- and the first page of
   * the first report had the introduction printed straight over the title, in
   * a file that validated perfectly. Structural checks cannot see a collision;
   * only opening the page can, which is the whole of §14A.
   */
  forceBreak(): void {
    this.page = this.fresh()
  }

  /** Does `height` fit below the cursor? */
  room(height: number): boolean {
    return this.y - height >= MARGIN.bottom
  }

  need(height: number): void {
    if (!this.room(height)) this.page = this.fresh()
  }

  gap(height: number): void {
    this.y -= height
  }

  at(): number {
    return this.y
  }

  current(): Page {
    return this.page
  }

  /** Draw wrapped text from the cursor, and report anything that had to break. */
  paragraph(
    text: string,
    face: Face,
    size: number,
    lead: number,
    colour = T.ink,
    indent = 0,
    where = 'body',
  ): void {
    const { broke, lines } = wrap(text, face, size, COLUMN - indent)
    for (const w of broke) {
      this.problems.push(`a word too wide for the column had to be broken in ${where}: "${w}"`)
    }
    for (const line of lines) {
      this.need(lead)
      this.y -= lead
      this.page.text(line, MARGIN.left + indent, this.y, face, size, colour)
    }
  }

  /**
   * Running feet, added once at the end so the page count is known.
   *
   * The cover is deliberately left bare — a page number on a title page is
   * what a word processor does and a designer does not.
   */
  finish(): void {
    for (const [i, page] of this.pages.entries()) {
      if (i === 0) continue
      const label = `${String(i + 1)} / ${String(this.pages.length)}`
      page.line(
        MARGIN.left,
        MARGIN.bottom - 18,
        A4.width - MARGIN.right,
        MARGIN.bottom - 18,
        0.5,
        T.rule,
      )
      /*
        The title in the foot is cut at a word to leave room for the page number. A long title ran under it - found by
        the layout check (qa.ts), which reported the number printed over the last words of the title.
      */
      let foot = this.title
      const room = COLUMN - widthOf(label, T.type.caption.face, T.type.caption.size) - 24
      while (foot.length > 1 && widthOf(foot, T.type.caption.face, T.type.caption.size) > room) {
        const cut = foot.replace(/\u2026$/, '').replace(/\s*\S+$/, '')
        foot = `${cut === '' ? foot.slice(0, -2) : cut}\u2026`
      }
      page.text(
        foot,
        MARGIN.left,
        MARGIN.bottom - 32,
        T.type.caption.face,
        T.type.caption.size,
        T.ink3,
      )
      page.text(
        label,
        A4.width - MARGIN.right - widthOf(label, T.type.caption.face, T.type.caption.size),
        MARGIN.bottom - 32,
        T.type.caption.face,
        T.type.caption.size,
        T.ink3,
      )
    }
  }
}

/** The cover. Deliberately not a heading on page one. */
function cover(flow: Flow, report: Report): void {
  const page = flow.current()
  // A band is the field in the primary colour with the type reversed out of it; the standard cover is the wash.
  const band = T.titlePage === 'band'
  page.rect(0, A4.height - 260, A4.width, 260, band ? T.primary : T.wash)
  page.rect(0, A4.height - 264, A4.width, 4, T.accent)
  const onField = band ? T.paper : null

  const kicker = report.author.toUpperCase()
  page.text(kicker, MARGIN.left, A4.height - 120, T.type.h1.face, 9, onField ?? T.primary)

  /*
    A title that needs a third line is set a size smaller instead: at 30 points three lines left the date jammed
    against the last of them (seen in the rendered capture), and the field is a fixed height. One or two lines are
    exactly as before.
  */
  let titleSize = 30
  let titleLead = 36
  let { lines } = wrap(report.title, T.type.h1.face, titleSize, COLUMN)
  if (lines.length > 2) {
    titleSize = 25
    titleLead = 30
    lines = wrap(report.title, T.type.h1.face, titleSize, COLUMN).lines
  }
  let y = A4.height - 160
  let lastBaseline = y
  for (const line of lines.slice(0, 3)) {
    page.text(line, MARGIN.left, y, T.type.h1.face, titleSize, onField ?? T.ink)
    lastBaseline = y
    y -= titleLead
  }
  const when = report.created.toISOString().slice(0, 10)
  /*
    Under the LAST title line, not at a fixed height. A three-line title ends at A4.height - 232 and the date used to
    sit at -240, eight points below it: the layout check (qa.ts) found the date printed over the third line. Two lines
    or fewer still put it at -240, so no existing document moves.
  */
  page.text(
    when,
    MARGIN.left,
    Math.min(A4.height - 240, lastBaseline - 20),
    T.type.caption.face,
    9.5,
    onField ?? T.ink2,
  )

  // The subtitle sits BELOW the field, in the body face, because it is prose
  // and the title is not.
  const sub = wrap(report.subtitle, T.type.lead.face, T.type.lead.size, COLUMN)
  let sy = A4.height - 310
  for (const line of sub.lines) {
    page.text(line, MARGIN.left, sy, T.type.lead.face, T.type.lead.size, T.ink2)
    sy -= T.type.lead.lead
  }
  /*
    A foot on the cover, so the lower two thirds are deliberate space rather
    than a page that ran out of things to say.
  */
  page.line(MARGIN.left, 120, A4.width - MARGIN.right, 120, 0.8, T.rule)
  /*
    The author is NOT repeated here.

    The kicker at the top of this same page is the author, in the accent, in
    small caps. Printing the name again eight inches below it is the same
    sentence twice on one page — visible in the first render of this cover and
    in nothing else, because a repetition is not overflow, not low contrast and
    not a dead control.

    What stays is the provenance line, which the kicker does not say and which
    is the one thing a person picking the document up needs to know about where
    it came from. It moves to the left, where the eye starts, now that it is
    alone on the rule.
  */
  const foot = 'Generated by the office from project material. Sources are listed at the end.'
  page.text(foot, MARGIN.left, 100, 'Helvetica', 8.5, T.ink3)

  flow.forceBreak()
}

function table(flow: Flow, block: Extract<Block, { kind: 'table' }>): void {
  const columns = block.columns.length
  if (columns === 0) return
  const width = COLUMN / columns
  const cellLines = (row: readonly string[]): number =>
    Math.max(
      1,
      ...row.map(
        (c) => wrap(c, T.type.tableCell.face, T.type.tableCell.size, width - 10).lines.length,
      ),
      ...(columns > row.length ? [1] : []),
    )

  const headHeight = T.type.tableHead.lead + 8
  flow.need(headHeight + T.type.tableCell.lead * 2)

  const drawHead = (): void => {
    const page = flow.current()
    const top = flow.at()
    page.rect(MARGIN.left, top - headHeight, COLUMN, headHeight, T.wash)
    for (const [i, name] of block.columns.entries()) {
      page.text(
        wrap(name, T.type.tableHead.face, T.type.tableHead.size, width - 10).lines[0] ?? '',
        MARGIN.left + i * width + 5,
        top - headHeight + 6,
        T.type.tableHead.face,
        T.type.tableHead.size,
        T.ink,
      )
    }
    page.line(MARGIN.left, top - headHeight, MARGIN.left + COLUMN, top - headHeight, 0.8, T.primary)
    flow.gap(headHeight)
  }

  drawHead()
  for (const row of block.rows) {
    const height = cellLines(row) * T.type.tableCell.lead + 8
    if (!flow.room(height)) {
      flow.break_()
      drawHead()
    }
    const page = flow.current()
    const top = flow.at()
    for (const [i, cell] of row.entries()) {
      const { lines } = wrap(cell, T.type.tableCell.face, T.type.tableCell.size, width - 10)
      let y = top - T.type.tableCell.lead
      for (const line of lines) {
        page.text(
          line,
          MARGIN.left + i * width + 5,
          y,
          T.type.tableCell.face,
          T.type.tableCell.size,
          T.ink,
        )
        y -= T.type.tableCell.lead
      }
    }
    page.line(MARGIN.left, top - height, MARGIN.left + COLUMN, top - height, 0.4, T.rule)
    flow.gap(height)
  }
  if (block.caption !== undefined) {
    flow.gap(6)
    flow.paragraph(
      block.caption,
      T.type.caption.face,
      T.type.caption.size,
      T.type.caption.lead,
      T.ink3,
      0,
      'a table caption',
    )
  }
}

/**
 * A bar chart, drawn as vectors.
 *
 * Horizontal bars rather than vertical, because a label under a vertical bar
 * either rotates or truncates and both look like a compromise. Labels sit
 * outside the plot and the value sits at the end of its own bar, so there is
 * no legend to read.
 */
function chart(flow: Flow, block: Extract<Block, { kind: 'chart' }>): void {
  const bars = block.bars.slice(0, 12)
  if (bars.length === 0) return
  const rowHeight = 20
  const height = bars.length * rowHeight + 34
  flow.need(height + 10)
  const page = flow.current()
  const top = flow.at()

  page.text(block.title, MARGIN.left, top - 12, 'Helvetica-Bold', 10, T.ink)
  const labelWidth = Math.min(
    150,
    Math.max(...bars.map((b) => widthOf(b.label, T.type.caption.face, T.type.caption.size))) + 10,
  )
  const plotLeft = MARGIN.left + labelWidth
  const plotWidth = COLUMN - labelWidth - 44
  const most = Math.max(...bars.map((b) => Math.abs(b.value)), 1)

  for (const [i, bar] of bars.entries()) {
    const y = top - 30 - i * rowHeight
    const w = Math.max(1, (Math.abs(bar.value) / most) * plotWidth)
    const label =
      wrap(bar.label, T.type.caption.face, T.type.caption.size, labelWidth - 8).lines[0] ?? ''
    page.text(label, MARGIN.left, y - 9, T.type.caption.face, T.type.caption.size, T.ink2)
    page.rect(plotLeft, y - 13, w, 11, T.primary)
    page.text(
      String(bar.value),
      plotLeft + w + 5,
      y - 9,
      T.type.caption.face,
      T.type.caption.size,
      T.ink2,
    )
  }
  page.line(plotLeft, top - 30 - bars.length * rowHeight + 5, plotLeft, top - 26, 0.6, T.rule)
  flow.gap(height)
  if (block.caption !== undefined) {
    flow.paragraph(
      block.caption,
      T.type.caption.face,
      T.type.caption.size,
      T.type.caption.lead,
      T.ink3,
      0,
      'a chart caption',
    )
    flow.gap(4)
  }
}

/** Lay the whole thing out. */
export function layout(report: Report, style?: StyleProfile | null): Laid {
  const resolved = resolveTheme(style)
  T = resolved.theme
  try {
    return layoutWith(report, resolved.unapplied)
  } finally {
    T = DEFAULT_THEME
  }
}

function layoutWith(report: Report, notes: readonly string[]): Laid {
  const flow = new Flow(report.title)
  cover(flow, report)

  /*
    The paragraph the cover already printed, so the body does not print it
    again. One answer from `coverTakes`, consulted here and by the caller that
    built `subtitle`, rather than two places deciding it by eye.

    Compared by TEXT rather than by identity, because the caller passes
    `coverTakes(...).line` through `Report.subtitle` and the block that reaches
    here is a different object with the same words.
  */
  const taken = coverTakes(report.blocks)
  const alreadySaid = taken.consumed && report.subtitle.trim() === taken.line ? taken.line : null
  let skipped = false

  for (const block of report.blocks) {
    if (
      !skipped &&
      alreadySaid !== null &&
      block.kind === 'paragraph' &&
      block.text.trim().replace(/\s+/g, ' ') === alreadySaid
    ) {
      skipped = true
      continue
    }
    switch (block.kind) {
      case 'pagebreak':
        flow.break_()
        break
      case 'heading': {
        const t = block.level === 1 ? T.type.h1 : T.type.h2
        flow.gap(block.level === 1 ? 20 : 14)
        /*
          A heading keeps two lines of what follows it.

          Without this a section title lands as the last thing on a page and
          the reader turns over to find out what it was about, which is the
          commonest way a generated document announces that nobody looked at
          it.
        */
        if (!flow.room(t.lead + T.type.body.lead * 2)) flow.break_()
        flow.paragraph(block.text, t.face, t.size, t.lead, T.ink, 0, 'a heading')
        if (block.level === 1) {
          /*
            Clear of the descenders, which six points was not.

            The first capture had the rule cutting through the tail of a "g"
            in the heading above it and reading as an underline on the first
            word. Nothing structural could see it: the line was exactly where
            the code put it.
          */
          flow.gap(13)
          const page = flow.current()
          page.line(MARGIN.left, flow.at(), MARGIN.left + 54, flow.at(), 2, T.primary)
        }
        flow.gap(block.level === 1 ? 10 : 6)
        break
      }
      case 'paragraph': {
        const t = block.lead === true ? T.type.lead : T.type.body
        flow.paragraph(block.text, t.face, t.size, t.lead, block.lead === true ? T.ink2 : T.ink)
        flow.gap(8)
        break
      }
      case 'bullets':
      case 'numbers': {
        for (const [i, item] of block.items.entries()) {
          const marker = block.kind === 'bullets' ? '•' : `${String(i + 1)}.`
          flow.need(T.type.body.lead)
          const page = flow.current()
          // The marker is drawn at the line the first wrapped line will take,
          // which is why the paragraph is measured before either is placed.
          page.text(
            marker,
            MARGIN.left + 2,
            flow.at() - T.type.body.lead,
            T.type.body.face,
            T.type.body.size,
            T.ink2,
          )
          flow.paragraph(
            item,
            T.type.body.face,
            T.type.body.size,
            T.type.body.lead,
            T.ink,
            20,
            'a list',
          )
          flow.gap(3)
        }
        flow.gap(6)
        break
      }
      case 'quote': {
        const { lines } = wrap(block.text, T.type.quote.face, T.type.quote.size, COLUMN - 26)
        const height = lines.length * T.type.quote.lead + 8
        flow.need(height)
        const page = flow.current()
        page.rect(MARGIN.left, flow.at() - height, 2.5, height, T.accent)
        flow.paragraph(
          block.text,
          T.type.quote.face,
          T.type.quote.size,
          T.type.quote.lead,
          T.ink2,
          16,
          'a quotation',
        )
        if (block.attribution !== undefined) {
          flow.paragraph(
            `— ${block.attribution}`,
            T.type.caption.face,
            T.type.caption.size,
            T.type.caption.lead,
            T.ink3,
            16,
            'an attribution',
          )
        }
        flow.gap(10)
        break
      }
      case 'table':
        flow.gap(4)
        table(flow, block)
        flow.gap(12)
        break
      case 'chart':
        flow.gap(4)
        chart(flow, block)
        flow.gap(12)
        break
    }
  }

  /*
    Sources last, and always present.

    #258 requires provenance on every artifact, and an empty list is a
    statement rather than an omission: a report the office wrote from nothing
    should say so on the page, not merely fail to mention it.
  */
  flow.gap(18)
  if (!flow.room(120)) flow.break_()
  flow.paragraph(
    'Sources',
    T.type.h2.face,
    T.type.h2.size,
    T.type.h2.lead,
    T.ink,
    0,
    'the sources heading',
  )
  flow.gap(6)
  if (report.sources.length === 0) {
    flow.paragraph(
      'This report cites nothing. It was written without retrieved material, ' +
        'and should be read as the office thinking aloud rather than as a finding.',
      T.type.body.face,
      T.type.body.size,
      T.type.body.lead,
      T.ink2,
    )
  } else {
    for (const [i, source] of report.sources.entries()) {
      flow.need(T.type.caption.lead)
      const page = flow.current()
      page.text(
        `[${String(i + 1)}]`,
        MARGIN.left,
        flow.at() - T.type.caption.lead,
        T.type.caption.face,
        T.type.caption.size,
        T.ink3,
      )
      flow.paragraph(
        `${source.label} — ${source.ref}`,
        T.type.caption.face,
        T.type.caption.size,
        T.type.caption.lead,
        T.ink2,
        24,
        'a source line',
      )
      flow.gap(2)
    }
  }

  flow.finish()
  return { notes, pages: flow.pages, problems: [...flow.problems, ...layoutCollisions(flow.pages)] }
}

/** Lay the report out and write the file. Throws nothing; problems are returned. */
export function renderReport(
  report: Report,
  style?: StyleProfile | null,
): { bytes: Uint8Array; problems: readonly string[]; notes: readonly string[] } {
  const laid = layout(report, style)
  const info: DocumentInfo = {
    author: report.author,
    created: report.created,
    producer: 'Agentic Team HQ',
    subject: report.subtitle,
    title: report.title,
  }
  return { bytes: assemble(laid.pages, info), notes: laid.notes, problems: laid.problems }
}

/**
 * A layout check on the Page model: does any text sit on top of other text, or off the page?
 *
 * ## Why this exists
 *
 * The first PDF the office produced validated perfectly - header, trailer, every xref offset on its object - and had
 * the introduction printed straight over the title, because the cover drew at absolute positions and the page break
 * saw an untouched page. `validatePdf` is structural and cannot see a collision. This reads where every text object
 * was PLACED (`Page.boxes()`, measured with the same width tables the layout used) and compares them, so the defect is
 * caught before a file is stored or sent.
 *
 * Pure: pages in, problem sentences out. Empty is the only acceptable result; `layout()` returns these among its
 * `problems`, which `validatePdf` already turns into a refusal.
 *
 * ## What it does not claim
 *
 * It compares text with text and text with the page edge. It does not see text against a filled rectangle (a band
 * reverses type out of one on purpose) or judge whether a page looks good - opening the rendered image still does that.
 */

import type { Page, TextBox } from './pdf.ts'

/** Ascender and descender as fractions of the type size: a box a Helvetica or Times line actually occupies. */
const ABOVE = 0.76
const BELOW = 0.22

/** Ignore overlaps thinner than this many points: kerning and rounding, not a collision. */
const MIN_WIDTH = 1
/** Two lines that merely touch are not a collision; overlapping by more than this share of the shorter box is. */
const MIN_DEPTH_SHARE = 0.3
/** Slack past the page edge, in points, before text is called off the page. */
const EDGE = 0.5

interface Rect {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
}

const rectOf = (b: TextBox): Rect => ({
  x0: b.x,
  x1: b.x + b.width,
  y0: b.y - b.size * BELOW,
  y1: b.y + b.size * ABOVE,
})

const shown = (text: string): string => (text.length > 40 ? `${text.slice(0, 37)}...` : text)

export function layoutCollisions(pages: readonly Page[]): readonly string[] {
  const problems: string[] = []
  for (const [index, page] of pages.entries()) {
    const boxes = page.boxes()
    const label = `page ${String(index + 1)}`
    for (const b of boxes) {
      const r = rectOf(b)
      if (r.x0 < -EDGE || r.x1 > page.width + EDGE || r.y0 < -EDGE || r.y1 > page.height + EDGE) {
        problems.push(`text runs off ${label}: "${shown(b.text)}"`)
      }
    }
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]
        const b = boxes[j]
        if (a === undefined || b === undefined) continue
        const ra = rectOf(a)
        const rb = rectOf(b)
        const w = Math.min(ra.x1, rb.x1) - Math.max(ra.x0, rb.x0)
        const h = Math.min(ra.y1, rb.y1) - Math.max(ra.y0, rb.y0)
        if (w <= MIN_WIDTH || h <= 0) continue
        const shorter = Math.min(ra.y1 - ra.y0, rb.y1 - rb.y0)
        if (h > shorter * MIN_DEPTH_SHARE) {
          problems.push(`text overlaps text on ${label}: "${shown(a.text)}" and "${shown(b.text)}"`)
        }
      }
    }
  }
  return problems
}

/**
 * The layout-collision check (src/artifacts/qa.ts).
 *
 * CLAUDE.md: the first PDF the office produced validated perfectly - header, trailer, every xref offset - and had the
 * introduction printed straight over the title. A structural check cannot see that. This reproduces it, proves the
 * check goes RED on it while the structural validator stays GREEN, then proves the fixed path is green. The check also
 * found a real defect in the cover (a three-line title with the date printed over its last line) the first time it ran
 * over a long title; that is pinned below.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { A4, assemble, Page, rgb } from '../../src/artifacts/pdf.ts'
import { layoutCollisions } from '../../src/artifacts/qa.ts'
import { layout, renderReport } from '../../src/artifacts/report.ts'
import { validatePdf } from '../../src/artifacts/validate.ts'
import { SAMPLE } from './sample-report.ts'

const INK = rgb(0, 0, 0)
const info = {
  author: 'x',
  created: new Date('2026-10-04T00:00:00Z'),
  producer: 'test',
  subject: 's',
  title: 't',
}

/** The first-PDF defect: the cover draws at absolute positions and the intro starts at the top of the same page. */
function defective(): Page[] {
  const cover = new Page(A4.width, A4.height)
  cover.text('Customer research report', 56, A4.height - 160, 'Helvetica-Bold', 30, INK)
  // the introduction, started where the page's cursor believes it is (untouched): over the title
  cover.text(
    'This report sets out what customers told us this quarter.',
    56,
    A4.height - 158,
    'Times-Roman',
    12,
    INK,
  )
  return [cover]
}

/** The fixed path: the intro is on its own page, below nothing. */
function fixed(): Page[] {
  const cover = new Page(A4.width, A4.height)
  cover.text('Customer research report', 56, A4.height - 160, 'Helvetica-Bold', 30, INK)
  const body = new Page(A4.width, A4.height)
  body.text(
    'This report sets out what customers told us this quarter.',
    56,
    A4.height - 72,
    'Times-Roman',
    12,
    INK,
  )
  return [cover, body]
}

describe('intro over title', () => {
  it('RED: the defective document is structurally valid and the layout check refuses it', () => {
    const pages = defective()
    const structural = validatePdf(assemble(pages, info))
    expect(structural.ok).toBe(true) // the blind spot this check exists for
    const problems = layoutCollisions(pages)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('overlaps')
    expect(problems[0]).toContain('Customer research report')
  })

  it('and validatePdf refuses it once the problems are handed over, so it is never stored or sent', () => {
    const pages = defective()
    const verdict = validatePdf(assemble(pages, info), { layoutProblems: layoutCollisions(pages) })
    expect(verdict.ok).toBe(false)
  })

  it('GREEN: the fixed path has no collisions', () => {
    expect(layoutCollisions(fixed())).toEqual([])
  })
})

describe('what counts as a collision, and what does not', () => {
  it('lines that merely stack, side by side, or touch are fine', () => {
    const p = new Page(A4.width, A4.height)
    p.text('First line', 56, 700, 'Times-Roman', 12, INK)
    p.text('Second line', 56, 684, 'Times-Roman', 12, INK)
    p.text('Beside', 300, 700, 'Times-Roman', 12, INK)
    expect(layoutCollisions([p])).toEqual([])
  })

  it('text off the page edge is named', () => {
    const p = new Page(A4.width, A4.height)
    p.text('A line that starts too far right to fit', A4.width - 40, 700, 'Times-Roman', 12, INK)
    expect(layoutCollisions([p]).join(' ')).toContain('runs off page 1')
  })

  it('names the page', () => {
    const [a, b] = fixed()
    b?.text('Overprint', 56, A4.height - 72, 'Times-Roman', 12, INK)
    expect(layoutCollisions([a as Page, b as Page]).join(' ')).toContain('page 2')
  })

  it('overlap the control: shifting the same two lines apart makes the check go green', () => {
    const near = new Page(A4.width, A4.height)
    near.text('Title', 56, 700, 'Helvetica-Bold', 30, INK)
    near.text('Intro', 56, 695, 'Times-Roman', 12, INK)
    expect(layoutCollisions([near]).length).toBe(1)
    const apart = new Page(A4.width, A4.height)
    apart.text('Title', 56, 700, 'Helvetica-Bold', 30, INK)
    apart.text('Intro', 56, 650, 'Times-Roman', 12, INK)
    expect(layoutCollisions([apart])).toEqual([])
  })
})

describe('the real renderer', () => {
  it('lays the sample out with no collisions on any page', () => {
    expect(layout(SAMPLE).problems).toEqual([])
  })

  it('a three-line title keeps the date clear of it (the defect this check found in the cover)', () => {
    const long = {
      ...SAMPLE,
      title:
        'A deliberately long title that has to wrap across more than one line of the cover field and then some more words to be sure',
    }
    for (const style of [
      null,
      { typography: { heading: 'Times' } },
      { formatting: { title_page: 'band' } },
    ]) {
      expect(renderReport(long, style).problems).toEqual([])
    }
  })

  it('a source with a very long address is broken across lines and the report still passes (it used to be thrown away)', () => {
    const url = `https://example.com/${'research/segment-'.repeat(8)}end?utm=1&ref=abcdefghijklmnop`
    const long = {
      ...SAMPLE,
      blocks: [
        ...SAMPLE.blocks,
        {
          kind: 'paragraph' as const,
          text: `Source: Market study (${url}) and a second line of ordinary words.`,
        },
      ],
    }
    expect(url.length).toBeGreaterThan(100)
    for (const style of [null, { formatting: { title_page: 'band' } }]) {
      const out = renderReport(long, style)
      expect(out.problems).toEqual([])
      expect(validatePdf(out.bytes, { layoutProblems: out.problems }).ok).toBe(true)
    }
  })

  it('layout() reports collisions among its problems, so a defective cover cannot be stored', () => {
    // The wiring, asserted on the call that matters rather than on a name appearing in the file.
    const src = readFileSync('src/artifacts/report.ts', 'utf8')
    expect(src).toMatch(
      /problems:\s*\[\.\.\.flow\.problems,\s*\.\.\.layoutCollisions\(flow\.pages\)\]/,
    )
  })
})

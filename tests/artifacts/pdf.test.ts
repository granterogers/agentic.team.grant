/**
 * The bytes, the typography and the validator that has to be able to fail
 * (#258).
 *
 * The office writes PDFs by hand because jobs run in Deno, so there is no
 * library between a mistake and a file Grant receives. The three things worth
 * testing are the three that fail silently:
 *
 *   1. a cross-reference table whose offsets do not land on their objects —
 *      readers show a blank document rather than an error, so "it opens"
 *      proves nothing;
 *   2. a line that does not fit, because a width table off by a few units
 *      produces overflow in one paragraph of one report and nothing else;
 *   3. a validator that passes everything, which is the worst of the three
 *      because it makes the other two invisible.
 *
 * So the validator is shown broken files it must reject, which is §10's
 * harness audit done in a unit test rather than by hand.
 */

import { describe, expect, it } from 'vitest'
import { WIDTHS, widthOf } from '../../src/artifacts/metrics.ts'
import { A4, assemble, Page, pdfString, rgb } from '../../src/artifacts/pdf.ts'
import { layout, type Report, renderReport, wrap } from '../../src/artifacts/report.ts'
import { validatePdf } from '../../src/artifacts/validate.ts'

const dec = new TextDecoder('latin1')

const report = (over: Partial<Report> = {}): Report => ({
  author: 'Agentic Team',
  blocks: [
    { kind: 'heading', level: 1, text: 'A heading' },
    { kind: 'paragraph', text: 'A paragraph with enough words in it to wrap onto a second line.' },
    { kind: 'bullets', items: ['One', 'Two'] },
  ],
  created: new Date('2026-09-17T08:00:00Z'),
  sources: [{ label: 'A document', ref: 'notion:abc' }],
  subtitle: 'A subtitle',
  title: 'A report',
  ...over,
})

describe('the font metrics', () => {
  it('match the base-14 values everybody knows', () => {
    // The control on the extraction. A table pulled from a SUBSTITUTED font
    // would not agree with these, and every one of them is published.
    expect(WIDTHS.Helvetica[32]).toBe(278) // space
    expect(WIDTHS.Helvetica[65]).toBe(667) // A
    expect(WIDTHS.Helvetica[105]).toBe(222) // i
    expect(WIDTHS.Helvetica[87]).toBe(944) // W
    expect(WIDTHS['Times-Roman'][65]).toBe(722)
    expect(WIDTHS['Times-Roman'][105]).toBe(278)
  })

  it('measure a string as the sum of its characters, scaled by size', () => {
    expect(widthOf('AA', 'Helvetica', 10)).toBeCloseTo(13.34, 5)
    expect(widthOf('AA', 'Helvetica', 20)).toBeCloseTo(26.68, 5)
    expect(widthOf('', 'Helvetica', 10)).toBe(0)
  })

  it('CONTROL: an unknown character costs something, never nothing', () => {
    // Zero would make a line of them free and let it run off the page, which
    // is the silent form of the defect the whole module exists to stop.
    expect(widthOf('中', 'Helvetica', 10)).toBeGreaterThan(0)
  })
})

describe('wrapping', () => {
  it('breaks at spaces and keeps every line inside the column', () => {
    const { broke, lines } = wrap(
      'the quick brown fox jumps over the lazy dog and keeps going for a while longer',
      'Helvetica',
      10,
      120,
    )
    expect(lines.length).toBeGreaterThan(1)
    expect(broke).toEqual([])
    for (const line of lines) expect(widthOf(line, 'Helvetica', 10)).toBeLessThanOrEqual(120)
  })

  it('hard-breaks a word wider than the column and SAYS it did', () => {
    const { broke, lines } = wrap('https://example.com/a/very/long/path', 'Helvetica', 10, 40)
    expect(broke).toHaveLength(1)
    for (const line of lines) expect(widthOf(line, 'Helvetica', 10)).toBeLessThanOrEqual(40)
  })

  it('CONTROL: and it does not drop the word it broke', () => {
    const { lines } = wrap('abcdefghijklmnop', 'Helvetica', 10, 20)
    expect(lines.join('')).toBe('abcdefghijklmnop')
  })

  it('keeps explicit line breaks', () => {
    expect(wrap('one\ntwo', 'Helvetica', 10, 500).lines).toEqual(['one', 'two'])
  })
})

describe('the file', () => {
  it('has a header, a trailer and as many pages as were laid out', () => {
    const laid = layout(report())
    const { bytes, problems } = renderReport(report())
    expect(problems).toEqual([])
    const verdict = validatePdf(bytes, { layoutProblems: problems, pages: laid.pages.length })
    expect(verdict.problems).toEqual([])
    expect(verdict.ok).toBe(true)
    expect(verdict.pages).toBe(laid.pages.length)
  })

  it('puts the cover on a page of its own', () => {
    // It did not, and the introduction printed over the title in a file that
    // validated perfectly — the cover draws at absolute positions and never
    // moved the cursor, so the page-break saw an untouched page.
    const laid = layout(report())
    expect(laid.pages.length).toBeGreaterThanOrEqual(2)
    const cover = dec.decode(laid.pages[0]?.stream() ?? new Uint8Array())
    expect(cover).toContain('A report')
    // The cover now LISTS the headings (a contents list with page numbers), so the heading's words appear on it by
    // design. What must not appear is the body: the paragraph under the heading is on page two, not the cover.
    expect(cover).not.toContain('A paragraph with enough words')
    const body = dec.decode(laid.pages[1]?.stream() ?? new Uint8Array())
    expect(body).toContain('A heading')
    expect(body).toContain('A paragraph with enough words')
  })

  it('carries the title, author and dates in its metadata, in UTF-16', () => {
    /*
      UTF-16 with a byte order mark, which is what the format says a metadata
      string is unless it is PDFDocEncoding — and what the first version got
      wrong. The en dash in a real title was written as WinAnsi 0x96, a control
      character in the encoding a reader applies to metadata, and Chromium
      showed the tab as "Legacy Coaching Course OE Current Status Report" while
      the same dash on the page was perfect.
    */
    const text = dec.decode(renderReport(report()).bytes)
    const utf16 = (v: string): string => `\u00fe\u00ff${[...v].map((c) => `\u0000${c}`).join('')}`
    expect(text).toContain(`/Title (${utf16('A report')})`)
    expect(text).toContain(`/Author (${utf16('Agentic Team')})`)
    expect(text).toMatch(/\/CreationDate \(D:2026091708/)
  })

  it('escapes the characters that would end a PDF string, in both encodings', () => {
    const meta = dec.decode(renderReport(report({ title: 'A (tricky) \\ title' })).bytes)
    // Escaped inside the UTF-16 title, where the low byte is the character.
    expect(meta).toContain('\u0000A\u0000 \u0000\\(')
    // And on the page, where the string is WinAnsi.
    const page = dec.decode(
      layout(
        report({ blocks: [{ kind: 'paragraph', text: 'A (tricky) \\ line' }] }),
      ).pages[1]?.stream() ?? new Uint8Array(),
    )
    expect(page).toContain('A \\(tricky\\) \\\\ line')
  })

  it('says so on the page when it cites nothing, rather than omitting the section', () => {
    const laid = layout(report({ sources: [] }))
    const all = laid.pages.map((p) => dec.decode(p.stream())).join('')
    expect(all).toContain('Sources')
    expect(all).toContain('cites nothing')
  })

  it('numbers every page but the cover', () => {
    const laid = layout(report())
    expect(dec.decode(laid.pages[0]?.stream() ?? new Uint8Array())).not.toContain(' / ')
    expect(dec.decode(laid.pages[1]?.stream() ?? new Uint8Array())).toContain(
      `2 / ${String(laid.pages.length)}`,
    )
  })
})

describe('the validator, shown things it must reject', () => {
  const good = (): Uint8Array => renderReport(report()).bytes

  it('accepts a real one', () => {
    expect(validatePdf(good()).ok).toBe(true)
  })

  it('HARNESS AUDIT: rejects a file whose xref offsets are wrong', () => {
    /*
      The defect that matters most, because a reader given bad offsets shows a
      blank document rather than an error. Injected by shifting every offset
      by one byte, which is exactly what an off-by-one in `assemble` would do.
    */
    const text = dec
      .decode(good())
      .replace(
        /^(\d{10}) 00000 n $/gm,
        (_m, off: string) => `${String(Number(off) + 1).padStart(10, '0')} 00000 n `,
      )
    const verdict = validatePdf(Uint8Array.from(text, (c) => c.charCodeAt(0)))
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join(' ')).toContain('is not where the xref says it is')
  })

  it('HARNESS AUDIT: rejects a file with no header', () => {
    const bytes = good().slice(4)
    expect(validatePdf(bytes).ok).toBe(false)
  })

  it('HARNESS AUDIT: rejects a truncated file', () => {
    const whole = good()
    expect(validatePdf(whole.slice(0, whole.length - 20)).ok).toBe(false)
  })

  it('HARNESS AUDIT: rejects a page count that disagrees with the page tree', () => {
    /*
      Replaced by pattern rather than by the literal it happens to be today.
      The first draft substituted "/Count 3" and the fixture is two pages, so
      the replace did nothing and the check went red about a file nobody had
      damaged — the harness audit failing for the wrong reason, which is the
      thing an audit is supposed to be immune to.
    */
    const text = dec.decode(good()).replace(/(\/Type \/Pages \/Count )(\d+)/, '$19')
    expect(text).toContain('/Count 9')
    const verdict = validatePdf(Uint8Array.from(text, (c) => c.charCodeAt(0)))
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join(' ')).toContain('the page tree claims')
  })

  it('HARNESS AUDIT: refuses anything the layout itself called a problem', () => {
    const verdict = validatePdf(good(), { layoutProblems: ['a word was too wide'] })
    expect(verdict.ok).toBe(false)
    expect(verdict.problems).toContain('a word was too wide')
  })

  it('HARNESS AUDIT: rejects a file too small to be a report', () => {
    /*
      A one-page PDF with the six font objects in it is already about 1.8 kB,
      which is why the first version of this control passed: the smallest file
      the writer can produce is above the floor. That is the floor working —
      it is there to catch a TRUNCATED or empty artifact reaching Grant, not a
      short one — so the control shows it something genuinely small.
    */
    const page = new Page(A4.width, A4.height)
    page.text('x', 10, 10, 'Helvetica', 10, rgb(0, 0, 0))
    const smallest = assemble([page], {
      author: 'a',
      created: new Date(),
      producer: 'a',
      subject: 'a',
      title: 'a',
    })
    expect(smallest.length).toBeGreaterThan(1_200)

    const stub = new TextEncoder().encode('%PDF-1.7\n1 0 obj\nendobj\n%%EOF\n')
    const verdict = validatePdf(stub)
    expect(verdict.ok).toBe(false)
    expect(verdict.problems.join(' ')).toContain('too small to be a report')
  })
})

describe('characters WinAnsi has a slot for', () => {
  it('maps the euro sign and the other 0x80-0x9f letters instead of printing a question mark', () => {
    const bytes = [...pdfString('€50 Žižek Šuput † ‰ ƒ')]
    expect(bytes).not.toContain(0x3f)
    expect(bytes).toContain(0x80)
    expect(bytes).toContain(0x8e)
    // control: a character with no slot and no stand-in is still visibly a question mark, never silently dropped
    expect([...pdfString('日')]).toContain(0x3f)
  })
})

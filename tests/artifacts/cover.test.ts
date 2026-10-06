/**
 * The composed cover (src/artifacts/report.ts `cover` / `coverFinish`): HQ-PDF-006/007/014.
 *
 * The old cover was two thirds empty by design. This pins what replaced it: a masthead, a title anchored to the
 * field, a facts strip, the summary and a contents list with REAL page numbers, an optional logo; and that none of it
 * moved the body pages or collides with anything.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readImage } from '../../src/artifacts/image.ts'
import { layout, renderReport } from '../../src/artifacts/report.ts'
import { validatePdf } from '../../src/artifacts/validate.ts'
import { SAMPLE } from './sample-report.ts'

const logo = (name = 'logo-rgba.png') => {
  const r = readImage(new Uint8Array(readFileSync(`tests/artifacts/fixtures/${name}`)))
  if (!r.ok) throw new Error('fixture')
  return r.image
}
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex').slice(0, 16)
const said = (r: ReturnType<typeof layout>): string => r.pages[0]?.said() ?? ''
const dec = new TextDecoder('latin1')

const long = (n: number) => ({
  ...SAMPLE,
  blocks: [
    ...SAMPLE.blocks,
    ...Array.from({ length: n }, (_, i) => [
      { kind: 'heading' as const, level: 1 as const, text: `Chapter ${String(i + 1)}` },
      {
        kind: 'paragraph' as const,
        text: 'Customers described the first week as the moment they decided. '.repeat(14),
      },
    ]).flat(),
  ],
})

describe('the cover is composed', () => {
  it('carries the facts, the summary and the contents, with the real page of each heading', () => {
    const laid = layout(long(6), { formatting: { title_page: 'band' } })
    const cover = said(laid)
    for (const w of [
      'SUMMARY',
      'IN THIS REPORT',
      'DATE',
      'SECTIONS',
      'SOURCES',
      'PAGES',
      '4 October 2026',
    ])
      expect(cover, w).toContain(w)
    expect(cover).toContain('Where things stand')
    expect(cover).toContain('Chapter 6')
    // The PAGES figure is the count of pages actually laid out, and the last chapter's number is a page that exists.
    expect(cover).toContain(String(laid.pages.length))
    const outline = laid.pages
      .map((p, i) => (p.said().includes('Chapter 6') && i > 0 ? i + 1 : 0))
      .find((n) => n > 0)
    const lines = cover.split('\n')
    const at = lines.indexOf('Chapter 6')
    expect(lines[at + 1]).toBe(String(outline))
  })

  it('draws the whole opening paragraph on the cover when the body omits it (no words lost)', () => {
    const laid = layout(SAMPLE)
    expect(said(laid).replace(/\n/g, ' ')).toContain('what remains open before')
    expect(
      laid.pages
        .slice(1)
        .map((p) => p.said())
        .join(' '),
    ).not.toContain('This report sets out what the project holds')
  })

  it('is clean for every treatment, with and without a logo, long title, long contents', () => {
    const title =
      'A deliberately long title that has to wrap across more than one line of the cover field and then some more words to be sure'
    for (const report of [SAMPLE, { ...SAMPLE, title }, long(14), { ...SAMPLE, subtitle: '' }]) {
      for (const style of [
        null,
        { formatting: { title_page: 'band' } },
        { formatting: { density: 'compact' } },
        { typography: { heading: 'Times' } },
      ]) {
        for (const assets of [undefined, { logo: logo() }, { logo: logo('logo.jpg') }]) {
          const r = renderReport(report, style, assets)
          expect(r.problems, JSON.stringify([report.title.length, style, !!assets])).toEqual([])
          expect(validatePdf(r.bytes).ok).toBe(true)
        }
      }
    }
  })

  it('a long contents list is cut and says so, keeping Sources', () => {
    const cover = said(layout(long(30)))
    expect(cover).toMatch(/and \d+ more sections/)
    expect(cover).toContain('Sources')
  })

  it('pages 2 onward are exactly what they were before the cover changed', () => {
    const pin = (s: Parameters<typeof layout>[1]) =>
      layout(SAMPLE, s)
        .pages.slice(1)
        .map((p) => sha(p.stream()))
        .join(',')
    // recorded from the renderer at the commit before the redesign
    expect(pin(null)).toBe('ad03f3f1c5c8aab0')
    expect(pin({ typography: { heading: 'Times' } })).toBe('37c48719a269a342')
  })
})

describe('the logo', () => {
  it('is drawn on the cover when supplied, in the file', () => {
    const r = renderReport(SAMPLE, { logo_document_id: 'x' }, { logo: logo() })
    expect(r.notes.join('|')).not.toMatch(/logo/)
    const t = dec.decode(r.bytes)
    expect(t).toContain('/Subtype /Image')
    expect(t).toContain('/SMask')
  })

  it('is put on a paper plate on a band cover, so a dark or transparent logo stays legible', () => {
    const band = layout(
      SAMPLE,
      { formatting: { title_page: 'band' } },
      { logo: logo() },
    ).pages[0]?.stream()
    const std = layout(SAMPLE, null, { logo: logo() }).pages[0]?.stream()
    // the plate is a paper-coloured (1 1 1) rectangle drawn right before the image's save-state operator
    expect(dec.decode(band)).toMatch(/1 1 1 rg\n[\d. ]+ re\nf\nq\n/)
    expect(dec.decode(std)).not.toMatch(/1 1 1 rg\n[\d. ]+ re\nf\nq\n/)
  })

  it('a style that asks for a logo that was not supplied renders without it and says why', () => {
    const none = renderReport(SAMPLE, { logo_document_id: 'x' })
    expect(none.notes.join('|')).toMatch(/logo was not drawn/)
    const refused = renderReport(
      SAMPLE,
      { logo_document_id: 'x' },
      { logoProblem: 'an interlaced PNG cannot be drawn' },
    )
    expect(refused.notes.join('|')).toContain('an interlaced PNG cannot be drawn')
    expect(dec.decode(refused.bytes)).not.toContain('/Subtype /Image')
    expect(refused.problems).toEqual([])
  })

  it('does not leak into the next render', () => {
    renderReport(SAMPLE, null, { logo: logo() })
    expect(dec.decode(renderReport(SAMPLE).bytes)).not.toContain('/Subtype /Image')
  })
})

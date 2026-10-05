/**
 * HQ-PDF-015: the cover's limits. A pale logo is not lost, a thin cover is composed, a long title steps down before
 * it is cut, a logo is sized sensibly, and a logo that cannot be drawn is left off with a sentence.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { logoBox, logoPlate, TITLE_STEPS } from '../../src/artifacts/cover-plan.ts'
import { readImage } from '../../src/artifacts/image.ts'
import { rgb } from '../../src/artifacts/pdf.ts'
import { fitCoverTitle, layout, readingTime, renderReport } from '../../src/artifacts/report.ts'
import { validatePdf } from '../../src/artifacts/validate.ts'
import { SAMPLE } from './sample-report.ts'

const img = (name: string) => {
  const r = readImage(new Uint8Array(readFileSync(`tests/artifacts/fixtures/${name}`)))
  if (!r.ok) throw new Error(`${name}: ${r.reason}`)
  return r.image
}
const WASH = rgb(0.96, 0.965, 0.975)
const BAND = rgb(0.13, 0.35, 0.55)
const PAPER = rgb(1, 1, 1)
const DARK = rgb(0.1, 0.1, 0.12)
const dec = new TextDecoder('latin1')

describe('the logo pixels are read', () => {
  it('a white-on-transparent mark is light, a black one is not, a colour one is not', () => {
    expect(img('logo-white-rgba.png').luma?.light).toBeGreaterThan(0.95)
    expect(img('logo-black-rgba.png').luma?.light).toBe(0)
    expect(img('logo-rgba.png').luma?.light).toBeLessThan(0.3)
    expect(img('logo-lightgrey-rgba.png').luma?.light).toBeGreaterThan(0.95)
  })
  it('an image with no transparency carries no luminance (it brings its own background)', () => {
    expect(img('logo-rgb.png').luma).toBeUndefined()
    expect(img('logo.jpg').luma).toBeUndefined()
  })
})

describe('logoPlate: decided from the logo, deterministically', () => {
  it('a light logo on the light standard cover gets a dark plate; a dark one gets none', () => {
    expect(logoPlate(img('logo-white-rgba.png'), false, WASH, PAPER, DARK).plate).toEqual(DARK)
    expect(logoPlate(img('logo-lightgrey-rgba.png'), false, WASH, PAPER, DARK).plate).toEqual(DARK)
    expect(logoPlate(img('logo-black-rgba.png'), false, WASH, PAPER, DARK).plate).toBeNull()
    expect(logoPlate(img('logo-rgba.png'), false, WASH, PAPER, DARK).plate).toBeNull()
  })
  it('on a dark band a dark or colour logo keeps the paper plate and a white one needs none', () => {
    expect(logoPlate(img('logo-black-rgba.png'), true, BAND, PAPER, DARK).plate).toEqual(PAPER)
    expect(logoPlate(img('logo-rgba.png'), true, BAND, PAPER, DARK).plate).toEqual(PAPER)
    expect(logoPlate(img('logo-white-rgba.png'), true, BAND, PAPER, DARK).plate).toBeNull()
  })
  it('a light logo on a light band is not left to vanish', () => {
    expect(logoPlate(img('logo-white-rgba.png'), true, WASH, PAPER, DARK).plate).toEqual(DARK)
  })
  it('an opaque logo: framed on a band, bare on the standard cover', () => {
    expect(logoPlate(img('logo-rgb.png'), true, BAND, PAPER, DARK).plate).toEqual(PAPER)
    expect(logoPlate(img('logo-rgb.png'), false, WASH, PAPER, DARK).plate).toBeNull()
  })
  it('is what the file shows: a white logo on the standard cover draws a plate before the image, a black one none', () => {
    const fills = (name: string): number => {
      const s = dec.decode(
        layout(SAMPLE, { logo_document_id: 'x' }, { logo: img(name) }).pages[0]?.stream(),
      )
      return (s.slice(0, s.indexOf('\nq\n')).match(/ re\nf\n/g) ?? []).length
    }
    expect(fills('logo-white-rgba.png')).toBe(fills('logo-black-rgba.png') + 1)
  })
})

describe('logoBox', () => {
  it('keeps proportions inside the box', () => {
    const b = logoBox({ height: 80, width: 240 })
    expect(b.w).toBeLessThanOrEqual(150)
    expect(b.h).toBeLessThanOrEqual(52)
    expect(b.w / b.h).toBeCloseTo(3, 5)
  })
  it('lifts a wide strip to a readable height by taking more width, and a tiny one is scaled up', () => {
    const wide = logoBox({ height: 40, width: 600 })
    expect(wide.h).toBeGreaterThanOrEqual(15)
    expect(wide.w).toBeLessThanOrEqual(230)
    expect(logoBox({ height: 20, width: 20 }).h).toBeCloseTo(52, 5)
  })
  it('a hair-thin strip is left off with a sentence, not drawn as a line', () => {
    expect(logoBox({ height: 20, width: 900 }).tooThin).toBe(true)
    const r = renderReport(SAMPLE, { logo_document_id: 'x' }, { logo: img('logo-thin-rgba.png') })
    expect(r.notes.join('|')).toContain('too thin')
    expect(dec.decode(r.bytes)).not.toContain('/Subtype /Image')
    expect(r.problems).toEqual([])
  })
})

describe('the title steps down before it is cut', () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `Word${String(i)}`).join(' ')
  it('keeps 30pt for a short title and steps down as it grows, never past the floor', () => {
    expect(fitCoverTitle('Plot purchase status').size).toBe(30)
    const sizes = [6, 12, 16, 20].map((n) => fitCoverTitle(words(n)).size)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
    expect(sizes.some((s) => s < 30)).toBe(true)
  })
  it('a title that fits at a smaller size is not ellipsised', () => {
    const t = fitCoverTitle(
      'A deliberately long title that has to wrap across more than one line of the cover field and then some more words to be sure it needs the smaller sizes',
    )
    expect(t.clipped).toBe(false)
    expect(t.lines.length).toBeGreaterThan(3)
    expect(t.lines.join(' ')).not.toContain('…')
  })
  it('only past the smallest step is it cut, at a word, with an ellipsis, in at most the allowed lines', () => {
    const floor = TITLE_STEPS[TITLE_STEPS.length - 1]
    const t = fitCoverTitle(words(80))
    expect(t.clipped).toBe(true)
    expect(t.size).toBe(floor?.[0])
    expect(t.lines.length).toBe(floor?.[2])
    const last = t.lines[t.lines.length - 1] ?? ''
    expect(last.endsWith('…')).toBe(true)
    expect(last.slice(0, -1).trim().split(' ').pop()).toMatch(/^Word\d+$/)
  })
})

describe('a thin cover is composed', () => {
  const thin = {
    ...SAMPLE,
    blocks: [SAMPLE.blocks[2] ?? SAMPLE.blocks[0]],
    sources: [],
    subtitle: '',
  }
  it('carries a colophon, and a rich cover does not', () => {
    const said = (r: ReturnType<typeof layout>) => r.pages[0]?.said() ?? ''
    expect(said(layout(thin as never))).toContain('READING TIME')
    const rich = {
      ...SAMPLE,
      blocks: [
        ...SAMPLE.blocks,
        ...Array.from({ length: 12 }, (_, i) => [
          { kind: 'heading' as const, level: 1 as const, text: `Chapter ${String(i)}` },
          { kind: 'paragraph' as const, text: 'Words. '.repeat(40) },
        ]).flat(),
      ],
    }
    expect(said(layout(rich))).not.toContain('READING TIME')
  })
  it('reading time is derived from the words and never below a minute', () => {
    expect(readingTime([{ kind: 'paragraph', text: 'one two three' }])).toBe('About 1 minute')
    expect(readingTime([{ kind: 'paragraph', text: 'w '.repeat(900) }])).toBe('About 5 minutes')
  })
  it('is clean across the matrix: titles x logos x metadata x cover x density', () => {
    const titles = ['Plot purchase status', 'Word '.repeat(60).trim(), 'A '.repeat(30).trim()]
    const logos = [
      undefined,
      'logo-white-rgba.png',
      'logo-black-rgba.png',
      'logo-wide-rgba.png',
      'logo-tiny.png',
      'logo.jpg',
    ]
    for (const title of titles)
      for (const l of logos)
        for (const base of [SAMPLE, thin as never])
          for (const style of [
            { formatting: { density: 'comfortable' } },
            { formatting: { density: 'compact', title_page: 'band' } },
            { formatting: { title_page: 'band' } },
          ]) {
            const r = renderReport(
              { ...(base as typeof SAMPLE), title },
              { ...style, ...(l === undefined ? {} : { logo_document_id: 'x' }) },
              l === undefined ? undefined : { logo: img(l) },
            )
            expect(r.problems, JSON.stringify([title.length, l, style])).toEqual([])
            expect(validatePdf(r.bytes).ok).toBe(true)
          }
  })
})

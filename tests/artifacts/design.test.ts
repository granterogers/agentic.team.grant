/**
 * The deterministic design brief (src/artifacts/design.ts): a closed set of options the renderer can draw, chosen from
 * the house style and the shape of the content; a model's proposal is accepted only where it is supported.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  applyDesign,
  BAND_AT_BLOCKS,
  COMPACT_ABOVE_WORDS,
  DENSITY_OPTIONS,
  designBrief,
  effectiveStyle,
  readDesignProposal,
  TITLE_PAGE_OPTIONS,
  wordCount,
} from '../../src/artifacts/design.ts'
import { type Block, renderReport } from '../../src/artifacts/report.ts'
import { FONT_FAMILIES, TITLE_PAGES } from '../../src/artifacts/style.ts'
import { validatePdf } from '../../src/artifacts/validate.ts'
import { SAMPLE } from './sample-report.ts'

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const para = (n: number): Block => ({ kind: 'paragraph', text: 'word '.repeat(n).trim() })
const chart = (bars: number): Block => ({
  bars: Array.from({ length: bars }, (_, i) => ({ label: `L${String(i)}`, value: i + 1 })),
  kind: 'chart',
  title: 'Counts',
})

describe('what the brief chooses', () => {
  it('a short note is plain and comfortable', () => {
    const d = designBrief({ blocks: [para(40), para(40)], style: null })
    expect(d.choice).toEqual({ charts: true, density: 'comfortable', titlePage: 'standard' })
  })

  it('a long or data-bearing report takes the band', () => {
    expect(
      designBrief({ blocks: Array.from({ length: BAND_AT_BLOCKS }, () => para(5)), style: null })
        .choice.titlePage,
    ).toBe('band')
    expect(designBrief({ blocks: [para(5), chart(4)], style: null }).choice.titlePage).toBe('band')
  })

  it('a long document is set compact; a short one is not (the control)', () => {
    expect(
      designBrief({ blocks: [para(COMPACT_ABOVE_WORDS + 50)], style: null }).choice.density,
    ).toBe('compact')
    expect(
      designBrief({ blocks: [para(COMPACT_ABOVE_WORDS - 50)], style: null }).choice.density,
    ).toBe('comfortable')
  })

  it('the house style outranks the content AND a proposal', () => {
    const d = designBrief({
      blocks: [para(10)],
      proposal: { density: 'compact', title_page: 'band' },
      style: { formatting: { density: 'comfortable', title_page: 'standard' } },
    })
    expect(d.choice.titlePage).toBe('standard')
    expect(d.choice.density).toBe('comfortable')
    expect(d.reasons.join(' ')).toContain('the house style says so')
  })

  it('a supported proposal beats the content shape when the style is silent', () => {
    const d = designBrief({
      blocks: [para(10)],
      proposal: { title_page: 'band', density: 'compact' },
      style: null,
    })
    expect(d.choice.titlePage).toBe('band')
    expect(d.choice.density).toBe('compact')
  })

  it('a chart that compares fewer than three things is decoration and is dropped, whatever was proposed', () => {
    const blocks = [para(10), chart(2)]
    const d = designBrief({ blocks, proposal: { charts: true }, style: null })
    expect(d.choice.charts).toBe(false)
    expect(applyDesign(blocks, d.choice).some((b) => b.kind === 'chart')).toBe(false)
  })

  it('a real chart is kept, and applyDesign never reorders', () => {
    const blocks = [para(10), chart(4), para(11)]
    const d = designBrief({ blocks, style: null })
    expect(d.choice.charts).toBe(true)
    expect(applyDesign(blocks, d.choice)).toEqual(blocks)
  })

  it('is a pure function: the same input, the same answer', () => {
    const input = { blocks: [para(30), chart(3)], proposal: { density: 'compact' }, style: null }
    expect(designBrief(input)).toEqual(designBrief(input))
  })

  it('counts words in every block kind', () => {
    expect(wordCount(SAMPLE.blocks)).toBeGreaterThan(40)
  })
})

describe('validating a model proposal against the supported set', () => {
  it('accepts exactly the supported values', () => {
    expect(readDesignProposal({ charts: false, density: 'compact', title_page: 'band' })).toEqual({
      proposal: { charts: false, density: 'compact', titlePage: 'band' },
      rejected: [],
    })
  })

  it('refuses a layout the renderer cannot draw, by name, and uses nothing from it', () => {
    const { proposal, rejected } = readDesignProposal({
      density: 'airy',
      font: 'Comic Sans',
      title_page: 'full-bleed-photo',
    })
    expect(proposal).toEqual({})
    expect(rejected.join(' | ')).toContain('full-bleed-photo')
    expect(rejected.join(' | ')).toContain('airy')
    expect(rejected.join(' | ')).toContain('font')
    const d = designBrief({
      blocks: [para(10)],
      proposal: { title_page: 'full-bleed-photo' },
      style: null,
    })
    expect(d.choice.titlePage).toBe('standard')
    expect(d.rejected.length).toBe(1)
  })

  it('anything that is not an object is no proposal', () => {
    for (const bad of [null, undefined, 'band', 7, ['band']]) {
      expect(readDesignProposal(bad)).toEqual({ proposal: {}, rejected: [] })
    }
  })

  it('the options are the vocabulary the style module and the database already enforce', () => {
    expect([...TITLE_PAGE_OPTIONS]).toEqual([...TITLE_PAGES])
    expect(DENSITY_OPTIONS).toEqual(['comfortable', 'compact'])
    expect(FONT_FAMILIES.length).toBeGreaterThan(0)
  })
})

describe('the renderer honours the choices', () => {
  it('a default design is byte-identical to no style at all (the baseline is not moved)', () => {
    const plain = renderReport(SAMPLE).bytes
    const eff = renderReport(
      SAMPLE,
      effectiveStyle(null, { charts: true, density: 'comfortable', titlePage: 'standard' }),
    ).bytes
    expect(sha(eff)).toBe(sha(plain))
  })

  it('compact changes the bytes, still validates, and never makes the document longer', () => {
    const comfy = renderReport(SAMPLE, { formatting: { density: 'comfortable' } })
    const tight = renderReport(SAMPLE, { formatting: { density: 'compact' } })
    expect(sha(tight.bytes)).not.toBe(sha(comfy.bytes))
    const a = validatePdf(comfy.bytes, { layoutProblems: comfy.problems })
    const b = validatePdf(tight.bytes, { layoutProblems: tight.problems })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(b.ok && a.ok ? b.pages <= a.pages : false).toBe(true)
  })

  it('band is drawn when chosen', () => {
    const plain = renderReport(SAMPLE, { formatting: { title_page: 'standard' } })
    const band = renderReport(SAMPLE, { formatting: { title_page: 'band' } })
    expect(sha(band.bytes)).not.toBe(sha(plain.bytes))
    expect(band.problems).toEqual([])
  })
})

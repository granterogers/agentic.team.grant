/**
 * House styles in the PDF renderer (src/artifacts/style.ts, report.ts; migration 0923).
 *
 * (a) With no profile the bytes are EXACTLY what the renderer produced before profiles existed - pinned by hash,
 *     recorded from the pre-change renderer, so a refactor that moves one colour is caught.
 * (b) A profile's colours, faces and title-page treatment reach the file.
 * (c) The result validates, and nothing a profile can say makes the layout overflow.
 * Plus: the vocabulary here is the vocabulary the database enforces.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderReport } from '../../src/artifacts/report.ts'
import {
  contrast,
  DEFAULT_THEME,
  FONT_FAMILIES,
  PALETTE_KEYS,
  parseHex,
  readProfile,
  resolveTheme,
  TITLE_PAGES,
} from '../../src/artifacts/style.ts'
import { validatePdf } from '../../src/artifacts/validate.ts'
import { SAMPLE } from './sample-report.ts'

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const text = (b: Uint8Array): string => Buffer.from(b).toString('latin1')

/*
  Recorded from the renderer as it stands AFTER the cover was redesigned on purpose (HQ-PDF-006/007/014: masthead,
  title anchored to the field's foot, facts strip, summary, contents list, optional logo). The previous pin,
  14290231f6124fee84186c1ca96cb17dd68f3c7a3eae1ecb19107915947bea1f, was the cover that was two thirds empty, and it was
  retired deliberately, not by accident: the byte-for-byte guarantee below is "no profile gives the default look, and a
  profile never leaks into the next render", which is unchanged. Pages 2 onward are unchanged by the redesign (the
  body-pages test in cover.test.ts pins that against the old layout rules).

  Changed again on purpose by HQ-PDF-015: a thin cover now grows its colour field and carries a colophon, and the title
  steps its size down instead of being cut. Previous pin 83b55b49480d9798...; the guarantees under it are unchanged.
*/
const BASELINE_SHA = '4154fea2d242141af8080f1d3b239a0eeb930e37c5194ba7042d357d659d2d97'

describe('(a) no profile: the default look, byte for byte', () => {
  it('is unchanged when no profile is passed, or a null, or an empty one', () => {
    expect(sha(renderReport(SAMPLE).bytes)).toBe(BASELINE_SHA)
    expect(sha(renderReport(SAMPLE, null).bytes)).toBe(BASELINE_SHA)
    expect(sha(renderReport(SAMPLE, {}).bytes)).toBe(BASELINE_SHA)
    expect(resolveTheme(undefined).theme).toBe(DEFAULT_THEME)
  })

  it('the control can fail: any real profile changes the bytes', () => {
    expect(sha(renderReport(SAMPLE, { palette: { primary: '#aa3322' } }).bytes)).not.toBe(
      BASELINE_SHA,
    )
  })

  it('a profile does not leak into the next render', () => {
    renderReport(SAMPLE, { palette: { primary: '#aa3322' }, formatting: { title_page: 'band' } })
    expect(sha(renderReport(SAMPLE).bytes)).toBe(BASELINE_SHA)
  })

  it('a layout that throws still restores the default theme', () => {
    const bad = { ...SAMPLE, blocks: [{ kind: 'bogus' }] } as unknown as typeof SAMPLE
    try {
      renderReport(bad, { palette: { primary: '#aa3322' } })
    } catch {
      /* the point is what happens next */
    }
    expect(sha(renderReport(SAMPLE).bytes)).toBe(BASELINE_SHA)
  })
})

describe('(b) a profile reaches the file', () => {
  const pdfColour = (hex: string): string => {
    const c = parseHex(hex)
    if (c === null) throw new Error('bad hex')
    // the writer prints each channel with up to four decimals; match on the channel text it would emit
    return [c.r, c.g, c.b].map((n) => String(Math.round(n * 1000) / 1000)).join(' ')
  }

  it('draws the primary colour and the heading and body faces it asked for', () => {
    const out = renderReport(SAMPLE, {
      palette: { primary: '#aa3322' },
      typography: { heading: 'Times', body: 'Helvetica' },
    })
    const t = text(out.bytes)
    expect(t).toContain(pdfColour('#aa3322'))
    expect(t).toContain('/BaseFont /Times-Bold')
    expect(t).toContain('/BaseFont /Helvetica')
  })

  it('the band title page fills the cover field with the primary colour and reverses the type out of it', () => {
    const plain = text(renderReport(SAMPLE, { palette: { primary: '#aa3322' } }).bytes)
    const band = text(
      renderReport(SAMPLE, { palette: { primary: '#aa3322' }, formatting: { title_page: 'band' } })
        .bytes,
    )
    expect(band).not.toBe(plain)
    // reversed type: white text exists in the band cover and not on the standard one's first page
    expect(band.split('1 1 1 rg').length).toBeGreaterThan(plain.split('1 1 1 rg').length)
  })

  it('derives the quieter inks from a chosen ink, and keeps the defaults when none is chosen', () => {
    expect(resolveTheme({ palette: { primary: '#aa3322' } }).theme.ink2).toBe(DEFAULT_THEME.ink2)
    const chosen = resolveTheme({ palette: { ink: '#202020', paper: '#fafafa' } }).theme
    expect(chosen.ink2).not.toBe(DEFAULT_THEME.ink2)
    expect(contrast(chosen.ink2, chosen.paper)).toBeGreaterThan(3)
  })

  it('keeps text readable: ink on paper under 4.5:1 falls back, and says so', () => {
    const r = resolveTheme({ palette: { ink: '#cccccc', paper: '#ffffff' } })
    expect(r.theme.ink).toBe(DEFAULT_THEME.ink)
    expect(r.unapplied.join(' ')).toMatch(/contrast/)
    const low = resolveTheme({ palette: { primary: '#f5f5f5' } })
    expect(low.theme.primary).toBe(DEFAULT_THEME.primary)
    expect(low.unapplied.join(' ')).toMatch(/primary/)
  })

  it('says what it did not draw (a logo) and what it could not set (an unknown face), and never throws', () => {
    const r = resolveTheme({
      logo_document_id: '00000000-0000-0000-0000-000000000000',
      typography: { heading: 'Comic Sans' },
      palette: { primary: 'red' },
    })
    expect(r.unapplied.join('|')).toMatch(/logo/)
    expect(r.unapplied.join('|')).toMatch(/Comic Sans/)
    expect(r.unapplied.join('|')).toMatch(/not a colour/)
    expect(r.theme.type.h1.face).toBe('Helvetica-Bold')
    expect(renderReport(SAMPLE, { logo_document_id: 'x' }).notes.length).toBeGreaterThan(0)
  })
})

describe('(c) the result is a valid document with nothing overflowing', () => {
  const profiles = [
    {
      palette: { primary: '#aa3322', accent: '#e8a04a' },
      typography: { heading: 'Times', body: 'Helvetica' },
    },
    {
      formatting: { title_page: 'band' },
      palette: { primary: '#0b3d2e' },
      typography: { heading: 'Helvetica', body: 'Times' },
    },
    {
      palette: { ink: '#101820', paper: '#fffdf7', wash: '#f1ede2', rule: '#cfc9b8' },
      typography: { heading: 'Times', body: 'Times' },
    },
  ]
  it.each(profiles.map((p, i) => [i, p] as const))(
    'profile %i validates and lays out clean',
    (_i, profile) => {
      const out = renderReport(SAMPLE, profile)
      expect(out.problems).toEqual([])
      const verdict = validatePdf(out.bytes, { layoutProblems: out.problems })
      expect(verdict.problems).toEqual([])
      expect(verdict.ok).toBe(true)
    },
  )

  it('a long title and a table wrap inside a Times heading face (wider metrics) without a problem', () => {
    const long = {
      ...SAMPLE,
      title:
        'A deliberately long title that has to wrap across more than one line of the cover field',
    }
    const out = renderReport(long, { typography: { heading: 'Times' } })
    expect(out.problems).toEqual([])
  })
})

describe("the vocabulary is the database's vocabulary", () => {
  const sql = readFileSync(
    new URL('../../migrations/0923_a_project_can_have_a_house_style.sql', import.meta.url),
    'utf8',
  )

  it('the same fonts, palette keys and title pages', () => {
    for (const f of FONT_FAMILIES) expect(sql).toContain(`'${f}'`)
    const palette = /palette_keys constant text\[\] := array\[([^\]]+)\]/.exec(sql)?.[1] ?? ''
    expect([...palette.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...PALETTE_KEYS])
    for (const t of TITLE_PAGES) expect(sql).toContain(`'${t}'`)
    expect(sql).toMatch(/formatting\.title_page is standard or band/)
  })
})

describe('readProfile reads a database column defensively', () => {
  it('drops what is the wrong shape, and returns null for nothing', () => {
    expect(readProfile({})).toBeNull()
    expect(readProfile(null)).toBeNull()
    expect(readProfile('x')).toBeNull()
    expect(
      readProfile({ palette: { primary: 5, accent: '#000000' }, typography: 'Times' }),
    ).toEqual({ palette: { accent: '#000000' } })
    expect(readProfile({ structure: { sections: ['A', 3, 'B'] }, tone: 'warm' })).toEqual({
      structure: { sections: ['A', 'B'] },
      tone: 'warm',
    })
  })
})

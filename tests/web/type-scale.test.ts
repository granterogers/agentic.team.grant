import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  The type scale (10 October 2026). Team HQ's text sizes are whole pixels on one short scale (12, 13, 14, 15, 16, 18 and the headings);
  the half-pixel steps (12.5, 13.5) that had crept in carried 22% of all text and read as noise between neighbours. The scale is
  held here, from the stylesheets themselves, so a new half step is refused where it is written.
*/
const dir = new URL('../../web/studio/bc/', import.meta.url)
const files = [
  ...readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => [`bc/${f}`, readFileSync(new URL(f, dir), 'utf8')] as const),
  [
    'settings-ui.css',
    readFileSync(new URL('../../web/studio/settings-ui.css', import.meta.url), 'utf8'),
  ] as const,
]
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const sizes = (css: string): number[] => {
  const out: number[] = []
  for (const m of stripComments(css).matchAll(/font-size:\s*([0-9.]+)px/g)) out.push(Number(m[1]))
  for (const m of stripComments(css).matchAll(
    /font:\s*(?:[0-9]{3}\s+)?(?:italic\s+)?([0-9.]+)px\//g,
  ))
    out.push(Number(m[1]))
  return out
}

describe('the type scale', () => {
  it('reads sizes out of the stylesheets (so the checks below are not about an empty list)', () => {
    const all = files.flatMap(([, css]) => sizes(css))
    expect(all.length).toBeGreaterThan(300)
    expect(all).toContain(12)
    expect(all).toContain(14)
  })

  it('no Team HQ text size is a half pixel', () => {
    const bad: string[] = []
    for (const [name, css] of files)
      for (const s of sizes(css)) if (!Number.isInteger(s)) bad.push(`${name}: ${String(s)}px`)
    expect([...new Set(bad)]).toEqual([])
  })

  it('nothing a person reads is under the 12px floor', () => {
    const small: string[] = []
    for (const [name, css] of files)
      for (const s of sizes(css)) if (s < 12) small.push(`${name}: ${String(s)}px`)
    /* Decorative glyph sizes inside icons are not text; none is declared as font-size under 12 in these files. */
    expect([...new Set(small)]).toEqual([])
  })

  it('the detector sees a half step when one is written (control)', () => {
    expect(
      sizes('.x { font-size: 12.5px } .y { font: 500 13.5px/1.4 serif }').filter(
        (s) => !Number.isInteger(s),
      ),
    ).toEqual([12.5, 13.5])
  })
})

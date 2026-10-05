import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  The Accent colour control in Global Settings is the only appearance setting that visibly changes Team HQ, so each
  swatch it offers must have a token override that actually exists, and its text colour must stay readable on it.
*/
const copy = readFileSync('web/studio/settings-copy.js', 'utf8')
const tokens = readFileSync('web/studio/bc/tokens.css', 'utf8')

const ACCENTS = [...copy.matchAll(/id:\s*'(slate|moss|clay|ink|paper)'[^}]*?#([0-9a-f]{6})/gi)].map(
  (m) => ({
    id: m[1],
    hex: m[2],
  }),
)

const lum = (hex: string) => {
  const c = [0, 2, 4].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0)
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

describe('accent colours', () => {
  it('offers the five named accents', () => {
    expect(ACCENTS.map((a) => a.id)).toEqual(['slate', 'moss', 'clay', 'ink', 'paper'])
  })

  it('has a token override for every accent except the default', () => {
    for (const a of ACCENTS.filter((x) => x.id !== 'slate')) {
      expect(tokens).toMatch(new RegExp(`\\[data-palette=['"]${a.id}['"]\\]`))
    }
  })

  it('every accent is readable against the page canvas (3:1 for non-text, as UI)', () => {
    for (const a of ACCENTS) expect(ratio(a.hex ?? '000000', '0a1419')).toBeGreaterThanOrEqual(3)
  })
})

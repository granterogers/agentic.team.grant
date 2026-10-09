import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Looks, glass and depth (aesthetic sprint, 9 October 2026).

  A look is only allowed to exist if text on it is readable, so the contrast of every look in every scheme is computed from
  the stylesheet itself, not asserted by name. Persistence and validation of the three new appearance keys are driven
  through the real module with a stand-in for the browser's storage.
*/
const read = (p: string): string =>
  readFileSync(new URL(`../../web/studio/${p}`, import.meta.url), 'utf8')
const refine = read('bc/refine.css')
const tokens = read('bc/tokens.css')

const hex = (h: string): [number, number, number] => {
  const n = h.replace('#', '')
  return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16)) as [number, number, number]
}
const lum = (rgb: [number, number, number]): number => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

/** The first rule for a look in a scheme: its canvas, surface and (when it sets one) muted text. */
const lookBlock = (look: string, scheme: 'dark' | 'light') => {
  const re = new RegExp(`\\[data-look='${look}'\\]\\[data-scheme='${scheme}'\\]\\s*\\{([^}]*)\\}`)
  const m = re.exec(refine)
  if (m === null) return null
  const body = m[1] ?? ''
  const get = (n: string): string | null =>
    new RegExp(`${n}:\\s*(#[0-9a-fA-F]{6})`).exec(body)?.[1] ?? null
  return { canvas: get('--bc-canvas'), surface: get('--bc-surface'), muted: get('--bc-text-muted') }
}
const base = (scheme: 'dark' | 'light') => {
  const block =
    scheme === 'dark'
      ? tokens.slice(tokens.indexOf(":root[data-experience='basecamp'][data-scheme='dark']"))
      : tokens
  const get = (n: string): string => new RegExp(`${n}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1] ?? ''
  return { text: get('--bc-text'), strong: get('--bc-text-strong'), muted: get('--bc-text-muted') }
}

const LOOKS = ['silver', 'forest', 'graphite'] as const

describe('every look keeps text readable', () => {
  for (const scheme of ['dark', 'light'] as const) {
    for (const look of LOOKS) {
      it(`${look} in ${scheme}: body, strong and muted text clear 4.5:1 on both its canvas and its surface`, () => {
        const b = lookBlock(look, scheme)
        expect(b, `${look} ${scheme} block`).not.toBeNull()
        const t = base(scheme)
        const muted = b?.muted ?? t.muted
        for (const [face, colour] of [
          ['surface', b?.surface],
          ['canvas', b?.canvas],
        ] as const) {
          expect(colour, `${look} ${scheme} ${face}`).toBeTruthy()
          for (const [name, ink] of [
            ['text', t.text],
            ['strong', t.strong],
            ['muted', muted],
          ] as const) {
            expect(
              ratio(ink, colour as string),
              `${look} ${scheme} ${name} on ${face}`,
            ).toBeGreaterThanOrEqual(4.5)
          }
        }
      })
    }
  }

  it('the surface is distinguishable from the canvas in every look (a module must read as a face on a ground)', () => {
    for (const scheme of ['dark', 'light'] as const)
      for (const look of LOOKS) {
        const b = lookBlock(look, scheme)
        expect(
          ratio(b?.surface as string, b?.canvas as string),
          `${look} ${scheme}`,
        ).toBeGreaterThanOrEqual(1.08)
      }
  })

  it('the device-following looks carry the same values as the explicit ones', () => {
    for (const look of LOOKS)
      for (const scheme of ['dark', 'light'] as const) {
        const explicit = lookBlock(look, scheme)
        const mq = scheme === 'dark' ? 'dark' : 'light'
        const at = refine.indexOf(`@media (prefers-color-scheme: ${mq})`)
        const seg = refine.slice(at, at + 2400)
        expect(seg, `${look} ${scheme}`).toContain(explicit?.surface as string)
        expect(seg, `${look} ${scheme}`).toContain(explicit?.canvas as string)
      }
  })
})

describe('every accent is readable on every look', () => {
  /* Accent pairs, read from the stylesheet: [accent, ink on it] per palette and scheme. */
  const accentOf = (palette: string, scheme: 'dark' | 'light'): [string, string] => {
    if (palette === 'slate')
      return scheme === 'dark' ? ['#6ab3fd', '#0e1d24'] : ['#2b6cb0', '#ffffff']
    const re =
      scheme === 'light'
        ? new RegExp(
            `data-palette='${palette}'\\]\\[data-scheme='light'\\]\\s*\\{\\s*--bc-accent:\\s*(#[0-9a-f]{6});\\s*--bc-accent-ink:\\s*(#[0-9a-f]{6})`,
          )
        : new RegExp(
            `data-palette='${palette}'\\]\\s*\\{\\s*--bc-accent:\\s*(#[0-9a-f]{6});\\s*--bc-accent-ink:\\s*(#[0-9a-f]{6})`,
          )
    const m = re.exec(tokens)
    return [m?.[1] ?? '', m?.[2] ?? '']
  }
  const surfaces = (look: string, scheme: 'dark' | 'light'): [string, string] => {
    if (look === 'original')
      return scheme === 'dark' ? ['#0b151b', '#1b2930'] : ['#d6d3cc', '#f0eee9']
    const b = lookBlock(look, scheme)
    return [b?.canvas as string, b?.surface as string]
  }
  for (const scheme of ['dark', 'light'] as const)
    for (const look of ['original', 'silver', 'forest', 'graphite'])
      for (const palette of ['slate', 'moss', 'clay', 'ink', 'paper']) {
        it(`${palette} accent on ${look} (${scheme}): the ink on it is 4.5:1 and the accent stands off the surface 3:1`, () => {
          const [accent, ink] = accentOf(palette, scheme)
          expect(accent, `${palette} ${scheme} accent found`).toMatch(/^#[0-9a-f]{6}$/)
          const [canvas, surface] = surfaces(look, scheme)
          expect(ratio(ink, accent), 'ink on accent').toBeGreaterThanOrEqual(4.5)
          expect(ratio(accent, surface), 'accent against the module face').toBeGreaterThanOrEqual(3)
          expect(ratio(accent, canvas), 'accent against the canvas').toBeGreaterThanOrEqual(3)
        })
      }
})

describe('glass and depth', () => {
  it('depth multiplies the one shadow scale, so no surface has a shadow of its own that ignores it', () => {
    expect(tokens).toMatch(/calc\(var\(--bc-sh-weak\) \* var\(--bc-depth, 1\)\)/)
    expect(tokens).toMatch(/calc\(var\(--bc-sh-mid\) \* var\(--bc-depth, 1\)\)/)
    expect(tokens).toMatch(/calc\(var\(--bc-sh-deep\) \* var\(--bc-depth, 1\)\)/)
    expect(tokens).not.toMatch(/var\(--bc-sh-(weak|mid|deep)\), transparent\)/)
    expect(refine).toMatch(/\[data-depth='flat'\]\s*\{\s*--bc-depth:\s*0\.\d+/)
    expect(refine).toMatch(/\[data-depth='deep'\]\s*\{\s*--bc-depth:\s*1\.\d+/)
  })

  it('only floating surfaces are glass: a module face and a maximised view are never in the list', () => {
    const list = /:is\(([^)]*)\) \{\s*background:/.exec(refine)?.[1] ?? ''
    expect(list).toContain('.bcmenupanel')
    expect(list).toContain('.bcsheet')
    expect(list).not.toMatch(/bcmod|bcexp|bcthumb|bcpanel\b/)
  })

  it('an office-menu wrapper is never given the panel material (it painted a grey square behind the three dots)', () => {
    expect(refine).not.toMatch(/\.bcofficemenu\)/)
  })

  it('glass never leaves less than 70% of the surface, so text over the board stays legible', () => {
    for (const m of refine.matchAll(/--bc-glass-keep:\s*(\d+)%/g))
      expect(Number(m[1])).toBeGreaterThanOrEqual(70)
  })
})

type Appearance = {
  look: string
  glass: string
  depth: string
  palette: string
  texture: string
  scheme: string
  density: string
}
type AppearanceModule = {
  appearance: () => Appearance
  apply: (a: Appearance) => Appearance
  LOOKS: { id: string; faces: Record<'dark' | 'light', [string, string]> }[]
}
// @ts-expect-error - a browser module with no types; ADR-0002, no build step.
const loadAppearance = (): Promise<AppearanceModule> => import('../../web/studio/appearance.js')

describe('the appearance module', () => {
  const store = new Map<string, string>()
  const root: { dataset: Record<string, string>; style: Record<string, unknown> } = {
    dataset: {},
    style: { setProperty: () => undefined, removeProperty: () => undefined },
  }
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  }
  ;(globalThis as Record<string, unknown>).document = { documentElement: root }
  ;(globalThis as Record<string, unknown>).window = { matchMedia: () => ({ matches: false }) }

  it('defaults to today: original look, soft glass, soft depth', async () => {
    const m = await loadAppearance()
    store.clear()
    const a = m.appearance()
    expect([a.look, a.glass, a.depth]).toEqual(['original', 'soft', 'soft'])
  })

  it('apply writes all three on the document and remembers them', async () => {
    const m = await loadAppearance()
    store.clear()
    m.apply({ ...m.appearance(), look: 'forest', glass: 'rich', depth: 'deep' })
    expect([root.dataset.look, root.dataset.glass, root.dataset.depth]).toEqual([
      'forest',
      'rich',
      'deep',
    ])
    const again = m.appearance()
    expect([again.look, again.glass, again.depth]).toEqual(['forest', 'rich', 'deep'])
  })

  it('a value nobody offers falls back to the default rather than to nothing', async () => {
    const m = await loadAppearance()
    store.set('studio.appearance', JSON.stringify({ look: 'neon', glass: 'max', depth: 9 }))
    const a = m.appearance()
    expect([a.look, a.glass, a.depth]).toEqual(['original', 'soft', 'soft'])
  })

  it('an older saved appearance (no look keys) loads unchanged and gains only the defaults', async () => {
    const m = await loadAppearance()
    store.set(
      'studio.appearance',
      JSON.stringify({ palette: 'clay', texture: 'oak', scheme: 'dark', density: 'compact' }),
    )
    const a = m.appearance()
    expect([a.palette, a.texture, a.scheme, a.density]).toEqual(['clay', 'oak', 'dark', 'compact'])
    expect([a.look, a.glass, a.depth]).toEqual(['original', 'soft', 'soft'])
  })

  it('every look offered has a CSS block in both schemes, and the picker faces match the CSS', async () => {
    const m = await loadAppearance()
    for (const l of m.LOOKS) {
      if (l.id === 'original') continue
      for (const scheme of ['dark', 'light'] as const) {
        const b = lookBlock(l.id, scheme)
        expect(b, `${l.id} ${scheme}`).not.toBeNull()
        expect(l.faces[scheme][0].toLowerCase()).toBe(b?.canvas?.toLowerCase())
        expect(l.faces[scheme][1].toLowerCase()).toBe(b?.surface?.toLowerCase())
      }
    }
  })
})

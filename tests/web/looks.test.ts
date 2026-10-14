// biome-ignore-all format: the appearance fixtures are long single-line JSON seeds, kept as written so each case reads at a glance
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Looks, glass and depth. The Porcelain & Teal identity (October 2026) is the only look; its values live in
  web/studio/bc/identity.css, which is loaded last. Every contrast figure is computed from that stylesheet, so a change that
  makes text unreadable fails here rather than in a person's browser. Persistence (including the one-time reset of choices
  saved before the current revision) is driven through the real module with a stand-in for the browser's storage.
*/
const read = (p: string): string => readFileSync(new URL(`../../web/studio/${p}`, import.meta.url), 'utf8')
const identity = read('bc/identity.css')
// The Silver and Forest looks predate the identity sheet and keep their tokens in refine.css (14 October 2026).
const everyLook = identity + read('bc/refine.css')
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

/*
  The rule block for a look in a scheme. The light look is one rule whose selector list ends in the `:not([data-scheme])`
  case, so the block is the text from the look's selector up to the opening brace of the rule it belongs to.
*/
const lookBlock = (look: string, scheme: 'dark' | 'light') => {
  const re = new RegExp(`\\[data-look='${look}'\\]\\[data-scheme='${scheme}'\\][^{]*\\{([^}]*)\\}`)
  const m = re.exec(everyLook)
  if (m === null) return null
  const body = m[1] ?? ''
  const get = (n: string): string | null => new RegExp(`${n}:\\s*(#[0-9a-fA-F]{6})`).exec(body)?.[1] ?? null
  return { canvas: get('--bc-canvas'), surface: get('--bc-surface'), muted: get('--bc-text-muted'), text: get('--bc-text'), strong: get('--bc-text-strong') }
}

const LOOKS = ['porcelain', 'silver', 'graphite', 'midnight', 'forest'] as const
const PALETTES = ['slate', 'moss', 'clay', 'ink', 'paper'] as const

describe('the porcelain look keeps text readable', () => {
  for (const scheme of ['dark', 'light'] as const) {
    it(`${scheme}: body, strong and muted text clear 4.5:1 on both its canvas and its surface`, () => {
      const b = lookBlock('porcelain', scheme)
      expect(b, `porcelain ${scheme} block`).not.toBeNull()
      for (const face of [b?.surface, b?.canvas] as const) {
        expect(face, `${scheme} face`).toBeTruthy()
        for (const ink of [b?.text, b?.strong, b?.muted] as const) {
          expect(ratio(ink as string, face as string), `${scheme} ink on face`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
  }

  it('the surface is distinguishable from the canvas (a module must read as a face on a ground)', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const b = lookBlock('porcelain', scheme)
      expect(ratio(b?.surface as string, b?.canvas as string), scheme).toBeGreaterThanOrEqual(1.08)
    }
  })

  it('the system-preference dark block carries the same values as the explicit dark block', () => {
    const explicit = lookBlock('porcelain', 'dark')
    const at = identity.indexOf('@media (prefers-color-scheme: dark)')
    expect(at, 'a system dark block exists').toBeGreaterThan(-1)
    const seg = identity.slice(at, at + 1400)
    expect(seg).toContain(explicit?.surface as string)
    expect(seg).toContain(explicit?.canvas as string)
  })

  it('the picker faces the module offers are the canvas and surface the CSS draws', async () => {
    const src = read('appearance.js')
    for (const scheme of ['dark', 'light'] as const) {
      const b = lookBlock('porcelain', scheme)
      const faces = new RegExp(`porcelain[^]*?${scheme}: \\['(#[0-9a-fA-F]{6})', '(#[0-9a-fA-F]{6})'\\]`).exec(src)
      expect(faces?.[1]?.toLowerCase(), `${scheme} canvas`).toBe(b?.canvas?.toLowerCase())
      expect(faces?.[2]?.toLowerCase(), `${scheme} surface`).toBe(b?.surface?.toLowerCase())
    }
  })
})

describe('every accent is readable on the porcelain look', () => {
  /* [accent, ink on it] per palette and scheme, read from the identity stylesheet. */
  const accentOf = (palette: string, scheme: 'dark' | 'light'): [string, string] => {
    const re = new RegExp(`data-palette='${palette}'\\]\\[data-scheme='${scheme}'\\][^{]*\\{\\s*--bc-accent:\\s*(#[0-9a-fA-F]{6});\\s*--bc-accent-ink:\\s*(#[0-9a-fA-F]{6})`)
    const m = re.exec(everyLook)
    return [m?.[1] ?? '', m?.[2] ?? '']
  }
  for (const scheme of ['dark', 'light'] as const)
    for (const look of LOOKS)
      for (const palette of PALETTES) {
        it(`${palette} accent on ${look} (${scheme}): the ink on it is 4.5:1 and the accent stands off the surfaces 3:1`, () => {
          const [accent, ink] = accentOf(palette, scheme)
          expect(accent, `${palette} ${scheme} accent found`).toMatch(/^#[0-9a-fA-F]{6}$/)
          const b = lookBlock(look, scheme)
          expect(ratio(ink, accent), 'ink on accent').toBeGreaterThanOrEqual(4.5)
          expect(ratio(accent, b?.surface as string), 'accent against the module face').toBeGreaterThanOrEqual(3)
          expect(ratio(accent, b?.canvas as string), 'accent against the canvas').toBeGreaterThanOrEqual(3)
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
    for (const m of refine.matchAll(/--bc-glass-keep:\s*(\d+)%/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(70)
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
  APPEARANCE_REVISION: number
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

  it('defaults to Porcelain & Teal, soft glass, soft depth, the deep-teal accent', async () => {
    const m = await loadAppearance()
    store.clear()
    const a = m.appearance()
    expect([a.look, a.palette, a.glass, a.depth]).toEqual(['porcelain', 'slate', 'soft', 'soft'])
  })

  it('apply writes all three on the document and remembers them', async () => {
    const m = await loadAppearance()
    store.clear()
    m.apply({ ...m.appearance(), glass: 'rich', depth: 'deep' })
    expect([root.dataset.look, root.dataset.glass, root.dataset.depth]).toEqual(['porcelain', 'rich', 'deep'])
    const again = m.appearance()
    expect([again.look, again.glass, again.depth]).toEqual(['porcelain', 'rich', 'deep'])
  })

  it('a value nobody offers falls back to the default rather than to nothing', async () => {
    const m = await loadAppearance()
    store.set('studio.appearance', JSON.stringify({ v: m.APPEARANCE_REVISION, look: 'neon', glass: 'max', depth: 9 }))
    const a = m.appearance()
    expect([a.look, a.glass, a.depth]).toEqual(['porcelain', 'soft', 'soft'])
  })

  it('a saved look from an earlier design is read as Porcelain & Teal, and its spacing and effect choices are kept', async () => {
    const m = await loadAppearance()
    store.set('studio.appearance', JSON.stringify({ look: 'original', palette: 'clay', glass: 'rich', depth: 'deep' }))
    const a = m.appearance()
    expect([a.look, a.palette, a.glass, a.depth]).toEqual(['porcelain', 'slate', 'rich', 'deep'])
    expect(m.LOOKS.map((l) => l.id)).toEqual(['porcelain', 'silver', 'graphite', 'midnight', 'forest'])
  })

  it('a choice saved before the current revision resets its look fields once, and keeps density, glass and depth', async () => {
    const m = await loadAppearance()
    store.set(
      'studio.appearance',
      JSON.stringify({ palette: 'clay', texture: 'oak', scheme: 'dark', look: 'graphite', density: 'compact', glass: 'rich', depth: 'deep' }),
    )
    const a = m.appearance()
    expect([a.palette, a.texture, a.scheme, a.look]).toEqual(['slate', 'none', 'light', 'porcelain'])
    expect([a.density, a.glass, a.depth]).toEqual(['compact', 'rich', 'deep'])
  })

  it('a choice saved at an older revision (2, the charcoal era) is reset too, so nothing stale survives an identity change', async () => {
    const m = await loadAppearance()
    store.set('studio.appearance', JSON.stringify({ v: 2, palette: 'clay', scheme: 'dark', look: 'graphite', density: 'compact' }))
    const a = m.appearance()
    expect([a.palette, a.scheme, a.look]).toEqual(['slate', 'light', 'porcelain'])
    expect(a.density).toBe('compact')
  })

  it('a choice saved at the current revision is read exactly as it was saved', async () => {
    const m = await loadAppearance()
    store.set(
      'studio.appearance',
      JSON.stringify({ v: m.APPEARANCE_REVISION, palette: 'ink', texture: 'oak', scheme: 'dark', look: 'porcelain', density: 'compact' }),
    )
    const a = m.appearance()
    expect([a.palette, a.texture, a.scheme, a.look, a.density]).toEqual(['ink', 'oak', 'dark', 'porcelain', 'compact'])
  })

  it('saving stamps the current revision, so the next load keeps the choice', async () => {
    const m = await loadAppearance()
    m.apply({ ...m.appearance(), scheme: 'dark', palette: 'ink' })
    const saved = JSON.parse(store.get('studio.appearance') ?? '{}')
    expect(saved.v).toBe(m.APPEARANCE_REVISION)
    expect(m.appearance().scheme).toBe('dark')
    expect(m.appearance().palette).toBe('ink')
  })

  it('the one look offered has a CSS block in both schemes, and its picker faces match the CSS', async () => {
    const m = await loadAppearance()
    for (const l of m.LOOKS) {
      for (const scheme of ['dark', 'light'] as const) {
        const b = lookBlock(l.id, scheme)
        expect(b, `${l.id} ${scheme}`).not.toBeNull()
        expect(l.faces[scheme][0].toLowerCase()).toBe(b?.canvas?.toLowerCase())
        expect(l.faces[scheme][1].toLowerCase()).toBe(b?.surface?.toLowerCase())
      }
    }
  })
})

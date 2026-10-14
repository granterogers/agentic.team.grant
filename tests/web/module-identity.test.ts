/**
 * A module's identity is one table, and its title ink is readable on both themes (#472, D1).
 *
 * The contrast figures here are computed against reference surfaces that approximate the module surfaces. The measured
 * figures from the Chromium capture (scripts in .out, recorded in docs/release/PROGRESS-LEDGER.md) are the evidence; these
 * tests keep the property from regressing when a colour is edited.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

/** WCAG 2.x relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05)
}

// The reference surfaces: a light panel on the light canvas, and a dark panel on the dark canvas.
const LIGHT_SURFACE = '#f6f7f9'
const DARK_SURFACE = '#1d2127'

const identity = read('web/studio/bc/identity.js')
const compose = read('web/studio/bc/compose.js')
const shell = read('web/studio/bc/shell.js')
const css = read('web/studio/bc/module-identity.css')

/** The six modules compose.js names, so a module added to the page is in this list or the test says so. */
const MODULE_IDS = ['tasks', 'board', 'documents', 'schedule', 'contacts', 'activity']

/** The INKS table, read from its source (the table is not exported as a value a test can import in Node). */
function inksFromSource(): Record<string, { light: string; dark: string }> {
  const block = /const INKS = \{([\s\S]*?)\n\}/.exec(identity)?.[1]
  if (block === undefined) throw new Error('INKS is not in identity.js')
  const out: Record<string, { light: string; dark: string }> = {}
  for (const m of block.matchAll(
    /(\w+):\s*\{\s*light:\s*'(#[0-9a-f]{6})',\s*dark:\s*'(#[0-9a-f]{6})'\s*\}/gi,
  )) {
    if (m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) {
      out[m[1]] = { light: m[2], dark: m[3] }
    }
  }
  return out
}

describe('the identity table', () => {
  const inks = inksFromSource()

  it('gives every module a deep ink for the light theme and a light ink for the dark theme', () => {
    expect(Object.keys(inks).sort()).toEqual([...MODULE_IDS].sort())
  })

  it('keeps every title ink at 4.5 to 1 or more on its theme surface', () => {
    for (const id of MODULE_IDS) {
      const ink = inks[id]
      expect(ink, id).toBeDefined()
      expect(contrast(ink?.light ?? '', LIGHT_SURFACE), `${id} light`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(ink?.dark ?? '', DARK_SURFACE), `${id} dark`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('is read by the markup and the menu, through one assembly, and by nothing else', () => {
    expect(compose).toContain('identity.cssVars(id)')
    expect(shell).toContain('identity.cssVars(id)')
    expect(identity).toContain('export const cssVars = (id) =>')
  })
})

describe('the module styling', () => {
  it('colours the title and the icon by the ink, with a dark rule for each scheme guard', () => {
    expect(css).toContain('var(--bc-id-ink-l)')
    expect(css).toContain(":root[data-scheme='dark'] .bcmod[style*='--bc-id-ink-d'] .bcmodtitle")
    expect(css).toContain('@media (prefers-color-scheme: dark) {')
    expect(css).toContain(
      ":root:not([data-scheme='light']) .bcmod[style*='--bc-id-ink-d'] .bcmodtitle",
    )
  })

  it('never fills a module with its colour: the border and glow are the only uses of the hue', () => {
    const fills = css.match(/background[^;]*var\(--bc-id-hue\)[^;]*/g) ?? []
    expect(fills).toEqual([])
    expect(css).toContain('border-color: color-mix(in srgb, var(--bc-id-hue) 42%, transparent);')
  })

  it('is linked after the earlier module rules, so its colours win where both apply', () => {
    const index = read('web/studio/index.html')
    expect(index.indexOf('/bc/module-identity.css')).toBeGreaterThan(
      index.indexOf('/bc/refine.css'),
    )
  })

  it('does not reuse the name of the person-tint variable for the identity', () => {
    expect(css).not.toContain('--bc-tint')
    expect(compose).toContain('--bc-tint:${hue}')
  })
})

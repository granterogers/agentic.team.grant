import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  One palette (9 October 2026). Inside Team HQ the studio's colour names (--accent, --surface, ...) and Settings' own
  role tokens (--st-*) must be aliases of the --bc-* values, so a scheme or an accent changes every surface at once. The
  chat, the menus, Settings and the maximised views had each worn a different colour because they were not.

  Each assertion is the wired expression, not a name appearing somewhere: a stray literal colour in place of the alias
  fails it, which a "file mentions --bc-accent" check would not.
*/
const read = (p: string): string =>
  readFileSync(new URL(`../../web/studio/${p}`, import.meta.url), 'utf8')
const tokens = read('bc/tokens.css')
const settings = read('settings-ui.css')
const polish = read('bc/polish.css')

const declared = (css: string, name: string): string | null => {
  const m = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(css)
  return m === null ? null : (m[1] ?? '').trim()
}

describe('one palette', () => {
  const unify = tokens.slice(tokens.indexOf(':root:root:root[data-experience'))

  it('the studio colour names are aliases of the Team HQ tokens', () => {
    expect(unify.length).toBeGreaterThan(100)
    const wanted: Record<string, string> = {
      '--ground': 'var(--bc-canvas)',
      '--surface': 'var(--bc-surface)',
      '--ink': 'var(--bc-text-strong)',
      '--accent': 'var(--bc-accent)',
      '--on-accent': 'var(--bc-accent-ink)',
      '--good': 'var(--bc-success)',
      '--bad': 'var(--bc-danger)',
      '--warn': 'var(--bc-warn)',
    }
    for (const [name, value] of Object.entries(wanted))
      expect(declared(unify, name), name).toBe(value)
  })

  it('the studio per-control texture is off inside Team HQ (the board has the one material)', () => {
    expect(declared(unify, '--tex-src')).toBe('none')
  })

  it('Settings reads its surfaces, text and state from the Team HQ tokens, with no literal colour for a role', () => {
    const roles = [
      '--st-canvas',
      '--st-panel',
      '--st-text',
      '--st-text-3',
      '--st-accent',
      '--st-ok',
      '--st-warn',
      '--st-bad',
    ]
    for (const r of roles) {
      const v = declared(settings, r) ?? ''
      expect(v, r).toMatch(/var\(--bc-/)
      expect(v, r).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?!\))/)
    }
  })

  it('every accent has a light-scheme step, so a chosen palette stays readable on the stone surface', () => {
    for (const id of ['moss', 'clay', 'ink', 'paper'])
      expect(tokens, id).toMatch(
        new RegExp(`data-palette='${id}'\\]\\[data-scheme='light'\\]\\s*\\{[^}]*--bc-accent:\\s*#`),
      )
  })

  it('the maximised view is scrimmed with shadow, never with the canvas colour (which is pale in the light scheme)', () => {
    const back = /\.bcexpback\s*\{([^}]*)\}/.exec(polish)?.[1] ?? ''
    expect(back).toMatch(/--bc-shadow-ink/)
    expect(back).not.toMatch(/--bc-canvas/)
  })
})

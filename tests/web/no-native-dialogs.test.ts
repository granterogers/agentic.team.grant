import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * P5: the browser's own confirm, alert and prompt have no focus handling, no 44px target and no way for a screen reader to be
 * told what they are about; every destructive control asks through the page's own dialog instead. Two native calls remain on
 * purpose, as the fallback when that dialog module cannot be loaded at all (an unasked destructive press is the worse
 * failure), and they are named here so a third one is a deliberate act.
 *
 * `sure()` is ASYNC. A caller that forgets `await` reads the pending promise as "yes" and performs the destructive act
 * unasked, which is why the second property is asserted over the source rather than left to review.
 */
const FILES = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? FILES(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : [],
  )
const SOURCES = FILES('web/studio').map((f) => ({ f, text: readFileSync(f, 'utf8') }))
/** Code with block and line comments removed, so a sentence ABOUT confirm() is not a call to it. */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Native calls in a piece of code: a bare `confirm(` or a `window.confirm(`, never `settingsUi.confirmDialog(` or `x.prompt(`. */
const nativeCalls = (c: string): number =>
  [...c.matchAll(/(?:window\.)?\b(?:confirm|alert|prompt)\s*\(/g)].filter((m) => {
    if (m[0].startsWith('window.')) return true
    const prev = c[(m.index ?? 0) - 1] ?? ''
    return !/[.\w$]/.test(prev)
  }).length

/** Calls to sure() that are not awaited (and are not its own definition). */
const unawaitedSure = (c: string): number[] =>
  [...c.matchAll(/\bsure\s*\(/g)]
    .filter((m) => {
      const before = c.slice(0, m.index).replace(/[\s(!]+$/, '')
      return !/function\s*$/.test(before) && !/\bawait$/.test(before)
    })
    .map((m) => c.slice(0, m.index).split('\n').length)

const ALLOWED_FALLBACKS = ['web/studio/office.js', 'web/studio/undo.js']

describe('the product asks in its own dialog, never the browser’s', () => {
  it('no native confirm, alert or prompt outside the two named fallbacks', () => {
    const found = SOURCES.filter(
      ({ f, text }) => !ALLOWED_FALLBACKS.includes(f) && nativeCalls(code(text)) > 0,
    ).map(({ f }) => f)
    expect(found).toEqual([])
  })

  it('the two fallbacks are exactly the ones named (one call each), so a third is a deliberate act', () => {
    const counts = Object.fromEntries(
      SOURCES.filter(({ f }) => ALLOWED_FALLBACKS.includes(f)).map(({ f, text }) => [
        f,
        nativeCalls(code(text)),
      ]),
    )
    expect(counts).toEqual({ 'web/studio/office.js': 1, 'web/studio/undo.js': 1 })
  })

  it('every call to sure() is awaited', () => {
    const bad = SOURCES.flatMap(({ f, text }) =>
      unawaitedSure(code(text)).map((line) => `${f}:${String(line)}`),
    )
    expect(bad).toEqual([])
  })

  it('CONTROL: the detectors fail on the shapes they exist for, and pass the right ones', () => {
    expect(unawaitedSure('if (!sure("delete?")) return')).toHaveLength(1)
    expect(unawaitedSure('if (!(await sure("delete?"))) return')).toHaveLength(0)
    expect(unawaitedSure('const yes = await sure(q, "Go")')).toHaveLength(0)
    expect(unawaitedSure('export async function sure(question) {}')).toHaveLength(0)
    expect(nativeCalls('if (!window.confirm("x")) return')).toBe(1)
    expect(nativeCalls('if (!confirm("x")) return')).toBe(1)
    expect(nativeCalls('window.alert("x")')).toBe(1)
    expect(nativeCalls('const r = window.prompt("x")')).toBe(1)
    expect(nativeCalls('settingsUi.confirmDialog({})')).toBe(0)
    expect(nativeCalls('await ui.confirmDialog({})')).toBe(0)
    expect(nativeCalls('dictate.prompt(x)')).toBe(0)
  })
})

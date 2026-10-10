import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  The tick on a My Tasks page row (integration, 10 October 2026). bc.css renders the base .bccheck as a NATIVE checkbox in the dark scheme,
  so a row outside the modules was a solid dark square on the light board. The modules draw their own tick; the page rows must too. This
  reads the stylesheet for the rule that takes the native appearance away on `.bclist .bcitem > .bccheck`, and for the checked state.
*/
const css = readFileSync(
  new URL('../../web/studio/bc/refine.css', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

const blockFor = (source: string, selector: string): string => {
  const at = source.indexOf(`${selector} {`)
  if (at < 0) return ''
  return source.slice(at, source.indexOf('}', at) + 1)
}

const BASE = "[data-experience='basecamp'] .bclist .bcitem > .bccheck"

describe('the My Tasks page tick is drawn, not native', () => {
  it('takes the native appearance away', () => {
    const rule = blockFor(css, BASE)
    expect(rule).toContain('appearance: none')
    expect(rule).toContain('box-shadow')
  })

  it('has a checked state in the accent', () => {
    expect(blockFor(css, `${BASE}:checked`)).toContain('var(--bc-accent)')
    expect(blockFor(css, `${BASE}:checked::after`)).toContain('var(--bc-accent-ink)')
  })

  it('the detector finds nothing when the rule is missing (control)', () => {
    expect(blockFor('.x { color: red }', BASE)).toBe('')
  })
})

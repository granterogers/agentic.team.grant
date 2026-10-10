import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Three defects that only appear with realistic data (staging validation, 10 October 2026; found by scripts/isolated/stress-browser.ts):
  a 100-character project name pushed the project menu to 784px on a 390px phone; a one-line Card table card was a 30px control; and
  the My Tasks tick answered a finger in 28px. The stress run is the proof; this holds the three rules where they are written.
*/
const raw = readFileSync(new URL('../../web/studio/bc/refine.css', import.meta.url), 'utf8')
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

const block = (selector: string): string => {
  const at = css.indexOf(`${selector} {`)
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at) + 1)
}

describe('rules found by realistic data volumes', () => {
  it('the project menu list is one column that may shrink', () => {
    expect(block("[data-experience='basecamp'] .bcmenulist")).toContain('minmax(0, 1fr)')
  })

  it('a Card table card is 44px on a touch screen', () => {
    expect(css).toContain('.bcminicard { min-height: 44px; -webkit-box-pack: center; }')
  })

  it('the My Tasks tick has a hit area larger than its drawing on a touch screen', () => {
    expect(css).toContain(
      ".bclist .bcitem > .bccheck::before { content: ''; position: absolute; inset: -8px; }",
    )
  })

  it('the detector finds nothing when a rule is missing (control)', () => {
    expect(block('.no-such-rule')).toBe('')
  })
})

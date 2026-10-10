import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  The agenda under a narrow month (staging validation, 10 October 2026). At 360px the maximised schedule's day agenda scrolls
  (`overflow-y: auto`), and axe's scrollable-region-focusable named it: a region the keyboard cannot reach cannot be scrolled by
  a keyboard user. Every place the agenda is opened must make it a keyboard stop with a name.
*/
const source = readFileSync(new URL('../../web/studio/bc/calendar.js', import.meta.url), 'utf8')

const openers = (text: string): string[] => text.match(/<div class="bccal2day"[^>]*>/g) ?? []

describe('the scrolling day agenda is a keyboard stop', () => {
  it('finds every place it is opened (so the checks below are not about an empty list)', () => {
    expect(openers(source).length).toBeGreaterThanOrEqual(2)
  })

  it('every opener has tabindex 0 and an accessible name', () => {
    for (const tag of openers(source)) {
      expect(tag).toContain('tabindex="0"')
      expect(tag).toContain('aria-label=')
    }
  })

  it('the detector flags an opener that lacks them (control)', () => {
    const bad = openers('<div class="bccal2day"><h3>')[0] ?? ''
    expect(bad).not.toContain('tabindex')
  })
})

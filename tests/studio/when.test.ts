/**
 * The words for a time, and the boundaries between them.
 *
 * Issue #153. `web/studio/when.js` is now the single place the product decides
 * what "recent" means — the whole second half of the Issue:
 *
 *   > *It also makes every relative time in the product derive from one
 *   > function instead of from whichever SQL built that section, which is how
 *   > "This week" and "3 days ago" came to disagree in the first place.*
 *
 * Which makes its boundaries worth pinning here rather than eyeballing in a
 * browser. A unit test walks the edge of every unit in a millisecond; a capture
 * run cannot see 59 seconds versus 61 at all.
 */

import { describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; the studio has no build
// step by ADR-0002, so there is nothing to generate them from and nothing that
// would consume them.
import { exact, stamp, words } from '../../web/studio/when.js'

const NOW = Date.parse('2026-09-12T14:00:00Z')
const ago = (ms: number): string => words(new Date(NOW - ms).toISOString(), NOW) as string

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('words', () => {
  it('calls anything under a minute "just now"', () => {
    expect(ago(0)).toBe('just now')
    expect(ago(59 * SECOND)).toBe('just now')
  })

  it('switches to minutes at exactly one minute', () => {
    expect(ago(MINUTE)).toBe('1 minute ago')
    expect(ago(MINUTE - 1)).toBe('just now')
  })

  /*
    Singular and plural, because "1 minutes ago" survives a whole design review
    and then reads as a bug to everyone who sees it afterwards.
  */
  it('agrees in number', () => {
    expect(ago(MINUTE)).toBe('1 minute ago')
    expect(ago(2 * MINUTE)).toBe('2 minutes ago')
    expect(ago(HOUR)).toBe('1 hour ago')
    expect(ago(DAY)).toBe('1 day ago')
    expect(ago(2 * DAY)).toBe('2 days ago')
  })

  it('rounds down rather than to nearest, so it never claims more than has passed', () => {
    expect(ago(119 * MINUTE)).toBe('1 hour ago')
    expect(ago(HOUR - SECOND)).toBe('59 minutes ago')
    expect(ago(DAY - SECOND)).toBe('23 hours ago')
  })

  /*
    Past a month the relative form stops helping: "47 days ago" is a number
    somebody has to do arithmetic on, and "14 Jul" is the answer they wanted.
  */
  it('gives up on relative past a month', () => {
    expect(ago(29 * DAY)).toBe('29 days ago')
    expect(ago(60 * DAY)).toBe('14 Jul')
  })

  /*
    The future is reachable three ways and none is a bug: a due date, a
    scheduled step, and a browser clock a few seconds ahead of the server's.
    "-3 minutes ago" is what happens when nobody thinks about it.
  */
  it('does not render the future as negative time ago', () => {
    expect(ago(-30 * SECOND)).toBe('just now')
    expect(ago(-10 * MINUTE)).toBe('in 10 min')
    expect(ago(-3 * HOUR)).toBe('in 3h')
    expect(ago(-5 * DAY)).toBe('in 5 days')
  })

  it('says nothing at all about a time it cannot read', () => {
    expect(words('not a date', NOW)).toBe('')
    expect(words('', NOW)).toBe('')
  })
})

describe('stamp', () => {
  it('carries the instant and the exact date, so the words are never the only truth', () => {
    const html = stamp('2026-09-12T13:55:00Z') as string
    expect(html).toContain('datetime="2026-09-12T13:55:00.000Z"')
    expect(html).toContain('data-rel')
    expect(html).toContain('title="')
  })

  /*
    The fallback is what makes this safe to roll through the projections one at
    a time: a section whose `_at` key has not been added yet keeps showing
    exactly what it showed before, rather than going blank.
  */
  it('falls back to what the server rendered when there is no instant', () => {
    expect(stamp(null, '3 days ago')).toBe('3 days ago')
    expect(stamp(undefined, '3 days ago')).toBe('3 days ago')
    expect(stamp('nonsense', '3 days ago')).toBe('3 days ago')
    expect(stamp(null, '')).toBe('')
  })

  it('escapes the fallback, which is server text', () => {
    expect(stamp(null, '<script>x</script>')).not.toContain('<script>')
  })
})

describe('exact', () => {
  it('is the whole date, never abbreviated, because it is the fallback', () => {
    const said = exact('2026-09-12T14:00:00Z') as string
    expect(said).toContain('September')
    expect(said).toContain('2026')
  })

  it('is empty for something it cannot read', () => {
    expect(exact('not a date')).toBe('')
  })
})

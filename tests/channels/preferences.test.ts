/**
 * §12: natural-language instructions become structured persistent preferences.
 *
 * The two examples the spec gives by name — "leave me alone today" and "only
 * important things" — are the first two tests, because a spec example that is
 * not a test case is a spec example nobody checked.
 */
import { describe, expect, it } from 'vitest'
import { looksLikeAPreference, parseInstruction } from '../../src/channels/preferences.ts'

const HOUR = 60 * 60 * 1000

describe("the spec's own examples", () => {
  it('"leave me alone today" becomes a bounded quiet window', () => {
    const r = parseInstruction('leave me alone today')
    expect(r.notUnderstood).toBeNull()
    expect(r.preference.quietForMs).toBe(24 * HOUR)
    // And it does NOT silence blockers. This is the whole safety property.
    expect(r.preference.blockersAlways).toBeUndefined()
  })

  it('"only important things" becomes a severity floor and nothing else', () => {
    const r = parseInstruction('only important things')
    expect(r.preference.minSeverity).toBe('important')
    // It said nothing about muting, so the parse must not invent a window.
    expect(r.preference.quietForMs).toBeUndefined()
    expect(r.preference.digestMode).toBeUndefined()
  })
})

describe('severity floors', () => {
  it.each([
    ['only urgent stuff please', 'urgent'],
    ['only blockers', 'blocker'],
    ['only things I need to decide', 'blocker'],
    ['only the big stuff', 'important'],
    ['tell me everything', 'trivial'],
  ])('%s -> %s', (text, expected) => {
    expect(parseInstruction(text).preference.minSeverity).toBe(expected)
  })
})

describe('quiet windows', () => {
  it('reads an explicit number of hours', () => {
    expect(parseInstruction('quiet for 3 hours').preference.quietForMs).toBe(3 * HOUR)
  })

  it('prefers the explicit duration over the day-long default', () => {
    // Both rules could match "quiet ... 2 hours". The explicit one is first in
    // its group, so the narrower reading wins — a longer mute than asked for is
    // the failure that goes unnoticed.
    expect(parseInstruction('leave me alone for 2 hours').preference.quietForMs).toBe(2 * HOUR)
  })

  it('gives the mute_24h button the same effect as the sentence', () => {
    // One definition, two paths. If the button had its own code path they would
    // drift, and the drift would be invisible.
    expect(parseInstruction('mute_24h').preference.quietForMs).toBe(
      parseInstruction('leave me alone today').preference.quietForMs,
    )
  })
})

describe('blockers survive an ordinary mute', () => {
  it.each([
    'leave me alone today',
    'quiet for 8 hours',
    'only important things',
    'mute_24h',
    'no telegram',
  ])('%s does not silence blockers', (text) => {
    expect(parseInstruction(text).preference.blockersAlways).toBeUndefined()
  })

  it('only an unambiguous request for total silence can', () => {
    expect(parseInstruction('absolutely nothing today').preference.blockersAlways).toBe(false)
    expect(parseInstruction('not even blockers').preference.blockersAlways).toBe(false)
  })
})

describe('channels and digests', () => {
  it('mutes a named channel without touching the others', () => {
    const r = parseInstruction('no slack today')
    expect(r.preference.mutedChannels).toEqual(['slack'])
  })

  it('reads a digest cadence', () => {
    expect(parseInstruction('once a day is fine').preference.digestMode).toBe('daily')
    expect(parseInstruction('hourly please').preference.digestMode).toBe('hourly')
  })
})

describe('combining effects', () => {
  it('applies one effect per group from a compound instruction', () => {
    const r = parseInstruction('leave me alone today, and after that only important things')
    expect(r.preference.quietForMs).toBe(24 * HOUR)
    expect(r.preference.minSeverity).toBe('important')
    expect(r.matched.length).toBeGreaterThanOrEqual(2)
  })
})

describe('not understood is a result, not a failure mode', () => {
  it('reports what it could not apply rather than silently doing nothing', () => {
    const r = parseInstruction('make the dashboard blue')
    expect(r.preference).toEqual({})
    expect(r.notUnderstood).toContain('make the dashboard blue')
  })

  it('handles an empty instruction', () => {
    expect(parseInstruction('   ').notUnderstood).toBe('the instruction was empty')
  })

  it('never returns a partial preference alongside a not-understood', () => {
    // The database CHECK enforces this too, but catching it here names the bug.
    const r = parseInstruction('completely unrelated sentence')
    expect(Object.keys(r.preference)).toHaveLength(0)
    expect(r.notUnderstood).not.toBeNull()
  })
})

describe('word boundaries', () => {
  it('does not mute anything because of the word "commuter"', () => {
    // /mute/ as a substring would match this. The effect of the bug would be
    // silence, which is indistinguishable from a correct mute.
    const r = parseInstruction('the commuter numbers look wrong')
    expect(r.preference.quietForMs).toBeUndefined()
    expect(r.preference.mutedChannels).toBeUndefined()
  })
})

describe('looksLikeAPreference', () => {
  it('separates "not a preference" from "an unparseable preference"', () => {
    expect(looksLikeAPreference('leave me alone today')).toBe(true)
    expect(looksLikeAPreference('mute telegram')).toBe(true)
    expect(looksLikeAPreference('what is the status of the migration?')).toBe(false)
  })
})

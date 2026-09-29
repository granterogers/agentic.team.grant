/**
 * The gate's preflight runs first, and stops the gate when it fails (#381).
 *
 * Read from the source rather than imported, because importing e2e.ts runs it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const src = readFileSync('scripts/e2e.ts', 'utf8')
const gate = src.slice(src.indexOf('const GATE:'), src.indexOf('\n]\n', src.indexOf('const GATE:')))
const entries = [
  ...gate.matchAll(/^\s*(?:\[\s*)?'((?:verify|check|backup|purge|slack):[a-z0-9:-]+)',/gm),
].map((m) => String(m[1]))

describe('the readiness gate order', () => {
  it('found the gate (a scan that finds nothing proves nothing)', () => {
    expect(entries.length).toBeGreaterThan(30)
    expect(entries).toContain('verify:escapes')
  })
  it('the two origin preflights are the first two entries', () => {
    expect(entries.slice(0, 2)).toEqual(['check:door-origins', 'check:voice-sessions'])
  })
  it('every live-door suite comes after both', () => {
    const live = [
      'verify:escapes',
      'verify:history',
      'verify:security',
      'verify:slack',
      'verify:telegram',
    ]
    for (const s of live.filter((x) => entries.includes(x)))
      expect(entries.indexOf(s), s).toBeGreaterThan(entries.indexOf('check:voice-sessions'))
  })
  it('a failed preflight stops the gate', () => {
    expect(src).toMatch(
      /if \(PREFLIGHT\.includes\(script\) && r\.status !== 'pass'\) \{[\s\S]{0,300}break/,
    )
  })
})

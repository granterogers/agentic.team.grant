/**
 * The pure parts of discovery, and the one judgement it makes.
 *
 * Phase 4's acceptance is mostly enforced by the schema, so these cover what
 * the schema cannot: slug derivation, the untitled-notebook fallback, and
 * change detection by fingerprint.
 */
import { describe, expect, it } from 'vitest'
import { displayName, fingerprintContent, slugify } from '../../src/projects/sync.ts'

describe('slugify', () => {
  it.each([
    ['AI Team HQ Test', 'ai-team-hq-test'],
    ['  Spaces  Everywhere  ', 'spaces-everywhere'],
    ['Q3 / Q4 Planning!', 'q3-q4-planning'],
    ['Café Research', 'cafe-research'],
    ['UPPER case MIX', 'upper-case-mix'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('always satisfies the database CHECK constraint', () => {
    // projects_slug_format is `^[a-z0-9]+(-[a-z0-9]+)*$`. A slug that fails it
    // turns discovery into a failed sync, so the shape is asserted here rather
    // than discovered at an INSERT.
    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/
    for (const input of [
      'AI Team HQ',
      '!!!',
      '   ',
      '---',
      'a',
      'Ω unicode Ω',
      'trailing-punctuation!!!',
      'x'.repeat(200),
      '2026 Q1',
    ]) {
      expect(slugify(input), `slugify(${JSON.stringify(input)})`).toMatch(pattern)
    }
  })

  it('is deterministic, because a slug is a stable handle', () => {
    // A random suffix would mean an upstream rename created a second project
    // rather than being recognised as the same one.
    expect(slugify('Research')).toBe(slugify('Research'))
  })

  it('stays within a sensible length', () => {
    expect(slugify('x'.repeat(500)).length).toBeLessThanOrEqual(60)
  })
})

describe('displayName', () => {
  it('uses the title when there is one', () => {
    expect(displayName({ id: 'abc12345-def', title: 'Real Title' })).toBe('Real Title')
  })

  it('names an untitled notebook after its id, not after nothing', () => {
    // The first live sync found an untitled notebook and the empty string
    // failed projects_name_present. The fallback is deliberately obviously a
    // placeholder and traceable to the thing it stands for.
    expect(displayName({ id: '45eb6a5c-201d-4608', title: '' })).toBe(
      'Untitled notebook (45eb6a5c)',
    )
    expect(displayName({ id: '45eb6a5c-201d-4608', title: '   ' })).toBe(
      'Untitled notebook (45eb6a5c)',
    )
  })

  it('gives two untitled notebooks different names', () => {
    // Otherwise they collide on slug and the second one takes a `-2` suffix
    // that says nothing about which notebook it is.
    const a = displayName({ id: 'aaaaaaaa-1111', title: '' })
    const b = displayName({ id: 'bbbbbbbb-2222', title: '' })
    expect(a).not.toBe(b)
    expect(slugify(a)).not.toBe(slugify(b))
  })
})

describe('fingerprintContent', () => {
  it('produces the shape the database CHECK requires', async () => {
    // documents_fingerprint_sha256 is `^[0-9a-f]{64}$`.
    expect(await fingerprintContent('hello')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the content changes by one character', async () => {
    // This is what makes the ten-minute cycle affordable: without a real
    // change signal, every sync rewrites every row and every downstream
    // consumer sees everything as new.
    expect(await fingerprintContent('finding')).not.toBe(await fingerprintContent('findings'))
  })

  it('is stable for identical content', async () => {
    const text = 'the same source text, fetched twice'
    expect(await fingerprintContent(text)).toBe(await fingerprintContent(text))
  })

  it('distinguishes whitespace, because a reformatted source is a changed one', async () => {
    expect(await fingerprintContent('a b')).not.toBe(await fingerprintContent('a  b'))
  })
})

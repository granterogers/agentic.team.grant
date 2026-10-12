import { describe, expect, it } from 'vitest'
import { redactStrict, strictFamilies } from '../../src/text/secrets'

// Every specimen is built from pieces so no credential-shaped literal sits in the repository.
const j = (...p: string[]) => p.join('')
const slack = j('xo', 'xb-', '1234567890-', 'abcdefghijklmnop')

describe('redactStrict', () => {
  it('removes a vendor token and names nothing of it', () => {
    const out = redactStrict(`here ${slack} there`)
    expect(out).not.toContain('abcdefghijklmnop')
  })

  it('removes credentials in a URL, keeping the host', () => {
    const out = redactStrict('see https://alice:swordfishsynthetic@example.com/path')
    expect(out).not.toContain('swordfishsynthetic')
    expect(out).toContain('example.com')
  })

  it('removes a password assignment of a short value', () => {
    expect(redactStrict('password=hunter2x')).not.toContain('hunter2x')
    expect(redactStrict('Token: abc12345')).not.toContain('abc12345')
  })

  it('sees through zero-width and bidi characters', () => {
    const split = j(slack.slice(0, 6), '\u{200B}', slack.slice(6, 12), '\u{202E}', slack.slice(12))
    expect(redactStrict(split)).not.toContain('abcdefghijklmnop')
  })

  it('sees through full-width letters', () => {
    const out = redactStrict('ｐａｓｓｗｏｒｄ＝swordfishsynthetic')
    expect(out).not.toContain('swordfishsynthetic')
  })

  it('leaves token counts, durations, ids and dates alone', () => {
    for (const s of [
      'input_tokens=1234 output_tokens=567',
      'took 842 ms',
      'job 3f2b8c1e-1111-4222-8333-444455556666',
      '2026-10-11T10:00:00Z',
      'pass: 3 of 4',
      'https://example.com/a/b?c=d',
    ]) {
      expect(redactStrict(s)).toBe(s)
    }
  })

  it('is idempotent', () => {
    for (const s of [`x ${slack}`, 'password=hunter2x', 'https://u:pw12345678@h.example/']) {
      const once = redactStrict(s)
      expect(redactStrict(once)).toBe(once)
    }
  })

  it('is bounded and linear on hostile input', () => {
    const hostile = 'aA1'.repeat(50000)
    const t = Date.now()
    const out = redactStrict(hostile)
    expect(Date.now() - t).toBeLessThan(500)
    expect(out.length).toBeLessThanOrEqual(4000 + 50)
  })

  it('names the family it found', () => {
    expect(strictFamilies(slack).length).toBeGreaterThan(0)
    expect(strictFamilies('nothing here')).toEqual([])
  })
})

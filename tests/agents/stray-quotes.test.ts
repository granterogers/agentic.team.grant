import { describe, expect, it } from 'vitest'
import { withoutStrayQuotes } from '../../src/agents/stray-quotes.js'

describe('an empty quotation at the edge of an answer is removed (R36)', () => {
  it.each([
    ['""   To give you the information in clear bullet points, I need', 'To give you'],
    ['""I can draft the committee note as soon as', 'I can draft'],
    ['"" I need the date, venue, expected headcount', 'I need the date'],
    ['“” I need the venue name', 'I need the venue'],
    ["'' Done.", 'Done.'],
  ])('%s', (raw, start) => {
    expect(withoutStrayQuotes(raw).startsWith(start)).toBe(true)
  })

  it('a trailing empty pair goes too', () => {
    expect(withoutStrayQuotes('That is on your list. ""')).toBe('That is on your list.')
  })

  // Negative controls: a quotation with content is somebody's words.
  it.each([
    '"Chase the printers" is on your list.',
    'You said "make it Monday", so I moved it.',
    '“Friday” is the day the venue gave.',
    'The title is "".', // mid-sentence, not at an edge in the leading sense
  ])('%s is left alone', (raw) => {
    const out = withoutStrayQuotes(raw)
    expect(out.startsWith(raw.slice(0, 5))).toBe(true)
  })

  it('an answer made only of quotes is not turned into nothing', () => {
    expect(withoutStrayQuotes('""')).toBe('""')
  })

  it('the worker applies it to every handler output', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/jobs/worker.ts', 'utf8')
    expect(src).toMatch(/output = \{ \.\.\.output, body: withoutStrayQuotes\(output\.body\) \}/)
  })
})

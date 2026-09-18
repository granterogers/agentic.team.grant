/**
 * A request is not a subtitle.
 *
 * Both call sites in `handlers/artifact.ts` passed `brief.slice(0, 400)` as
 * the report's subtitle, so the cover of every PDF the office has produced
 * printed Grant's own instruction back at him — *"Write me a PDF report on
 * the coaching course modules, from what we hold."* — and then two thirds of
 * an empty page, because that was the only body content on it.
 *
 * `validatePdf` was green over it every time. It checks the header, the
 * trailer, the xref offsets and the page count, and all of those were
 * correct. CLAUDE.md already records that a structural check cannot see a
 * collision; it cannot see this either. It was found by opening the file.
 */
import { describe, expect, it } from 'vitest'
import { type Block, coverLine, coverTakes, layout } from '../../src/artifacts/report.ts'

const para = (text: string): Block => ({ kind: 'paragraph', text })

describe('the line under the title on a report cover', () => {
  it('is the document opening sentence, not the whole paragraph', () => {
    const line = coverLine([
      { kind: 'heading', level: 1, text: 'Ignored' },
      para('The course has limited documented material. Existing reports are empty.'),
    ])
    expect(line).toBe('The course has limited documented material.')
  })

  it('skips headings and empty paragraphs to find it', () => {
    expect(coverLine([{ kind: 'heading', level: 2, text: 'H' }, para('   '), para('Real.')])).toBe(
      'Real.',
    )
  })

  it('is empty when there is no prose, because the cover is laid out for space', () => {
    expect(coverLine([{ kind: 'heading', level: 1, text: 'Only a heading' }])).toBe('')
    expect(coverLine([])).toBe('')
  })

  it('truncates a runaway sentence AT A WORD, not mid-word', () => {
    const long = `${'word '.repeat(80)}end.`
    const line = coverLine([para(long)])
    expect(line.length).toBeLessThanOrEqual(200)
    expect(line.endsWith('…')).toBe(true)
    /*
      The assertion that matters, and the one the first version of this test
      did not have. Length and an ellipsis were both true of
      "…the coaching focus and client enga…", which is what shipped onto a
      rendered cover before anybody opened it. A cut at a word reads as a
      summary; a cut mid-word reads as a bug, because it is one.
    */
    expect(line.replace(/…$/, '')).toMatch(/\S$/)
    expect(line.replace(/…$/, '').split(' ').pop()).toBe('word')
  })

  it('takes a clause when the first full stop is past the cover', () => {
    // The real sentence this was found on runs 214 characters before its
    // first full stop and has a perfectly good semicolon at 96.
    const line = coverLine([
      para(
        'The course has limited documented material; existing status reports are empty, ' +
          'while the opening assessment provides an overview.',
      ),
    ])
    expect(line).toBe('The course has limited documented material')
  })

  it('collapses the whitespace a model leaves in wrapped prose', () => {
    expect(coverLine([para('Two   lines\n  joined. Next.')])).toBe('Two lines joined.')
  })

  it('never returns the instruction, which is the whole point', () => {
    // The shape that shipped: a report whose blocks are real, asked for by a
    // request that must not appear.
    const brief = 'Write me a PDF report on the coaching course modules, from what we hold.'
    const line = coverLine([para('The course has limited documented material.')])
    expect(line).not.toContain('Write me')
    expect(line).not.toBe(brief)
  })
})

/*
  The cover said it and the body said it again.

  `coverLine` takes the first SENTENCE of the opening paragraph and the body
  then printed that paragraph in full — so the identical sentence appeared
  twice, an inch apart, on the cover and at the top of page two. Nothing could
  see it: `validatePdf` checks the header, the trailer, every cross-reference
  offset and the page count, and all of those were correct. It was found by
  rendering a report and looking at it, which is what §22 is for.

  `coverTakes` gives one answer to "did the cover already say this", consulted
  by both the caller that builds the subtitle and the layout that skips the
  block — because two places deciding it by eye is how they come to disagree,
  which is the defect this very file was written about.
*/
describe('the cover and the body do not say the same thing twice', () => {
  const lead = (text: string): Block => ({ kind: 'paragraph', lead: true, text })
  const SHORT =
    'The course has completed four of its six modules, with the remaining two blocked ' +
    'on client sign-off. Enrolment is ahead of plan; completion is behind it.'

  it('takes the WHOLE opening paragraph when it fits, and says the body owes nothing', () => {
    const got = coverTakes([lead(SHORT), { kind: 'heading', level: 1, text: 'Where it stands' }])
    expect(got.consumed).toBe(true)
    expect(got.line).toBe(SHORT)
  })

  it('and the rendered body then does NOT repeat it', () => {
    const blocks = [lead(SHORT), { kind: 'heading', level: 1, text: 'Where it stands' } as Block]
    const taken = coverTakes(blocks)
    const laid = layout({
      author: 'Emma Whitfield',
      blocks,
      created: new Date('2026-09-18T00:00:00Z'),
      sources: [],
      subtitle: taken.line,
      title: 'A report',
    })
    expect(laid.problems).toEqual([])
    /*
      Counted across the WHOLE document rather than per page. The sentence
      legitimately appears once — on the cover — and the defect was a second
      copy, so a per-page assertion would pass on the page that is right.
    */
    const whole = laid.pages.map((p) => p.said()).join('\n')
    const first = SHORT.slice(0, 48)
    const times = whole.split(first).length - 1
    expect(times).toBe(1)
  })

  it('falls back to one clause when the paragraph is too long to be a cover', () => {
    const huge = `${'This is a long opening sentence that keeps going and going. '.repeat(12)}`
    const got = coverTakes([lead(huge)])
    // Not consumed: losing text to fit a title page would be the worse trade,
    // so the body keeps the paragraph and the cover takes a clause.
    expect(got.consumed).toBe(false)
    expect(got.line.length).toBeLessThan(huge.length)
  })

  it('CONTROL: an unconsumed cover line leaves the body paragraph in place', () => {
    const huge = `${'This is a long opening sentence that keeps going and going. '.repeat(12)}`
    const blocks = [lead(huge)]
    const laid = layout({
      author: 'Emma Whitfield',
      blocks,
      created: new Date('2026-09-18T00:00:00Z'),
      sources: [],
      subtitle: coverTakes(blocks).line,
      title: 'A report',
    })
    const whole = laid.pages.map((p) => p.said()).join('\n')
    expect(whole).toContain('This is a long opening sentence')
  })

  it('the cover does not print the author twice', () => {
    const laid = layout({
      author: 'Emma Whitfield, Research Director',
      blocks: [lead(SHORT)],
      created: new Date('2026-09-18T00:00:00Z'),
      sources: [],
      subtitle: SHORT,
      title: 'A report',
    })
    const cover = laid.pages[0]?.said() ?? ''
    /*
      The kicker upper-cases it, so the two occurrences were not identical
      strings and a naive contains-check would have passed. Compared
      case-insensitively, which is how a person reads it.
    */
    const times = cover.toLowerCase().split('emma whitfield').length - 1
    expect(times).toBe(1)
  })
})

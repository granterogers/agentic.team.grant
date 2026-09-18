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
import { type Block, coverLine } from '../../src/artifacts/report.ts'

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

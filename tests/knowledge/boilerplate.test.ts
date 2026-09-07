/**
 * Taking the furniture out, as cases.
 *
 * The document that prompted this is real: 69,000 characters of Wikipedia in
 * Grant's corpus, of which the first four thousand are the navigation menu.
 * Emma cited it back to him as "just the page navigation", which was the right
 * answer to the wrong corpus.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_REMOVED_FRACTION,
  MIN_KEPT_CHARS,
  stripBoilerplate,
} from '../../src/knowledge/boilerplate.ts'

const wikipediaish = [
  'Coaching - Wikipedia',
  'Jump to content',
  'https://en.wikipedia.org/wiki/Coaching#bodyContent',
  '[-]',
  'Main menu',
  'move to sidebar hide',
  'Navigation',
  'Main page',
  'https://en.wikipedia.org/wiki/Main_Page',
  'Contents',
  'https://en.wikipedia.org/wiki/Wikipedia:Contents',
  'Current events',
  'https://en.wikipedia.org/wiki/Portal:Current_events',
  '',
  'Coaching is a form of development in which an experienced person, called a coach,',
  'supports a learner or client in achieving a specific personal or professional goal',
  'by providing training and guidance. Coaching differs from mentoring in that it',
  'focuses on specific tasks or objectives rather than general goals or development.',
].join('\n')

describe('what comes out', () => {
  it('drops the navigation and keeps the article', () => {
    const r = stripBoilerplate(wikipediaish)
    expect(r.applied).toBe(true)
    expect(r.text).toContain('Coaching is a form of development')
    expect(r.text).not.toContain('Jump to content')
    expect(r.text).not.toContain('wikipedia.org/wiki/Main_Page')
  })

  it('drops a line that is nothing but a link', () => {
    const r = stripBoilerplate(
      [
        'A real sentence that is long enough to be prose and to survive.',
        'https://example.com/x',
      ].join('\n'),
    )
    expect(r.text).not.toContain('https://example.com/x')
    expect(r.text).toContain('A real sentence')
  })

  it('keeps a URL that is part of a sentence', () => {
    // Deleting these would change what a source said, which §10's citations
    // are built on not happening.
    const line = 'The register is published at https://example.com/register each quarter.'
    expect(stripBoilerplate(line).text).toBe(line)
  })

  it('keeps a short heading that is not a link label', () => {
    // The distinction is the line AFTER it. "Overview" followed by prose is a
    // heading; "Overview" followed by its own href is a menu item. The first
    // version used run length instead and wanted to delete two thirds of the
    // real article, because this extractor hard-wraps prose into short lines
    // too — measured, not guessed.
    const doc = [
      'Overview',
      'This section explains at some length what the register contains and who maintains it.',
    ].join('\n')
    expect(stripBoilerplate(doc).text).toContain('Overview')
  })

  it('drops a short label that is followed by its own link', () => {
    const doc = [
      'Main page',
      'https://en.wikipedia.org/wiki/Main_Page',
      'This section explains at some length what the register contains and who maintains it.',
    ].join('\n')
    expect(stripBoilerplate(doc).text).not.toContain('Main page')
  })

  it('keeps a full sentence even when a link follows it', () => {
    const doc = [
      'The full register of accredited providers is published every quarter.',
      'https://example.com/register',
    ].join('\n')
    expect(stripBoilerplate(doc).text).toContain('The full register')
  })
})

describe('when it does not understand the document', () => {
  it('leaves a link list alone rather than reducing it to nothing', () => {
    // A page that is only links has nothing to keep, and returning three
    // characters would be worse than returning the page. The floor catches
    // this without anyone having to guess the right percentage.
    const linksOnly = Array.from(
      { length: 30 },
      (_, i) => `Item ${String(i)}\nhttps://example.com/${String(i)}`,
    ).join('\n')
    const r = stripBoilerplate(linksOnly)
    expect(r.applied).toBe(false)
    expect(r.text).toBe(linksOnly)
    expect(r.refused).toContain('nothing substantial')
  })

  it('says how much it WANTED to remove even when it refuses', () => {
    // The first version zeroed the counters on refusal, so "nothing matched"
    // and "everything matched and was overruled" had one symptom. That cost an
    // hour of looking in the wrong place.
    const linksOnly = Array.from(
      { length: 30 },
      (_, i) => `Item ${String(i)}\nhttps://example.com/${String(i)}`,
    ).join('\n')
    expect(stripBoilerplate(linksOnly).removedChars).toBeGreaterThan(0)
  })

  it('has stated limits rather than implicit ones', () => {
    expect(MAX_REMOVED_FRACTION).toBeGreaterThan(0)
    expect(MAX_REMOVED_FRACTION).toBeLessThan(1)
    expect(MIN_KEPT_CHARS).toBeGreaterThan(0)
  })

  it('leaves ordinary prose completely alone', () => {
    const prose =
      'Coaching is a form of development in which an experienced person supports a learner.\n\n' +
      'It differs from mentoring in that it focuses on specific tasks rather than general goals.'
    const r = stripBoilerplate(prose)
    expect(r.text).toBe(prose)
    expect(r.applied).toBe(false)
  })

  it('survives an empty document', () => {
    expect(stripBoilerplate('').text).toBe('')
  })
})

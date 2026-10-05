/**
 * What source a document is, which entries are one document, and what a filter
 * keeps. The negative controls matter more than the positives: a merge or a
 * match that fires on a title is a failure that hides somebody's file.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as D from '../../web/studio/bc/docsources.js'

describe('source', () => {
  it('prefers what the office says outright', () => {
    expect(D.sourceOf({ source: 'drive', origin: 'Yours' })).toBe('drive')
  })
  it('infers from the connector, then the label, and never guesses', () => {
    expect(D.sourceOf({ connector: 'drive' })).toBe('drive')
    expect(D.sourceOf({ connector: 'notebooklm' })).toBe('notebook')
    expect(D.sourceOf({ origin: 'Yours' })).toBe('upload')
    expect(D.sourceOf({ kind: 'made', origin: 'Oliver · 2 days ago' })).toBe('generated')
    expect(D.sourceOf({ origin: 'Google Drive' })).toBe('drive')
    expect(D.sourceOf({ origin: 'Somebody Else' })).toBe('other')
    expect(D.sourceOf({})).toBe('other')
  })
})

describe('type', () => {
  it('reads the media type before the name, and the name before the label', () => {
    expect(D.typeOf({ mime: 'application/pdf', title: 'x' })).toBe('pdf')
    expect(D.typeOf({ title: 'Budget.xlsx' })).toBe('sheet')
    expect(D.typeOf({ title: 'photo.JPG' })).toBe('image')
    expect(D.typeOf({ kind: 'audio', title: 'note' })).toBe('audio')
    expect(D.typeOf({ title: 'weird.bin' })).toBe('other')
  })
})

describe('one logical document', () => {
  it('merges on an explicit canonical id', () => {
    const out = D.dedupe([
      { id: 1, title: 'Plan', canonical_id: 'abc', connector: 'drive' },
      { id: 2, title: 'Plan (copy)', canonical_id: 'abc', connector: 'notion' },
    ])
    expect(out).toHaveLength(1)
  })
  it('merges on the same connector and external reference, and says where else it is held', () => {
    const out = D.dedupe(
      [
        { id: 1, title: 'A', connector: 'drive', external_ref: 'f1' },
        {
          id: 2,
          title: 'A',
          connector: 'drive',
          external_ref: 'f1',
          imported: true,
          origin: 'Yours',
        },
      ].map(D.enrich),
    )
    expect(out).toHaveLength(1)
    expect(out[0].imported).toBe(true)
  })
  it('NEVER merges on a title alone (negative control)', () => {
    const out = D.dedupe([
      { id: 1, title: 'Report' },
      { id: 2, title: 'Report' },
      { id: 3, title: 'Report', connector: 'drive', external_ref: 'f1' },
      { id: 4, title: 'Report', connector: 'drive', external_ref: 'f2' },
    ])
    expect(out).toHaveLength(4)
  })
  it('does not merge the same reference in two different connectors', () => {
    const out = D.dedupe([
      { id: 1, connector: 'drive', external_ref: 'x' },
      { id: 2, connector: 'notion', external_ref: 'x' },
    ])
    expect(out).toHaveLength(2)
  })
})

describe('filtering', () => {
  const docs = [
    {
      id: 1,
      title: 'Customer research report',
      origin: 'Google Drive',
      connector: 'drive',
      kind: 'doc',
      tags: ['research'],
    },
    { id: 2, title: 'Course one-pager', origin: 'Oliver', kind: 'made', mime: 'application/pdf' },
    { id: 3, title: 'Notes.txt', origin: 'Yours' },
  ].map(D.enrich)
  it('by source', () => {
    expect(
      D.applyFilter(docs, { source: 'drive', type: 'all', q: '' }).map((d: { id: number }) => d.id),
    ).toEqual([1])
    expect(
      D.applyFilter(docs, { source: 'generated', type: 'all', q: '' }).map(
        (d: { id: number }) => d.id,
      ),
    ).toEqual([2])
  })
  it('by type', () => {
    expect(
      D.applyFilter(docs, { source: 'all', type: 'pdf', q: '' }).map((d: { id: number }) => d.id),
    ).toEqual([2])
  })
  it('by words, all of them, in the title, the origin or a tag', () => {
    expect(
      D.applyFilter(docs, { source: 'all', type: 'all', q: 'customer research' }),
    ).toHaveLength(1)
    expect(
      D.applyFilter(docs, { source: 'all', type: 'all', q: 'research tag-that-is-absent' }),
    ).toHaveLength(0)
    expect(D.applyFilter(docs, { source: 'all', type: 'all', q: 'drive' })).toHaveLength(1)
  })
  it('counts only what is present', () => {
    const c = D.counts(docs)
    expect(c.get('drive')).toBe(1)
    expect(c.has('notion')).toBe(false)
  })
})

describe('the way back to the source', () => {
  it('derives a Drive address from the id and nothing else from a guess', () => {
    expect(D.sourceUrl({ src: 'drive', external_ref: 'abc' })).toBe(
      'https://drive.google.com/file/d/abc/view',
    )
    expect(D.sourceUrl({ src: 'notion', external_ref: 'abc' })).toBe('')
    expect(D.sourceUrl({ src: 'notion', external_url: 'https://notion.so/x' })).toBe(
      'https://notion.so/x',
    )
    expect(
      D.sourceUrl({ src: 'drive', external_url: 'javascript:alert(1)', external_ref: '' }),
    ).toBe('')
  })
})

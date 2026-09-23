/**
 * A citation's scheme names where the source came from, and the office's own
 * work is not "null".
 *
 * `documents.connector` is nullable and every one of the ten null rows has
 * `origin = 'made'` — they are the PDFs the office produced. Three sites
 * interpolated `${connector}:${id}` independently, so a report citing an
 * earlier report printed
 *
 *     Legacy Coaching Course – Status Report — null:b8f72c15-0423-…
 *
 * on its sources page, in a PDF Grant reads. Five of them are in real
 * delivered artifacts from 17 September.
 *
 * 0177 already refused a `'none'` sentinel in that column — *a sentinel
 * satisfies the constraint and lies*. The answer is to ask `origin`, which
 * knows, rather than to invent a value for `connector`, which does not.
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { citationRef, isUntrusted, sourceRefs } from '../../src/knowledge/retrieval.ts'

describe('the scheme of a citation', () => {
  it('is the connector when there is one', () => {
    expect(citationRef({ connector: 'notebooklm', documentId: 'abc' })).toBe('notebooklm:abc')
  })

  it('is `made` for a document the office produced', () => {
    expect(citationRef({ connector: null, origin: 'made', documentId: 'abc' })).toBe('made:abc')
  })

  it('is never the word null', () => {
    for (const source of [
      { connector: null, origin: 'made', documentId: 'a' },
      { connector: null, origin: null, documentId: 'b' },
      { connector: null, documentId: 'c' },
      { connector: '', origin: 'made', documentId: 'd' },
    ]) {
      expect(citationRef(source)).not.toContain('null')
    }
  })

  it('and says `unknown` rather than guessing a connector it has not got', () => {
    // Honest beats tidy: the office does not know, and a plausible scheme
    // would be a claim about provenance nobody made.
    expect(citationRef({ connector: null, origin: null, documentId: 'x' })).toBe('unknown:x')
  })

  it('reaches the answer’s sources through sourceRefs', () => {
    const refs = sourceRefs([
      {
        connector: null,
        origin: 'made',
        documentId: 'abc',
        title: 'Status Report',
        rank: 1,
        excerpt: '',
      },
    ])
    expect(refs[0]).toBe('made:abc Status Report')
  })
})

describe('and a document the office made is not somebody else’s material', () => {
  /*
    `isUntrusted` fences what was written elsewhere and pulled in
    automatically. Fencing the office's own work would tell the model to
    distrust its own report — and a null connector is exactly that work.
  */
  it('a null connector is not fenced', () => {
    expect(isUntrusted(null)).toBe(false)
  })

  it('while the three that are still are', () => {
    for (const c of ['browser', 'gmail', 'mail']) expect(isUntrusted(c)).toBe(true)
  })
})

describe('and every site that writes one uses the same format', () => {
  it('the artifact handler does not interpolate a connector itself', async () => {
    const text = await readFile(new URL('../../src/handlers/artifact.ts', import.meta.url), 'utf8')
    /*
      The wired CALL, not the import. A test that only checked the file
      mentions `citationRef` stays green when one of the two source lists goes
      back to a template — which is the defect this file exists for, and there
      were two of them.
    */
    const calls = text.match(/citationRef\(\{ connector: d\.connector/g) ?? []
    expect(calls.length).toBe(2)
    expect(text).not.toMatch(/ref: `\$\{d\.connector\}:\$\{d\.id\}`/)
  })
})

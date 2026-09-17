/**
 * What the office may conclude from having found nothing (#257).
 *
 * Grant asked about a document in the project's linked Google Notebook and was
 * told it could not be found. The search was honest and the sentence was not:
 * "there is nothing in our documents" is legitimate evidence when the index
 * covers what is attached, and a lie the moment a connector is attached with
 * nothing indexed.
 *
 * `coverageNote` is the difference, and it is a pure function of the coverage
 * so it can be asserted without a database. The important half is the EMPTY
 * case: a sentence saying "I searched all of it" on every turn is noise that
 * teaches a model to skim the block it sits in.
 */

import { describe, expect, it } from 'vitest'
import { type Coverage, coverageNote } from '../../src/knowledge/retrieval.ts'

const covered = (over: Partial<Coverage> = {}): Coverage => ({
  blank: [],
  complete: true,
  documents: 33,
  ...over,
})

describe('when the index covers everything attached', () => {
  it('says nothing at all', () => {
    expect(coverageNote(covered())).toBe('')
  })

  it('CONTROL: including when the project holds no documents but nothing is attached', () => {
    // Nothing attached means nothing unindexed. An empty project is not a
    // project with a gap in it, and saying so would make every new project
    // open with a caveat.
    expect(coverageNote(covered({ documents: 0 }))).toBe('')
  })
})

describe('when a connector is attached and unindexed', () => {
  it('names it, in words Grant would use', () => {
    const note = coverageNote(covered({ blank: ['drive'], complete: false }))
    expect(note).toContain('Google Drive')
    // The connector slug is for the database; the sentence is for a model that
    // copies what it reads — the defect that put "Setting aside constraint
    // #242." in front of Grant.
    expect(note).not.toMatch(/\bdrive\b/)
  })

  it('forbids the sentence that caused the Issue', () => {
    const note = coverageNote(covered({ blank: ['notebooklm'], complete: false }))
    expect(note).toContain('the Google Notebook')
    expect(note).toContain('never that the thing does not exist')
  })

  it('says how much it DID search, so the caveat is not the whole answer', () => {
    expect(coverageNote(covered({ blank: ['drive'], complete: false, documents: 12 }))).toContain(
      '12 document(s)',
    )
  })

  it('reads as English with two, not as a list with an and missing', () => {
    const note = coverageNote(covered({ blank: ['drive', 'notion'], complete: false }))
    expect(note).toContain('Google Drive and Notion')
    expect(note).toContain('are attached')
    expect(note).toContain('have not been read')
  })

  it('and with three', () => {
    const note = coverageNote(covered({ blank: ['drive', 'notion', 'upload'], complete: false }))
    expect(note).toContain('Google Drive, Notion and the files you uploaded')
  })

  it('falls back to the slug for a connector nobody has written words for', () => {
    // A future connector must produce a clumsy sentence rather than no
    // sentence: silence here is the failure this whole module exists to stop.
    const note = coverageNote(covered({ blank: ['some_new_thing'], complete: false }))
    expect(note).toContain('some_new_thing')
    expect(note).toContain('never that the thing does not exist')
  })
})

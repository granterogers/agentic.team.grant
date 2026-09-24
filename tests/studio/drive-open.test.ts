/*
 * WHERE A LINKED FILE OPENS.
 *
 * Derived rather than stored, so this is where the derivation is pinned: a
 * spreadsheet must not open at a document's URL, and an unknown provider must
 * produce NOTHING rather than a guess, because a link that goes somewhere
 * wrong is worse than a document that opens its own details.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import { opensAt } from '../../web/studio/bc/drive.js'

const ID = '1abcDEFghiJKLmnoPQRstu'

describe('a document that lives in Google Drive', () => {
  it('opens a Doc as a Doc', () => {
    expect(opensAt({ connector: 'drive', ref: ID, kind: 'google-doc' })).toBe(
      `https://docs.google.com/document/d/${ID}/edit`,
    )
  })

  it('opens a Sheet as a Sheet, not as a Doc', () => {
    const url = opensAt({ connector: 'drive', ref: ID, kind: 'google-sheet' })
    expect(url).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit`)
    expect(url).not.toContain('/document/')
  })

  it('opens Slides as Slides', () => {
    expect(opensAt({ connector: 'drive', ref: ID, kind: 'google-slides' })).toContain(
      '/presentation/',
    )
  })

  /*
    EVERYTHING DRIVE HOLDS AS A REAL FILE opens at the same address whatever it
    is - a PDF, an image, a recording - so this is one branch rather than a
    list that would be missing the next format.
  */
  for (const kind of ['pdf', 'image', 'audio', 'video', 'text', 'file']) {
    it(`opens ${kind} at the file viewer`, () => {
      expect(opensAt({ connector: 'drive', ref: ID, kind })).toBe(
        `https://drive.google.com/file/d/${ID}/view`,
      )
    })
  }

  it('says nothing for a connector it does not know', () => {
    expect(opensAt({ connector: 'notion', ref: ID, kind: 'page' })).toBe('')
  })

  it('and nothing for a document with no reference, rather than a broken link', () => {
    expect(opensAt({ connector: 'drive', ref: '', kind: 'google-doc' })).toBe('')
    expect(opensAt({})).toBe('')
    expect(opensAt(null)).toBe('')
  })

  /*
    THE CONTROL. Every assertion above is about a URL being produced, and a
    function that returned the same URL for everything would satisfy most of
    them. Two kinds must not collide.
  */
  it('and two kinds never produce the same address', () => {
    const doc = opensAt({ connector: 'drive', ref: ID, kind: 'google-doc' })
    const sheet = opensAt({ connector: 'drive', ref: ID, kind: 'google-sheet' })
    const file = opensAt({ connector: 'drive', ref: ID, kind: 'pdf' })
    expect(new Set([doc, sheet, file]).size).toBe(3)
  })
})

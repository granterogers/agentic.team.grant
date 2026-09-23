/**
 * The path that WRITES A DOCUMENT must be told what the office could not look
 * at, not merely what it found.
 *
 * `mailBlock(hits, coverage)` produces the coverage note only on the no-hits
 * branch, and `handlers/artifact.ts` called it with ONE argument for the life
 * of the feature — so a PDF was composed from a prompt that said nothing about
 * mail at all. `instruction.ts` has passed it since #172 and its comment
 * beside that call says exactly what the gap costs: any *"there is nothing in
 * your email"* the model produced was a claim about a search it had never been
 * shown.
 *
 * It is the only branch either path takes today. `public.contacts` holds zero
 * rows and the contact tier is the strong one, so every one of Grant's
 * projects associates zero of 274 cached messages.
 *
 * The parameter's DEFAULT is what allowed it. Making coverage required turned
 * one silent omission into a compile error at every call site, now and for the
 * next one added.
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { mailBlock } from '../../src/knowledge/retrieval.ts'

const source = async (name: string): Promise<string> =>
  await readFile(new URL(`../../src/${name}`, import.meta.url), 'utf8')

describe('an empty mail search is not an empty inbox', () => {
  it('says the office could not connect any of it, and may not say there is none', () => {
    const note = mailBlock([], { cached: 274, contacts: 0, aliases: 0, associated: 0 })
    expect(note).toContain('274 cached messages')
    expect(note).toContain('may NOT')
  })

  it('and distinguishes holding nothing from matching nothing', () => {
    const note = mailBlock([], { cached: 0, contacts: 0, aliases: 0, associated: 0 })
    expect(note).toContain('no cached mail at all')
    expect(note).not.toContain('may NOT')
  })

  /*
    THE CASE THAT WAS SILENT ON EVERY REAL PROJECT.

    The note used to return '' whenever the project had a contact or an alias —
    asking "could this ever match?" where the branch means "this search found
    nothing". Measured live: all five of Grant's active projects match ZERO of
    274 cached messages and every one has at least one alias, one of them five
    contacts. So it was suppressed exactly where it was needed.
  */
  it.each([
    [{ cached: 274, contacts: 0, aliases: 3, associated: 0 }, 'an alias nobody writes about'],
    [{ cached: 274, contacts: 5, aliases: 1, associated: 0 }, 'contacts who have not written'],
  ])('still says it could not connect any of it — %#: %s', (cover) => {
    const note = mailBlock([], cover)
    expect(note).toContain('274 cached messages')
    expect(note).toContain('may NOT')
    // And it says WHY, because the two cases point at different fixes.
    expect(note).toContain('none of them comes from a contact')
  })

  it('and names the other reason when the project has neither', () => {
    const note = mailBlock([], { cached: 274, contacts: 0, aliases: 0, associated: 0 })
    expect(note).toContain('this project has neither')
    expect(note).toContain('may NOT')
  })

  it('and says nothing at all when no coverage was read', () => {
    // Still a legitimate answer — but the caller now has to say so.
    expect(mailBlock([], null)).toBe('')
  })
})

describe('and both paths that build a prompt pass it', () => {
  /*
    The wired ARGUMENT, not the name. A test asserting the file mentions
    `mailBlock` stays green when the second argument is dropped, which is the
    defect this file exists for — three vacuous controls in this repository
    passed exactly that way.
  */
  it('the handler that answers passes what it read', async () => {
    expect(await source('handlers/instruction.ts')).toMatch(/mailBlock\(mail, mailCover\)/)
  })

  it('the handler that writes a document passes what it read', async () => {
    const text = await source('handlers/artifact.ts')
    expect(text).toMatch(/mailBlock\(post, cover\)/)
    expect(text).toMatch(/app\.mail_coverage\(/)
  })

  it('and the parameter has no default, so a third caller cannot forget', async () => {
    const text = await source('knowledge/retrieval.ts')
    expect(text).toMatch(
      /export function mailBlock\(\s*hits: readonly MailHit\[\],\s*coverage: MailCoverage \| null,?\s*\): string/,
    )
    expect(text).not.toMatch(/coverage: MailCoverage \| null = null/)
  })
})

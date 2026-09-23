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
    const note = mailBlock([], { cached: 274, contacts: 0, aliases: 0, associated: null })
    expect(note).toContain('274 cached messages')
    expect(note).toContain('may NOT')
  })

  it('and distinguishes holding nothing from matching nothing', () => {
    const note = mailBlock([], { cached: 0, contacts: 0, aliases: 0, associated: null })
    expect(note).toContain('no cached mail at all')
    expect(note).not.toContain('may NOT')
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

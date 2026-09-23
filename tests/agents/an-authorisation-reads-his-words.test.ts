/**
 * The one clause that authorises duplicating work must be read from Grant's
 * own sentence, and must cover the class rather than one memorable phrasing.
 *
 * #316 permits a second independent attempt only when he clearly asks for
 * one. `wantsAnotherGo` is that clause. It was being read from
 * `instruction` — which `resolveAgainstThread` replaces — and every pattern
 * in `again.ts` is anchored to a whole short sentence, which is exactly the
 * shape the resolver expands. Driven live against a real thread, both
 * directions occurred: "try it again" resolved to a sentence the recogniser
 * declines, and "give it another go" resolved to "Ask them again.", which
 * authorises duplication he never asked for.
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { wantsAnotherGo } from '../../src/agents/again.ts'

describe('asking for another go, said the ways people say it', () => {
  it.each([
    'give it another go',
    'Give it another go',
    'have another go at it',
    'give the pricing report another crack',
    'have another crack at it please',
    'can you give it another bash',
    'try it again',
    'ask them again',
  ])('reads %j as a deliberate retry', (said) => {
    expect(wantsAnotherGo(said)).toBe('retry')
  })

  /*
    The expensive direction. Each of these is a question, a report of
    something already done, or a sentence about somebody else — and reading
    one as authorisation spends the office twice on an answer nobody asked
    for twice.
  */
  it.each([
    'should we give it another go',
    'would it be worth another go',
    'I gave it another go yesterday and it was no better',
    'they had another go at the venue quote',
    'another go would probably help',
    'what if we gave it another go',
  ])('declines %j', (said) => {
    expect(wantsAnotherGo(said)).toBeNull()
  })
})

describe('and the office reads it from what he said', () => {
  const source = async (): Promise<string> =>
    await readFile(new URL('../../src/handlers/instruction.ts', import.meta.url), 'utf8')

  it('decides it from his pre-rewrite words, never from the resolution', async () => {
    const text = await source()
    /*
      The wired expression, not the name. CLAUDE.md records three vacuous
      controls that passed sabotage because an import still named the
      function — what discriminates is that the ARGUMENT is his words.
    */
    expect(text).toMatch(/const hisWords = resolved\.from \?\? instruction/)
    expect(text).toMatch(/const askedForAnother = wantsAnotherGo\(hisWords\)/)
  })

  it('passes that one decision down rather than re-deriving it from the plan text', async () => {
    const text = await source()
    expect(text).toMatch(
      /planAndPursue\(deps\.db, deps\.router, job, goalAsHeSaidIt, askedForAnother\)/,
    )
  })

  it('never reads the authorisation from the resolved instruction', async () => {
    const text = await source()
    const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(withoutComments).not.toMatch(/wantsAnotherGo\(instruction\)/)
  })
})

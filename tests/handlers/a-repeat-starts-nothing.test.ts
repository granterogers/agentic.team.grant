/**
 * Saying it again does not quietly make a second one (#316, still live for
 * the artifact path).
 *
 * Driven against the deployed worker, one reply said all of this:
 *
 *     You asked me that a moment ago and it came back — here is what it
 *     found: … Say the word if you want it done again from scratch.
 *     Writing that up as a PDF from what this project holds.
 *
 * It offered him the choice and took it for him in the next sentence. Two
 * PDFs into the project, which is the provenance harm this repository keeps
 * paying for: an answer citing two copies of one thing as two sources.
 *
 * `alreadyOn`'s own comment already said what should happen — "Still running:
 * say who has it, and do not start a second one" — and three branches that
 * start work had never been told.
 */

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = async (): Promise<string> =>
  (await readFile(new URL('../../src/handlers/instruction.ts', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

/*
  The declarations that START work, named by the recogniser each falls through
  to. Asserted as the WIRED guard, because a test that only checked the name
  was present stays green when the expression is replaced by null — three
  vacuous controls in this repository passed exactly that way.
*/
const STARTS_WORK: readonly (readonly [string, string])[] = [
  ['a PDF or a report', 'firstOf(artifactRequest)'],
  ['a page to read', 'entitled.page(turn.kept)'],
  ['tasks pulled out of a document', 'firstOf(extractionRequest)'],
]

describe('a branch that starts work consults the decision already made', () => {
  it.each(STARTS_WORK)(
    '%s is not started when the office has just said it is in hand',
    async (_what, reader) => {
      const text = await source()
      const at = text.indexOf(reader)
      expect(at).toBeGreaterThan(-1)
      /*
      Bounded at BOTH ends — from the declaration that owns this reader back
      to nothing further than its own `const`. A slice with one open end runs
      into the next block and is satisfied by it, which is how a sabotage that
      gutted a fan-in's error handling left its check green.
    */
      const from = text.lastIndexOf('const ', at)
      const guard = text.slice(from, at)
      expect(guard).toContain('alreadyOn !== null')
    },
  )

  it('and the narration it belongs to is the same decision', async () => {
    const text = await source()
    expect(text).toMatch(/const alreadyOn =\s*alreadyRunning === null/)
  })
})

describe('and nothing new starts work without deciding about this', () => {
  /*
    A STALE BASELINE rather than a list to keep in step by hand. Every child
    kind this handler can start is named here with what it is; adding one
    fails this test, which is the moment to decide whether a repeat should
    start it twice. Derived from the source, so it cannot quietly drift.
  */
  const KNOWN = new Set([
    'artifact.report',
    'browser.gather',
    'notebook.add_source',
    'notebook.generate',
    'notebook.list_artifacts',
    'office.extract_tasks',
    'office.instruction',
    'office.notion_adopt',
    'office.notion_import',
    'office.pursue',
    'web.research',
  ])

  it('the child kinds it can start are the ones that have been thought about', async () => {
    const text = await source()
    const found = new Set<string>()
    const call = /app\.enqueue_child(?:_once)?\(/g
    for (let m = call.exec(text); m !== null; m = call.exec(text)) {
      const kind = /'([a-z_]+\.[a-z_]+)'/.exec(text.slice(m.index, m.index + 240))
      if (kind !== null) found.add(kind[1] as string)
    }
    expect(found.size).toBeGreaterThan(5)
    expect([...found].filter((k) => !KNOWN.has(k))).toEqual([])
  })
})

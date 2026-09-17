/**
 * A refusal a MODEL reads must not carry an issue number.
 *
 * ## The answer this is written against
 *
 * Grant asked for the margin impact and an announcement email. What the
 * communications director produced began:
 *
 *   > *"Setting aside constraint #242. Subject: New Lower Prices – 15% Off.
 *   > Dear [Customer Name], …"*
 *
 * Seven outputs in thirty days opened that way. The prompt never mentions
 * #242 — the COHERENCE GATE does. Its refusal ended *"say in one clause which
 * constraint you set aside (#242)"*, the refusal is written into
 * `pinned_config` so the retry can see it (which is the closed loop CLAUDE.md
 * asks for), and the model copied the reference into the answer, because from
 * where it sits that is part of the instruction.
 *
 * So the rule is a property of the whole module rather than of one string: a
 * message written for a model to read is written in the words Grant would use,
 * and an issue number is not one of them. The comments above each check keep
 * their references — they are for a person reading the code, and losing them
 * would cost the provenance this repository runs on.
 *
 * Asserted over the SOURCE rather than by enumerating outcomes, for the same
 * reason the command-bar test reads the drawable views out of the source: the
 * next message added is the one an enumeration would miss.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  fileURLToPath(new URL('../../src/agents/quality.ts', import.meta.url)),
  'utf8',
)

/**
 * Every `problem:` value, as written.
 *
 * A problem is an object property whose value is a string expression running
 * to the next line ending in `,` at the same nesting — crude, and crude is
 * right: a parser here would be a second thing to maintain, and over-capturing
 * makes the assertion STRICTER rather than weaker.
 */
const problemMessages = (): string[] => {
  const out: string[] = []
  const lines = source.split('\n')
  for (const [i, line] of lines.entries()) {
    if (!/^\s*problem:/.test(line)) continue
    const block: string[] = []
    for (let j = i; j < Math.min(i + 12, lines.length); j++) {
      const l = lines[j] ?? ''
      block.push(l)
      if (/,\s*$/.test(l) && j > i) break
      if (/^\s*problem:.*,\s*$/.test(l)) break
    }
    /*
      Comments out.

      The block runs to the end of the value, so a `//` line explaining WHY a
      message says what it says gets swept in — and the first run of this test
      caught its own explanation, which mentions the number it exists to keep
      out. A comment is for a person; only the string reaches a model.
    */
    out.push(
      block
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join(' ')
        .trim(),
    )
  }
  return out
}

describe('what the office says when it refuses its own answer', () => {
  it('finds the refusal messages at all', () => {
    // The control for a source-reading test: a regex that matched nothing
    // would pass every assertion below and prove nothing at all.
    expect(problemMessages().length).toBeGreaterThanOrEqual(10)
  })

  it('names no issue number, because the model copies what it reads', () => {
    const offenders = problemMessages().filter((m) => /#\d+/.test(m))
    expect(offenders.map((m) => m.replace(/\s+/g, ' ').trim().slice(0, 100))).toEqual([])
  })

  it('names no section mark either — §11 is not a sentence Grant would write', () => {
    const offenders = problemMessages().filter((m) => /§\s*\d+/.test(m))
    expect(offenders.map((m) => m.replace(/\s+/g, ' ').trim().slice(0, 100))).toEqual([])
  })
})

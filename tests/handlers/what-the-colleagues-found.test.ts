/**
 * 0549 — what the specialists came back with reaches the conversation.
 *
 * ## Measured
 *
 *     real child jobs                      56
 *     of those, wrote an output            56
 *     of those, reachable by a later turn   0
 *
 * `app.conversation_before` built each earlier turn from the PARENT's own
 * output — `where o.job_id = c.job_id` — so every answer a specialist ever
 * produced was structurally invisible to the next thing Grant said.
 *
 * Live on v723:
 *
 *     say:    work out what the three big competitors charge …
 *     office: (fans out to two children, both of which answer)
 *     say:    what did they come back with?
 *     office: "I don't have any competitor pricing data in our records."
 *
 * Not a retrieval failure and not a narration failure. The conversation could
 * not see its own work.
 *
 * ## A payload gaining a key needs three places to learn it
 *
 * The reader, the prompt and the provenance bucket — and the two that are not
 * the renderer fail SILENTLY, which CLAUDE.md records costing a Governance
 * section that read "0 open" over fourteen rows. This asserts all three,
 * because two of them cannot be seen from any screen.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/handlers/instruction.ts', 'utf8')
const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const sql = readFileSync(
  'migrations/0549_what_the_specialists_found_reaches_the_conversation.sql',
  'utf8',
)

describe('all three places learned the key', () => {
  it('the reader carries it', () => {
    expect(withoutComments).toMatch(/colleagues: Array\.isArray\(entry\.colleagues\)/)
    expect(withoutComments).toMatch(
      /said: string; answered: string \| null; colleagues: string\[\]/,
    )
  })

  it('the prompt shows it, attributed', () => {
    expect(withoutComments).toContain('What the colleagues I asked came back with')
    /*
      As the OFFICE's turn, not Grant's. A colleague's answer replayed as a
      user turn would read as something he told the office, which is the
      fabrication-laundering shape `provenance.ts` exists to prevent.
    */
    expect(withoutComments).toMatch(/role: 'assistant' as const,\s*content: `What the colleagues/)
  })

  it('and provenance files it as the office own prose, never as evidence', () => {
    /*
      #128's safety property: Oliver may write up what Emma found, and a
      figure of Emma's does not become grounded by having passed through her.
      `answeredBefore` is conversation; `retrieved` is evidence.
    */
    const before = withoutComments.indexOf('answeredBefore: [')
    const retrieved = withoutComments.indexOf('retrieved:', before)
    const colleagues = withoutComments.indexOf('turns.flatMap((t) => t.colleagues)', before)
    expect(colleagues).toBeGreaterThan(before)
    expect(colleagues).toBeLessThan(retrieved === -1 ? Number.MAX_SAFE_INTEGER : retrieved)
  })
})

describe('and the reader is bounded', () => {
  it('takes at most two colleagues per turn, and only ones that said something', () => {
    /*
      Twelve turns of unbounded specialist output would crowd out the material
      the current turn is about, and #309 is what an overfull prompt costs.
    */
    expect(sql).toMatch(/limit 2\) x\) as colleagues/)
    expect(sql).toMatch(/coalesce\(trim\(o2\.body\), ''\) <> ''/)
  })

  it('reads a CHILD of that turn, not the turn itself', () => {
    expect(sql).toMatch(/where k\.parent_job_id = c\.job_id/)
  })
})

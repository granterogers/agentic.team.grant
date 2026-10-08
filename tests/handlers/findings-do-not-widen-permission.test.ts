/**
 * #440 must remove a disclaimer, never widen a permission.
 *
 * A findings request lands no row, so the office used to open a grounded finding with "I have not done this yet". The fix
 * drops that SENTENCE when findings are the answer. A first draft did it by counting the finding as a landed row; that
 * also made `contractFor` permit promises and completion claims, so a draft saying "I have emailed Kevin" skipped the
 * rewrite (the version 1 acceptance suite, M2b, went red: "I could not get through what you asked me just now" instead of
 * the honest rewrite). The permission reads the rows; only the wording reads the findings.
 *
 * Reads the source because the turn is assembled inside a handler that needs a database and a model. The assertions are on
 * the wired expressions, not on a name appearing in the file.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/handlers/instruction.ts', 'utf8')

describe('findings as the answer', () => {
  it('only a draft he asked for is counted as landed; findings are not', () => {
    expect(source).toMatch(
      /\.\.\.\(draftIsTheAnswer \? \{ landed: outcome\.landed \+ 1 \} : \{\}\),/,
    )
    expect(source).not.toMatch(/findingsAreTheAnswer \? \{ landed/)
    expect(source).not.toMatch(/draftIsTheAnswer \|\| findingsAreTheAnswer/)
  })

  it('the state sentence is dropped by name, and the permission still reads the one outcome', () => {
    expect(source).toMatch(
      /const outcomeLine = findingsAreTheAnswer \? null : sayWhatHappened\(outcomeNow\)/,
    )
    expect(source).toMatch(/const may = contractFor\(outcomeNow\)/)
  })
})

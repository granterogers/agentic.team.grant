/**
 * A convened team is the work (#441, found with a real model).
 *
 * With a real model the planner returned a plan for "ask the team to investigate X, Y and Z", so the lead ALSO started a
 * pursuit of the same request: a plan say-back instead of the hand-off note, then a message repeating the project's
 * sources verbatim after the synthesis. The scripted proof (message-ordering.ts, O6) drives it end to end; this pins the
 * wired expression, so the guard cannot become a name that nothing evaluates.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/handlers/instruction.ts', 'utf8')

describe('the planner does not pursue a request whose team has been convened', () => {
  it('teamIsTheWork needs branches this turn actually started AND a request for findings only (a request that also writes still plans)', () => {
    expect(source).toMatch(
      /const teamIsTheWork = branchesStarted\.length > 0 && requests\.every\(answersByFindings\)/,
    )
  })

  it('and it gates the pursuit itself, not a comment about it', () => {
    expect(source).toMatch(
      /const pursuing =\s+actedAlready \|\| isBranch \|\| teamIsTheWork \|\| requests\.length === 0\s+\? null\s+: await planAndPursue\(/,
    )
  })
})

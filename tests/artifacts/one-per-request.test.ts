/**
 * One request, one report (#258).
 *
 * The first live Slack round trip produced TWO near-identical PDFs from one
 * sentence: the parent turn started an `artifact.report`, AND handed the
 * instruction verbatim to a second specialist, who read the same words and
 * started another. Both finished seconds apart and both landed in the project.
 *
 * CLAUDE.md names what that costs — an answer citing two of them as separate
 * sources is the provenance defect this office keeps paying for, manufactured
 * by the office itself.
 *
 * The guard is one line in `instruction.ts` and the property it protects is
 * stated here, in the source, because the live suite that found it costs eight
 * minutes and a real Slack channel. A unit test that reads the source is a weak
 * test in general; it is the right one for a guard whose whole content is
 * "this branch of this function must not be reached in this case", and it can
 * be broken on purpose in a second.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/handlers/instruction.ts', 'utf8')

describe('an artifact is started once per request', () => {
  it('a branch child does not start its own report', () => {
    // The guard, as a property: whatever it is spelt, the artifact request is
    // not consulted when the turn is a hand-off.
    expect(source).toMatch(/isBranch\s*=\s*String\(payload\.handed_off_by \?\? ''\) !== ''/)
    expect(source).toMatch(/job\.projectId === null \|\| isBranch \? null : artifactRequest/)
  })

  it('and the hand-off is what sets the flag the guard reads', () => {
    // Both halves, because either alone is the defect: a guard reading a field
    // nothing writes is inert, and a field nothing reads is dead weight.
    expect(source).toMatch(/'handed_off_by', \$\{lit\(who\.slug\)\}/)
  })

  it('the extraction path is guarded the same way, which is the precedent', () => {
    // Named so that removing one and leaving the other is visible: these two
    // are the same rule about the same sentence.
    expect(source).toMatch(/wantsFile !== null \? null : extractionRequest/)
  })
})

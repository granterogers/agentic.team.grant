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

/**
 * Where each action is decided, and what its decision may read.
 *
 * The first version of this file asserted the guard's exact SPELLING —
 * `wantsFile !== null ? null : extractionRequest` — and went red the day the
 * guard got stronger and wrapped onto three lines. CLAUDE.md records that
 * correction more often than any other: assert the property, never the
 * artefact that currently implements it.
 *
 * The property is that the expression deciding each action mentions
 * `isBranch`. Read off the assignment itself, so reformatting is invisible and
 * deleting the guard is not.
 */
const decides = (name: string): string => {
  const at = source.indexOf(`const ${name} =`)
  if (at < 0) throw new Error(`no assignment to ${name} in instruction.ts`)
  // Up to the end of that statement: the next `const ` at the same depth is
  // close enough, and every one of these is followed by one.
  const next = source.indexOf('\n      const ', at + 1)
  return source.slice(at, next < 0 ? at + 600 : next)
}

describe('an action is performed once per request', () => {
  it('the flag exists and the hand-off is what sets it', () => {
    // Both halves, because either alone is the defect: a guard reading a field
    // nothing writes is inert, and a field nothing reads is dead weight.
    expect(source).toMatch(/isBranch\s*=\s*String\(payload\.handed_off_by \?\? ''\) !== ''/)
    expect(source).toMatch(/'handed_off_by', \$\{lit\(who\.slug\)\}/)
  })

  /*
    EVERY action path, not the two that had already been paid for.

    #258 guarded the artifact and #135 inherited it for the page fetch. The
    independent acceptance pass found the next instance — "Call it X" convened
    three specialists and put three tasks on Grant's list — and the lesson of
    CLAUDE.md's #249/#254 pair is that a third copy of the same two lines is
    the mistake, not the fix. So the rule is stated once, over the whole list,
    and a new action path added without the guard fails here rather than in
    front of Grant.
  */
  for (const [name, why] of [
    ['wantsFile', 'a second PDF from one sentence (#258)'],
    ['askedForPage', 'a second fetch of the same page (#135)'],
    ['sent', 'a connector wired twice'],
    ['wanted', 'a notebook artifact made twice'],
    ['listing', 'the same listing enqueued twice'],
    ['pullOut', 'one document extracted into two sets of tasks'],
    ['forGrant', 'one personal task per specialist convened'],
    ['asked', 'one agent task per specialist convened'],
    ['namedLater', 'the answer to a title question, acted on twice'],
    ['change', 'one follow-up applied once per specialist'],
  ] as [string, string][]) {
    it(`${name} is not decided on a branch — ${why}`, () => {
      expect(decides(name)).toContain('isBranch')
    })
  }

  it('CONTROL: the helper reads the real assignment, so a typo cannot pass', () => {
    // A found-nothing check needs something that must come back positive.
    expect(() => decides('nothingIsCalledThis')).toThrow()
    expect(decides('wantsFile')).toContain('artifactRequest')
  })
})

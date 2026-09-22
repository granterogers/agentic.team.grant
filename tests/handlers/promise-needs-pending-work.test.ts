/**
 * The other half of #302's contract: the WRITER is told what it may say.
 *
 * `outcome.ts` computes the permission from rows and `sayWhatHappened`
 * composes the sentence the class owes. A live probe against the deployed
 * worker showed that was not enough on its own — with the composed line
 * leading, the office still answered:
 *
 *   > *"I have not done this. I understood what you want and could not carry
 *   > it out — say it again in a sentence and I will. …but I'll create a task
 *   > for the appropriate team member to own it and set a deadline two weeks
 *   > before the expiry date so it doesn't slip."*
 *
 * against **0 tasks and 0 child jobs**. The truth led and the promise followed
 * it, which is a mixed message rather than an honest one.
 *
 * So the permission is stated to the model as well, gated on the same
 * `contractFor(outcome)` the sentence is gated on. Two gates reading one
 * computation, never two computations — a row list built twice is a list that
 * will disagree.
 *
 * ## Why this reads the source
 *
 * The prompt is assembled inside a handler that needs a database and a model,
 * so the assembled messages cannot be reached from a unit test. The property
 * that matters is structural and IS reachable: the clause exists, it is gated
 * on the contract rather than on anything about the wording, and it carries
 * nothing a person should not read. `quality-messages.test.ts` reads the
 * source for the same reason and states the same argument.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/handlers/instruction.ts', 'utf8')

/*
  Comments keep their references — they are for a person reading the code.
  Only the strings a MODEL or GRANT reads are under test, so the check strips
  every comment first, exactly as the sibling suite does.
*/
const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('the prohibition on promising exists and is gated on the rows', () => {
  it('is present', () => {
    expect(withoutComments).toContain('NOTHING IS QUEUED TO HAPPEN AFTER THIS ANSWER')
  })

  it('is gated on the contract, not on a property of the wording', () => {
    expect(withoutComments).toMatch(/contractFor\(outcome\)\.mayCommitToFuture\s*\n?\s*\?\s*\[\]/)
  })

  /*
    The permission and the composed sentence must read the SAME outcome.

    Two computations of "what happened" would drift, and the drift would be
    silent: the office would be told it may not promise while the sentence
    said the work was done, or the reverse.
  */
  it('the sentence and the permission read one computation', () => {
    expect(withoutComments).toContain('sayWhatHappened(outcome)')
    expect(withoutComments).toContain('contractFor(outcome)')
    expect(withoutComments.match(/const outcome: CanonicalOutcome = \{/g) ?? []).toHaveLength(1)
  })
})

describe('what the clause may and may not contain', () => {
  const clause = withoutComments
    .slice(withoutComments.indexOf('NOTHING IS QUEUED TO HAPPEN AFTER THIS ANSWER'))
    .slice(0, 700)

  it('carries no issue number or section mark', () => {
    expect(clause).not.toMatch(/#\d{2,4}\b|§\d+/)
  })

  /*
    It must permit the CONDITIONAL future, which is the whole point of asking.

    "Tell me which project and I will" depends on him and is exactly the next
    action the invariant asks for. A clause that forbade every future tense
    would forbid the office from offering to continue, which is worse than
    the defect: it would turn an ask into a dead end.
  */
  it('permits a commitment that depends on him', () => {
    expect(clause).toContain('depends on him')
  })

  it('names the state as the reason, not a list of forbidden words', () => {
    expect(clause).toContain('nothing will')
    for (const phrase of ["'I'll'", '"I will"', 'list of phrases']) {
      expect(clause).not.toContain(phrase)
    }
  })
})

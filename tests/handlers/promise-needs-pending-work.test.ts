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

  /*
    And `asked` is the GRAMMAR's answer, not a restatement of `wanted`.

    Wiring it to `requests.length > 0` compiles, passes every other check in
    this file, and reinstates the measured defect exactly — 22 of 34 live
    turns opening with "I have not done this", 8 of them on questions —
    because `requests` counts the `other` reading that every non-model path
    produces for the whole utterance.

    A source assertion because the handler cannot be unit-driven, and a
    sabotage of that one line is the control: replacing it with the length
    test must turn this red.
  */
  /*
    AND PENDING WORK IS COUNTED FROM ROWS TOO (#312's second half).

    `pendingActions` was `pursuing === null ? 0 : 1` — a variable the handler
    set, which is exactly what `outcome.ts`'s field comment forbids for
    `landed`. Wrong twice over: blind to a child enqueued by any other path,
    and saying ONE when the office fanned out to four.

    Measured live on v721 with #312's fix already deployed: a turn that
    created one child job and two consultations mentioned neither, because
    the contract could not see the child.
  */
  it('counts pending work from the jobs table, not from a variable', () => {
    expect(withoutComments).toMatch(/pendingActions: pendingChildren/)
    expect(withoutComments).toMatch(/parent_job_id = \$\{lit\(job\.jobId\)\}::uuid\) as kids/)
    expect(withoutComments).not.toMatch(/pendingActions: pursuing === null \? 0 : 1/)
  })

  /*
    AND "WAITING ON YOUR WORD" HAS TO BE REACHABLE.

    `awaitingApproval` was hardcoded `false`, so the one branch of
    `sayWhatHappened` that tells Grant the office is waiting on HIM could
    never fire — a permission on the contract with nothing able to reach it.

    Measured live on v723: a turn fanned out, one child completed and the
    other PAUSED with an open blocker asking him to approve the next step,
    and the conversation told him "I have handed this on and will come back
    with what comes of it." Each side waiting for the other, and only one of
    them knowing. Four such blockers are open in real traffic.

    Descendants as well as this job, because the office asking through a
    specialist is still the office asking.
  */
  it('knows when it is waiting on him, including through a child', () => {
    expect(withoutComments).toMatch(/awaitingApproval: Number\(counted\?\.asking \?\? 0\) > 0/)
    expect(withoutComments).toMatch(/b\.state = 'open'/)
    expect(withoutComments).toMatch(
      /c\.parent_job_id = \$\{lit\(job\.jobId\)\}::uuid\)\)\) as asking/,
    )
    expect(withoutComments).not.toMatch(/awaitingApproval: false/)
  })

  it('reads whether he asked from the mood, not from the count', () => {
    expect(withoutComments).toMatch(/asked:\s*askedForWork/)
    expect(withoutComments).toMatch(
      /const askedForWork = requests\.some\([\s\S]{0,80}asksForWork\(/,
    )
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

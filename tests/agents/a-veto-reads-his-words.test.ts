/**
 * A grounded action guarded by an ungrounded veto (#322).
 *
 * ## The failure
 *
 *   Grant : Add a task
 *   office: Happy to add that. What should it be called?
 *   Grant : Call it Review the onboarding copy
 *   office: I am not sure which task you mean — nothing has gone on your list
 *           in this conversation.
 *
 * Two readers decide that turn. `personalTaskChange` sees a RENAME and
 * `titleReply` sees the answer to the office's own question; the second vetoes
 * the first, which is #259's fix and is correct.
 *
 * The veto was reading the wrong text. `instruction` is replaced by
 * `resolveAgainstThread` two thousand lines earlier, so `changesHis` read
 * Grant's own words through `firstOfHis` — #313's rule — and `titleReply` read
 * the MODEL'S PARAPHRASE of them. An action grounded in what he said, guarded
 * by a guard grounded in what a model made of it, is a guard that can vanish
 * for reasons that have nothing to do with him.
 *
 * ## Reproduced without a model
 *
 * The cases below are not one memorable sentence. They are the class: the
 * ways a person answers "what should it be called?", and the ways a thread
 * resolver rewrites them. Two rewrites lose the veto outright and three keep
 * it while corrupting the title, and both are the same defect.
 */

import { describe, expect, it } from 'vitest'
import { NEEDS_A_TITLE, titleReply } from '../../src/agents/tasks.ts'

const asked = NEEDS_A_TITLE

describe('the ways a person answers "what should it be called?"', () => {
  it('are read as the title, whatever the wording', () => {
    for (const [said, want] of [
      ['Call it Review the onboarding copy', 'Review the onboarding copy'],
      ['Review the onboarding copy', 'Review the onboarding copy'],
      ['Chase the caterers', 'Chase the caterers'],
      ['Name it Draft the investor update', 'Draft the investor update'],
    ] as const) {
      expect(titleReply(said, asked, false), said).toBe(want)
    }
  })

  it('and a turn that asks for something of its own is never a title', () => {
    for (const said of [
      'What did Emma say about the pricing?',
      'Actually, cancel that.',
      'Can you look at the notebook instead?',
    ]) {
      expect(titleReply(said, asked, false), said).toBeNull()
    }
  })

  it('a bare phrase is a title only because the office asked', () => {
    expect(titleReply('Review the onboarding copy', 'Here is what I found.', false)).toBeNull()
    expect(titleReply('Review the onboarding copy', null, false)).toBeNull()
  })

  /*
    An EXPLICIT naming form needs no pending question, by design -- `readFollowUp`
    says so: *"an explicit naming form, which needs no pending question"*.

    Written down here because the handler's own comment beside `namedLater`
    claims the opposite -- that it "is only non-null when the office ITSELF
    asked the question in the previous turn, so preferring it cannot swallow an
    ordinary rename". That is true of the bare-phrase branch and false of this
    one, which is CLAUDE.md's comment-with-no-check again. Filed rather than
    changed: which of the two readings "Call it X" deserves when nothing is
    pending is a product question, not a defect this fix should decide.
  */
  it('but an explicit naming form is read as one either way', () => {
    expect(titleReply('Call it Review the onboarding copy', null, false)).toBe(
      'Review the onboarding copy',
    )
  })
})

describe('a model paraphrase is not what the veto may depend on', () => {
  /*
    These are the rewrites that broke it, and they are kept as evidence rather
    than as a specification: the fix is not to make `titleReply` understand
    every paraphrase — that is an enumeration, and the next rewrite is not in
    it — but to stop feeding it one at all.
  */
  it('some rewrites of a title answer are not readable as title answers', () => {
    const lost = [
      'The task should be called Review the onboarding copy',
      'Set the title of the new task to Review the onboarding copy',
    ].filter((r) => titleReply(r, asked, false) === null)
    expect(lost.length).toBeGreaterThan(0)
  })

  it('and some are readable but give the wrong title', () => {
    expect(
      titleReply('Title the task you are adding "Review the onboarding copy"', asked, false),
    ).not.toBe('Review the onboarding copy')
  })
})

describe('the handler reads his words first', () => {
  /*
    Assert the CALL, not the NAME. CLAUDE.md records three vacuous controls in
    one session: `toContain('titleReply')` stays green when the expression is
    replaced, because the import still names it. The wired expression is what a
    sabotage has to remove.
  */
  it('tries every one of his own requests before the rewrite', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/handlers/instruction.ts', 'utf8'),
    )
    expect(source).toContain('firstOfHis(read) ?? read(instruction)')
  })
})

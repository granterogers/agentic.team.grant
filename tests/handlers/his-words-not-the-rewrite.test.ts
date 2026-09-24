/**
 * #313 — a follow-up is recognised from what he SAID, not from the rewrite.
 *
 * ## Measured, in process, with a debug line on the veto
 *
 *     Grant : Make that urgent
 *     read as: Make the 'Ring the caterers …' task urgent
 *     change = null
 *     office: Added it: the 'Ring the caterers …' task urgent
 *     CANONICAL: priority still 100, and a second task on his list
 *
 * `resolveAgainstThread` rewrites an elliptical message so it stands alone,
 * and `instruction` is replaced by the rewrite before any recogniser runs.
 * That is right for the MODEL and exactly wrong for these readers: they key
 * on the elliptical shape BECAUSE the elliptical shape is what a follow-up
 * looks like. Rewriting "Make that urgent" into an imperative naming the task
 * turns a CHANGE into a CREATE — a junk row on his own list AND the task he
 * meant left untouched.
 *
 * Two more shapes, one of them already in the live run's own data before it
 * was looked for:
 *
 *     "Call it Ring the venue"   -> "Call the reminder Ring the venue"   DECLINED
 *     "Call it Review the …"     -> "Call the task Review the …"         "I have not done this."
 *
 * ## Why the properties and not the wording
 *
 * A literal-string assertion is a wording lock, which this repository has
 * paid for six times. What is asserted is the SHAPE: his own sentence is
 * offered to the recognisers, and one clause is never both a change and a
 * new thing.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { personalTaskChange, personalTaskRequest } from '../../src/agents/mine.ts'

const source = readFileSync('src/handlers/instruction.ts', 'utf8')
const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('his own words reach the recognisers', () => {
  it('the original is offered first, ahead of the rewritten clauses', () => {
    const hisRequests = /const hisRequests = \[([\s\S]*?)\]\n/.exec(withoutComments)?.[1] ?? ''
    expect(hisRequests).toContain('resolved.from')
    /*
      FIRST, not merely present. `firstOfHis` returns on the first reader that
      claims a text, so order is the whole behaviour: his words behind the
      rewrite would lose every time the rewrite is also recognised.
    */
    expect(hisRequests.indexOf('resolved.from')).toBeLessThan(
      hisRequests.indexOf('understood.surviving'),
    )
  })

  it('and only when the resolver actually rewrote something', () => {
    /*
      `resolved.from` is null when nothing was rewritten, and feeding the
      readers a null would be a second reading of nothing.
    */
    expect(withoutComments).toMatch(/resolved\.changed && resolved\.from !== null/)
  })
})

describe('one clause is either a change or a new thing', () => {
  it('a recognised change vetoes both create readers', () => {
    expect(withoutComments).toMatch(
      /const changesHis = isBranch \? null : firstOfHis\(personalTaskChange\)/,
    )
    /*
      Bounded by the statement, not by a reading that happens to follow it.
      This sliced as far as `firstOfHis(personalTaskRequest)` and went red when
      that reading moved above the artifact veto (#325) and the site started
      reusing it — the slice-is-a-substring trap, from the open end.
    */
    const forGrant = /const forGrant =([^\n]*(?:\n(?!\s*const )[^\n]*)*)/.exec(withoutComments)?.[1]
    expect(forGrant).toContain('changesHis !== null')
    /*
      And the reading it falls through to is his own words, wherever it is
      computed: `deferred` is `firstOfHis(personalTaskRequest)`.
    */
    // Wrapped since ledger R4b (a title from a rewrite must be grounded in his
    // words), so the property is asserted rather than the exact expression.
    expect(withoutComments).toMatch(
      /const deferred = isBranch\s*\?\s*null\s*:\s*firstOfHis\(\(text\) => \{\s*const got = personalTaskRequest\(text\)\s*\n/,
    )
    const asked = /const asked =([\s\S]*?)taskRequest\(text, classifyIntent\(text\)\)/.exec(
      withoutComments,
    )?.[1]
    expect(asked).toContain('changesHis !== null')
  })

  it('and the change branch reuses that one recognition rather than a second', () => {
    /*
      Two calls to the same recogniser is the "row list built twice" defect:
      the veto and the action could disagree, and then the office would
      decline to create AND decline to change.
    */
    expect(withoutComments).toMatch(/: changesHis\n/)
    expect(withoutComments.match(/firstOfHis\(personalTaskChange\)/g)).toHaveLength(1)
  })
})

describe('the two readers genuinely do not overlap', () => {
  /*
    The veto above only ever SUBTRACTS safely because of this. If a create
    sentence were also read as a change, vetoing would lose the task — the
    expensive direction. Asserted rather than assumed.
  */
  const CREATES = [
    'Remind me tomorrow to ring the printers',
    'Add a task to review the onboarding copy',
    'Put chase the invoice on my list',
    'Remind me on Friday to call the caterers',
    'Remind me to book the hall next week',
  ]
  const CHANGES = ['Make that urgent', 'Actually make that Monday', 'Make that high priority']

  it.each(CREATES)('a new task is not read as a change: %s', (text) => {
    expect(personalTaskRequest(text)).not.toBeNull()
    expect(personalTaskChange(text)).toBeNull()
  })

  it.each(CHANGES)('and a follow-up is not read as a new task: %s', (text) => {
    expect(personalTaskChange(text)).not.toBeNull()
    expect(personalTaskRequest(text)).toBeNull()
  })
})

describe('the rewrite is what loses them, which is why his words go first', () => {
  /*
    The rewrites are the ones the live resolver produced, recorded verbatim.
    They are here so the fix cannot be removed on the argument that the
    resolver is harmless: each of these is a real sentence the office was
    given in place of what Grant typed.
  */
  const REWRITTEN: readonly (readonly [string, string])[] = [
    ['Call it Ring the venue', 'Call the reminder Ring the venue'],
    ['Call it Review the onboarding copy', 'Call the task Review the onboarding copy'],
    ['Make that urgent', "Make the 'Ring the caterers' task urgent"],
  ]

  it.each(REWRITTEN)('"%s" is recognised and its rewrite "%s" is not', (his, rewrite) => {
    expect(personalTaskChange(his)).not.toBeNull()
    expect(personalTaskChange(rewrite)).toBeNull()
  })
})

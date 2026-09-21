/**
 * Mid-message retraction — #291.
 *
 * Paired throughout. A detector shown only the shapes it was written for
 * passes on a corpus of those shapes, and the expensive error here is the
 * other one: withdrawing something the person actually wanted.
 *
 * The "must not fire" half is longer than the "must fire" half on purpose.
 */

import { describe, expect, it } from 'vitest'
import { readRetraction } from '../../src/agents/retraction.ts'

describe('a clause withdrawn in the same message', () => {
  /*
    The three that were live failures, verbatim from the runs that found
    them, and kept verbatim so a future change has something exact to fail
    against.
  */
  const live: [string, string, string][] = [
    [
      'dictated, no punctuation at all',
      'ok so how is the coaching thing looking no forget that push it forward however you like just nobody gets contacted',
      'push it forward however you like just nobody gets contacted',
    ],
    [
      'the pivot is shorter than the clause splitter floor',
      'send that to the funding officer, no leave it, I will do it',
      'I will do it',
    ],
    [
      'a dash and a filler in front of the pivot',
      'can you check whether — actually never mind, just tell me what is on my list',
      'just tell me what is on my list',
    ],
  ]

  for (const [what, said, kept] of live) {
    it(`reads it: ${what}`, () => {
      const r = readRetraction(said)
      expect(r).not.toBeNull()
      expect(r?.kept).toBe(kept)
      expect(r?.withdrawn.length).toBeGreaterThan(0)
    })
  }

  it('withdraws everything when nothing follows the pivot', () => {
    const r = readRetraction('Draft the announcement email. Actually, hold off on that.')
    expect(r?.kept).toBe('')
    expect(r?.withdrawn).toBe('Draft the announcement email.')
  })

  it('takes the LAST pivot, because a person who changes their mind twice means the last one', () => {
    const r = readRetraction(
      'do the budget, no scrap that, do the summary, actually forget it, just the total',
    )
    expect(r?.kept).toBe('just the total')
    expect(r?.pivot).toBe('forget')
  })

  /*
    Generalisation, which is the whole point. None of these wordings appears
    in the corpus that exposed the defect; each uses a different operator
    from the closed cancellation class.
  */
  const unseen: [string, string][] = [
    [
      'strike that',
      'email the supplier about the delay, strike that, I will ring them',
      'I will ring them',
    ],
    [
      'ignore that',
      'put together the slides for monday ignore that just send me the figures',
      'just send me the figures',
    ],
    [
      'on second thoughts',
      'book the venue for the 14th, on second thoughts, check the budget first',
      'check the budget first',
    ],
    [
      'skip that',
      'write up the retro and circulate it skip that just file the notes',
      'just file the notes',
    ],
    [
      'drop that',
      'chase the invoice with accounts, drop that, remind me tomorrow',
      'remind me tomorrow',
    ],
    [
      'do not bother',
      'set up a call with the team, don’t bother, I will message them',
      'I will message them',
    ],
    [
      'no need',
      'draft a reply to the council, no need, they already answered',
      'they already answered',
    ],
    [
      'disregard',
      'add a milestone for the launch disregard that show me the timeline',
      'show me the timeline',
    ],
    [
      'undo that',
      'move the deadline to friday, undo that, leave it where it is',
      'leave it where it is',
    ],
  ].map(([, said, kept]) => [said as string, kept as string]) as [string, string][]

  for (const [said, kept] of unseen) {
    it(`generalises to an operator the corpus never used: ${said.slice(0, 40)}`, () => {
      expect(readRetraction(said)?.kept).toBe(kept)
    })
  }
})

describe('a pivot that NAMES what it withdraws takes only that', () => {
  /*
    The live multi.partial-cancel failure, verbatim. The office was asked
    to chase a letter, redo a budget and note some paperwork, changed its
    mind about the budget alone, and the first version of this file - a
    whole-message rule - threw away the two asks that were kept.
  */
  it('keeps the asks that were not withdrawn', () => {
    const r = readRetraction(
      'right chase sorry right chase the letter redo the budget no leave the budget and proofread it and the funding officer is going to want that paperwork before the tenth',
    )
    expect(r?.target).toBe('the budget')
    expect(r?.withdrawn).toBe('redo the budget')
    expect(r?.kept).toContain('chase the letter')
    expect(r?.kept).toContain('proofread')
    expect(r?.kept).toContain('paperwork')
    expect(r?.kept).not.toContain('redo the budget')
  })

  it('a pronoun names nothing, so the whole of what came before goes', () => {
    const r = readRetraction('chase the letter and redo the budget, scrap that, just the total')
    expect(r?.target).toBeNull()
    expect(r?.kept).toBe('just the total')
  })

  it('names something that was never asked for, so nothing is being taken back', () => {
    expect(readRetraction('chase the letter and proofread it, forget the invoice')).toBeNull()
  })
})

describe('what must NOT be read as a retraction', () => {
  const silent: [string, string][] = [
    ['a negative in an answer', 'there is no entry for that in the notebook'],
    ['an instruction to remember', 'do not forget to send the note to the funding officer'],
    ['a polite reminder', 'please remember to cancel the room if nobody signs up'],
    ['an ordinary request', 'Book the room for Thursday and let me know the cost'],
    ['a bare cancellation with nothing before it', 'forget it'],
    [
      'a pivot at the very start, which corrections own',
      'never mind, just tell me what is on my list',
    ],
    ['a future intention', 'I will cancel that myself later today'],
    ['cancelling as the actual task', 'please cancel the Thursday booking and tell the venue'],
    ['a modal in front of the operator', 'we should drop that idea at some point'],
    ['an excluded subject, which negation owns', 'look at the onboarding, not the pricing'],
    ['a constraint, not a withdrawal', 'draft the email but do not send it to anyone'],
  ]

  for (const [what, said] of silent) {
    it(`stays silent: ${what}`, () => {
      expect(readRetraction(said), said).toBeNull()
    })
  }

  it('stays silent on empty and on whitespace', () => {
    expect(readRetraction('')).toBeNull()
    expect(readRetraction('   ')).toBeNull()
  })
})

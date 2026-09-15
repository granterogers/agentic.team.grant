/**
 * #255 — a pending question is not permission to reinterpret the next turn.
 *
 * The third examination created a task called "Walk me through whether two is
 * actually enough to choose from", because the office had asked what to call
 * something and the code that read the reply checked only that it was short and
 * had no question mark.
 *
 * The consent chain these protect:
 *
 *   REQUEST                != EXECUTION
 *   RECOGNISED INTENT      != EXECUTION
 *   PENDING ACTION         != EXECUTION
 *   CLARIFICATION ASKED    != USER CONFIRMATION
 *   NEXT MESSAGE           != CLARIFICATION ANSWER
 *   TOPIC SWITCH           != CLARIFICATION ANSWER
 *   CANCELLATION           != CLARIFICATION ANSWER
 *   ASSISTANT INFERENCE    != USER-SUPPLIED ARGUMENT
 */
import { describe, expect, it } from 'vitest'
import { readFollowUp } from '../../src/agents/clarify.ts'
import { TITLE_ASKED, titleReply } from '../../src/agents/tasks.ts'

const ASKED = `Happy to add that. ${TITLE_ASKED} A title is all I need.`
const ELSEWHERE = 'The quarter comes to about 780 at that rate.'

describe('#255 — the six things a follow-up can be', () => {
  const CASES: readonly [string, string, string][] = [
    ['an explicit field answer', 'Call it supplier follow-up.', 'answered'],
    ['a plausible bare name', 'Chase the supplier.', 'answered'],
    ['a cancellation', 'Actually forget it.', 'cancelled'],
    ['a second cancellation form', 'Never mind, drop it.', 'cancelled'],
    ['a topic switch as a question', 'What did Emma say about the budget?', 'changed_subject'],
    [
      'a topic switch as a request',
      'Walk me through whether two quotes are enough.',
      'changed_subject',
    ],
    [
      'the turn that caused this',
      'Walk me through whether two is actually enough to choose from.',
      'changed_subject',
    ],
    ['not decided yet', "I'm not sure yet.", 'unsure'],
    ['not decided, another way', 'No idea, let me think.', 'unsure'],
    ['a referent', 'That one.', 'ambiguous'],
    [
      'a whole sentence',
      'The references need taking up before we make any kind of offer to either of them.',
      'ambiguous',
    ],
  ]
  for (const [label, say, want] of CASES) {
    it(`${label} -> ${want}`, () => {
      expect(readFollowUp(say, true).kind).toBe(want)
    })
  }
})

describe('#255 — only "answered" may proceed to a mutation', () => {
  it('and the six others all produce nothing', () => {
    const NOTHING = [
      'Actually forget it.',
      'What did Emma say about the budget?',
      'Walk me through whether two is actually enough to choose from.',
      "I'm not sure yet.",
      'That one.',
      'The references need taking up before we make any kind of offer to either of them.',
    ]
    for (const say of NOTHING) expect(titleReply(say, ASKED)).toBeNull()
  })

  it('an answer does proceed', () => {
    expect(titleReply('Chase the supplier.', ASKED)).toBe('Chase the supplier')
    expect(titleReply('Call it supplier follow-up.', ASKED)).toBe('supplier follow-up')
  })
})

describe('#255 — how long a pending question lasts, which is a decision', () => {
  it('an implicit answer needs the question to have just been asked', () => {
    // One turn. Nothing can fire five turns later off a question Grant has
    // forgotten he was asked.
    expect(titleReply('Chase the supplier.', ASKED)).toBe('Chase the supplier')
    expect(titleReply('Chase the supplier.', ELSEWHERE)).toBeNull()
    expect(titleReply('Chase the supplier.', null)).toBeNull()
  })

  it('an explicit answer works whenever it arrives', () => {
    // The delayed reply: clarification, unrelated turns, then a naming form.
    // It needs no pending state, which is what makes it safe to honour late.
    expect(titleReply('Call it supplier follow-up.', ELSEWHERE)).toBe('supplier follow-up')
    expect(titleReply('Call it supplier follow-up.', null)).toBe('supplier follow-up')
  })

  it('and an explicit answer pointing at a referent still names nothing', () => {
    expect(titleReply('Call it that.', ASKED)).toBeNull()
  })
})

describe('#255 — a turn asking for something of its own is never an answer', () => {
  it('even when it is short and looks like a name', () => {
    // The caller supplies this, because only it knows which recognisers exist.
    expect(readFollowUp('Make a slide deck.', true, true).kind).toBe('changed_subject')
    expect(readFollowUp('Make a slide deck.', true, false).kind).toBe('answered')
  })
})

/**
 * #364, measured: the conservatism is right, and this pins it.
 *
 * #364 observed that "Stop sending me updates." is stored by NOTHING.
 * `callsItOff` declines `stop` + a gerund on purpose — its comment says the
 * sentence is "a rule about how the office behaves" and a false call-off
 * destroys work in flight — and hands it to the rule path; `readTeaching`
 * needs a standing marker (`from now on`, `always`, `never`), so a bare
 * imperative reaches neither. The office complies that turn, because the
 * sentence is in the prompt, and does not keep the rule.
 *
 * THE OBVIOUS FIX IS THE DANGEROUS ONE, and his own traffic is what proves
 * it. In 1,438 real turns, ZERO open with "stop"; the only four mentions are
 * "which one should we stop spending on?", a question. What his traffic does
 * contain is five conduct-shaped sentences, and every one of them is scoped
 * to the turn or is a question — three of them are the sentences below.
 * Widening `STANDING` to admit a bare imperative about conduct would store
 * all three as PERMANENT rules, and `public.lessons` refuses UPDATE, so
 * "do not contact anyone at all on this" would silently disable outreach for
 * ever. 0567 records what one wrongly-stored rule already cost: eight days
 * in every prompt at 0.95 confidence, permanent.
 *
 * The September complaints that #364 was filed against are NOT this defect.
 * "You're still not respecting my request…" (21 September) is the bullet
 * points complaint, whose cause was `guidanceFor` selecting `body`, `scope`
 * and `observations` and dropping `learned_by` — so an ORDER arrived in the
 * prompt as a belief to weigh. That is fixed, and it was never about a
 * sentence nothing stored.
 *
 * So there is nothing to widen here. What was missing is a check: the
 * distinction lived only in a comment, and a comment claiming a property is
 * worth nothing without one. These are his real words, so a future widening
 * cannot make them permanent rules without turning this red first.
 */

import { describe, expect, it } from 'vitest'
import { callsItOff } from '../../src/agents/calloff.ts'
import { readTeaching } from '../../src/agents/teaching.ts'

/* Verbatim from public.inbound_commands, typos and all. Real words, because a
   sentence somebody invented for a test is a sentence tuned to the test. */
const SCOPED_TO_THE_TURN = [
  'actually do not contact anyone at all on this',
  'um no,, um no, do not send it & what does knockinng ten percent off do to what we keep',
  'so shorter, and lose the last paargraph',
  'give me that as a list',
] as const

/* Calling off particular work. `callsItOff` may claim these; a RULE may not. */
const CALLS_OFF_PARTICULAR_WORK = [
  'Stop working on the venue report.',
  'stop writing the pricing summary',
  'Please stop drafting that email.',
] as const

describe('a bare imperative about this turn never becomes a permanent rule', () => {
  it.each(SCOPED_TO_THE_TURN)('is not stored as a standing rule: %s', (said) => {
    expect(readTeaching(said)).toBeNull()
  })

  it.each(CALLS_OFF_PARTICULAR_WORK)('calling off work is not a rule: %s', (said) => {
    expect(readTeaching(said)).toBeNull()
  })
})

describe('the distinction the evidence demonstrates is preserved', () => {
  /*
    The control in the other direction. If these stopped being stored, the
    office would have lost the ability to be taught at all, and every test
    above would still pass — a suite made only of refusals passes against a
    system that refuses everything.
  */
  it.each([
    'From now on, answer in prose rather than bullet points.',
    'Always put the project name at the top.',
    'Never copy Ruby in on finance work.',
  ])('a marked standing instruction is still stored: %s', (said) => {
    expect(readTeaching(said)).not.toBeNull()
  })

  /*
    THE TRADE, STATED. `A_RULE` is /^stop \w+ing/, so the call-off path
    declines "stop using bullet points" (a rule) and "stop working on the
    venue report" (calling off work) IDENTICALLY — it cannot tell them apart
    from the verb, and it refuses both rather than risk destroying work in
    flight on a sentence that named none. Both are in the prompt for their own
    turn, so the office acts on each once; neither persists.

    This asserts that deliberate refusal so it cannot be quietly reversed. The
    first draft of this test asserted the opposite — that the call-off path
    claims the venue report — which was an invention about a function whose
    own comment says otherwise.
  */
  it.each([
    'Stop working on the venue report.',
    'Stop sending me updates.',
    'stop using bullet points',
  ])('the call-off path declines a gerund rather than guess: %s', (said) => {
    expect(callsItOff(said)).toBeNull()
  })

  it('a call-off that NAMES the work without a gerund is still claimed', () => {
    /*
      The control that stops the refusal above becoming "callsItOff never
      returns anything". A suite made only of refusals passes against a
      system that refuses everything.
    */
    expect(callsItOff('hold off on the venue report')).not.toBeNull()
  })
})

/**
 * #364, measured: the conservatism is right, and this pins it.
 *
 * #364 observed that "Stop sending me updates." is stored by NOTHING.
 * `callsItOff` declines `stop` + a gerund on purpose — its comment says the
 * sentence is "a rule about how the office behaves" and a false call-off
 * destroys work in flight — and hands it to the rule path; `readTeaching`
 * needs a standing marker (`from now on`, `always`, `never`), so a bare
 * imperative reaches neither.
 *
 * THE FIRST VERSION OF THIS FILE CITED FIVE SENTENCES AS HIS AND NOT ONE OF
 * THEM WAS. They were filtered with `app.harness_label(dedupe_key)` alone,
 * which does not see a suite whose dedupe key reads `teamhq:my_tasks:<run>`
 * while its JOB is attributed `teamhq:verify-mytasks-<run>`. `app.harness_job`
 * is the canonical predicate and says so. The corpus was 1,438 turns by the
 * weak filter and **182** by the real one, and all five sentences were a
 * suite's. The direction survived; the evidence did not. Same class as the
 * measure that matched nothing and reported a perfect score, and the reason
 * this file now names the predicate it was filtered with.
 *
 * WHAT HIS 182 REAL TURNS ACTUALLY CONTAIN. Zero open with "stop" — the only
 * mentions are "which one should we stop spending on?", a question. Seven are
 * conduct-shaped; two are stored as rules and five are not, and none of the
 * five is a standing rule that was lost:
 *
 *   - two are corrections about THIS piece of work ("Same job, not a second
 *     one - do not run it twice");
 *   - one is a factual correction about a Notion teamspace;
 *   - two concern the bullet-point rule, which IS stored, live, at 0.95
 *     confidence since 11 September. Their cause was `guidanceFor` selecting
 *     `body`, `scope` and `observations` and dropping `learned_by`, so an
 *     ORDER reached the prompt as a belief to weigh. Fixed, and never about a
 *     sentence nothing stored.
 *
 * SO THE OBVIOUS FIX IS THE DANGEROUS ONE. Widening `STANDING` to admit a
 * bare imperative about conduct would store "do not run it twice" as a
 * PERMANENT rule — `public.lessons` refuses UPDATE — and the office would
 * stop repeating work it was asked to repeat, for ever. 0567 records what one
 * wrongly-stored rule already cost: eight days in every prompt.
 *
 * There is nothing to widen. What was missing is a check: the distinction
 * lived only in a comment, and a comment claiming a property is worth nothing
 * without one.
 */

import { describe, expect, it } from 'vitest'
import { callsItOff } from '../../src/agents/calloff.ts'
import { readTeaching } from '../../src/agents/teaching.ts'

/* Verbatim from public.inbound_commands, typos and all. Real words, because a
   sentence somebody invented for a test is a sentence tuned to the test. */
const SCOPED_TO_THE_TURN = [
  /* Verbatim from public.inbound_commands, filtered with app.harness_job —
     his own words, typos and all. Each is about THIS piece of work and each
     would become permanent under the widening #364 proposed. */
  'here too. Same job, not a second one - do not run it twice.',
  "I don't think you understood what I meant. I don't mean the emoticons of thumbs up thumbs down.",
  "there is only one current notion teamspace you ahve access to already, so i don't hink you need the iD",
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

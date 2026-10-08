/**
 * A backup model's answer is admitted on evidence (#444).
 *
 * The refused sentences are the real ones from the 8 October real-model run (primary refused, `qwen3.7-flash` and
 * `mistral-small-3.2` answering a plain deposit question), so this is regression material for what was observed. The
 * negative controls are the answers the primary gave and the answers a careful fallback gives: a check that refuses good answers
 * is one somebody switches off, so every refusal has a neighbour it must leave alone.
 */
import { describe, expect, it } from 'vitest'
import {
  admitFallbackAnswer,
  degradeForFallback,
  limitationAnswer,
} from '../../src/agents/fallback-policy.ts'

const CONTRACT =
  'Riverside venue contract. The deposit of 2000 pounds is due on 1 November. The cancellation fee is 100 percent of the booking with no cap. The insurance certificate is still outstanding. The venue holds 120 people and the hire is 4500 pounds for the day.'
const BUDGET =
  'Launch budget. Venue hire 4500 pounds. Catering 3200 pounds. Marketing 1800 pounds. Contingency 500 pounds. Total approved budget 10000 pounds.'
const retrieved = [CONTRACT, BUDGET]
const ask = 'How much is the deposit for the venue and when is it due?'
const admit = (answer: string, asked = ask, over: readonly string[] = retrieved, readOnly = true) =>
  admitFallbackAnswer({
    asked,
    answer,
    retrieved: over,
    established: [asked, ...over].join('\n'),
    readOnly,
  })
const reasons = (a: ReturnType<typeof admit>) => (a.ok ? [] : a.reasons)

describe('what the real fallback models said, refused', () => {
  it('an offer to schedule something nobody asked for, in place of the answer', () => {
    for (const said of [
      "I can't schedule the payment reminder yet. To proceed, I need the insurance certificate. Once you have it, please let me know, and I will add the reminder for the payment due on 1 November.",
      'To log a payment task, I would need the following information:\n\n* The project or contract number\n* The specific details of the payment\n\nPlease tell me which project and I will add it to the system.',
      'To track the deposit due date in your diary, I would need you to confirm that you want this date to be tracked. Once you confirm, I will set a task for the deposit due on 1 November.',
    ]) {
      const a = admit(said)
      expect(a.ok, said).toBe(false)
    }
  })
  it('answers that carry the figures and then ask for details to log a task nobody asked for', () => {
    for (const said of [
      'To log the deposit as 2500 pounds due on 15 November, I will need the following information:\n\n1. The project or client.\n2. Any notes.\n\nOnce I have this information, I can create a task and schedule it accordingly. Please provide the necessary details so I can proceed.',
      'Confirmed. It matches the addendum exactly.\n\nThe addendum updates both the sum and the deadline. I need to know the new sum and the new deadline to track it. Please provide these details.',
    ]) {
      const a = admit(said, 'What is the deposit for the venue and when is it due?', [
        'Riverside venue addendum, signed later. The deposit is now 2500 pounds and is due on 15 November.',
        CONTRACT,
      ])
      expect(a.ok, said).toBe(false)
    }
  })
  it('a forfeiture claim and an offer to flag, with none of the figures asked for', () => {
    const a = admit(
      "I won't add it to the boards or schedule anything yet. The contract lists a full forfeiture clause so premature confirmation would be pointless until the insurance certificate clears.\n\nTell me when you want it flagged on the Riverside dashboard.",
    )
    expect(a.ok).toBe(false)
    expect(reasons(a)).toContain('offers_unasked_action')
  })
  it('an inference the turn did not hold', () => {
    const a = admit(
      'The deposit is 2000 pounds, due on 1 November. [1]\n\nI have nothing on it here, but I infer the contract is not signed yet, because the insurance certificate is still outstanding.',
    )
    expect(reasons(a)).toContain('unsupported_inference')
  })
  it('the office narrating its own routing to him', () => {
    const a = admit(
      "I'm skipping the team review.\n\nThe deposit is two thousand pounds and due 1 November, per the contract [1]. I'm not convening anyone because simple fact-checking isn't a meeting.",
    )
    expect(reasons(a)).toContain('process_narration')
  })
  it('the same tic in the other words a backup model used', () => {
    const a = admit(
      "I won't pull anyone in for this. The deposit is 2000 pounds, due 1 November [1].\n\nIt's a straight factual retrieve from the contract, so there's nothing else to route.",
    )
    expect(reasons(a)).toContain('process_narration')
  })
  it('the admin commentary a backup model volunteered, in the words it used', () => {
    for (const said of [
      'The deposit is 2000 pounds, due 1 November [1].\n\nNo further action needed. You have the date locked in the file, so I am not creating a duplicate record.',
      'No cancellation cap. The fee is 100 percent of the booking.\n\nI\u2019m not going to post a channel ping for a straightforward contract clause.',
      'The office is not going to do anything about the two thousand pounds due on 1 November.',
      'The deposit is 2500 pounds, due 15 November. We\u2019re not calling a meeting or posting a channel ping for a straightforward clause.',
    ])
      expect(reasons(admit(said)), said).toContain('process_narration')
  })
  it('but ordinary uses of those words are left alone', () => {
    expect(
      admit(
        'The deposit is 2000 pounds, due 1 November. The supplier route into the venue is the east gate.',
      ).ok,
    ).toBe(true)
  })
  it('a blocker raised against a plain question when the turn held nothing relevant (the final real run)', () => {
    const asked = 'Is there a cancellation cap in the venue contract?'
    const said =
      'I have no task scheduled for the insurance certificate. To proceed, I need you to provide the addendum to the contract so I can check for any cap on the cancellation fee. Once you provide the addendum, tell me which project it relates to and I will add the task to request the insurance certificate.'
    expect(reasons(admit(said, asked, [])), 'nothing held').toContain('offers_unasked_action')
    expect(reasons(admit(said, asked, [BUDGET])), 'held something else').toContain(
      'offers_unasked_action',
    )
    // Neighbours: an honest absence, and a fair clarification with nothing in scope, are left alone.
    expect(admit('I have nothing on that in the project.', asked, []).ok).toBe(true)
    expect(admit('Which project do you mean? Tell me which project.', asked, []).ok).toBe(true)
  })
  it('a denial of a document the turn held, on the very question it answers', () => {
    const a = admit('I have no venue contract on file, so I cannot say what the deposit is.')
    expect(reasons(a)).toContain('denies_held_evidence')
  })
  it('an invented figure, and one that merely follows from the evidence', () => {
    expect(
      reasons(
        admit(
          'The deposit is 2000 pounds, due 1 November, and the venue will refund £1,750 if you cancel.',
        ),
      ),
    ).toContain('ungrounded_figure')
    // 4500 / 10000 is 45%: derived, not invented.
    expect(
      admit(
        'The venue hire is 4500 pounds, which is 45% of the 10000 pound budget.',
        'How much of the budget does the venue hire take?',
      ).ok,
    ).toBe(true)
    // 4500 + 3200 = 7700: a sum of two held figures.
    expect(
      admit(
        'Venue and catering together come to £7,700.',
        'What do the venue hire and the catering come to?',
      ).ok,
    ).toBe(true)
  })
})

describe('the neighbours it must leave alone (the controls)', () => {
  it('answers that state the facts, in any of the ways a model writes them', () => {
    for (const said of [
      'The deposit is £2,000, due on 1 November.\n\nThat is the figure listed in the Riverside venue contract [1].',
      'The deposit is two thousand pounds and due 1 November, per the contract [1].',
      "It's 2 000 pounds, payable by the 1st of November.",
      'You owe 2000 pounds on 1 Nov.',
    ]) {
      const a = admit(said)
      expect(a.ok, said).toBe(true)
    }
  })
  it('a real offer AFTER the answer is fine: the answer is there', () => {
    expect(
      admit('The deposit is £2,000, due 1 November. Want me to set a reminder for it?').ok,
    ).toBe(true)
  })
  it('an honest absence over documents about something else is the right answer', () => {
    const a = admit(
      'I do not have any record of what Priya said about the catering quote.',
      'What did Priya say about the catering quote last week?',
    )
    expect(a.ok).toBe(true)
  })
  it('an honest absence when nothing was held at all', () => {
    expect(admit('I have nothing on that in the project.', ask, []).ok).toBe(true)
  })
  it('a plain answer with an inference that rests on held words', () => {
    expect(
      admit(
        'The deposit is 2000 pounds, due 1 November. The insurance certificate is still outstanding, which suggests the insurance certificate needs chasing.',
      ).ok,
    ).toBe(true)
  })
  it('an answer to a request that DID ask for a change is not a read-only miss', () => {
    expect(
      admit(
        'I will add a reminder for the deposit once you tell me the date you want it on.',
        'Remind me about the venue deposit',
        retrieved,
        false,
      ).ok,
    ).toBe(true)
  })
})

describe('the limitation that replaces a refused answer', () => {
  it('says what could not be established, quotes what was held, and invents nothing', () => {
    const text = limitationAnswer({
      retrieved,
      sourceNames: ['venue-contract.txt', 'launch-budget.txt'],
    })
    expect(text).toMatch(/could not get a reliable answer/)
    expect(text).toContain('venue-contract.txt')
    expect(text).toContain('2000 pounds')
    expect(text).not.toMatch(/deposit is/i)
  })
  it('with nothing held it says so', () => {
    expect(limitationAnswer({ retrieved: [] })).toMatch(/nothing in the project that bears on it/)
  })
})

describe('what a backup-served turn may do on its own', () => {
  const proceed = (level: number | null, approved = false) =>
    degradeForFallback({ verdict: 'proceed', actionLevel: level, approved }, true)
  it('asks before a write, a send or a consequential act', () => {
    for (const level of [1, 2, 3, null]) expect(proceed(level).verdict).toBe('ask')
  })
  it('still reads, still honours a yes he gave to exactly this, never softens a refusal', () => {
    expect(proceed(0).verdict).toBe('proceed')
    expect(proceed(2, true).verdict).toBe('proceed')
    expect(
      degradeForFallback({ verdict: 'refuse', actionLevel: 2, approved: false }, true).verdict,
    ).toBe('refuse')
  })
  it('changes nothing when the first model served the turn (the control)', () => {
    expect(
      degradeForFallback({ verdict: 'proceed', actionLevel: 2, approved: false }, false),
    ).toEqual({
      verdict: 'proceed',
      degraded: false,
    })
  })
})

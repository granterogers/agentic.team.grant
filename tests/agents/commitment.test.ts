/**
 * The semantic backstop — #302, the half the outcome contract could not do
 * alone.
 *
 * `outcome.ts` computes whether a commitment is permitted. This decides
 * whether the answer contains one, and it is consulted ONLY where the rows
 * have already said it may not — so it never has to tell a real plan from an
 * invented one.
 *
 * ## The controls are written from the categories, not from the defect
 *
 * #302's three live reproductions are at the bottom, kept apart and clearly
 * labelled. Everything above them was assembled from the SIX THINGS THE
 * DISTINCTION HAS TO MAKE, before the reproductions were looked at again:
 *
 *   1. unsupported commitment          must fire
 *   2. legitimate conditional          must not
 *   3. request for grounding           must not
 *   4. capability explanation          must not
 *   5. description of pending work     must not
 *   6. ordinary future conversation    must not
 *
 * Written the other way round — neighbours of the sentences that failed —
 * this would be a wording lock that passes the day it ships and misses the
 * next phrasing, which this repository records six times.
 *
 * **False positives are treated as seriously as misses**, and the negatives
 * outnumber the positives here for that reason: a gate that refuses good
 * answers is one somebody switches off.
 */

import { describe, expect, it } from 'vitest'
import {
  claimsCompletion,
  heldToWhatIsQueued,
  misrepresents,
  unsupportedCommitment,
} from '../../src/agents/commitment.ts'

/** Both halves disallowed, which is what the loop is for. */
const BOTH_FORBIDDEN = { mayCommitToFuture: false, mayClaimCompletion: false }

const fires = (s: string): boolean => unsupportedCommitment(s) !== null

// --- 1. unsupported commitment: must fire ---------------------------------

const promises: [string, string][] = [
  ['plain future', "I'll create a task for the insurance renewal."],
  ['will, spelled', 'I will add that to your list.'],
  ['first person plural', "We'll draft the outline and circulate it."],
  ['going to', 'I am going to set up a reminder two weeks before.'],
  ['contracted going to', "I'm going to chase the letter of support."],
  ['shall', 'I shall send the note across to the funding officer.'],
  ['about to', 'I am about to open a task for this.'],
  ['mid-sentence', 'That is noted, and I will book the venue for Thursday.'],
  ['several verbs', "I'll draft it, assign an owner and set the deadline."],
  ['curly apostrophe', 'I’ll put that on the board for you.'],
  ['a promise with a reason attached', "I'll log it so the renewal does not slip."],
]

describe('an unsupported commitment is found', () => {
  for (const [what, said] of promises) {
    it(`fires: ${what}`, () => {
      expect(fires(said)).toBe(true)
    })
  }
})

// --- 2..6 the negatives, which matter more --------------------------------

const legitimate: [string, string][] = [
  // 2. a conditional that depends on HIM - the next action the invariant asks for
  ['tell me and I will', "Tell me which project and I'll add it."],
  ['condition first', "If you confirm the owner, I'll set the deadline too."],
  ['condition after', "I'll add it once you tell me which project it belongs to."],
  ['as soon as you', "As soon as you name the owner, I'll assign it."],
  ['say the word', "Say the word and I'll get it on the board."],
  ['your go-ahead', "On your go-ahead I'll send it."],
  ['let me know and', "Let me know the date and I'll put it in."],

  // 3. a request for grounding - no commitment at all
  ['a bare question', 'Which project should I add it to?'],
  ['two questions', 'When is it due, and who should own it?'],
  ['naming the gap', 'I have not done this yet — I need to know which project.'],
  ['future tense need', "I'll need the project name before I can file anything."],
  ['have to', "I'll have to ask you which one you mean."],

  // 4. a capability explanation - `can` is not a future marker
  ['can, positive', 'I can create tasks on any of your projects.'],
  ['cannot', 'I cannot send email, so that one is not something I can do.'],
  ['could', 'I could put it on the coaching project if that is the right one.'],
  ['capability with a limit', 'I can draft it, but I have no way to send it anywhere.'],

  // 5. a description of work that is actually pending
  //    (never reaches the detector - the contract permits it - but the
  //     wording must not be inherently a violation either)
  ['third person pending', 'Emma is looking at the figures and will report back.'],
  ['passive pending', 'The report is being drafted now.'],

  // 6. ordinary future-oriented conversation
  ['a fact about the world', 'The renewal will lapse in March if nobody acts.'],
  ['a fact about him', 'You will probably want the budget page redone first.'],
  ['brevity', "I'll be brief: there is nothing on that."],
  ['epistemic', "I'll know more once the figures are indexed."],
  ['not first person', 'It will take about a week to turn around.'],
  ['a question containing will', 'Will you want the summary as well?'],
  ['honest absence', 'There is no record of that in the office documents.'],
]

describe('and these are not commitments', () => {
  for (const [what, said] of legitimate) {
    it(`stays silent: ${what}`, () => {
      expect(fires(said)).toBe(false)
    })
  }
})

// --- #302's own reproductions, kept apart ---------------------------------

describe('the live reproductions, verbatim from the deployed worker', () => {
  /*
    Quoted exactly as they came back from v679 and v681. Kept SEPARATE from
    the controls above so the suite cannot be read as having been tuned to
    them - they are the confirmation, not the specification.
  */
  const real = [
    "I have not done this. I understood what you want and could not carry it out — say it again in a sentence and I will. I have no indexed record of the insurance renewal, but I'll create a task for the appropriate team member to own it and set a deadline two weeks before the expiry date so it doesn't slip.",
    "I have not done this. I understood what you want and could not carry it out — say it again in a sentence and I will. I'll create a task that flags the insurance renewal a week before its deadline. I need you to confirm who should own this – the compliance lead or the finance contact. Once you name the owner, I'll assign the task and set the reminder. This will keep the renewal from slipping.",
    "Setting aside the bullet‑point rule, I'll create a task titled “Insurance renewal – follow‑up” with a due date three weeks before the policy expires and assign it to the person you designate; let me know who should own it and the exact renewal deadline.",
  ]

  for (const [i, said] of real.entries()) {
    it(`catches reproduction ${String(i + 1)}`, () => {
      expect(fires(said)).toBe(true)
    })
  }

  /*
    And the sentence the office is REQUIRED to say must not itself trip it.

    "...say it again in a sentence and I will" is a conditional that depends
    on him, and it is composed by `sayWhatHappened`. A detector that fired on
    the office's own mandated sentence would make the contract unsatisfiable.
  */
  it('does NOT fire on the composed sentence alone', () => {
    expect(
      fires(
        'I have not done this. I understood what you want and could not carry it out — say it again in a sentence and I will.',
      ),
    ).toBe(false)
  })
})

describe('the rewrite is bounded, and ends at the truth', () => {
  const TRUTH = 'I have not done this yet — I need which project this is for.'
  const PROMISE = "I'll create the task and set a reminder."

  it('leaves a clean draft alone and never spends a call', async () => {
    let calls = 0
    const r = await heldToWhatIsQueued(
      'There is nothing on that.',
      TRUTH,
      async () => {
        calls++
        return ''
      },
      BOTH_FORBIDDEN,
    )
    expect(r.outcome).toBe('clean')
    expect(calls).toBe(0)
  })

  it('takes a rewrite that stops promising', async () => {
    const r = await heldToWhatIsQueued(
      PROMISE,
      TRUTH,
      async () => `${TRUTH} Which one is it?`,
      BOTH_FORBIDDEN,
    )
    expect(r.outcome).toBe('rewritten')
    expect(unsupportedCommitment(r.answer)).toBeNull()
  })

  /*
    The property the user asked for by name: repeated regeneration must not
    turn a failed action into a DIFFERENT unsupported promise.

    Proved against a rewriter that is adversarial by construction - it
    answers every correction with a fresh promise. The loop must still
    terminate at a sentence composed from the rows.
  */
  it('never lets an adversarial rewriter promise something else instead', async () => {
    let calls = 0
    const r = await heldToWhatIsQueued(
      PROMISE,
      TRUTH,
      async () => {
        calls++
        return `I'll do something completely different, attempt ${String(calls)}.`
      },
      BOTH_FORBIDDEN,
    )
    expect(calls).toBe(1)
    expect(r.outcome).toBe('fell_back')
    expect(r.answer).toBe(TRUTH)
    expect(unsupportedCommitment(r.answer)).toBeNull()
  })

  it('survives a rewriter that throws, and still lands on the truth', async () => {
    const r = await heldToWhatIsQueued(
      PROMISE,
      TRUTH,
      async () => {
        throw new Error('provider down')
      },
      BOTH_FORBIDDEN,
    )
    expect(r.answer).toBe(TRUTH)
  })

  it('survives a rewriter that returns nothing', async () => {
    const r = await heldToWhatIsQueued(PROMISE, TRUTH, async () => '   ', BOTH_FORBIDDEN)
    expect(r.answer).toBe(TRUTH)
  })

  /*
    A COMPLETED turn owes no sentence, so there is nothing to fall back to.
    The work really was done, and losing the report of it to protect against
    a trailing promise would be the worse trade - so the draft stands and
    the caller records it.
  */
  it('keeps the draft when the turn owes no sentence, rather than going silent', async () => {
    const done = "That is on your list. I'll also send it over."
    const r = await heldToWhatIsQueued(
      done,
      null,
      async () => "I'll still promise things.",
      BOTH_FORBIDDEN,
    )
    expect(r.outcome).toBe('fell_back')
    // The promise is REMOVED and the true report of the work survives.
    expect(r.answer).toBe('That is on your list.')
    expect(unsupportedCommitment(r.answer)).toBeNull()
  })
})

describe('the past tense, which the contract permitted and nothing enforced', () => {
  /*
    Found by the durability sweep against v685. One turn apart, on a job with
    zero tasks and zero child jobs:

      "Added 'book venue' to the coaching project and moved 'write welcome
       pack' to the Match Funding Bid project."
      "I haven't created any tasks yet, so there's nothing to list."

    At most one could be true. `claimsToHaveMade` could not see the first
    because it requires a creation VERB and an artifact NOUN, and that
    sentence names the task by its TITLE - so the noun never appears. The set
    of things a person can ask to be created is open; a list of nouns is
    always one short.

    The noun requirement is dropped and the closed part kept: a
    brought-into-existence verb, in the past, with the office as agent.
  */
  const real =
    'Added “book venue” to the coaching project and moved “write welcome pack” to the Match Funding Bid project.'

  it('catches the live one that the noun list could not', () => {
    expect(claimsCompletion(real)).not.toBeNull()
  })

  for (const [what, said] of [
    ['first person perfect', 'I have added the task for you.'],
    ['sentence-initial past', 'Created a note on the bid.'],
    ['set up', 'I set up a reminder for Tuesday.'],
    ['sent', 'I sent the note to the funding officer.'],
    ['after a truthful sentence', `There is nothing indexed. ${real}`],
  ] as [string, string][]) {
    it(`fires: ${what}`, () => {
      expect(claimsCompletion(said)).not.toBeNull()
    })
  }

  /*
    The negatives, and they carry the weight. The composed sentence and the
    honest answer are BOTH negated past tense, so a detector that fired on
    them would refuse the office for telling the truth - which is the
    failure this repository records twice as the one somebody switches off.
  */
  for (const [what, said] of [
    [
      'the composed sentence itself',
      'I have not done this. I understood what you want and could not carry it out — say it again in a sentence and I will.',
    ],
    ['the honest denial', "I haven't created any tasks yet, so there's nothing to list."],
    ['no record', 'I have no record of the insurance being sorted.'],
    ['an offer as a question', 'Would you like me to add it?'],
    ['shall I', 'Shall I create the task?'],
    ['conditional', 'If you tell me the project I will add it.'],
    ['a refusal', 'I could not create it without a project.'],
    ['nothing happened', 'Nothing has been created.'],
    ['reporting HIS action', 'You added that one yourself last week.'],
  ] as [string, string][]) {
    it(`stays silent: ${what}`, () => {
      expect(claimsCompletion(said)).toBeNull()
    })
  }

  it('is reached through the one entry point, so neither half can be forgotten', () => {
    const may = { mayCommitToFuture: true, mayClaimCompletion: false }
    expect(misrepresents(real, may)).not.toBeNull()
    expect(misrepresents(real, { mayCommitToFuture: true, mayClaimCompletion: true })).toBeNull()
  })
})

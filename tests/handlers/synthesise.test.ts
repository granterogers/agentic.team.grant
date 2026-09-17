/**
 * Can a fan-in answer credit somebody who did not contribute? (#262)
 *
 * The whole anti-fabrication property of a synthesis, in one pure function.
 * #233 exists because the office used to narrate collaboration it had not
 * done, and a fan-in is the easiest place in the building to do it again: four
 * specialists were asked, two answered, and "Emma found that competitors
 * charge forty to sixty, and Ruby's view is that…" is one sentence away.
 *
 * The expensive direction is FAILING TO CATCH it — a false negative is a lie
 * Grant acts on. But a false positive is not free either: an answer refused
 * because it happens to contain the word "grace" is an answer he never sees,
 * so the controls below are as much about the words that must NOT trip it.
 */

import { describe, expect, it } from 'vitest'
import { namedWithoutEvidence } from '../../src/handlers/synthesise.ts'

const present = [
  { agent: 'research-director', name: 'Emma' },
  { agent: 'finance-director', name: 'Daniel' },
]
const absent = [{ agent: 'growth-director', name: 'Ruby' }]

describe('crediting somebody who did not contribute', () => {
  it('catches the name of a branch that produced nothing', () => {
    expect(
      namedWithoutEvidence(
        'Emma found competitors charge forty to sixty, and Ruby thinks the launch should wait.',
        present,
        absent,
      ),
    ).toEqual(['Ruby'])
  })

  it('catches it even when the mention is glancing', () => {
    expect(
      namedWithoutEvidence('Daniel and Ruby both agree on the timing.', present, absent),
    ).toEqual(['Ruby'])
  })

  it('catches the slug as well as the name, because a model might use either', () => {
    expect(
      namedWithoutEvidence('The growth-director was not able to help.', present, [
        { agent: 'growth-director' },
      ]),
    ).toEqual(['growth-director'])
  })
})

describe('and the words that must not trip it', () => {
  it('CONTROL: naming somebody who DID contribute is the point of the answer', () => {
    expect(
      namedWithoutEvidence(
        'Emma found competitors charge forty to sixty. Daniel puts the margin cost at four points.',
        present,
        absent,
      ),
    ).toEqual([])
  })

  it('CONTROL: an answer that names nobody passes', () => {
    expect(
      namedWithoutEvidence(
        'Competitors charge forty to sixty and it costs four points.',
        present,
        absent,
      ),
    ).toEqual([])
  })

  it('CONTROL: a name INSIDE a longer word is not the name', () => {
    /*
      The false positive that would matter. "Grace" is a specialist and also
      a word — "with good grace", "a grace period" — and "Ruby" is a
      programming language. A substring match would refuse a good answer, and
      an answer refused is an answer Grant never sees.
    */
    expect(
      namedWithoutEvidence('We rubyised the pipeline.', present, [{ agent: 'x', name: 'Ruby' }]),
    ).toEqual([])
    expect(
      namedWithoutEvidence('There is a disgraceful amount of churn.', present, [
        { agent: 'quality-director', name: 'Grace' },
      ]),
    ).toEqual([])
  })

  it('CONTROL: an absent colleague who shares a name with a present one is not flagged', () => {
    // Two people called Emma is not a case the roster has, and the day it is,
    // refusing every answer that says "Emma" would be worse than saying it.
    expect(
      namedWithoutEvidence(
        'Emma found the figure.',
        [{ agent: 'a', name: 'Emma' }],
        [{ agent: 'b', name: 'Emma' }],
      ),
    ).toEqual([])
  })

  it('CONTROL: nothing absent means nothing to catch', () => {
    expect(namedWithoutEvidence('Emma, Daniel and Ruby all agree.', present, [])).toEqual([])
  })

  it('catches more than one at a time, so a report is complete', () => {
    expect(
      namedWithoutEvidence('Ruby and Grace both raised concerns.', present, [
        { agent: 'growth-director', name: 'Ruby' },
        { agent: 'quality-director', name: 'Grace' },
      ]),
    ).toEqual(['Ruby', 'Grace'])
  })
})

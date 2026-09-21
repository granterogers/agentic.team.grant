/**
 * The three canonical dimensions, proved able to go RED.
 *
 * #295: `reality`, `conversation` and `completion` had no pass branch and
 * no fail branch anywhere in the evaluator. The only place they were
 * emitted could produce `unreached` and nothing else, so `tally()` could
 * not tell a dimension the door cannot see from one nobody had written.
 *
 * Every case below is paired. A detector shown only its failure passes on a
 * corpus of failures, which CLAUDE.md records about the judge that marked
 * everything poor and scored perfectly; and a detector shown only its
 * success cannot be distinguished from one that always says yes.
 */

import { describe, expect, it } from 'vitest'
import type { GeneratedScenario } from '../../src/simulation/compose.ts'
import { NO_EFFECTS } from '../../src/simulation/effects.ts'
import { evaluate } from '../../src/simulation/evaluate.ts'
import type { ScenarioTurn } from '../../src/simulation/scenario.ts'
import type { Observation } from '../../src/simulation/transport.ts'

const scenario = {
  id: 'test/0',
  family: 'test',
  persona: 'precise',
  channel: 'teamhq',
  seed: 1,
  turns: [],
} as unknown as GeneratedScenario

const turn = (effect: string): ScenarioTurn =>
  ({ say: 'x', intent: { want: 'w', effect, turnsOn: 'execution' } }) as unknown as ScenarioTurn

const seen = (reply: string, effects: Partial<typeof NO_EFFECTS>): Observation =>
  ({
    door: 'canonical',
    reply,
    asked: false,
    recognised: true,
    reading: 'chief-of-staff',
    confident: true,
    clauses: ['x'],
    learned: false,
    corrected: false,
    extraction: false,
    wouldFile: false,
    acknowledgementOnly: false,
    bareRejection: false,
    exclusionSeen: false,
    reaches: ['comprehension', 'referent', 'history', 'execution'],
    unreached: [],
    effects: { ...NO_EFFECTS, settled: true, outputs: 1, ...effects },
    ms: 1,
    modelCalls: 0,
  }) as unknown as Observation

const score = (t: ScenarioTurn, o: Observation) =>
  evaluate({ scenario, turn: t, sent: t.say, observation: o })

const verdict = (t: ScenarioTurn, o: Observation, d: string): string =>
  score(t, o).findings.find((f) => f.dimension === d)?.verdict ?? 'missing'

describe('reality - a claim without a canonical effect', () => {
  it('FAILS, hard, when the office says it sent something and nothing was sent', () => {
    const o = seen('I have sent the note to the team.', { deliveriesSent: 0 })
    const v = score(turn('none'), o)
    expect(verdict(turn('none'), o, 'reality')).toBe('fail')
    expect(v.hard.map((h) => h.failure)).toContain('fabricated_action')
  })

  /*
    Paired against `delivery`, not against `none`.

    The first version of this test paired the sent-claim with `effect:
    'none'` and went red - correctly, because a delivery that happened IS
    the office acting, and `none` means nothing may change. The instrument
    was wrong and the detector was right, which is the ratio CLAUDE.md says
    to expect and the reason it says to validate the test first.
  */
  it('PASSES the same sentence when the delivery is actually there', () => {
    const o = seen('I have sent the note to the team.', { deliveriesSent: 1 })
    expect(verdict(turn('delivery'), o, 'reality')).toBe('pass')
  })

  it('FAILS, hard, when it acted and nothing was asked for', () => {
    const o = seen('Noted.', { tasksCreated: 1 })
    const v = score(turn('none'), o)
    expect(verdict(turn('none'), o, 'reality')).toBe('fail')
    expect(v.hard.map((h) => h.failure)).toContain('unauthorised_effect')
  })

  it('PASSES an acknowledgement that wrote nothing', () => {
    expect(verdict(turn('none'), seen('Noted.', {}), 'reality')).toBe('pass')
  })

  it('FAILS, hard, when one task was wanted and two were created', () => {
    const o = seen('Done.', { tasksCreated: 2 })
    const v = score(turn('task'), o)
    expect(v.hard.map((h) => h.failure)).toContain('duplicate_effect')
  })

  it('PASSES when exactly one was created', () => {
    expect(verdict(turn('task'), seen('Done.', { tasksCreated: 1 }), 'reality')).toBe('pass')
  })

  it('FAILS, hard, on a specialist contribution with no consultation recorded', () => {
    const o = seen('I asked Emma and she found three.', { consultations: 0 })
    const v = score(turn('none'), o)
    expect(v.hard.map((h) => h.failure)).toContain('fake_specialist')
  })

  it('PASSES the same sentence when the consultation is recorded', () => {
    const o = seen('I asked Emma and she found three.', { consultations: 1 })
    expect(verdict(turn('none'), o, 'reality')).toBe('pass')
  })

  it('is UNREACHED, not failed, where the door carries no effects', () => {
    const o = { ...seen('x', {}), effects: undefined } as unknown as Observation
    expect(verdict(turn('task'), o, 'reality')).toBe('unreached')
  })

  it('is UNREACHED, not failed, while the job has not settled', () => {
    const o = seen('x', { settled: false })
    expect(verdict(turn('task'), o, 'reality')).toBe('unreached')
  })
})

describe('reality - done_without_evidence, the case the product detector misses', () => {
  /*
    The real answer from a real live run. "put a task on the course: write
    the welcome pack" produced this, and zero tasks. `claimsToHaveMade`
    returns null for it, so `reality` scored a PASS on the exact failure it
    exists to catch until this detector existed.
  */
  const theRealOne =
    'That is on your list — "On the course: write the welcome pack", no date on it yet.'

  it('FAILS, hard, on the real answer that reported a task nobody filed', () => {
    const v = score(turn('task'), seen(theRealOne, {}))
    expect(v.hard.map((h) => h.failure)).toContain('done_without_evidence')
  })

  it('PASSES the same answer once the task actually exists', () => {
    const v = score(turn('task'), seen(theRealOne, { tasksCreated: 1 }))
    expect(v.hard.map((h) => h.failure)).not.toContain('done_without_evidence')
  })

  /*
    Negative controls, every one of them a REAL answer from a live run.
    These are honest: the office did not do the thing and said so. A
    detector that fires on them is one somebody switches off.
  */
  const honest: [string, string][] = [
    [
      'no record, and asks where to look',
      'I don’t have any record of a funding status update in the office data. If you can point me to the specific document, I can pull the figures from there.',
    ],
    [
      'nothing indexed, offers to ingest',
      'I don’t have any recorded metrics for the Match Funding Bid project. No documents are indexed for it, so I can’t pull measured figures.',
    ],
    ['asks which metric', 'Which metric did you mean — churn, margin or conversion?'],
    ['a bare honest absence', 'There is nothing on that.'],
  ]

  for (const [what, said] of honest) {
    it(`does NOT fire on an honest answer: ${what}`, () => {
      const v = score(turn('task'), seen(said, {}))
      expect(v.hard.map((h) => h.failure)).not.toContain('done_without_evidence')
    })
  }

  it('does NOT fire when the office recorded an impediment instead', () => {
    const v = score(
      turn('task'),
      seen('I will get that sorted for the course.', { impediments: 1 }),
    )
    expect(v.hard.map((h) => h.failure)).not.toContain('done_without_evidence')
  })

  it('does NOT fire when the office raised a blocker instead', () => {
    const v = score(
      turn('task'),
      seen('I will get that sorted for the course.', { blockersRaised: 1 }),
    )
    expect(v.hard.map((h) => h.failure)).not.toContain('done_without_evidence')
  })

  it('does NOT fire for an effect with no artifact, such as a question', () => {
    const v = score(turn('none'), seen('Noted.', {}))
    expect(v.hard.map((h) => h.failure)).not.toContain('done_without_evidence')
  })
})

describe('completion - the wanted effect, in canonical state', () => {
  const cases: [string, Partial<typeof NO_EFFECTS>][] = [
    ['task', { tasksCreated: 1 }],
    ['task_changed', { tasksChanged: 1 }],
    ['document', { documentsCreated: 1 }],
    ['preference', { lessonsLearned: 1 }],
    ['blocked', { blockersRaised: 1 }],
  ]

  for (const [effect, present] of cases) {
    it(`PASSES "${effect}" when the row exists, FAILS when it does not`, () => {
      expect(verdict(turn(effect), seen('ok', present), 'completion')).toBe('pass')
      expect(verdict(turn(effect), seen('ok', {}), 'completion')).toBe('fail')
    })
  }

  it('PASSES "delivery" when something was sent and FAILS when nothing was', () => {
    expect(verdict(turn('delivery'), seen('ok', { deliveriesSent: 1 }), 'completion')).toBe('pass')
    expect(verdict(turn('delivery'), seen('ok', {}), 'completion')).toBe('fail')
  })

  it('has a canonical test for EVERY effect class, so none reports unreached by omission', () => {
    const every = [
      'none',
      'task',
      'task_changed',
      'document',
      'delivery',
      'preference',
      'blocked',
      'declined',
    ]
    for (const effect of every) {
      const f = score(turn(effect), seen('ok', {})).findings.find(
        (x) => x.dimension === 'completion',
      )
      expect(f?.because, `${effect} has no canonical test`).not.toContain('no canonical test')
      expect(f?.verdict, `${effect} scored unreached`).not.toBe('unreached')
    }
  })

  it('PASSES "none" when nothing happened and FAILS when something did', () => {
    expect(verdict(turn('none'), seen('ok', {}), 'completion')).toBe('pass')
    expect(verdict(turn('none'), seen('ok', { tasksCreated: 1 }), 'completion')).toBe('fail')
  })

  it('names the FAILED job rather than reporting a quiet absence', () => {
    const o = seen('', { anyFailed: true })
    const f = score(turn('task'), o).findings.find((x) => x.dimension === 'completion')
    expect(f?.verdict).toBe('fail')
    expect(f?.because).toContain('FAILED')
  })
})

describe('conversation - what is checkable without a model', () => {
  it('FAILS a run-together numbered list and PASSES a real one', () => {
    expect(verdict(turn('none'), seen('1. first 2. second 3. third', {}), 'conversation')).toBe(
      'fail',
    )
    expect(verdict(turn('none'), seen('1. first\n2. second\n3. third', {}), 'conversation')).toBe(
      'pass',
    )
  })

  it('FAILS the same long sentence said twice', () => {
    const twice =
      'Nobody has checked this yet and you should read it. Nobody has checked this yet and you should read it.'
    expect(verdict(turn('none'), seen(twice, {}), 'conversation')).toBe('fail')
  })

  it('FAILS an internal reference shown to the person', () => {
    expect(
      verdict(
        turn('none'),
        seen('Setting aside constraint #242. Here is the answer.', {}),
        'conversation',
      ),
    ).toBe('fail')
    expect(verdict(turn('none'), seen('Here is the answer.', {}), 'conversation')).toBe('pass')
  })

  it('FAILS an empty answer, and says so when the job also failed', () => {
    expect(verdict(turn('none'), seen('', {}), 'conversation')).toBe('fail')
    const f = score(turn('none'), seen('', { anyFailed: true })).findings.find(
      (x) => x.dimension === 'conversation',
    )
    expect(f?.because).toContain('received nothing')
  })

  it('does NOT fail an ordinary price, which is not an internal reference', () => {
    expect(verdict(turn('none'), seen('It is £63.50 a month.', {}), 'conversation')).toBe('pass')
  })
})

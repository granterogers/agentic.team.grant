/**
 * Proof that hidden intent cannot reach the office under test.
 *
 * §5 of the mission requires explicit tests for this; §10 lists a leak among
 * the hard failures; §14 says a detector that has never been shown a defect
 * is not proved.
 *
 * Every negative case here is built by DELIBERATELY LEAKING and then checking
 * the leak is caught. CLAUDE.md records the trap that makes that harder than
 * it sounds: *"A SABOTAGE THAT DID NOT APPLY IS NOT A PASSING CONTROL"* —
 * twice in one run a sabotage silently failed to land and "the check did not
 * fire" was read as the check working. So each sabotage below first asserts
 * that the poisoned input really does contain the secret. If that assertion
 * fails, the test fails there rather than recording a vacuous green.
 */

import { describe, expect, it } from 'vitest'
import {
  CROSSING_KEYS,
  fieldsCrossing,
  HiddenIntentLeak,
  outOfBand,
  sealed,
  textCrossing,
} from '../../src/simulation/isolation.ts'
import type { Scenario, ScenarioTurn } from '../../src/simulation/scenario.ts'
import { utteranceOf } from '../../src/simulation/scenario.ts'

const turn: ScenarioTurn = {
  say: 'can you stick a thing on for me to ring kevin back about the quote',
  why: 'indirect future-action intent expressed without the word remind',
  intent: {
    want: 'a task exists to telephone Kevin about the outstanding quotation',
    effect: 'task',
    project: 'alpha',
    mayAskAbout: ['which Kevin is meant'],
    alreadyKnows: ['the quote is the one on alpha'],
  },
}

const scenario: Scenario = {
  id: 'indirect-task-0001',
  family: 'indirect future-action intent',
  persona: 'grant-like',
  channel: 'telegram',
  seed: 1,
  turns: [turn],
}

describe('the wall between the simulator and the office', () => {
  it('lets an ordinary message through untouched', () => {
    const u = utteranceOf('telegram', turn.say, 'alpha')
    expect(sealed(scenario, turn, u)).toEqual(u)
  })

  it('lets a message through that shares ordinary words with the hidden intent', () => {
    // "kevin", "quote" and "task" all appear in the hidden intent. Overlap of
    // ordinary words is not a leak, and a detector that treated it as one
    // would be red on every correct scenario in this family.
    const u = utteranceOf('telegram', 'task me to call kevin about the quote')
    expect(() => sealed(scenario, turn, u)).not.toThrow()
  })

  it('carries a withdrawn clause and a negative constraint, because the person said them', () => {
    const cancelling: ScenarioTurn = {
      say: 'book the room for thursday, actually forget that, but do not email anyone',
      why: 'cancellation mid-message with a negative constraint',
      intent: {
        want: 'nothing is booked and nobody is contacted',
        effect: 'none',
        withdrawn: ['book the room for thursday'],
        forbids: ['do not email anyone'],
      },
    }
    const u = utteranceOf('voice', cancelling.say)
    // The message legitimately contains both. The wall must not object.
    expect(u.text).toContain('actually forget that')
    expect(u.text).toContain('do not email anyone')
    expect(() => sealed({ ...scenario, turns: [cancelling] }, cancelling, u)).not.toThrow()
  })

  describe('sabotage — each detector must be provable red', () => {
    it('catches the goal description pasted into the message', () => {
      const poisoned = `${turn.say} (${turn.intent.want})`
      // Prove the sabotage landed before believing the verdict.
      expect(poisoned).toContain(turn.intent.want)
      const u = utteranceOf('telegram', poisoned)
      expect(() => sealed(scenario, turn, u)).toThrow(HiddenIntentLeak)
    })

    it('catches the note on what the turn is testing', () => {
      const poisoned = `${turn.say}\n\n${turn.why}`
      expect(poisoned).toContain(turn.why)
      expect(textCrossing(scenario, turn, poisoned).length).toBeGreaterThan(0)
    })

    it('catches the clarification lists, either side of them', () => {
      for (const secret of [
        ...(turn.intent.mayAskAbout ?? []),
        ...(turn.intent.alreadyKnows ?? []),
      ]) {
        const poisoned = `${turn.say} ${secret}`
        expect(poisoned).toContain(secret)
        expect(textCrossing(scenario, turn, poisoned).length).toBeGreaterThan(0)
      }
    })

    it('catches a leak through the context alongside the message, not only the message', () => {
      // The utterance itself is clean. The conversation history handed over
      // with it is not. A firewall that only inspected the message would pass
      // this, and CLAUDE.md's rule about auditing what the page actually
      // requests is exactly this mistake in another costume.
      const u = utteranceOf('telegram', turn.say)
      expect(() => sealed(scenario, turn, u)).not.toThrow()
      expect(() => sealed(scenario, turn, u, [`earlier: ${turn.intent.want}`])).toThrow(
        HiddenIntentLeak,
      )
    })

    it('catches a field riding along on the object that crosses', () => {
      const spread = { ...utteranceOf('telegram', turn.say), expect: 'task' }
      expect(Object.keys(spread)).toContain('expect')
      const found = fieldsCrossing(spread)
      expect(found).toHaveLength(1)
      expect(found[0]?.detail).toBe('expect')
    })

    it('catches a leak dressed in different case and punctuation', () => {
      const poisoned = `${turn.say} -- A TASK EXISTS, to TELEPHONE Kevin about the outstanding Quotation!`
      const found = textCrossing(scenario, turn, poisoned)
      expect(found.length).toBeGreaterThan(0)
    })

    it('the allow-list is deny-by-default, so a new field is refused until decided', () => {
      // The property, rather than the current contents: whatever
      // `CROSSING_KEYS` grows to, anything outside it must be refused.
      const invented = { text: 'hello', channel: 'teamhq', rubricVersion: '3' }
      expect(CROSSING_KEYS).not.toContain('rubricVersion')
      expect(fieldsCrossing(invented).map((l) => l.detail)).toEqual(['rubricVersion'])
    })
  })

  describe('the detector cannot be quietly weakened', () => {
    it('reports every out-of-band string the scenario holds', () => {
      const bag = outOfBand(scenario, turn)
      for (const s of [turn.intent.want, turn.why, scenario.family, scenario.id]) {
        expect(bag).toContain(s)
      }
    })

    it('does not treat the person’s own withdrawn or forbidden words as secrets', () => {
      const cancelling: ScenarioTurn = {
        ...turn,
        intent: { ...turn.intent, withdrawn: ['book the room'], forbids: ['do not email anyone'] },
      }
      const bag = outOfBand(scenario, cancelling)
      expect(bag).not.toContain('book the room')
      expect(bag).not.toContain('do not email anyone')
    })
  })
})

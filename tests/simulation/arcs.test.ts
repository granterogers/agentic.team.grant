/**
 * Properties of the multi-turn arcs.
 *
 * The one that matters: an arc must be a conversation, not a list of
 * messages wearing one. The test for that is whether the turns could be
 * shuffled without changing what a correct answer is — if they could, the
 * arc is buying nothing that the single-message corpus does not already
 * have.
 */

import { describe, expect, it } from 'vitest'
import {
  ARC_RECIPES,
  buildArc,
  buildArcs,
  reactionFor,
  reactionText,
} from '../../src/simulation/arcs.ts'
import { familyById } from '../../src/simulation/goals.ts'
import { sealed } from '../../src/simulation/isolation.ts'
import { GRANT_LIKE, PERSONAS } from '../../src/simulation/persona.ts'
import { Seeded } from '../../src/simulation/random.ts'
import { utteranceOf } from '../../src/simulation/scenario.ts'
import { DEFAULT_WORLD } from '../../src/simulation/world.ts'

describe('the arcs are well-formed', () => {
  it('names only goal families that exist', () => {
    for (const r of ARC_RECIPES) {
      for (const f of r.families) {
        expect(familyById(f), `${r.id} names ${f}`).toBeDefined()
      }
    }
  })

  it('is genuinely multi-turn', () => {
    for (const r of ARC_RECIPES) expect(r.families.length, r.id).toBeGreaterThan(2)
  })

  it('builds reproducibly from a seed', () => {
    const a = buildArc(ARC_RECIPES[0] as never, GRANT_LIKE, DEFAULT_WORLD, 9)
    const b = buildArc(ARC_RECIPES[0] as never, GRANT_LIKE, DEFAULT_WORLD, 9)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('covers the continuity properties §8 and §9 ask for', () => {
    const ids = ARC_RECIPES.map((r) => r.id)
    for (const want of [
      'arc.preference-continuity',
      'arc.preference-reversal',
      'arc.wrong-project-recovery',
      'arc.approval-declined',
      'arc.cancellation',
    ]) {
      expect(ids).toContain(want)
    }
  })
})

describe('an arc is a conversation, not a list', () => {
  it('places every turn that depends on history after something it can depend on', () => {
    // The property that makes an arc worth running. `preference.applied-later`
    // is meaningless in turn 0, and a corpus that placed it there would score
    // the office for failing to recall something never said.
    for (const r of ARC_RECIPES) {
      const arc = buildArc(r, GRANT_LIKE, DEFAULT_WORLD, 5)
      arc.turns.forEach((turn, i) => {
        if ((turn.intent.turnsOn ?? 'comprehension') === 'history') {
          expect(i, `${r.id} turn ${i} needs history and has none before it`).toBeGreaterThan(0)
        }
      })
    }
  })
})

describe('the simulator reacts rather than co-operating', () => {
  it('produces all of approving, declining and modifying across seeds', () => {
    const seen = new Set<string>()
    for (let s = 0; s < 300; s++) seen.add(reactionFor(GRANT_LIKE, new Seeded(s)))
    // §8 asks for all three. A simulator that only ever approves cannot test
    // what happens when somebody says no, which is the case where acting
    // anyway is the most serious failure in the list.
    for (const r of ['approves', 'declines', 'modifies', 'answers']) expect([...seen]).toContain(r)
  })

  it('says something short and human for each reaction', () => {
    for (const r of [
      'answers',
      'approves',
      'declines',
      'modifies',
      'vague',
      'impatient',
    ] as const) {
      const said = reactionText(r, new Seeded(1))
      expect(said.length).toBeGreaterThan(1)
      expect(said.split(' ').length).toBeLessThan(10)
    }
  })
})

describe('no arc leaks', () => {
  it('passes the firewall on every turn of every arc and persona', () => {
    const leaks: string[] = []
    for (const arc of buildArcs(PERSONAS, DEFAULT_WORLD, 11)) {
      for (const turn of arc.turns) {
        try {
          sealed(arc, turn, utteranceOf(arc.channel, turn.say))
        } catch (e) {
          leaks.push(`${arc.id}: ${(e as Error).message}`)
        }
      }
    }
    expect(leaks.slice(0, 5)).toEqual([])
  })
})

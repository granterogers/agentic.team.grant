/**
 * Properties of the goal-family corpus.
 *
 * Deliberately NOT a count. CLAUDE.md records a count-based assertion going
 * red on a correct change four separate times — most sharply when a graph
 * learned to see a third relation that was always true and a suite asserting
 * "exactly 2" reported the improvement as a regression. The corpus is meant
 * to grow, so every assertion here is a property that survives growth.
 *
 * The important test in this file is the last one: every family, drafted
 * under every persona across many seeds, put through the hidden-intent
 * firewall. A family whose sentence happens to quote its own `want` would
 * hand the office the answer, and nothing else in the harness would ever
 * notice.
 */

import { describe, expect, it } from 'vitest'
import { GOAL_FAMILIES, GROUPS } from '../../src/simulation/goals.ts'
import { sealed } from '../../src/simulation/isolation.ts'
import { PERSONAS } from '../../src/simulation/persona.ts'
import { derive, Seeded } from '../../src/simulation/random.ts'
import { roughen } from '../../src/simulation/roughen.ts'
import type { Scenario, ScenarioTurn } from '../../src/simulation/scenario.ts'
import { utteranceOf } from '../../src/simulation/scenario.ts'
import { DEFAULT_WORLD } from '../../src/simulation/world.ts'

describe('the corpus has the breadth the mission asks for', () => {
  it('covers at least fifty underlying goal families', () => {
    // A floor, not an equality: §7 asks for "roughly 50 ... or equivalent
    // breadth", and an equality would make adding a family a test failure.
    expect(GOAL_FAMILIES.length).toBeGreaterThanOrEqual(50)
  })

  it('covers every block §7 names', () => {
    for (const group of [
      'projects',
      'knowledge',
      'tasks',
      'drafts',
      'specialists',
      'approval',
      'preferences',
      'multi-intent',
      'capability',
      'conversation',
      'no-action',
    ]) {
      expect(GROUPS).toContain(group)
      expect(GOAL_FAMILIES.filter((f) => f.group === group).length).toBeGreaterThan(0)
    }
  })

  it('gives every family a unique id, so a failure names exactly one thing', () => {
    const ids = GOAL_FAMILIES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('covers every effect class, including the ones where doing nothing is right', () => {
    const effects = new Set(
      GOAL_FAMILIES.map((f) => f.draft(DEFAULT_WORLD, new Seeded(1)).intent.effect),
    )
    // "none", "blocked" and "declined" are the three the office can only pass
    // by NOT acting, and a corpus without them scores an office that does
    // something every time as perfect.
    for (const e of [
      'none',
      'task',
      'task_changed',
      'document',
      'preference',
      'blocked',
      'declined',
    ]) {
      expect([...effects]).toContain(e)
    }
  })

  it('exercises the hard-failure shapes: withdrawal, negative constraints, ambiguity', () => {
    const drafts = GOAL_FAMILIES.map((f) => f.draft(DEFAULT_WORLD, new Seeded(3)))
    expect(drafts.filter((d) => (d.intent.withdrawn?.length ?? 0) > 0).length).toBeGreaterThan(2)
    expect(drafts.filter((d) => (d.intent.forbids?.length ?? 0) > 0).length).toBeGreaterThan(2)
    expect(drafts.filter((d) => (d.intent.mayAskAbout?.length ?? 0) > 0).length).toBeGreaterThan(4)
    // The other half of clarification scoring, and the half usually missing.
    expect(drafts.filter((d) => (d.intent.alreadyKnows?.length ?? 0) > 0).length).toBeGreaterThan(4)
  })
})

describe('every family is well-formed under every persona and seed', () => {
  it('drafts a non-empty sentence and a stated want, always', () => {
    for (const family of GOAL_FAMILIES) {
      for (let seed = 0; seed < 25; seed++) {
        const d = family.draft(DEFAULT_WORLD, new Seeded(derive(seed, family.id)))
        expect(d.say.trim(), `${family.id} seed ${seed}`).not.toBe('')
        expect(d.intent.want.trim(), `${family.id} seed ${seed}`).not.toBe('')
        expect(d.why.trim(), `${family.id} seed ${seed}`).not.toBe('')
      }
    }
  })

  it('produces more than one phrasing where the family offers alternatives', () => {
    // A family whose draft ignored the rng would be one stored prompt with a
    // function around it, which is exactly what §7 forbids.
    const varied = GOAL_FAMILIES.filter((family) => {
      const seen = new Set<string>()
      for (let seed = 0; seed < 40; seed++) {
        seen.add(family.draft(DEFAULT_WORLD, new Seeded(derive(seed, family.id))).say)
      }
      return seen.size > 1
    })
    expect(varied.length / GOAL_FAMILIES.length).toBeGreaterThan(0.85)
  })
})

describe('no family leaks its own answer to the office', () => {
  it('survives the firewall for every family, persona and seed', () => {
    const leaks: string[] = []
    for (const family of GOAL_FAMILIES) {
      for (const persona of PERSONAS) {
        for (let seed = 0; seed < 12; seed++) {
          const s = derive(seed, family.id, persona.slug)
          const d = family.draft(DEFAULT_WORLD, new Seeded(s))
          const turn: ScenarioTurn = { say: d.say, intent: d.intent, why: d.why }
          const scenario: Scenario = {
            id: `${family.id}-${seed}`,
            family: family.id,
            persona: persona.slug,
            channel: 'teamhq',
            seed: s,
            turns: [turn],
          }
          const { text } = roughen(d.say, persona, s)
          try {
            sealed(scenario, turn, utteranceOf('teamhq', text))
          } catch (e) {
            leaks.push(`${family.id}/${persona.slug}/${seed}: ${(e as Error).message}`)
          }
        }
      }
    }
    expect(leaks.slice(0, 5)).toEqual([])
  })
})

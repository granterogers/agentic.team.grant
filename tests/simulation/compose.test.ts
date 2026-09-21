/**
 * The generator's one non-negotiable property: the sentence and the recorded
 * intent always describe the same request.
 *
 * Every structural operator edits both halves together. If one could edit the
 * sentence alone, the harness would mark the office wrong for answering the
 * message it actually received — silently, on a fraction of seeds, which is
 * the hardest kind of harness defect to notice and the one CLAUDE.md records
 * costing the most time.
 */

import { describe, expect, it } from 'vitest'
import { composeTurn, generate, generateCorpus } from '../../src/simulation/compose.ts'
import { familyById, GOAL_FAMILIES } from '../../src/simulation/goals.ts'
import { sealed } from '../../src/simulation/isolation.ts'
import { GRANT_LIKE, PERSONAS, PRECISE } from '../../src/simulation/persona.ts'
import { derive } from '../../src/simulation/random.ts'
import { utteranceOf } from '../../src/simulation/scenario.ts'
import { DEFAULT_WORLD } from '../../src/simulation/world.ts'

describe('generation is reproducible', () => {
  it('gives an identical corpus for an identical run seed', () => {
    const a = generateCorpus(DEFAULT_WORLD, 4242)
    const b = generateCorpus(DEFAULT_WORLD, 4242)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('gives a different corpus for a different run seed', () => {
    const a = generateCorpus(DEFAULT_WORLD, 1)
    const b = generateCorpus(DEFAULT_WORLD, 2)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('records the seed that produced each scenario, so any failure regenerates', () => {
    for (const s of generateCorpus(DEFAULT_WORLD, 7)) {
      expect(Number.isInteger(s.seed)).toBe(true)
      const again = generate(
        familyById(s.family) as never,
        PERSONAS.find((p) => p.slug === s.persona) as never,
        DEFAULT_WORLD,
        7,
        Number(s.id.split('/')[2]),
      )
      expect(again.turns[0]?.say).toBe(s.turns[0]?.say)
    }
  })
})

describe('sentence and intent never disagree', () => {
  it('records a withdrawal whenever the message contains one', () => {
    const wrong: string[] = []
    for (const family of GOAL_FAMILIES) {
      for (const persona of PERSONAS) {
        for (let seed = 0; seed < 8; seed++) {
          const s = derive(seed, family.id, persona.slug, 'wd')
          const { turn, composition } = composeTurn(family, persona, DEFAULT_WORLD, s)
          if (composition.structural.includes('self-correction')) {
            // The operator that withdraws must always leave a record of it,
            // or a cancelled clause becomes invisible to the evaluator and
            // "cancelled action executed" can never be detected.
            if ((turn.intent.withdrawn?.length ?? 0) === 0) {
              wrong.push(`${family.id}/${persona.slug}/${seed}: withdrew nothing`)
            }
          }
        }
      }
    }
    expect(wrong.slice(0, 5)).toEqual([])
  })

  it('never loses a negative constraint, however the message is restructured', () => {
    // The real property, not "forbidding families exist". A forbid on either
    // half binds the whole message, and losing one when the message grows is
    // exactly how a hard failure happens in real life: the person's limit is
    // still on screen and no longer in the record the evaluator reads.
    //
    // The first version of this test asserted only that some family somewhere
    // carried a forbid, which is a check that cannot fail. CLAUDE.md: a green
    // check that cannot be made red is not proved.
    const alwaysForbids = ['multi.negative-constraint', 'noaction.cancelled-outright']
    let checked = 0
    for (const id of alwaysForbids) {
      const family = familyById(id)
      expect(family, id).toBeDefined()
      if (family === undefined) continue
      for (const persona of PERSONAS) {
        for (let seed = 0; seed < 40; seed++) {
          const { turn } = composeTurn(
            family,
            persona,
            DEFAULT_WORLD,
            derive(seed, id, persona.slug),
          )
          checked++
          expect(
            turn.intent.forbids?.length ?? 0,
            `${id}/${persona.slug}/${seed}: the limit vanished`,
          ).toBeGreaterThan(0)
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  it('adds a legitimate thing to ask about when it removes the project name', () => {
    let checked = 0
    for (const family of GOAL_FAMILIES) {
      for (let seed = 0; seed < 20; seed++) {
        const s = derive(seed, family.id, 'vague')
        const { turn, composition } = composeTurn(family, GRANT_LIKE, DEFAULT_WORLD, s)
        if (composition.structural.includes('vague-reference')) {
          checked++
          // Without this the evaluator would score a CORRECT clarification
          // as an unnecessary question, and a check that fires on correct
          // behaviour is one somebody switches off.
          expect(turn.intent.mayAskAbout).toContain('which project is meant')
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('the generator is not inert', () => {
  it('actually restructures messages for the grant-like persona', () => {
    let structured = 0
    let total = 0
    for (const family of GOAL_FAMILIES) {
      for (let seed = 0; seed < 6; seed++) {
        total++
        const { composition } = composeTurn(
          family,
          GRANT_LIKE,
          DEFAULT_WORLD,
          derive(seed, family.id),
        )
        if (composition.structural.length > 0) structured++
      }
    }
    expect(structured / total).toBeGreaterThan(0.3)
    // And not everything, because §6 says not every message is maximally messy.
    expect(structured / total).toBeLessThan(0.95)
  })

  it('leaves the precise persona structurally untouched', () => {
    for (const family of GOAL_FAMILIES) {
      for (let seed = 0; seed < 6; seed++) {
        const { composition } = composeTurn(family, PRECISE, DEFAULT_WORLD, derive(seed, family.id))
        expect(composition.structural.filter((x) => x !== 'vague-reference')).toEqual([])
      }
    }
  })
})

describe('nothing the generator produces leaks', () => {
  it('passes the firewall for a whole generated corpus', () => {
    const leaks: string[] = []
    for (const runSeed of [1, 2, 3]) {
      for (const s of generateCorpus(DEFAULT_WORLD, runSeed)) {
        const turn = s.turns[0]
        if (turn === undefined) continue
        try {
          sealed(s, turn, utteranceOf(s.channel, turn.say))
        } catch (e) {
          leaks.push(`${s.id}: ${(e as Error).message}`)
        }
      }
    }
    expect(leaks.slice(0, 5)).toEqual([])
  })
})

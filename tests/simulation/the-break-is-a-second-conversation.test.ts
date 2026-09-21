/**
 * `breaksAfter` — the person goes away and comes back.
 *
 * Every arc was one unbroken thread, so two questions with OPPOSITE right
 * answers were the same question:
 *
 *   - does the office still know my preference tomorrow?  It must. A
 *     preference is a LESSON - a row, durable, and it has to hold in a
 *     conversation that has never heard it said.
 *   - does it still resolve "that one" tomorrow?  It must not.
 *     `app.conversation_before` windows at thirty minutes and twelve turns,
 *     so after a break there is nothing to resolve against and the office
 *     should ASK rather than guess.
 *
 * An office that forgets the preference is one Grant has to repeat himself
 * to. An office that confidently resolves the stale referent acts on the
 * wrong project. Only a break tells them apart.
 *
 * ## Why this file exists at all
 *
 * The decision lived as three lines inside `scripts/shadow/grant.ts`, where
 * nothing could reach it - and the distinction it draws is one the
 * COMPREHENSION door cannot exercise, because that door carries no history.
 * So the offline sweep runs green over the whole mechanism and says nothing
 * about it. A mechanism with no check behind it is what this repository
 * records paying for most often, and an audit that cannot reach a surface
 * says nothing about that surface.
 */

import { describe, expect, it } from 'vitest'
import type { Arc } from '../../src/simulation/arcs.ts'
import {
  ARC_RECIPES,
  buildArc,
  conversationFor,
  isFirstAfterTheBreak,
} from '../../src/simulation/arcs.ts'
import { GRANT_LIKE } from '../../src/simulation/persona.ts'
import { DEFAULT_WORLD } from '../../src/simulation/world.ts'

const arcNamed = (id: string): Arc => {
  const recipe = ARC_RECIPES.find((r) => r.id === id)
  if (recipe === undefined) throw new Error(`no arc called ${id}`)
  return buildArc(recipe, GRANT_LIKE, DEFAULT_WORLD, 1)
}

describe('an arc that breaks becomes two conversations', () => {
  const arc = arcNamed('arc.across-conversations')

  it('carries its break through buildArc', () => {
    expect(arc.breaksAfter).toBe(1)
  })

  it('puts the turns before the break in one conversation', () => {
    expect(conversationFor(arc, 0)).toBe(conversationFor(arc, 1))
  })

  it('and the turns after it in a DIFFERENT one', () => {
    expect(conversationFor(arc, 2)).not.toBe(conversationFor(arc, 0))
    expect(conversationFor(arc, 3)).toBe(conversationFor(arc, 2))
  })

  it('announces the break exactly once, on the first turn of the second', () => {
    const at = arc.turns.map((_, i) => isFirstAfterTheBreak(arc, i))
    expect(at.filter(Boolean)).toHaveLength(1)
    expect(at.indexOf(true)).toBe(2)
  })
})

describe('and an arc without one stays a single conversation', () => {
  /*
    The control. Without it this passes against a `conversationFor` that
    returns a new name every turn, which would make EVERY arc a sequence of
    one-turn conversations - the opposite defect, and a silent one, because
    a turn with no history behind it simply asks more.
  */
  const arc = arcNamed('arc.preference-continuity')

  it('has no break', () => {
    expect(arc.breaksAfter).toBeUndefined()
  })

  it('gives every turn the same conversation', () => {
    const all = new Set(arc.turns.map((_, i) => conversationFor(arc, i)))
    expect(all.size).toBe(1)
  })

  it('never announces a break', () => {
    expect(arc.turns.map((_, i) => isFirstAfterTheBreak(arc, i))).not.toContain(true)
  })
})

describe('every arc that declares a break can actually take one', () => {
  /*
    A break after the last turn is a break that never happens, and it would
    look exactly like an arc that works. Asserting the property rather than
    the two arcs that have one today.
  */
  for (const recipe of ARC_RECIPES.filter((r) => r.breaksAfter !== undefined)) {
    it(`${recipe.id} has turns on both sides of it`, () => {
      const arc = buildArc(recipe, GRANT_LIKE, DEFAULT_WORLD, 1)
      const after = arc.breaksAfter ?? -1
      expect(after).toBeGreaterThanOrEqual(0)
      expect(arc.turns.length).toBeGreaterThan(after + 1)
    })
  }
})

/**
 * A reserved project is not one of Grant's projects.
 *
 * Found by acting like him: *"What projects do we have open at the moment?"*
 * came back *"Here are the five open projects: 1. Unnamed, …"*. He has four.
 * The fifth is the reserved bucket ADR-0024 created so a message naming no
 * project lands somewhere; `projects.reserved_reason` marks it, is correctly
 * set, and was read by **nothing** in `src/`, `supabase/` or `web/`.
 */
import { describe, expect, it } from 'vitest'
import { projectSpine } from '../../src/handlers/instruction.ts'

const p = (name: string, reserved = false) => ({ name, reserved })

describe('the project spine', () => {
  it('counts only the real projects', () => {
    const line = projectSpine([p('A'), p('B'), p('C'), p('D'), p('Unnamed', true)])
    expect(line).toContain('4 of them')
    expect(line).not.toContain('5 of them')
  })

  it('names the reserved place rather than hiding it', () => {
    // "What has ended up in the unnamed project?" is a fair question, and an
    // answer that cannot see the row cannot field it.
    const line = projectSpine([p('A'), p('Unnamed', true)])
    expect(line).toContain('Unnamed')
    expect(line).toContain('reserved place')
  })

  it('says nothing about a reserved place when there is not one', () => {
    const line = projectSpine([p('A'), p('B')])
    expect(line).toContain('2 of them')
    expect(line).not.toContain('reserved')
  })

  it('is empty when there is nothing to say', () => {
    expect(projectSpine([])).toBe('')
  })

  it('states a FACT and never gives the model an order', () => {
    /*
      The regression that matters, and the one only real execution found.

      The first version ended "…so do not count it as a project or offer it as
      one unless he asks about it directly." The count went right and TWO OF
      THREE answers got worse: "What projects do we have open?" came back
      "I have nothing on it here" from a prompt that listed all four. A
      negative imperative next to the data it is about invites over-obedience.

      Asserted as a property of the sentence — no imperative verb aimed at the
      model — rather than as the exact wording, because rewording is the fix
      half the time and a literal lock would forbid it.
    */
    const line = projectSpine([p('A'), p('Unnamed', true)]).toLowerCase()
    for (const order of ['do not', "don't", 'never ', 'you must', 'always ']) {
      expect(line, `the spine gives the model an order: "${order}"`).not.toContain(order)
    }
  })

  it('CONTROL: and that check can actually see an imperative', () => {
    // Without this the rule above passes on any sentence at all, including an
    // empty one — the found-nothing shape, on a guard about wording.
    expect('do not count it as a project'.includes('do not')).toBe(true)
  })
})

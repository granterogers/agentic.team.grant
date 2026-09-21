/**
 * The harness may not misspell the word the scenario turns on.
 *
 * `roughen.ts` respells words to imitate a person typing on a phone. It has
 * always refused to touch negations and numerals, for the reason its own
 * comment gives: respelling one of those changes the instruction rather than
 * roughening it, and a lost negative constraint is a HARD FAILURE.
 *
 * The same argument applies with the same force to an operator that takes
 * something back, and the hand-written list missed `ignore` - which is the
 * one Grant's own messages use most. On the 29-arc sweep four of the ten
 * complaints were `igore`, `ignoore`, `ignoer` and `inore`: the harness
 * testing its own spelling, and reporting the result as #291, the class
 * Grant ranks highest because it "can cause unwanted real-world actions".
 *
 * So the list is derived from `CANCELS` now, and this is the check that it
 * stays derived. Asserting the PROPERTY - no operator the office recognises
 * can be respelled by the simulator - rather than the membership of a list,
 * because a list asserted by name is the correction this repository records
 * five times.
 */

import { describe, expect, it } from 'vitest'
import { BARE_PIVOTS, CANCELS, readRetraction } from '../../src/agents/retraction.ts'
import { GRANT_LIKE } from '../../src/simulation/persona.ts'
import { Seeded } from '../../src/simulation/random.ts'
import { roughen } from '../../src/simulation/roughen.ts'

/*
  The property asked END TO END, which is the only form of it that is right.

  A first draft asserted that each WORD of each operator survived, and went
  red on `about` - which the roughener had not misspelled at all but
  replaced, meaning-preservingly, with the shorthand "re". Asserting which
  word carries an operator is guessing at the mechanism; asking whether the
  OFFICE still sees a withdrawal is the thing that actually matters, and it
  cannot be wrong about which word mattered.
*/
const stillSeesIt = (op: string, seed: number): boolean => {
  // The optional group kept, its syntax removed: `forget(?: about)?` is the
  // phrase "forget about". An earlier version ate the SPACE too and built
  // "forgetabout", which four operators then failed on - the test wrong,
  // not the roughener, for the third time this session.
  const phrase = op.replace(/\(\?:/g, '').replace(/\)\?/g, '').replace(/\?/g, '').trim()
  const said = `add a task on the course to write the welcome pack ${phrase} that what is outstanding on the bid`
  return readRetraction(roughen(said, TYPIST, new Seeded(seed)).text) !== null
}

/*
  A persona that types badly, asked many times over. One seed proves
  nothing: the typo operator fires per word at a probability, so a word can
  survive a hundred seeds by luck and be mangled on the hundred and first.
*/
const TYPIST = { ...GRANT_LIKE, typos: 1 }

describe('the simulator never misspells an operator that takes something back', () => {
  for (const op of [...CANCELS, ...BARE_PIVOTS]) {
    it(`leaves "${op}" still readable as a withdrawal`, () => {
      const lost: number[] = []
      for (let seed = 0; seed < 60; seed++) if (!stillSeesIt(op, seed)) lost.push(seed)
      expect(lost).toEqual([])
    })
  }
})

describe('the control - it really does misspell ordinary words', () => {
  /*
    Without this the suite above passes against a roughener that has
    silently stopped producing typos at all, which is the found-nothing
    shape this repository records three times. A sabotage that does not
    apply is not a passing control.
  */
  it('mangles at least one ordinary word across sixty seeds', () => {
    const said = 'please redo the budget page and chase the letter of support before Thursday'
    let mangled = 0
    for (let seed = 0; seed < 60; seed++) {
      if (roughen(said, TYPIST, new Seeded(seed)).text !== said) mangled++
    }
    expect(mangled).toBeGreaterThan(0)
  })
})

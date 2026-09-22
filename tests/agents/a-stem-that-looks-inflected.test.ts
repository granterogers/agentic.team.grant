/**
 * "bring Finance in on that" is an instruction, and the office read it as a
 * musing — for two characters' worth of reason.
 *
 * ## The measurement that found it
 *
 * `npm run measure`, real traffic only: the **finance director has never been
 * chosen**, on any job, ever. Sampling the real messages classified `thought`
 * — the class that convenes nobody and writes nothing — turned up why:
 *
 *     "bring Finance in on that"   x2, and they are the only two times Grant
 *                                  has ever asked for that specialist by name
 *
 * `readClause` rejects a clause opening with a gerund, because "Drafting it
 * now feels premature" is a description rather than a request. The test is
 * structural — `/ing$/` — and `bring` ends in -ing.
 *
 * `ring the venue` is the same word class and is the commonest phone-call
 * task there is. `speed`, `feed`, `proceed` and `exceed` are the -ed half.
 *
 * ## Why a list is right here and a list is usually wrong
 *
 * This file avoids phrase lists because English keeps acquiring phrasings.
 * It is not acquiring monosyllabic verbs whose stem ends in -ing: that set is
 * closed and has been for centuries. And no derivation separates them —
 * stripping the suffix from "bring" leaves "br", and from "making" leaves
 * "mak", neither of which is a word.
 *
 * It also only ever SUBTRACTS from a rejection, so its worst failure is
 * reading a description as an instruction, which §6's downward resolution
 * caps at `assignment`.
 */

import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import { readClause } from '../../src/agents/request.ts'

describe('a stem that looks inflected is still a stem', () => {
  const instructions = [
    'bring Finance in on that',
    'bring the team in on this',
    'ring the venue on Thursday',
    'ring them back before five',
    'speed the invoice up',
    'feed that back to them',
    'proceed with the booking',
    'lead on the funding bid',
    'read the spec before you reply',
    'spread the cost over two months',
    'shed the extra scope',
    'string the two threads together',
  ]
  for (const said of instructions) {
    it(`"${said}" is read as an instruction`, () => {
      expect(readClause(said).mood).toBe('ask')
    })
  }

  it('and the one that was measured reaches a class that convenes somebody', () => {
    const c = classifyIntent('bring Finance in on that')
    expect(c.recognised).toBe(true)
    expect(c.intent).toBe('assignment')
  })
})

describe('and a real gerund or past tense is still not one', () => {
  /*
    THE DIRECTION THAT MATTERS MORE. The rule this subtracts from exists
    because a description must not become an instruction — widening it until
    "Drafting it now feels premature" writes a task would be worse than the
    defect it fixes.
  */
  const descriptions = [
    'Drafting it now feels premature',
    'Bringing it up now would be awkward',
    'Ringing them twice already felt like too much',
    'Decided not to in the end',
    'Needed a second opinion on that',
    'Proceeded without them, in the end',
    'Speeding it up is not really possible',
  ]
  for (const said of descriptions) {
    it(`"${said.slice(0, 44)}…" is still a remark`, () => {
      expect(readClause(said).mood).toBe('remark')
    })
  }
})

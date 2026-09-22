/**
 * #310 — the dimension classifier, which is what makes precedence
 * deterministic without a model.
 *
 * The end-to-end lifecycle is proved against the real database by
 * `npm run verify:preferences`, because every piece of it was already in the
 * database and unreachable from the product: a suite driving the SQL would
 * have passed on the day the office was broken. What is unit-testable is the
 * reading that decides WHICH rule a new one is about, and that is here.
 *
 * ## Why `null` is a first-class answer
 *
 * The asymmetry the whole design rests on, and it is 0304's:
 *
 *     failing to recognise a dimension leaves today's behaviour;
 *     recognising the wrong one destroys something Grant said.
 *
 * So every "does not claim a dimension" case below is as load-bearing as the
 * positive ones, and the two-dimension case returns null on purpose rather
 * than picking.
 */

import { describe, expect, it } from 'vitest'
import {
  boundToThisConversation,
  type Dimension,
  dimensionOf,
  restates,
  withdrawsARule,
} from '../../src/agents/preference.ts'

describe('two rules about one thing are recognised as being about it', () => {
  const cases: [string, Dimension][] = [
    ['From now on keep your replies short', 'answer-length'],
    ['actually, detailed answers are fine from now on', 'answer-length'],
    ['keep everything you send me to one line from now on', 'answer-length'],
    ['from now on use bullet points in everything you send me', 'answer-format'],
    ['never use bullet points, prose only', 'answer-format'],
    ['From now on, always paste the image URLs into the reply as well', 'links-and-images'],
    ['never put a due date on anything unless I give you one', 'due-dates'],
    ['just do that kind of thing without asking me in the future', 'asking-first'],
  ]
  for (const [said, dimension] of cases) {
    it(`"${said.slice(0, 46)}…" is about ${dimension}`, () => {
      expect(dimensionOf(said)).toBe(dimension)
    })
  }

  it('reads an instruction and its opposite as the SAME thing', () => {
    /*
      The property the whole feature turns on. If these came out as two
      dimensions the office would hold both and obey neither reliably, which
      is the state #310 found it in.
    */
    expect(dimensionOf('always use bullet points')).toBe(dimensionOf('never use bullet points'))
    expect(dimensionOf('keep it short')).toBe(dimensionOf('detailed answers are fine'))
  })
})

describe('and claims nothing when it is not sure', () => {
  for (const said of [
    'always tell me who you asked before you send anything to a client',
    'the funding officer prefers a phone call',
    'we always invoice on the first of the month',
  ]) {
    it(`claims no dimension for "${said.slice(0, 44)}…"`, () => {
      expect(dimensionOf(said)).toBeNull()
    })
  }

  it('claims none when an instruction spans two', () => {
    /*
      "a single short paragraph" is about length AND about format. Superseding
      a rule about one of them would silently drop the other half, so this
      returns null and the rule simply accumulates — which is exactly today's
      behaviour and therefore costs nothing.
    */
    expect(dimensionOf('keep every answer to a single short paragraph')).toBeNull()
  })
})

describe('taking a rule back is not stating a new one', () => {
  it('reads a withdrawal, with the rule it is about', () => {
    expect(withdrawsARule('do not use bullets anymore')).toBe('answer-format')
    expect(withdrawsARule('forget what I said about bullets')).toBe('answer-format')
    expect(withdrawsARule('no longer put links in')).toBe('links-and-images')
  })

  it('does not read a NEW prohibition as a withdrawal', () => {
    /*
      "never use bullets" is a rule to store, not a rule to retire — it has to
      supersede, not retract, or the office ends up holding nothing at all
      where he stated something.
    */
    expect(withdrawsARule('never use bullet points')).toBeNull()
    expect(withdrawsARule('from now on use bullet points')).toBeNull()
  })

  it('retires nothing when it cannot tell what the withdrawal is about', () => {
    expect(withdrawsARule('forget what I said')).toBeNull()
    expect(withdrawsARule('never mind that anymore')).toBeNull()
  })
})

describe('saying it again is not a second rule', () => {
  it('reads the complaint form as the same instruction', () => {
    /*
      The real pair. Six copies of one rule existed, and one of them was him
      pointing out that it had not stuck.
    */
    expect(
      restates(
        "I've told you to always give your information in the form of clear bullet points",
        'always give your information in the form of clear bullet points',
      ),
    ).toBe(true)
  })

  it('does not treat two different rules as one', () => {
    expect(restates('keep replies short', 'use bullet points')).toBe(false)
    expect(restates('always paste image links', 'never paste image links')).toBe(false)
    expect(
      restates('keep replies short', 'keep replies short unless I ask for detail on pricing'),
    ).toBe(false)
  })
})

describe('a rule that says how long it lasts', () => {
  it('is recognised as bounded to the conversation', () => {
    for (const said of [
      'From now on in this conversation, keep every answer to a single short paragraph',
      'for this chat, no bullet points please',
      'just for now, keep it brief',
    ]) {
      expect(boundToThisConversation(said)).toBe(true)
    }
  })

  it('and an ordinary standing rule is not', () => {
    for (const said of [
      'From now on keep your replies short',
      'always give your information in bullet points',
      'never put a due date on anything unless I give you one',
    ]) {
      expect(boundToThisConversation(said)).toBe(false)
    }
  })
})

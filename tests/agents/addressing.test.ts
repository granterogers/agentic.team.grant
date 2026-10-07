/**
 * Who a message was sent TO is not the same fact as where the answer goes (`src/agents/addressing.ts`).
 *
 * The chief's Telegram bot carries the slug `chief-of-staff`, the webhook stores it as `addressed_to` so the reply path
 * finds the bot, and `speaker()` read any non-empty value as "he opened a specialist's bot", so nothing typed to the
 * chief's bot ever convened anybody. These are the cases, each with its negative neighbour, because a fix that routes
 * everything or addresses nothing would pass half of them.
 */
import { describe, expect, it } from 'vitest'
import { addressedDirectly, CHIEF_OF_STAFF } from '../../src/agents/addressing.ts'

describe('addressedDirectly', () => {
  it('the chief alone is the router, not a selection (the production Telegram shape)', () => {
    expect(addressedDirectly({ addressedTo: CHIEF_OF_STAFF })).toBe(false)
    expect(addressedDirectly({ addressedTo: CHIEF_OF_STAFF, alsoAddressed: [] })).toBe(false)
  })

  it('a specialist whose bot he opened is addressed directly, whatever they are called', () => {
    for (const slug of [
      'research-director',
      'finance-director',
      'communications-director',
      'quality-director',
    ]) {
      expect(addressedDirectly({ addressedTo: slug }), slug).toBe(true)
    }
  })

  it('nobody named is routed, however the absence is spelled', () => {
    for (const none of [null, undefined, '', '   ']) {
      expect(addressedDirectly({ addressedTo: none })).toBe(false)
    }
  })

  it('the chief WITH people he picked himself is a selection of several, so it stays direct', () => {
    expect(
      addressedDirectly({ addressedTo: CHIEF_OF_STAFF, alsoAddressed: ['finance-director'] }),
    ).toBe(true)
  })

  it('the chief with a selection that is only herself or blanks is still the chief alone', () => {
    expect(addressedDirectly({ addressedTo: CHIEF_OF_STAFF, alsoAddressed: [''] })).toBe(false)
    expect(
      addressedDirectly({ addressedTo: CHIEF_OF_STAFF, alsoAddressed: [CHIEF_OF_STAFF] }),
    ).toBe(false)
  })

  it('a hand-off child never routes, even when it is addressed to the chief (a chain ends at one by construction)', () => {
    expect(addressedDirectly({ addressedTo: CHIEF_OF_STAFF, handedOff: true })).toBe(true)
    expect(addressedDirectly({ addressedTo: 'finance-director', handedOff: true })).toBe(true)
    // ...and a hand-off with nobody named is not a hand-off to anyone.
    expect(addressedDirectly({ addressedTo: null, handedOff: true })).toBe(false)
  })

  it('a near-miss of the chief slug is a different person, not the chief', () => {
    expect(addressedDirectly({ addressedTo: 'chief-of-staff-2' })).toBe(true)
    expect(addressedDirectly({ addressedTo: 'Chief-Of-Staff' })).toBe(true)
  })
})

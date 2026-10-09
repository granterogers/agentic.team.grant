/**
 * The sentence appended to an answer that misstated what the office can do (found by the real-model acceptance run of
 * 9 October 2026: a backup model offered a paid action and the correction read "I cannot any action that incurs cost").
 *
 * The registry's one-sentence descriptions come in two shapes, a verb phrase ("Send email") and a noun phrase ("Any action
 * that incurs cost"). The property is that the sentence reads correctly for BOTH, which no wording lock could say.
 */
import { describe, expect, it } from 'vitest'
import { capabilityCorrection } from '../../src/agents/capability-claims.ts'

const DESCRIPTIONS = [
  'Send email',
  'Read the application database',
  'Post into Slack',
  'Any action that incurs cost',
  'Delete application data',
  'Modify production configuration or security.',
]

/** What the first draft did: ran the description straight after the modal. Used only as the control below. */
const firstDraft = (what: string): string =>
  `I cannot ${what.charAt(0).toLowerCase()}${what.slice(1)} — that is switched off here.`

/** A modal followed directly by a determiner or quantifier is a noun phrase used as a verb phrase. */
const modalThenNounPhrase = /\b(?:cannot|can)\s+(?:any|an|a|the|all|every|some)\b/i

describe('capabilityCorrection', () => {
  it.each(DESCRIPTIONS)('reads correctly for "%s"', (what) => {
    for (const verdict of ['false_denial', 'false_offer'] as const) {
      const text = capabilityCorrection(verdict, what)
      expect(text).toContain(`(${what.replace(/[.\s]+$/, '')})`)
      expect(text).not.toMatch(modalThenNounPhrase)
      expect(text.startsWith('(Correction, from the system rather than from me:')).toBe(true)
      expect(text.endsWith(')')).toBe(true)
    }
  })

  it('says the opposite things for the two verdicts', () => {
    const denial = capabilityCorrection('false_denial', 'Send email')
    const offer = capabilityCorrection('false_offer', 'Send email')
    expect(denial).toMatch(/this office CAN do that/)
    expect(denial).toMatch(/ignore it/)
    expect(offer).toMatch(/I cannot do that, because it is switched off here/)
    expect(offer).toMatch(/ignore the offer/)
  })

  it('carries no issue or section number, which a person or a model would read aloud', () => {
    for (const what of DESCRIPTIONS) {
      for (const verdict of ['false_denial', 'false_offer'] as const) {
        expect(capabilityCorrection(verdict, what)).not.toMatch(/#\d|§|\bconstraint\b/i)
      }
    }
  })

  it('CONTROL: the detector fails on the first draft for the noun-phrase description, and not for a verb phrase', () => {
    expect(firstDraft('Any action that incurs cost')).toMatch(modalThenNounPhrase)
    expect(firstDraft('Send email')).not.toMatch(modalThenNounPhrase)
  })
})

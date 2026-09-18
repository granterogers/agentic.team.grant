/**
 * Two vocabularies for one thing (#260).
 *
 * The provider answers `slide_deck` and `mind_map`; this office says `slides`
 * and `mindmap`. Adoption stored the wire word verbatim, `artifacts.kind` has
 * no CHECK to refuse it, and the page falls through to the raw string for a
 * kind it has no English for — so a slide deck Grant made himself appeared on
 * his Sources tab as "slide_deck".
 *
 * Nothing failed, which is why nothing caught it: the unknown-kind fallback
 * exists so a NEW type cannot break enumeration, and it did its job over a
 * type that is not new at all.
 *
 * **Every wire word below was measured**, by listing Grant's four real
 * notebooks: 12 artifacts, of which 1 slide_deck and 2 mind_maps in one
 * notebook and 1 more slide_deck in another. Keeping the measured words as
 * the fixtures means the next person to change this has to argue with the
 * provider rather than with me.
 */
import { describe, expect, it } from 'vitest'
import { ARTIFACT_KINDS, officeKind } from '../../src/notebook/actions.ts'

describe('the provider speaks its vocabulary and the office speaks its own', () => {
  const MEASURED = [
    ['audio', 'audio'],
    ['slide_deck', 'slides'],
    ['mind_map', 'mindmap'],
  ] as const

  it.each(MEASURED)('%s becomes %s', (wire, ours) => {
    expect(officeKind(wire)).toBe(ours)
  })

  it('and everything it translates to is a kind this office actually has', () => {
    for (const [, ours] of MEASURED) {
      expect(ARTIFACT_KINDS as readonly string[]).toContain(ours)
    }
  })

  /*
    Unknown stays unknown rather than being guessed at. A kind nobody has
    mapped is one the office genuinely has no word for, and inventing a label
    would put a wrong name on a real artifact — worse than an ugly true one.
  */
  it('leaves a kind nobody has mapped alone', () => {
    expect(officeKind('some_future_thing')).toBe('some_future_thing')
  })

  /*
    The control. Without it this file would pass against a translation that
    simply strips underscores, which happens to be right for these two and
    wrong the moment the provider ships `audio_overview` or `deep_dive`.
  */
  it('CONTROL: it is a mapping, not a string transformation', () => {
    expect(officeKind('mind_map')).not.toBe('mindmap'.replace('mindmap', 'mind map'))
    // `study_guide` keeps its underscore, so stripping them is not the rule.
    expect(officeKind('study_guide')).toBe('study_guide')
  })
})

/**
 * What the floor channel says, as cases.
 *
 * Grant asked for "understandable English", which is the whole requirement and
 * the easy half to get wrong: every field this reads is stored in a vocabulary
 * written for an audit trail. The first live render said *"Direct_command
 * permits research-director, strategy-director"* and *"Duplicate check: none
 * found."* — both true, both unreadable.
 */
import { describe, expect, it } from 'vitest'
import { narrate } from '../../src/slack/narrate.ts'

const NAMES = new Map([
  ['research-director', 'Emma'],
  ['strategy-director', 'Tom'],
  ['chief-of-staff', 'Claire'],
])

const handoff = (over: Record<string, unknown> = {}): never =>
  ({
    job_id: '11111111-1111-4111-8111-111111111111',
    kind: 'office.instruction',
    instruction: 'Make a mind map in the notebook on coaching qualifications.',
    intent_class: 'direct_command',
    confident: true,
    intent_reason: 'make-this',
    roster: ['research-director'],
    roster_reason:
      'direct_command permits research-director, strategy-director (§9: roster ceilings)',
    duplicate_resolution: 'none_found',
    candidate_count: 0,
    project: 'AI Team HQ Test',
    chief_name: 'Claire',
    chief_title: 'Chief of Staff',
    chief_avatar: null,
    taker_name: 'Emma',
    taker_title: 'Research Director',
    decided_at: '2026-09-07T06:00:00Z',
    ...over,
  }) as never

describe('the floor', () => {
  it('says who has it and why, by name', () => {
    const said = narrate(handoff(), NAMES)
    expect(said).toContain('Emma has it — Research Director.')
    expect(said).toContain('Emma, Tom')
    expect(said).toContain('a straight instruction')
  })

  it('leaves no slug, no section number and no enum token behind', () => {
    const said = narrate(handoff(), NAMES)
    expect(said).not.toMatch(/-director/)
    expect(said).not.toMatch(/§/)
    expect(said).not.toMatch(/direct_command|none_found|light_investigation/)
  })

  it('reads the duplicate scan by its real enum spelling', () => {
    // `none_found`, not the `no_candidates` the first version guessed from the
    // column name — which fell through to a fallback and printed
    // "Duplicate check: none found."
    expect(narrate(handoff(), NAMES)).toContain('Nothing else in flight on it.')
    expect(narrate(handoff({ duplicate_resolution: 'linked_to_existing' }), NAMES)).toContain(
      'already had this one open',
    )
  })

  it('does not round an unconfident reading up into a confident one', () => {
    // The case a generated summary would smooth over, and the one Grant most
    // needs to see.
    expect(narrate(handoff({ confident: false }), NAMES)).toContain('I am not certain')
  })

  it('says plainly when nobody was convened', () => {
    expect(narrate(handoff({ taker_name: null, taker_title: null }), NAMES)).toContain(
      'I am handling it',
    )
  })

  it('survives a job with no instruction text', () => {
    expect(narrate(handoff({ instruction: null }), NAMES)).toContain('office.instruction')
  })
})

/**
 * A word that is already English is left alone.
 *
 * Grant's floor channel carried this, in his own workspace, for a fortnight:
 *
 *     One specialist: the a question is about evidence, and forbids convening
 *     a team for it.
 *
 * The router had written "the question is about evidence", using `question` as
 * the ordinary noun it is, and the vocabulary substitution replaced it with
 * "a question" — article included. Four of the seven classes are plain English
 * words and can only be damaged by translating them; the three spelled with an
 * underscore are the ones that need it, and an underscore is also what makes a
 * false match impossible.
 */
describe('the vocabulary substitution', () => {
  it('leaves a class name that is already an English word untouched', () => {
    const said = narrate(
      handoff({
        roster_reason: 'the question is about evidence, and forbids convening a team for it',
      }),
      NAMES,
    )
    // Capitalised, because `plainly` finishes the clause into a sentence.
    expect(said).toContain('The question is about evidence')
    expect(said.toLowerCase()).not.toContain('the a question')
  })

  it('still translates the ones spelled as vocabulary rather than as English', () => {
    const said = narrate(
      handoff({ roster_reason: 'light_investigation permits one specialist' }),
      NAMES,
    )
    expect(said).not.toContain('light_investigation')
    expect(said).toContain('A bit of digging')
  })

  /*
    CONTROL. Every assertion above would also pass if the substitution had been
    removed altogether — which is the tempting fix and the wrong one, because
    the underscored terms are exactly what Grant cannot read.
  */
  it('CONTROL: a slug is still replaced with the person it names', () => {
    const said = narrate(
      handoff({ roster_reason: 'direct_command permits research-director' }),
      NAMES,
    )
    expect(said).toContain('Emma')
    expect(said).not.toContain('research-director')
  })
})

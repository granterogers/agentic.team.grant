/**
 * The voice note that produced #60, replayed.
 *
 * Grant sent one 59-second instruction containing six things. The say-back
 * listed two of them, with "from it" referring to a project the plan had lost,
 * and offered a Go ahead button underneath. Pressing it would have generated a
 * slide deck and an audio overview about nothing.
 *
 * This is the transcript, verbatim from the echo, asserted clause by clause —
 * because the failure was not that the parser was bad at one thing, it was that
 * four separate clauses disappeared without trace and nothing noticed.
 */

import { describe, expect, it } from 'vitest'
import { describePlan, readPlan } from '../../src/agents/plan.ts'

const HEARD =
  'Create for me a new Google Notebook project. You can call it Coaching for Success ' +
  'and I want you to do some research on how to make good money coaching people in ' +
  'wellness over three or six month long programs. The research can be done via Google ' +
  'Notebook as relevant sources and then I want you to produce a presentation and a ' +
  'short audio explanation and once that’s done I want you to send me the link to the ' +
  'audio and presentation directly here that I can click on it and open it.'

describe('the Coaching for Success voice note', () => {
  const plan = readPlan(HEARD)

  it('is read as a plan at all', () => {
    expect(plan).not.toBeNull()
  })

  it('finds the project name even though it arrives in the next sentence', () => {
    // The whole first defect. Both original patterns required the name to
    // follow the word "project" inside one sentence, and he put a full stop
    // there — which is how a person speaks.
    expect(plan?.project).toBe('Coaching for Success')
  })

  it('and emits a project step, so the artifacts have something to be made from', () => {
    expect(plan?.steps.some((s) => s.kind === 'project')).toBe(true)
  })

  it('still catches both artifacts', () => {
    const kinds = (plan?.steps ?? [])
      .filter((s) => s.kind === 'generate')
      .map((s) => (s as { artifact: string }).artifact)
    expect(kinds).toContain('slides')
    expect(kinds).toContain('audio')
  })

  it('admits it cannot do the research', () => {
    // Not turned into a step: this planner's premise is that every step maps
    // to a job kind that exists, and a `research` step nothing can run would
    // produce a confident plan followed by silence.
    expect((plan?.unread ?? []).some((u) => u.includes('research'))).toBe(true)
  })

  it('and admits it cannot send the links back', () => {
    expect((plan?.unread ?? []).some((u) => u.includes('links'))).toBe(true)
  })

  it('names the subject instead of saying "from it" with no "it"', () => {
    const said = describePlan(plan as never)
    expect(said).toContain('Coaching for Success')
    expect(said).not.toMatch(/Make .* from it\./)
  })

  it('does not offer a bare "go ahead" when it only understood part of it', () => {
    /*
      The dangerous part. A plan that understands nothing and says so is
      recoverable; one that understands a third and puts a confirm button under
      it makes a partial reading look checked.
    */
    const said = describePlan(plan as never)
    expect(said).toContain('could not work out how to')
    expect(said).not.toContain('Go ahead and I will start.')
  })
})

describe('an instruction it fully understands is unaffected', () => {
  const plan = readPlan(
    'Push this video https://youtu.be/abc123 into the notebook project called AI Learning ' +
      'and then make me an audio overview and a mind map',
  )

  it('reads it', () => {
    expect(plan).not.toBeNull()
  })

  it('has nothing to apologise for', () => {
    expect(plan?.unread ?? []).toHaveLength(0)
  })

  it('and still ends with the plain go-ahead', () => {
    // The new wording must not leak onto plans that are complete — an apology
    // on every message is how a warning stops being read.
    expect(describePlan(plan as never)).toContain('Go ahead and I will start.')
  })
})

describe('"call it X" is a fallback, not a first reading', () => {
  it('does not invent a project from a throwaway phrase', () => {
    // "call it whatever you like" must not become a project called "whatever
    // you like". CALL_IT only applies when a new project was actually asked
    // for.
    const plan = readPlan(
      'Add this to the Legacy course and make an audio overview and a mind map, ' +
        'call it whatever you like',
    )
    expect(plan?.project).not.toBe('whatever you like')
  })
})

/**
 * He says "notebook"; the planner required the word "project" (#347).
 *
 * On 11 September Grant asked, by voice, for a new Google Notebook project
 * called **Coaching for Success**, research in it on coaching wellness
 * programmes, a presentation, a short audio explanation, and the links sent
 * back to him. The office said back only:
 *
 *   1. Make slide deck from it. I will ask you before I do.
 *   2. Make audio overview from it. I will ask you before I do.
 *
 * — "it" with no antecedent — and then asked *"Shall I make it in Legacy
 * Coaching Course?"*, substituting the project he happened to be scoped to.
 * No "Coaching for Success" was ever created, no research was done, and no
 * links were ever sent.
 *
 * That exact sentence plans correctly today. **The class did not.** Both
 * `NEW_PROJECT` and `NAMED_PROJECT` read `(?:notebook\s+)?project\s+
 * (?:called|named|titled)` — the `notebook` optional and the `project`
 * REQUIRED — so dropping one word reproduced the whole failure, with "from
 * the sources in that notebook" standing in for the missing antecedent.
 *
 * Asserted as a semantic class rather than against his one memorable
 * sentence, which is the trap CLAUDE.md names.
 */
import { describe, expect, it } from 'vitest'
import { describePlan, readPlan } from '../../src/agents/plan.ts'

const steps = (said: string): readonly string[] => (readPlan(said)?.steps ?? []).map((s) => s.kind)

describe('naming a notebook is naming a notebook', () => {
  it('plans the creation however he words it', () => {
    for (const said of [
      'Create a notebook called Onboarding and produce a presentation and an audio explanation.',
      'Make a notebook named Q4 Planning, a slide deck and an audio overview.',
      'Create a new Google Notebook project called Onboarding and produce a presentation and a short audio explanation.',
    ]) {
      expect(steps(said), said).toContain('project')
    }
  })

  it('and his own sentence still plans, unchanged', () => {
    // The regression half. It worked before this and must go on working.
    const said =
      'Create for me a new Google Notebook project. You can call it Coaching for Success ' +
      'and I want you to do some research on how to make good money coaching people in ' +
      'wellness over three or six month long programs. The research can be done via ' +
      'Google Notebook as relevant sources and then I want you to produce a presentation ' +
      'and a short audio explanation and once that is done I want you to send me the link ' +
      'to the audio and presentation directly here that I can click on it and open it.'
    expect(steps(said)).toEqual(['project', 'generate', 'generate'])
  })

  it('names the notebook in the say-back rather than pointing at nothing', () => {
    /*
      The user-visible half, and the thing he actually received. An unbound
      referent is worse than a missing step: "Make slide deck from it" reads
      as though the office understood, and invites a "go ahead" for work it
      will do somewhere else.
    */
    const plan = readPlan(
      'Create a notebook called Onboarding and produce a presentation and an audio explanation.',
    )
    expect(plan).not.toBeNull()
    const said = describePlan(plan as NonNullable<typeof plan>)
    expect(said).toContain('Onboarding')
    expect(said).not.toMatch(/from (?:it|that notebook)\b/i)
  })

  /*
    CONTROL: widening the noun must not invent a project out of a message that
    names none. `WANTS_A_PROJECT`'s gate on `CALL_IT` is deliberately left
    alone, so a loose "call it X" still needs "new".
  */
  it('CONTROL: a message naming nothing plans no project step', () => {
    expect(steps('Make me a slide deck and an audio overview.')).not.toContain('project')
    expect(steps('What do our documents say about the opening assessment?')).not.toContain(
      'project',
    )
  })

  /*
    CONTROL: a `project` step does NOT mean create. Its own comment says so and
    the resolver decides — `use_project` when it finds one, `create_project`
    only when it does not. Referring to a notebook he already has must still
    produce the same step, or widening the noun would have changed what the
    step means.
  */
  it('CONTROL: referring to an existing notebook produces the same neutral step', () => {
    const plan = readPlan(
      'In the notebook called Legacy Coaching Course, make a slide deck and an audio overview.',
    )
    expect((plan?.steps ?? []).map((s) => s.kind)).toContain('project')
    const named = (plan?.steps ?? []).find((s) => s.kind === 'project')
    expect(named).toBeDefined()
    // Neutral: the planner does not touch the world, so it cannot say create.
    expect(JSON.stringify(named)).not.toMatch(/create/i)
  })
})

/**
 * THE SOVEREIGN HALF OF THE PLANNER (#283).
 *
 * The model decides what sequence of work looks appropriate. This decides
 * whether any of it may happen, and `plan.ts` was right about why that matters:
 * a freely-generated plan proposing steps nothing can execute produces a
 * confident plan followed by silence.
 *
 * Every rule below is one a model will eventually break, so each has its own
 * case and each has a counterpart proving the rule is not simply "refuse
 * everything" — a validator that rejects all plans would pass a file of
 * refusals and be a worse defect than the one it guards.
 */
import { describe, expect, it } from 'vitest'
import { type Capability, validate } from '../../src/agents/goal.ts'

const CATALOGUE: Capability[] = [
  {
    tool: 'db.read',
    level: 0,
    enabled: true,
    inReply: true,
    purpose: 'read the office database',
    verbs: ['read'],
  },
  {
    tool: 'gmail.search',
    level: 0,
    enabled: true,
    inReply: true,
    purpose: 'search the mail',
    verbs: ['search'],
  },
  {
    tool: 'task.create',
    level: 1,
    enabled: true,
    inReply: true,
    purpose: 'put a task on the list',
    verbs: ['create'],
  },
  {
    tool: 'draft.create',
    level: 1,
    enabled: true,
    inReply: true,
    purpose: 'write a draft',
    verbs: ['write'],
  },
  {
    tool: 'slack.post',
    level: 2,
    enabled: true,
    inReply: true,
    purpose: 'post in Slack',
    verbs: ['post'],
  },
]
const ROSTER = new Set(['research-director', 'finance-director', 'chief-of-staff'])

const step = (o: Partial<Record<string, unknown>>) => ({
  id: 's1',
  capability: 'db.read',
  why: 'read it',
  needs: [],
  specialist: null,
  ...o,
})

describe('validate — the capability vocabulary is closed', () => {
  it('a capability the office does not have is refused, not improvised', () => {
    /*
      The rule that makes the planner safe to ship. "Something similar" is how
      a plan to READ the diary becomes a plan to write to it.
    */
    const got = validate(
      { goal: 'g', steps: [step({ capability: 'web.search' })] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.how).toBe('fallback')
    expect(got.why).toContain('web.search')
  })

  it('a plausible near-miss is refused too', () => {
    const got = validate(
      { goal: 'g', steps: [step({ capability: 'db.write' })] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.how).toBe('fallback')
  })

  it('CONTROL: a capability the office DOES have is accepted', () => {
    const got = validate({ goal: 'g', steps: [step({})] }, CATALOGUE, ROSTER)
    expect(got.how).toBe('model')
    expect(got.steps).toHaveLength(1)
    expect(got.steps[0]?.capability).toBe('db.read')
  })

  it('one bad step among good ones still falls back, rather than quietly shrinking', () => {
    /*
      Silently dropping the bad step would hand Grant a confident plan that
      does less than it says — #60's defect, which is worse than not planning.
      Here every step is refused so nothing is left, and that is a fallback.
    */
    const got = validate(
      {
        goal: 'g',
        steps: [
          step({ id: 'a', capability: 'nope.nope' }),
          step({ id: 'b', capability: 'also.nope' }),
        ],
      },
      CATALOGUE,
      ROSTER,
    )
    expect(got.how).toBe('fallback')
  })
})

describe('validate — dependencies may only point backwards', () => {
  it('a step depending on a LATER step is refused', () => {
    const got = validate(
      {
        goal: 'g',
        steps: [step({ id: 'a', needs: ['b'] }), step({ id: 'b', capability: 'task.create' })],
      },
      CATALOGUE,
      ROSTER,
    )
    expect(got.steps.map((s) => s.id)).toEqual(['b'])
    expect(got.refused.join(' ')).toContain('does not come before')
  })

  it('a step depending on ITSELF is refused', () => {
    const got = validate({ goal: 'g', steps: [step({ id: 'a', needs: ['a'] })] }, CATALOGUE, ROSTER)
    expect(got.how).toBe('fallback')
  })

  it('a repeated id is refused, because a dependency on it would be ambiguous', () => {
    const got = validate(
      { goal: 'g', steps: [step({ id: 'a' }), step({ id: 'a', capability: 'task.create' })] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.steps).toHaveLength(1)
    expect(got.refused.join(' ')).toContain('repeated id')
  })

  it('CONTROL: a genuine backwards dependency is kept, with its ordering', () => {
    const got = validate(
      {
        goal: 'g',
        steps: [
          step({ id: 'read', capability: 'gmail.search' }),
          step({ id: 'act', capability: 'task.create', needs: ['read'] }),
        ],
      },
      CATALOGUE,
      ROSTER,
    )
    expect(got.how).toBe('model')
    expect(got.steps[1]?.needs).toEqual(['read'])
  })
})

describe('validate — bounds and shape', () => {
  it('a plan longer than the ceiling is refused whole', () => {
    const many = Array.from({ length: 9 }, (_, i) => step({ id: `s${String(i)}` }))
    const got = validate({ goal: 'g', steps: many }, CATALOGUE, ROSTER)
    expect(got.how).toBe('fallback')
    expect(got.why).toContain('9 steps')
  })

  it('an empty plan is a legitimate answer, not a failure', () => {
    /*
      "Thanks, that is all I needed" must produce no work. A validator that
      treated nothing-to-do as a malfunction would make the controls
      unsatisfiable.
    */
    const got = validate({ goal: 'nothing to do', steps: [] }, CATALOGUE, ROSTER)
    expect(got.how).toBe('model')
    expect(got.steps).toHaveLength(0)
  })

  it('unreachable work is carried, not dropped', () => {
    const got = validate(
      { goal: 'g', steps: [], unreachable: ['nothing here can read LinkedIn'] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.how).toBe('model')
    expect(got.unreachable).toEqual(['nothing here can read LinkedIn'])
  })

  it('a garbage shape falls back rather than throwing', () => {
    expect(validate({} as never, CATALOGUE, ROSTER).how).toBe('model')
    expect(validate({ steps: 'not a list' } as never, CATALOGUE, ROSTER).how).toBe('model')
  })
})

describe('validate — the roster is checked, and a bad name is not fatal', () => {
  it('an invented specialist is dropped but the step survives', () => {
    /*
      WHO does the work is a routing preference and `pickRoster` is sovereign
      over it anyway. WHAT the step does is the safety question. Refusing the
      step over a bad name would lose real work to a cosmetic error.
    */
    const got = validate(
      { goal: 'g', steps: [step({ specialist: 'chief-of-vibes' })] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.steps).toHaveLength(1)
    expect(got.steps[0]?.specialist).toBeNull()
    expect(got.refused.join(' ')).toContain('chief-of-vibes')
  })

  it('CONTROL: a real specialist is kept', () => {
    const got = validate(
      { goal: 'g', steps: [step({ specialist: 'finance-director' })] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.steps[0]?.specialist).toBe('finance-director')
  })
})

describe('validate — level 3 can never be proposed', () => {
  it('a level-3 capability is not in the catalogue at all, so naming it is refused', () => {
    /*
      `planningCatalogue` filters `level < 3` in SQL, so the catalogue handed to
      the validator never contains one and the vocabulary rule does the work.
      Asserted here so that widening the catalogue query later fails a test
      rather than quietly making `gmail.send` proposable.
    */
    expect(CATALOGUE.some((c) => c.level >= 3)).toBe(false)
    const got = validate(
      { goal: 'g', steps: [step({ capability: 'gmail.send' })] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.how).toBe('fallback')
    expect(got.why).toContain('gmail.send')
  })
})

/**
 * AUDIENCE IS NOT A DELIVERY CHANNEL (#283).
 *
 * A post-discovery regression, from the held-out run. Asked to *"let the whole
 * cohort know the session has moved"*, the planner proposed `slack.post` —
 * granted, internal, and aimed at people outside the office. The capability
 * was available and the AUDIENCE was not, and nothing in the plan could
 * express the difference. Only the approval policy stood between it and
 * Grant's reputation.
 *
 * The frozen corpus is NOT edited to cover this. It is a separate regression,
 * here, where it can be stated exactly.
 *
 * The model declares the audience and deterministic code uses it in ONE
 * direction: to refuse. Declaring `office` grants nothing — the approval
 * policy still rules at execution — so a model cannot talk its way past the
 * boundary by choosing the comfortable word.
 */
describe('validate — a delivery capability may not reach outside the office', () => {
  const outward = (capability: string) =>
    validate(
      { goal: 'g', steps: [step({ capability, audience: 'outside' })] },
      [
        ...CATALOGUE,
        {
          tool: 'notion.write',
          level: 2,
          enabled: true,
          inReply: true,
          purpose: 'write to Notion',
          verbs: ['write'],
        },
      ],
      ROSTER,
    )

  it('slack.post aimed at outsiders is refused — the cohort case', () => {
    const got = outward('slack.post')
    expect(got.steps).toHaveLength(0)
    expect(got.refused.join(' ')).toContain('outside the office')
  })

  it('and the refusal reaches Grant rather than staying a log line', () => {
    /*
      The office declining something he asked for is news. A refusal he never
      hears about is indistinguishable from the office quietly not bothering.
    */
    expect(outward('slack.post').unreachable.join(' ')).toContain('outside the office')
  })

  it('every outward capability is covered, not just the one that was caught', () => {
    for (const capability of ['slack.post', 'notion.write']) {
      expect(outward(capability).steps, capability).toHaveLength(0)
    }
  })

  it('CONTROL: draft.create for an outside audience is ALLOWED', () => {
    /*
      The whole point of the refusal is that it points somewhere. Preparing
      what would be sent is exactly what the office may do for an outside
      audience, so a guard that also blocked this would leave Grant with
      nothing instead of something to approve.
    */
    const got = validate(
      { goal: 'g', steps: [step({ capability: 'draft.create', audience: 'outside' })] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.steps).toHaveLength(1)
    expect(got.steps[0]?.capability).toBe('draft.create')
  })

  it('CONTROL: slack.post for the OFFICE is allowed — Slack is where the team is', () => {
    const got = validate(
      { goal: 'g', steps: [step({ capability: 'slack.post', audience: 'office' })] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.steps).toHaveLength(1)
  })

  it('CONTROL: a read for an outside audience is untouched', () => {
    /*
      The rule is about DELIVERY, not about who benefits. Reading the mail to
      answer a question about a client is not contacting the client.
    */
    const got = validate(
      { goal: 'g', steps: [step({ capability: 'gmail.search', audience: 'outside' })] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.steps).toHaveLength(1)
  })

  it('an unrecognised audience word is treated as unstated, not as permission', () => {
    /*
      A model returning "everyone" or "" must not thereby escape the check by
      failing to say the forbidden word. Unstated means the guard does not
      fire — the approval policy is still there — but it must never mean the
      guard is satisfied.
    */
    const got = validate(
      { goal: 'g', steps: [step({ capability: 'slack.post', audience: 'everyone' })] },
      CATALOGUE,
      ROSTER,
    )
    expect(got.steps[0]?.audience).toBeNull()
  })
})

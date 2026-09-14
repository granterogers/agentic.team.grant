/**
 * The router (§9).
 *
 * Two of Phase 5's four acceptance sentences land here, and both are about
 * things that must be impossible rather than discouraged: the duplicate query
 * is required, and an ambiguous request must not turn into a team.
 *
 * The scan's SQL is proved against the real database in `scripts/verify/
 * router-live.ts`, not here. A fake executor can only show that rows are
 * mapped; it cannot show that the query matches anything, and the first
 * version of that query could not have — see 0021.
 */
import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.ts'
import {
  NO_DISTINCTIVE_TERMS,
  parsePgTextArray,
  pickRoster,
  ROLE_SLUGS,
  ROSTER_CEILING,
  route,
  scanForDuplicates,
  searchTerms,
} from '../../src/agents/router.ts'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'

/** Answers the coverage probe, then whatever the test queued for the scan. */
const fakeDb = (candidateRows: Record<string, unknown>[] = [], unrouted = 0): SqlExecutor => ({
  kind: 'fake',
  execute: (sql: string): Promise<SqlResult> =>
    Promise.resolve(
      sql.includes('unrouted_live_jobs') ? { rows: [{ n: unrouted }] } : { rows: candidateRows },
    ),
})

describe('searchTerms', () => {
  it('keeps the distinctive words and drops the scaffolding', () => {
    expect(searchTerms('Please can you summarise the pricing research for us')).toEqual([
      'summarise',
      'pricing',
      'research',
    ])
  })

  it('finds the overlap that an idempotency key cannot', () => {
    // The case that motivated the whole design: two instructions asking for
    // the same work in different words derive different idempotency keys, so
    // 0005's unique index cannot collide them.
    const a = new Set(searchTerms('summarise the pricing research'))
    const b = searchTerms('what did we find on pricing')
    expect(b.filter((t) => a.has(t))).toEqual(['pricing'])
  })

  it('deduplicates and caps', () => {
    const terms = searchTerms(
      'pricing pricing pricing ' +
        Array.from({ length: 30 }, (_, i) => `word${String(i)}`).join(' '),
    )
    expect(terms.length).toBeLessThanOrEqual(12)
    expect(new Set(terms).size).toBe(terms.length)
  })
})

describe('the scan is a real query with a stated blind spot', () => {
  it('records a marker rather than fabricating a term when nothing is distinctive', async () => {
    const scan = await scanForDuplicates(fakeDb(), 'ok do it')
    expect(scan.terms).toEqual([NO_DISTINCTIVE_TERMS])
    expect(scan.candidates).toEqual([])
  })

  it('carries how many live jobs it could not see', async () => {
    // `none_found` with 40 invisible jobs is not the same claim as `none_found`
    // with 0, and a caller that cannot tell them apart reads a blind spot as an
    // all-clear.
    const scan = await scanForDuplicates(fakeDb([], 40), 'the pricing research')
    expect(scan.candidates).toEqual([])
    expect(scan.unroutedLiveJobs).toBe(40)
  })

  it('reports which words matched, not a similarity score', async () => {
    const scan = await scanForDuplicates(
      fakeDb([
        {
          job_id: '11111111-1111-4111-8111-111111111111',
          kind: 'research',
          state: 'queued',
          intent_class: 'assignment',
          shared_terms: '{pricing,competitor}',
          matched: 2,
        },
      ]),
      'look at competitor pricing',
    )
    expect(scan.candidates[0]?.sharedTerms).toEqual(['pricing', 'competitor'])
    expect(scan.candidates[0]?.matchedTerms).toBe(2)
  })
})

describe('parsePgTextArray', () => {
  it('handles empty, plain and quoted', () => {
    expect(parsePgTextArray('{}')).toEqual([])
    expect(parsePgTextArray('{pricing,research}')).toEqual(['pricing', 'research'])
    expect(parsePgTextArray('{"no distinctive terms",pricing}')).toEqual([
      'no distinctive terms',
      'pricing',
    ])
  })
})

describe('§9: trivial work spawns no subagents', () => {
  it.each([
    ['What is the status of the migration?', 'question'],
    ['Random thought, the onboarding feels long', 'thought'],
  ])('convenes nobody for %s', (text) => {
    expect(pickRoster(classifyIntent(text), text).roster).toEqual([])
  })

  it('gives a reason even when the roster is empty, because that is a decision', () => {
    const r = pickRoster(classifyIntent('What is the status?'), 'What is the status?')
    expect(r.reason.length).toBeGreaterThanOrEqual(10)
  })
})

describe('#230: a question may reach a specialist, but the subject has to earn it', () => {
  /*
    The defect this closes. `ROSTER_CEILINGS.question` was `[]`, so a question
    could never convene anybody — and `question` is 237 of the 505 routing
    decisions this office has ever made. Five of the eight people here had never
    been selected once, and verify:roster proved it: eight instructions each
    written for one specific person, and every one went to the Chief of Staff.
  */
  it.each([
    [
      'finance-director',
      'What does a fifteen percent cut to the middle tier do to our gross margin?',
    ],
    ['growth-director', 'What is our best campaign audience at the moment?'],
    ['operations-director', 'Where is the bottleneck in our onboarding process?'],
    ['communications-director', 'What wording would you use for the announcement email?'],
  ])('reaches %s when the question is plainly about their subject', (who, text) => {
    const c = classifyIntent(text)
    expect(c.intent).toBe('question')
    /*
      Asserted, because the contested branch would produce an empty roster for a
      different and legitimate reason. The first draft used *"which acquisition
      channel is bringing us the best audience"*, which `classifyIntent` reads
      as "question or direct_command" — so it convened nobody CORRECTLY, and the
      test failure looked like the fix not working.
    */
    expect(c.confident).toBe(true)
    expect(pickRoster(c, text).roster).toContain(who)
  })

  /*
    The PRODUCTION path, which is not the one above.

    `pickRoster` falls back to this file's regexes only when `topical` is
    omitted. In the office it is always supplied, from `app.who_knows_about`
    reading `staff.expertise` — the column Grant edits (#65, 0201). A test that
    only exercised the fallback would be checking a path the product does not
    take, which is CLAUDE.md's most repeated trap.

    Grace is why it matters: she has NO pattern in `TOPIC_ROLES` at all, so
    reaching her depends entirely on her stored expertise.
  */
  it('reaches a specialist the hardcoded fallback cannot name, via stored expertise', () => {
    const text = 'What could go wrong if we ship this on a Friday?'
    const c = classifyIntent(text)
    expect(c.intent).toBe('question')
    expect(pickRoster(c, text, ['quality-director']).roster).toEqual(['quality-director'])
  })

  /*
    CONTROL, and the half that keeps the change safe.

    The old comment — "answering from what we already hold is retrieval, not a
    meeting" — was right about THIS kind of question, and it must keep being
    right. Without `TOPIC_ONLY` the widened ceiling would hand every status
    question to whoever is first in the list, which is a worse bug than the one
    being fixed and would show up as cost on the commonest message Grant sends.
  */
  it.each([
    'What is the status of the migration?',
    'Do we have anything on record about that?',
    'What time did it finish?',
  ])('still convenes nobody for a question that names no subject: %s', (text) => {
    expect(pickRoster(classifyIntent(text), text).roster).toEqual([])
  })

  it('convenes nobody when the reading is contested AND no subject is named', () => {
    /*
      `ceiling[0]` used to be taken here. With `question` opened from [] to seven
      roles that line would have handed every ambiguous question to the finance
      director purely for being first in the list. §6 resolves ambiguity
      downward and the floor for a question with no subject is the Chief of
      Staff.
    */
    const text = 'What is the status of that thing?'
    const contested = { ...classifyIntent(text), confident: false }
    const r = pickRoster(contested, text)
    expect(r.roster).toEqual([])
    expect(r.reason).toContain('Chief of Staff')
  })

  it('convenes exactly one when the reading is contested but the subject is not', () => {
    /*
      #232. The half the rule above used to get wrong.

      An uncertain READING is not an uncertain SUBJECT. This sentence is
      unmistakably a question for the finance director and reads as both a
      question and a discussion, so the old rule sent it to Claire for being
      AMBIGUOUS rather than for being unclear — and `verify:routing-breadth`
      measured what that costs across the corpus. One person, never a team,
      which is also the shape `routing_decisions_unconfident_stays_small`
      requires of the recorded row.
    */
    const text = 'What does a fifteen percent cut to the middle tier do to our gross margin?'
    const contested = { ...classifyIntent(text), confident: false }
    const r = pickRoster(contested, text, ['finance-director'])
    expect(r.roster).toEqual(['finance-director'])
    expect(r.reason).toContain('contested')
  })

  it('takes the intersection rather than the whole widened ceiling', () => {
    // Seven roles are now permitted for a question. A question about one
    // subject must still convene one person, not a committee of seven.
    const text = 'What are our competitor prices?'
    const c = classifyIntent(text)
    expect(c.intent).toBe('question')
    const { roster } = pickRoster(c, text)
    expect(roster).toContain('research-director')
    expect(roster.length).toBeLessThanOrEqual(ROSTER_CEILING)
    expect(roster).not.toContain('operations-director')
  })
})

describe('the roster is an intersection, not a union', () => {
  it('takes only the roles the request is actually about', () => {
    const text = 'I need you to compare competitor pricing and model the margin impact'
    const c = classifyIntent(text)
    expect(c.intent).toBe('assignment')
    const { roster } = pickRoster(c, text)
    /*
      Research and finance are both genuinely named by this sentence and both
      are now permitted for an assignment — #232 widened these ceilings after
      measuring what a ceiling that predates half the roster costs: *"Draft the
      announcement email"* named the communications director, was refused by
      the table, and went to research instead.

      What must still hold is that the roster is an INTERSECTION. Quality and
      operations have nothing to do with competitor pricing and a union of
      ceiling and subject would have pulled the whole class in.
    */
    expect(roster).toContain('research-director')
    expect(roster).not.toContain('quality-director')
    expect(roster).not.toContain('operations-director')
  })

  it('falls back to one role, not the whole ceiling, when no subject is named', () => {
    const text = 'I need you to handle it'
    const { roster } = pickRoster(classifyIntent(text), text)
    expect(roster).toHaveLength(1)
  })

  it('never exceeds the ceiling the database enforces', () => {
    const text =
      'I need you to research the competitor pricing, draft the announcement copy, ' +
      'plan the rollout schedule and model the revenue impact'
    expect(pickRoster(classifyIntent(text), text).roster.length).toBeLessThanOrEqual(ROSTER_CEILING)
  })

  it('names only seeded roles', () => {
    const text = 'I need you to research the competitor pricing and plan the rollout schedule'
    for (const slug of pickRoster(classifyIntent(text), text).roster) {
      expect(ROLE_SLUGS).toContain(slug)
    }
  })
})

describe('ambiguity never becomes a workload', () => {
  it('convenes at most one specialist on a contested reading', async () => {
    // Mirrors `routing_decisions_unconfident_stays_small`. The type system and
    // the schema disagree about nothing here, which is the point.
    const text = 'Maybe we should look into the competitor pricing'
    const c = classifyIntent(text)
    expect(c.confident).toBe(false)
    expect(pickRoster(c, text).roster.length).toBeLessThanOrEqual(1)
  })

  it('convenes nobody at all when the answer is to ask', async () => {
    // Written first as `if (d.clarificationNeeded) ... else ...`, which passed
    // whichever branch ran and so asserted nothing. The reading here is
    // contested between suggestion and light_investigation, the dearer of
    // which would do substantive work, so clarification is required and the
    // roster is empty. Both are asserted outright.
    const text = 'Maybe we should look into the competitor pricing'
    const d = route(text, await scanForDuplicates(fakeDb(), text))
    expect(d.clarificationNeeded).toBe(true)
    expect(d.roster).toEqual([])
    expect(d.rosterReason).toMatch(/ask/)
  })
})

describe('the duplicate resolution', () => {
  const withCandidate = () =>
    fakeDb([
      {
        job_id: '22222222-2222-4222-8222-222222222222',
        kind: 'research',
        state: 'running',
        intent_class: 'assignment',
        shared_terms: '{pricing}',
        matched: 1,
      },
    ])

  it('is none_found when the scan came back empty', async () => {
    const text = 'I need you to research the pricing'
    expect(route(text, await scanForDuplicates(fakeDb(), text)).resolution).toBe('none_found')
  })

  it('links rather than duplicates when the caller says so', async () => {
    const text = 'I need you to research the pricing'
    const d = route(text, await scanForDuplicates(withCandidate(), text), {
      linkTo: '22222222-2222-4222-8222-222222222222',
    })
    expect(d.resolution).toBe('linked_to_existing')
    expect(d.linkedJobId).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('proceeds only with a justification long enough for the constraint', async () => {
    // `routing_decisions_distinct_is_argued` requires 20 characters. A default
    // that is one character short would fail at insert time, in production,
    // on the branch that only runs when a near-duplicate exists.
    const text = 'I need you to research the pricing'
    const d = route(text, await scanForDuplicates(withCandidate(), text))
    expect(d.resolution).toBe('proceeded_distinct')
    expect((d.distinctJustification ?? '').trim().length).toBeGreaterThanOrEqual(20)
  })

  it('says in the default justification that no reason was given', async () => {
    const text = 'I need you to research the pricing'
    const d = route(text, await scanForDuplicates(withCandidate(), text))
    expect(d.distinctJustification).toMatch(/no caller justification/)
  })
})

describe('#232: text no rule understood, whose subject is clear', () => {
  /*
    `classifyIntent` falls back to `thought` for anything its regexes do not
    cover and `thought` convenes nobody, so a correctly identified specialist
    was discarded before the subject was ever consulted. Measured over the
    91-case corpus in `verify:routing-breadth`, every phrasing that describes a
    subject without naming it scored 0%.
  */
  it('reaches one specialist when the subject is named', () => {
    const text = 'Run the numbers if we sell it cheaper.'
    const c = classifyIntent(text)
    expect(c.recognised).toBe(false)
    const r = pickRoster(c, text, ['finance-director'])
    expect(r.roster).toEqual(['finance-director'])
    expect(r.reason).toContain('no intent rule matched')
  })

  it('never convenes more than one, however many the subject names', () => {
    // An unrecognised request is not evidence that a team is needed, and the
    // row it produces is unconfident — `routing_decisions_unconfident_stays_small`
    // permits exactly one.
    const text = 'Run the numbers if we sell it cheaper.'
    const r = pickRoster(classifyIntent(text), text, [
      'finance-director',
      'growth-director',
      'strategy-director',
    ])
    expect(r.roster).toHaveLength(1)
  })

  it('still convenes nobody when nothing names a subject', () => {
    const text = 'Sort that out for me when you get a chance.'
    const r = pickRoster(classifyIntent(text), text, [])
    expect(r.roster).toEqual([])
    expect(r.reason).toContain('Chief of Staff')
  })

  it('respects who is on the project', () => {
    // Grant can take a specialist off a project in Settings, and this branch
    // must not be the one place that ignores it (#36, migration 0323).
    const text = 'Run the numbers if we sell it cheaper.'
    const r = pickRoster(classifyIntent(text), text, ['finance-director'], ['research-director'])
    expect(r.roster).toEqual([])
  })

  it('leaves a DELIBERATE remark convening nobody', () => {
    /*
      The distinction that makes the branch safe. §9 is about a remark Grant
      chose to make, not about text the classifier failed to parse, and
      `recognised` is what separates them.
    */
    const text = 'fyi the pricing page went live this morning'
    const c = classifyIntent(text)
    expect(c.intent).toBe('thought')
    expect(c.recognised).toBe(true)
    expect(pickRoster(c, text, ['finance-director']).roster).toEqual([])
  })
})

describe('#232: the communications director can be reached at all', () => {
  /*
    `direct_command`'s ceiling was research, strategy and operations, so
    drafting — which is the one thing a communications director exists for —
    could not reach them. Six of the corpus's eleven communications cases went
    to the research director, which is worse than going to Claire: the wrong
    specialist answers confidently.
  */
  it('routes a drafting command to communications when the subject says so', () => {
    const text = 'Draft the announcement email for the pricing change.'
    const { roster } = pickRoster(classifyIntent(text), text, ['communications-director'])
    expect(roster).toContain('communications-director')
  })

  it('leaves the fallback for an unnamed subject where it was', () => {
    // The first entry of each widened ceiling is unchanged, because that is
    // what an unclassifiable request of the class still falls back to.
    const text = 'I need you to handle it'
    const { roster } = pickRoster(classifyIntent(text), text, [])
    expect(roster).toEqual(['research-director'])
  })
})

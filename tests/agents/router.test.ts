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

describe('the roster is an intersection, not a union', () => {
  it('takes only the ceiling roles the request is actually about', () => {
    const text = 'I need you to compare competitor pricing and model the margin impact'
    const c = classifyIntent(text)
    expect(c.intent).toBe('assignment')
    const { roster } = pickRoster(c, text)
    // finance matches the topic but is NOT in assignment's ceiling, so a union
    // would have pulled it in. The intersection must not.
    expect(roster).toContain('research-director')
    expect(roster).not.toContain('finance-director')
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

/**
 * Briefings (§12).
 *
 * The properties worth testing are not about prose. They are: the right day,
 * the right order, and never twice.
 */
import { describe, expect, it } from 'vitest'
import type { BriefingInputs } from '../../src/briefings/compose.ts'
import { compose, localDate } from '../../src/briefings/compose.ts'

const empty: BriefingInputs = {
  openBlockers: 0,
  overdueBlockers: 0,
  liveJobs: 0,
  waitingOnGrant: 0,
  stalledJobs: 0,
  failedJobs24h: 0,
  completed24h: 0,
  projectsNeedingAttention: [],
  staleBriefs: [],
}

describe('which day the briefing is for', () => {
  it('uses the local day, not the UTC one', () => {
    // 23:40 UTC is already tomorrow in Sydney. A briefing generated then and
    // dated by the server clock is dated yesterday for the person reading it -
    // the exact hours a briefing is sent are the hours this goes wrong.
    const late = new Date('2026-09-04T23:40:00Z')
    expect(localDate(late, 'UTC')).toBe('2026-09-04')
    expect(localDate(late, 'Australia/Sydney')).toBe('2026-09-05')
  })

  it('handles the other direction too', () => {
    const early = new Date('2026-09-04T02:00:00Z')
    expect(localDate(early, 'America/Los_Angeles')).toBe('2026-09-03')
  })
})

describe('what a quiet day reads like', () => {
  it('says so plainly rather than padding', () => {
    const body = compose('morning', '2026-09-04', empty)
    expect(body).toContain('Nothing needs you this morning.')
    expect(body).toContain('No work is in flight.')
    expect(body).not.toMatch(/failed|Worth a look/)
  })

  it('carries its date in the text, not only in the row', () => {
    // A forwarded or screenshotted briefing loses its row.
    expect(compose('morning', '2026-09-04', empty)).toContain('2026-09-04')
  })
})

describe('ordering: what needs Grant comes first', () => {
  it('opens with blockers even when plenty else is happening', () => {
    const body = compose('morning', '2026-09-04', {
      ...empty,
      openBlockers: 3,
      overdueBlockers: 1,
      liveJobs: 9,
      failedJobs24h: 2,
      projectsNeedingAttention: ['Pricing Research'],
    })
    const lines = body.split('\n').filter((l) => l.trim() !== '')
    // Line 0 is the header.
    expect(lines[1]).toContain('3 things need you, 1 overdue.')
    expect(body.indexOf('need you')).toBeLessThan(body.indexOf('failed'))
    expect(body.indexOf('need you')).toBeLessThan(body.indexOf('Worth a look'))
  })

  it('gets singular and plural right, because "1 things need you" reads as broken', () => {
    expect(compose('morning', '2026-09-04', { ...empty, openBlockers: 1 })).toContain(
      '1 thing needs you.',
    )
    expect(compose('morning', '2026-09-04', { ...empty, liveJobs: 1 })).toContain(
      '1 job is in flight.',
    )
    expect(compose('morning', '2026-09-04', { ...empty, liveJobs: 2 })).toContain(
      '2 jobs are in flight.',
    )
  })

  it('mentions overdue only when something is overdue', () => {
    expect(compose('morning', '2026-09-04', { ...empty, openBlockers: 2 })).not.toContain('overdue')
  })
})

describe('morning and evening differ', () => {
  it('only the evening reports what completed', () => {
    const inputs = { ...empty, completed24h: 4 }
    expect(compose('evening', '2026-09-04', inputs)).toContain('4 jobs completed today.')
    expect(compose('morning', '2026-09-04', inputs)).not.toContain('completed today')
  })

  it('the evening says so when nothing completed', () => {
    expect(compose('evening', '2026-09-04', empty)).toContain('Nothing completed today.')
  })
})

describe('stalled work is surfaced, because §6 says it must not look stuck', () => {
  it('names the count alongside the in-flight figure', () => {
    const body = compose('morning', '2026-09-04', { ...empty, liveJobs: 5, stalledJobs: 2 })
    expect(body).toContain('5 jobs are in flight.')
    expect(body).toContain('2 have not changed state in over an hour.')
  })

  it('says nothing about staleness when nothing is stale', () => {
    expect(compose('morning', '2026-09-04', { ...empty, liveJobs: 5 })).not.toContain(
      'changed state',
    )
  })
})

describe('the briefing makes no claims a model would have to back up', () => {
  it('contains only counts and names', () => {
    const body = compose('evening', '2026-09-04', {
      ...empty,
      openBlockers: 2,
      liveJobs: 3,
      completed24h: 1,
      projectsNeedingAttention: ['Pricing Research'],
      staleBriefs: ['Onboarding'],
    })
    // No hedging, no interpretation, nothing that would need review under §16.
    expect(body).not.toMatch(/\b(seems|appears|likely|probably|suggests|I think|may be)\b/i)
  })
})

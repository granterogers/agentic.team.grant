/**
 * What the briefing says about how long he has been waited on (#272, 0469).
 *
 * `app.needs_me_pressure` had no caller at all — one of the fifteen in
 * `check:callers`' baseline. It answers two things the briefing could not:
 *
 *   * `needs_me` is CAPPED, so a sixth and seventh request are simply absent.
 *     Being told about four of nine reads exactly like there being four.
 *   * "past a real deadline" counts only requests with a deadline, so
 *     something nobody dated ages invisibly and is never late.
 *
 * Both clauses are conditional, and the tests below are mostly about the
 * conditions: a line that appears every morning saying nothing is held back is
 * a line he stops reading, which is the same argument as the hourly sync that
 * only speaks when something moved.
 */

import { describe, expect, it } from 'vitest'
import type { Facts } from '../../src/handlers/briefing.ts'
import { briefingLines } from '../../src/handlers/briefing.ts'

const facts = (over: Partial<Facts> = {}): Facts => ({
  for_date: '2026-09-17',
  timezone: 'Europe/Athens',
  waiting_on_you: [
    {
      what: 'Approve the supplier change',
      why: 'it needs a person',
      project: null,
      overdue: false,
      deadline: null,
      if_delayed: null,
      work_continues: true,
    },
  ],
  overnight: { finished: 0, failed: 0, still_going: 0 },
  stuck: [],
  diary: [],
  noticed: [],
  wanted: [],
  ...over,
})

const first = (f: Facts): string => briefingLines(f)[0] ?? ''

describe('#272 — the briefing says what the cap is hiding', () => {
  it('says how many it is holding back when the cap is suppressing some', () => {
    const line = first(
      facts({ pressure: { open_items: 9, cap: 7, suppressed: 2, oldest_days: 1 } }),
    )
    expect(line).toMatch(/holding back/)
    expect(line).toContain('2')
  })

  it('says NOTHING about holding back when the cap is not biting', () => {
    // The condition is the feature. A morning line that always appears is one
    // he stops reading, and then it is not there when it matters.
    const line = first(
      facts({ pressure: { open_items: 3, cap: 7, suppressed: 0, oldest_days: 1 } }),
    )
    expect(line).not.toMatch(/holding back/)
  })

  it('says how long the oldest has waited once it has been a week', () => {
    const line = first(
      facts({ pressure: { open_items: 5, cap: 7, suppressed: 0, oldest_days: 8.3 } }),
    )
    expect(line).toMatch(/oldest has been waiting 8 days/)
  })

  it('and says nothing about age before then, because two days is not waiting', () => {
    const line = first(
      facts({ pressure: { open_items: 5, cap: 7, suppressed: 0, oldest_days: 2.9 } }),
    )
    expect(line).not.toMatch(/oldest/)
  })

  it('rounds DOWN, so it never overstates how long he has left something', () => {
    // 8.9 days is "8 days", not "9". The number is about his conscience and
    // rounding it up would be the office being dramatic with his own data.
    const line = first(
      facts({ pressure: { open_items: 5, cap: 7, suppressed: 0, oldest_days: 8.9 } }),
    )
    expect(line).toContain('8 days')
    expect(line).not.toContain('9 days')
  })

  it('survives a payload from before 0469, which has no pressure at all', () => {
    /*
      An older briefing row has no such key. A handler that threw on it would
      lose the whole briefing for the sake of an addition — the clause is worth
      having and it is not worth the message.
    */
    const line = first(facts())
    expect(line).toMatch(/waiting on you/)
    expect(line).not.toMatch(/holding back|oldest/)
  })

  it('keeps the deadline clause it already had, and adds to it rather than replacing it', () => {
    const line = first(
      facts({
        waiting_on_you: [
          {
            what: 'A',
            why: 'w',
            project: null,
            overdue: true,
            deadline: '2026-09-10',
            if_delayed: null,
            work_continues: true,
          },
        ],
        pressure: { open_items: 9, cap: 7, suppressed: 2, oldest_days: 12 },
      }),
    )
    expect(line).toMatch(/past a real deadline/)
    expect(line).toMatch(/holding back/)
    expect(line).toMatch(/oldest/)
  })
})

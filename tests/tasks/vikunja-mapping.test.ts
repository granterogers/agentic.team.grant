/**
 * The two scales and the two sentinels (#259, Phase 2).
 *
 * These are the four functions that can corrupt Grant's list silently. A wrong
 * URL fails loudly on the first call; a priority mapped the wrong way round
 * turns every urgent task into "whenever" and says nothing, and Vikunja's zero
 * date read as a real one files tasks in the year 1.
 *
 * Pure, so they cost milliseconds and run in the normal test pass — the live
 * suite proves the wiring, and this proves the arithmetic.
 */
import { describe, expect, it } from 'vitest'
import { dueIn, dueOut, priorityIn, priorityOut, readTask } from '../../src/tasks/vikunja.ts'

describe('the priority scales run in opposite directions', () => {
  it('maps the office onto Vikunja without inverting it', () => {
    // 10 is the hottest here and 4 is the hottest there.
    expect(priorityOut(10)).toBe(4)
    expect(priorityOut(20)).toBe(3)
    expect(priorityOut(50)).toBe(2)
    expect(priorityOut(100)).toBe(1)
  })

  it('and is MONOTONIC, which is the property a table can get wrong', () => {
    // The real defect a hand-written table produces is one row out of order,
    // and every individual assertion above still passes when that happens.
    const ladder = [10, 20, 50, 100].map(priorityOut)
    expect(ladder).toEqual([...ladder].sort((a, b) => b - a))
  })

  it('round trips', () => {
    for (const p of [10, 20, 50, 100]) expect(priorityIn(priorityOut(p))).toBe(p)
  })

  it('treats Vikunja 0 as "nobody said", never as "lowest"', () => {
    // Mapping 0 to 100 would demote every urgent task the first time the
    // provider reported one back without a priority.
    expect(priorityIn(0)).toBeNull()
    expect(priorityIn(null)).toBeNull()
  })

  it('and an unset canonical priority is not invented', () => {
    expect(priorityOut(null)).toBe(0)
  })

  it('CONTROL: an unfamiliar value lands on the nearest rung, not on nothing', () => {
    expect(priorityOut(15)).toBe(4)
    expect(priorityIn(5)).toBe(10)
  })
})

describe("Vikunja's zero date is not a date", () => {
  it('reads as no due date at all', () => {
    expect(dueIn('0001-01-01T00:00:00Z')).toBeNull()
    expect(dueIn('0001-01-01T00:00:00.000000Z')).toBeNull()
    expect(dueIn('')).toBeNull()
    expect(dueIn(undefined)).toBeNull()
  })

  it('and is what the office writes when there is no date', () => {
    expect(dueOut(null)).toBe('0001-01-01T00:00:00Z')
    expect(dueOut('')).toBe('0001-01-01T00:00:00Z')
  })

  it('a real date round trips as the same DAY', () => {
    expect(dueOut('2026-09-25')).toBe('2026-09-25T00:00:00Z')
    expect(dueIn(dueOut('2026-09-25'))).toBe('2026-09-25')
  })

  it('a time set at the provider keeps the day and loses the time, on purpose', () => {
    // The stated mismatch policy. Losing a time the office has nowhere to put
    // beats inventing a due_on a day either side of it.
    expect(dueIn('2026-09-25T18:30:00Z')).toBe('2026-09-25')
    expect(dueIn('2026-09-25T23:59:59Z')).toBe('2026-09-25')
  })

  it('CONTROL: nonsense is refused rather than turned into a date', () => {
    expect(dueIn('not a date')).toBeNull()
  })
})

describe('reading one task the provider reported', () => {
  it('takes the tags out of the description', () => {
    // Vikunja's editor writes HTML. Stored raw, it renders as literal angle
    // brackets on Grant's phone.
    const t = readTask({ id: 7, description: '<p>ring the <b>venue</b></p>', updated: 'u' })
    expect(t.detail).toBe('ring the venue')
  })

  it('carries the provider revision as text and never parses it', () => {
    const t = readTask({ id: 7, updated: '2026-09-20T05:22:06Z' })
    expect(t.externalRevision).toBe('2026-09-20T05:22:06Z')
    expect(typeof t.externalRevision).toBe('string')
  })

  it('and a task with nothing set comes back with nothing invented', () => {
    const t = readTask({ id: 9 })
    expect(t).toMatchObject({ externalId: '9', title: '', detail: '', done: false })
    expect(t.dueOn).toBeNull()
    expect(t.priority).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  composeNotice,
  daysToLimit,
  type Level,
  levelFor,
  type Reading,
  ratePerDay,
  rawLevel,
  type Sample,
  topicFor,
} from '../../src/ops/capacity.ts'

const MB = 1_000_000
const s = (day: string, mbs: number): Sample => ({ day, bytes: mbs * MB })

describe('rawLevel: the three lines', () => {
  it('is silent below 70 and raises exactly at each line (a guard that never fires fails here)', () => {
    expect(rawLevel(0)).toBe(0)
    expect(rawLevel(69.99)).toBe(0)
    expect(rawLevel(70)).toBe(1)
    expect(rawLevel(84.99)).toBe(1)
    expect(rawLevel(85)).toBe(2)
    expect(rawLevel(94.99)).toBe(2)
    expect(rawLevel(95)).toBe(3)
    expect(rawLevel(140)).toBe(3)
  })
})

describe('levelFor: crossing with hysteresis', () => {
  it('goes up at once and may skip a level', () => {
    expect(levelFor(71, 0)).toBe(1)
    expect(levelFor(96, 0)).toBe(3)
    expect(levelFor(86, 1)).toBe(2)
  })

  it('does not flap around a line: a level is held until usage is three points below it', () => {
    expect(levelFor(84, 2)).toBe(2)
    expect(levelFor(82.01, 2)).toBe(2)
    expect(levelFor(81.99, 2)).toBe(1)
    expect(levelFor(66.99, 1)).toBe(0)
    expect(levelFor(67, 1)).toBe(1)
    // walking a noisy series across 85 announces one crossing, not six
    const series = [84.9, 85.1, 84.8, 85.2, 84.7, 85.3, 84.9]
    let level: Level = 1
    const changes: Level[] = []
    for (const p of series) {
      const next = levelFor(p, level)
      if (next !== level) changes.push(next)
      level = next
    }
    expect(changes).toEqual([2])
  })

  it('falls only one held band at a time and never below what the number itself reaches', () => {
    expect(levelFor(50, 3)).toBe(0)
    expect(levelFor(90, 3)).toBe(2)
    expect(levelFor(93, 3)).toBe(3)
    expect(levelFor(80, 0)).toBe(1)
  })
})

describe('ratePerDay: the fastest recent window', () => {
  it('is null with no span to measure, and with nothing growing', () => {
    expect(ratePerDay([])).toBeNull()
    expect(ratePerDay([s('2026-10-05', 372)])).toBeNull()
    expect(ratePerDay([s('2026-10-04', 372), s('2026-10-05', 372)])).toBeNull()
    expect(ratePerDay([s('2026-10-04', 380), s('2026-10-05', 372)])).toBeNull()
  })

  it('takes the maximum across windows, so a quiet last week does not erase a bad month', () => {
    // 28 days ago 100 MB, 7 days ago 380, now 382: 7-day rate is tiny, the 28-day rate is not
    const samples = [s('2026-09-07', 100), s('2026-09-28', 380), s('2026-10-05', 382)]
    const r = ratePerDay(samples) as number
    expect(r / MB).toBeCloseTo((382 - 100) / 28, 5)
  })

  it('uses the real elapsed days when a window has a gap, and the last reading of a day wins', () => {
    const r = ratePerDay([
      s('2026-10-01', 300),
      s('2026-10-05', 340),
      s('2026-10-05', 344),
    ]) as number
    expect(r / MB).toBeCloseTo((344 - 300) / 4, 5)
  })

  it('does not depend on the order samples arrive in', () => {
    const a = [s('2026-10-03', 329), s('2026-10-04', 346), s('2026-10-05', 372)]
    expect(ratePerDay([...a].reverse())).toBe(ratePerDay(a))
  })
})

describe('daysToLimit', () => {
  it('projects at the recorded 4 to 5 October rate, and is zero at or past the line', () => {
    const d = daysToLimit([s('2026-10-04', 346), s('2026-10-05', 372)], 500 * MB) as number
    expect(d).toBe(Math.floor(128 / 26))
    expect(daysToLimit([s('2026-10-04', 499), s('2026-10-05', 500)], 500 * MB)).toBe(0)
    expect(daysToLimit([s('2026-10-05', 501)], 500 * MB)).toBe(0)
  })

  it('is null for a flat or shrinking series and for no data (never a made-up date)', () => {
    expect(daysToLimit([], 500 * MB)).toBeNull()
    expect(daysToLimit([s('2026-10-04', 372), s('2026-10-05', 372)], 500 * MB)).toBeNull()
  })
})

describe('the notice is composed in code', () => {
  const db = (level: Level, bytes = 372 * MB): Reading => ({
    scope: 'database',
    bytes,
    limitBytes: 500 * MB,
    level,
    daysToLimit: 4,
    largest: [
      { table: 'public.jobs', bytes: 108 * MB },
      { table: 'public.job_state_transitions', bytes: 38 * MB },
    ],
  })
  const st = (level: Level): Reading => ({
    scope: 'storage',
    bytes: 800 * MB,
    limitBytes: 1000 * MB,
    level,
    daysToLimit: null,
  })

  it('says nothing when nothing is at a warning level', () => {
    expect(composeNotice([db(0), st(0)])).toBeNull()
  })

  it('names the resource, the figures, the projection and the biggest tables', () => {
    const text = composeNotice([db(1), st(0)]) as string
    expect(text).toContain('The database is 372 MB of 500 MB (74%)')
    expect(text).toContain('about 4 days')
    expect(text).toContain('public.jobs (108 MB)')
    expect(text).not.toContain('File storage')
    expect(text).toContain('Nothing has been deleted')
  })

  it('escalates its wording at level 3 and orders the worst first', () => {
    const text = composeNotice([db(1), st(3)]) as string
    expect(text.startsWith('Capacity needs a decision today.')).toBe(true)
    expect(text.indexOf('File storage')).toBeLessThan(text.indexOf('The database'))
    expect(text).toContain('It is not growing at the moment.')
  })

  it('has a topic that changes on a crossing in either direction and on nothing else', () => {
    expect(topicFor([db(1), st(0)])).toBe(topicFor([db(1, 390 * MB), st(0)]))
    expect(topicFor([db(1), st(0)])).not.toBe(topicFor([db(2), st(0)]))
    expect(topicFor([db(1), st(0)])).not.toBe(topicFor([db(1), st(1)]))
    expect(topicFor([db(2), st(0)])).not.toBe(topicFor([db(1), st(0)]))
  })
})

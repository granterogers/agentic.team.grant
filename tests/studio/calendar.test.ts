/**
 * The project calendar's pure parts: dates, event normalisation, overlap lanes
 * and the three sizes. The pointer and layout behaviour is in
 * scripts/verify/calendar.ts; what is here is what is decidable from values.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as C from '../../web/studio/bc/calendar.js'

describe('dates', () => {
  it('weeks start on Monday', () => {
    expect(C.weekStart('2026-10-04')).toBe('2026-09-28') // a Sunday belongs to the week before
    expect(C.weekStart('2026-10-05')).toBe('2026-10-05')
    expect(C.weekStart('2026-10-07')).toBe('2026-10-05')
  })
  it('adds days across month and year ends', () => {
    expect(C.addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(C.addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('adds months without overflowing into the next one', () => {
    expect(C.addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(C.addMonths('2026-10-15', -10)).toBe('2025-12-15')
  })
})

describe('normalising an event', () => {
  it('reads an all-day event by its date, never shifted by the time zone', () => {
    const e = C.norm({
      id: 'a',
      title: 'Launch',
      all_day: true,
      starts_at: '2026-10-10T00:00:00.000Z',
      ends_at: '2026-10-13T00:00:00.000Z',
    })
    expect(e.startDay).toBe('2026-10-10')
    expect(e.endDay).toBe('2026-10-12') // the end is exclusive, as Google sends it
  })
  it('a one-day all-day event starts and ends on one day', () => {
    const e = C.norm({
      id: 'a',
      all_day: true,
      starts_at: '2026-10-10T00:00:00.000Z',
      ends_at: '2026-10-11T00:00:00.000Z',
    })
    expect([e.startDay, e.endDay]).toEqual(['2026-10-10', '2026-10-10'])
  })
  it('gives a zero-length timed event a visible length', () => {
    const t = new Date(2026, 9, 6, 10, 0).toISOString()
    const e = C.norm({ id: 'a', all_day: false, starts_at: t, ends_at: t })
    expect(e.endMin).toBeGreaterThan(e.startMin)
  })
  it('only the office may edit what the office owns: Google events are read-only here', () => {
    expect(
      C.norm({
        id: 'g:x:y',
        source: 'google',
        starts_at: '2026-10-10T09:00:00Z',
        ends_at: '2026-10-10T10:00:00Z',
      }).editable,
    ).toBe(false)
    expect(
      C.norm({
        id: 'n',
        source: 'team_hq',
        starts_at: '2026-10-10T09:00:00Z',
        ends_at: '2026-10-10T10:00:00Z',
      }).editable,
    ).toBe(true)
  })
})

describe('what is on a day', () => {
  const list = [
    C.norm({
      id: '1',
      title: 'B',
      all_day: false,
      starts_at: new Date(2026, 9, 6, 11).toISOString(),
      ends_at: new Date(2026, 9, 6, 12).toISOString(),
    }),
    C.norm({
      id: '2',
      title: 'A',
      all_day: true,
      starts_at: '2026-10-06T00:00:00Z',
      ends_at: '2026-10-07T00:00:00Z',
    }),
    C.norm({
      id: '3',
      title: 'C',
      all_day: false,
      starts_at: new Date(2026, 9, 6, 9).toISOString(),
      ends_at: new Date(2026, 9, 6, 10).toISOString(),
    }),
    C.norm({
      id: '4',
      title: 'D',
      all_day: false,
      starts_at: new Date(2026, 9, 7, 9).toISOString(),
      ends_at: new Date(2026, 9, 7, 10).toISOString(),
    }),
  ]
  it('puts all-day first, then by start time, and nothing from another day', () => {
    expect(C.onDay(list, '2026-10-06').map((e: { id: string }) => e.id)).toEqual(['2', '3', '1'])
  })
  it('a multi-day event appears on every day it covers', () => {
    const w = C.norm({
      id: 'w',
      all_day: true,
      starts_at: '2026-10-10T00:00:00Z',
      ends_at: '2026-10-13T00:00:00Z',
    })
    expect([10, 11, 12, 13].map((d) => C.onDay([w], `2026-10-${String(d)}`).length)).toEqual([
      1, 1, 1, 0,
    ])
  })
})

describe('overlapping events', () => {
  it('sit side by side', () => {
    const out = C.lanes([
      { sMin: 600, eMin: 660, k: 'a' },
      { sMin: 630, eMin: 690, k: 'b' },
      { sMin: 700, eMin: 760, k: 'c' },
    ])
    const by = (k: string) => out.find((o: { k: string }) => o.k === k)
    expect(by('a').lane).not.toBe(by('b').lane)
    expect(by('a').width).toBe(2)
    expect(by('c').width).toBe(1)
  })
  it('never put two overlapping events in one lane', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      sMin: 600 + i * 10,
      eMin: 700 + i * 5,
      k: String(i),
    }))
    const out = C.lanes(items)
    for (const a of out)
      for (const b of out)
        if (a !== b && a.sMin < b.eMin && b.sMin < a.eMin) expect(a.lane).not.toBe(b.lane)
  })
})

describe('the module chooses its size', () => {
  it('large, medium or small, and never a crushed month in a small card', () => {
    expect(C.sizeOf(900, 500)).toBe('large')
    expect(C.sizeOf(400, 300)).toBe('medium')
    expect(C.sizeOf(330, 200)).toBe('small')
    expect(C.sizeOf(560, 300)).not.toBe('large')
    expect(C.sizeOf(200, 600)).toBe('small')
  })
})

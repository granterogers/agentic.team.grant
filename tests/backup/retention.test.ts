import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLICY,
  isOurs,
  isoWeek,
  planRetention,
  type RunInfo,
} from '../../src/backup/retention.ts'

const NOW = new Date('2026-10-06T12:00:00Z')
const uuid = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
const daysAgo = (d: number, hour = 12): string => {
  const t = new Date(NOW.getTime() - d * 86_400_000)
  t.setUTCHours(hour, 0, 0, 0)
  return t.toISOString()
}
const run = (n: number, ago: number, extra: Partial<RunInfo> = {}): RunInfo => ({
  name: `run-${uuid(n)}`,
  at: daysAgo(ago),
  bytes: 10_000_000,
  complete: true,
  verified: true,
  ...extra,
})
/** One run a day for `count` days, the newest `newestAgo` days old. */
const nightly = (count: number, newestAgo = 0, verifiedFrom = 0): RunInfo[] =>
  Array.from({ length: count }, (_, i) =>
    run(i + 1, newestAgo + i, { verified: i >= verifiedFrom }),
  )

describe('what this system created', () => {
  it('recognises its own folders and legacy files and nothing else', () => {
    expect(isOurs(`run-${uuid(1)}`)).toBe(true)
    expect(isOurs('aiteamhq-20260916T123456Z.json.gz')).toBe(true)
    expect(isOurs('grants-hand-made-export.json.gz')).toBe(false)
    expect(isOurs(`run-${uuid(1)}-copy`)).toBe(false)
    expect(isOurs(`xrun-${uuid(1)}`)).toBe(false)
    expect(isOurs('run-nope')).toBe(false)
  })

  it('never lists a foreign object for deletion however old, and says it ignored it', () => {
    const foreign: RunInfo = { ...run(99, 400), name: 'grants-hand-made-export.json.gz' }
    const plan = planRetention([foreign, ...nightly(40)], NOW)
    expect(plan.foreign).toEqual(['grants-hand-made-export.json.gz'])
    expect(plan.remove.map((d) => d.name)).not.toContain(foreign.name)
    expect(plan.keep.map((d) => d.name)).not.toContain(foreign.name)
  })
})

describe('keep-last-N plus weekly', () => {
  it('keeps the newest seven and one per week for eight weeks, and removes the rest (the policy does something)', () => {
    const runs = nightly(60)
    const plan = planRetention(runs, NOW)
    const kept = new Set(plan.keep.map((d) => d.name))
    for (const r of runs.slice(0, 7)) expect(kept.has(r.name)).toBe(true)
    expect(plan.remove.length).toBeGreaterThan(20)
    // eight ISO weeks counted from this week: the weekly copies are at most 9 distinct weeks (week 0..7 plus the nightly seven)
    const weeklies = plan.keep.filter((d) => d.reason.startsWith('the weekly copy'))
    expect(weeklies.length).toBeGreaterThan(0)
    // anything older than eight weeks and not the newest of its week is removable, anything kept has a reason
    expect(plan.keep.every((d) => d.reason.length > 0)).toBe(true)
    expect(plan.freedBytes).toBe(plan.remove.reduce((a, d) => a + d.bytes, 0))
  })

  it('removes the OLDEST first and respects the per-pass limit', () => {
    const plan = planRetention(nightly(120), NOW, { ...DEFAULT_POLICY, maxDeletes: 5 })
    expect(plan.remove).toHaveLength(5)
    const names = plan.remove.map((d) => d.name)
    // run 120 is the oldest
    expect(names[0]).toBe(`run-${uuid(120)}`)
    expect(plan.keep.some((d) => d.reason.startsWith('over the per-pass limit'))).toBe(true)
  })

  it('removes nothing from a bucket small enough to keep entirely', () => {
    expect(planRetention(nightly(6), NOW).remove).toEqual([])
  })
})

describe('the invariants', () => {
  it('never deletes the newest complete backup, even when it is the only one', () => {
    const plan = planRetention([run(1, 200)], NOW)
    expect(plan.remove).toEqual([])
    expect(plan.keep.map((d) => d.name)).toEqual([`run-${uuid(1)}`])
  })

  it('never deletes the newest VERIFIED backup when newer ones are unverified', () => {
    // the 10 newest are unverified; run 11 is the newest verified and is far outside both windows
    const runs = [...nightly(10).map((r) => ({ ...r, verified: false })), run(11, 300)]
    const plan = planRetention(runs, NOW, { ...DEFAULT_POLICY, keepLast: 2, keepWeeks: 1 })
    expect(plan.keep.find((d) => d.name === `run-${uuid(11)}`)?.reason).toBe(
      'the newest verified backup',
    )
    expect(plan.remove.map((d) => d.name)).not.toContain(`run-${uuid(11)}`)
  })

  it('deletes NOTHING when no backup has been verified (a pass must not leave the bucket unproven)', () => {
    const plan = planRetention(
      nightly(60).map((r) => ({ ...r, verified: false })),
      NOW,
    )
    expect(plan.remove).toEqual([])
    expect(plan.refused).toContain('no backup has been verified')
  })

  it('deletes nothing when there is no complete backup at all', () => {
    const plan = planRetention([run(1, 30, { complete: false })], NOW)
    expect(plan.remove).toEqual([])
    expect(plan.refused).toContain('no complete backup')
  })

  it('does not delete anything younger than the minimum age', () => {
    const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString()
    const policy = { ...DEFAULT_POLICY, keepLast: 1, keepWeeks: 0 }
    const young = planRetention(
      [
        run(1, 0, { at: hoursAgo(1) }),
        run(2, 0, { at: hoursAgo(5) }),
        run(3, 0, { at: hoursAgo(23) }),
      ],
      NOW,
      policy,
    )
    expect(young.remove).toEqual([])
    // the control: the same shape, older than the minimum age, IS removed
    const older = planRetention(
      [
        run(1, 0, { at: hoursAgo(1) }),
        run(2, 0, { at: hoursAgo(5) }),
        run(3, 0, { at: hoursAgo(25) }),
      ],
      NOW,
      policy,
    )
    expect(older.remove.map((d) => d.name)).toEqual([`run-${uuid(3)}`])
  })

  it('treats an unfinished folder as possibly resumable until the grace has passed', () => {
    const young = run(50, 1, { complete: false })
    const old = run(51, 10, { complete: false })
    const plan = planRetention([...nightly(3), young, old], NOW)
    expect(plan.remove.map((d) => d.name)).toEqual([old.name])
    expect(plan.keep.find((d) => d.name === young.name)?.reason).toContain('may still be resumed')
  })

  it('holds under a randomised fuzz of runs, flags, ages and policies', () => {
    let seed = 20261006
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    let withDeletes = 0
    for (let trial = 0; trial < 400; trial++) {
      const n = Math.floor(rnd() * 90)
      const runs: RunInfo[] = Array.from({ length: n }, (_, i) =>
        run(i + 1, Math.floor(rnd() * 200), {
          complete: rnd() > 0.15,
          verified: rnd() > 0.4,
          bytes: Math.floor(rnd() * 60_000_000),
        }),
      )
      if (rnd() > 0.7) runs.push({ ...run(500, 90), name: 'someone-elses-file.gz' })
      const policy = {
        keepLast: Math.floor(rnd() * 10),
        keepWeeks: Math.floor(rnd() * 12),
        minAgeHours: Math.floor(rnd() * 72),
        partialGraceHours: Math.floor(rnd() * 200),
        maxDeletes: Math.floor(rnd() * 40),
      }
      const plan = planRetention(runs, NOW, policy)
      const removed = new Set(plan.remove.map((d) => d.name))
      const complete = runs.filter((r) => r.complete && isOurs(r.name))
      const newest = [...complete].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
      const newestVerified = [...complete]
        .filter((r) => r.verified)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
      if (newest !== undefined) expect(removed.has(newest.name)).toBe(false)
      if (newestVerified !== undefined) expect(removed.has(newestVerified.name)).toBe(false)
      if (newestVerified === undefined) expect(removed.size).toBe(0)
      for (const name of removed) expect(isOurs(name)).toBe(true)
      expect(plan.remove.length).toBeLessThanOrEqual(policy.maxDeletes)
      // every ours-run is either kept or removed, never both, never neither
      const ours = runs.filter((r) => isOurs(r.name))
      for (const r of ours) {
        const k = plan.keep.some((d) => d.name === r.name)
        expect(k !== removed.has(r.name)).toBe(true)
      }
      if (removed.size > 0) withDeletes++
    }
    // the fuzz is not vacuous: a policy that never deleted would pass every invariant above
    expect(withDeletes).toBeGreaterThan(50)
  })
})

describe('isoWeek', () => {
  it('follows ISO 8601 across the year boundary', () => {
    expect(isoWeek('2026-10-06T00:00:00Z')).toBe('2026-W41')
    expect(isoWeek('2026-01-01T00:00:00Z')).toBe('2026-W01')
    expect(isoWeek('2027-01-01T00:00:00Z')).toBe('2026-W53')
    expect(isoWeek('2026-10-04T23:59:59Z')).toBe('2026-W40')
    expect(isoWeek('2026-10-05T00:00:00Z')).toBe('2026-W41')
  })
})

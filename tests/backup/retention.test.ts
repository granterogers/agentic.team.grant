import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_POLICY,
  isOurs,
  isoWeek,
  type Plan,
  type Policy,
  planRetention,
  type RunInfo,
  utcDay,
} from '../../src/backup/retention.ts'
import { applyRetention, RetentionRefused } from '../../src/backup/runs.ts'

/*
  The owner's policy (7 October 2026): the NEWEST 7 DAILY VERIFIED backups, PLUS the NEWEST VERIFIED backup from each of
  the PREVIOUS 8 ISO WEEKS. See docs/ops/backup-retention-policy.md for the reading these tests pin down.
*/

const NOW = new Date('2026-10-06T12:00:00Z') // a Tuesday, ISO 2026-W41 (Monday 5 October)
const DAY = 86_400_000
const uuid = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
let counter = 0
const run = (at: string, extra: Partial<RunInfo> = {}): RunInfo => {
  counter += 1
  return {
    name: `run-${uuid(counter)}`,
    at,
    bytes: 10_000_000,
    complete: true,
    verified: true,
    ...extra,
  }
}
const daysBefore = (now: Date, d: number, hour = 2): string => {
  const t = new Date(now.getTime() - d * DAY)
  t.setUTCHours(hour, 0, 0, 0)
  return t.toISOString()
}
/** One verified run a day, the first `0` days before `now` (today, 02:00 UTC). */
const nightly = (count: number, now: Date = NOW): RunInfo[] =>
  Array.from({ length: count }, (_, i) => run(daysBefore(now, i)))
const names = (ds: readonly { name: string }[]): string[] => ds.map((d) => d.name)
const ruleOf = (plan: Plan, r: RunInfo): string | undefined =>
  [...plan.keep, ...plan.remove, ...plan.unknown].find((d) => d.name === r.name)?.rule
const policy = (over: Partial<Policy>): Policy => ({ ...DEFAULT_POLICY, ...over })
/** Isolates the owner's two rules from the two safety limits. */
const PURE: Policy = { ...DEFAULT_POLICY, minAgeHours: 0, maxDeletes: 10_000 }

describe('the owner policy is what is configured', () => {
  it('is the newest 7 daily verified plus the previous 8 ISO weeks', () => {
    expect(DEFAULT_POLICY.keepDays).toBe(7)
    expect(DEFAULT_POLICY.keepWeeks).toBe(8)
  })

  it('keeps exactly seven days of a long nightly series, then a thin weekly tail', () => {
    const runs = nightly(80)
    const plan = planRetention(runs, NOW, PURE)
    // the newest run is reported as the newest verified and is also the first of the seven days
    const daily = plan.keep.filter((d) => d.rule === 'daily' || d.rule === 'newest-verified')
    expect(daily).toHaveLength(7)
    // the seven newest days, each by its own run
    expect(names(daily).sort()).toEqual(names(runs.slice(0, 7)).sort())
    // W40 (the newest of the previous 8 weeks) is already covered by a daily, which counts once: 7 weekly keepers remain
    expect(plan.keep.filter((d) => d.rule === 'weekly')).toHaveLength(7)
    expect(plan.keep).toHaveLength(14)
    expect(plan.remove).toHaveLength(80 - 14)
  })
})

describe('what verified means', () => {
  it('an unverified run is never counted toward the kept set and never causes a verified one to be deleted', () => {
    // ten unverified nights are the newest; the seven daily slots go to the seven newest VERIFIED days
    const unverified = Array.from({ length: 10 }, (_, i) =>
      run(daysBefore(NOW, i), { verified: false }),
    )
    const verified = Array.from({ length: 12 }, (_, i) => run(daysBefore(NOW, 10 + i)))
    const plan = planRetention([...unverified, ...verified], NOW, PURE)
    const daily = plan.keep.filter((d) => d.rule === 'daily' || d.rule === 'newest-verified')
    expect(daily).toHaveLength(7)
    expect(names(daily).sort()).toEqual(names(verified.slice(0, 7)).sort())
    // none of the ten unverified runs is kept, removed or counted: they are reported
    for (const u of unverified) {
      expect(ruleOf(plan, u)).toBe('unverified')
      expect(names(plan.remove)).not.toContain(u.name)
      expect(names(plan.keep)).not.toContain(u.name)
    }
    expect(plan.unknown).toHaveLength(10)
  })

  it('an unverified run on the same day as a verified one does not displace it', () => {
    const verified = run('2026-10-05T01:00:00Z')
    const newerUnverified = run('2026-10-05T23:00:00Z', { verified: false })
    const plan = planRetention([newerUnverified, verified], NOW, PURE)
    expect(ruleOf(plan, verified)).toBe('newest-verified')
    expect(ruleOf(plan, newerUnverified)).toBe('unverified')
  })

  it('unverified old backups are never selected for deletion however old', () => {
    const old = run('2025-01-01T00:00:00Z', { verified: false })
    const plan = planRetention([...nightly(3), old], NOW, PURE)
    expect(names(plan.remove)).not.toContain(old.name)
    expect(ruleOf(plan, old)).toBe('unverified')
  })

  it('an unfinished run is reported, never deleted, never counted', () => {
    const partial = run('2026-01-01T00:00:00Z', { complete: false })
    const partialButMarkedVerified = run('2026-01-02T00:00:00Z', {
      complete: false,
      verified: true,
    })
    const plan = planRetention([...nightly(9), partial, partialButMarkedVerified], NOW, PURE)
    for (const p of [partial, partialButMarkedVerified]) {
      expect(ruleOf(plan, p)).toBe('incomplete')
      expect(names(plan.remove)).not.toContain(p.name)
    }
  })

  it('only unverified runs: nothing is kept, nothing is deleted, everything is reported, and the plan says why', () => {
    const runs = nightly(30).map((r) => ({ ...r, verified: false }))
    const plan = planRetention(runs, NOW)
    expect(plan.remove).toEqual([])
    expect(plan.keep).toEqual([])
    expect(plan.unknown).toHaveLength(30)
    expect(plan.refused).toContain('no backup has been verified')
  })
})

describe('what daily means: one per UTC calendar day', () => {
  it('a night with several runs yields one daily, the newest verified of that day, and the others are outside the policy', () => {
    const early = run('2026-09-20T01:00:00Z')
    const mid = run('2026-09-20T09:00:00Z')
    const late = run('2026-09-20T22:30:00Z')
    const plan = planRetention([...nightly(9), early, mid, late], NOW, PURE)
    // 9 nights fill the seven daily slots, so 20 September is older than the window: only the weekly rule can keep one of its runs
    expect(ruleOf(plan, late)).toBe('weekly')
    expect(ruleOf(plan, mid)).toBe('outside-policy')
    expect(ruleOf(plan, early)).toBe('outside-policy')
  })

  it('two runs inside the daily window: the newest of the day is the daily and the older is removed', () => {
    const a = run('2026-10-05T01:00:00Z')
    const b = run('2026-10-05T22:00:00Z')
    const plan = planRetention([a, b, run('2026-10-06T02:00:00Z')], NOW, PURE)
    expect(ruleOf(plan, b)).toBe('daily')
    expect(ruleOf(plan, a)).toBe('outside-policy')
  })

  it('the newest 7 days that HAVE a verified run: a gap of days does not shrink the kept set', () => {
    const recent = [0, 1, 2].map((d) => run(daysBefore(NOW, d)))
    const afterGap = [20, 21, 22, 23, 24, 25, 26].map((d) => run(daysBefore(NOW, d)))
    const plan = planRetention([...recent, ...afterGap], NOW, PURE)
    const daily = plan.keep.filter((d) => d.rule === 'daily' || d.rule === 'newest-verified')
    expect(daily).toHaveLength(7)
    expect(names(daily)).toEqual(
      expect.arrayContaining([...names(recent), ...names(afterGap.slice(0, 4))]),
    )
  })

  it('the day is the UTC day: 23:59:59.999Z and 00:00:00.000Z are different days', () => {
    expect(utcDay('2026-10-05T23:59:59.999Z')).toBe('2026-10-05')
    expect(utcDay('2026-10-06T00:00:00.000Z')).toBe('2026-10-06')
    const lateYesterday = run('2026-10-05T23:59:59.999Z')
    const midnight = run('2026-10-06T00:00:00.000Z')
    const plan = planRetention([lateYesterday, midnight], NOW, PURE)
    expect(ruleOf(plan, midnight)).toBe('newest-verified')
    expect(ruleOf(plan, lateYesterday)).toBe('daily')
  })
})

describe('ISO weeks: the previous 8, excluding the current one', () => {
  const week = (iso: string): string => isoWeek(iso)

  it('follows ISO 8601 across the year boundary (2026 has a week 53)', () => {
    expect(week('2026-10-06T00:00:00Z')).toBe('2026-W41')
    expect(week('2026-01-01T00:00:00Z')).toBe('2026-W01')
    expect(week('2026-12-31T23:59:59Z')).toBe('2026-W53')
    expect(week('2027-01-01T00:00:00Z')).toBe('2026-W53')
    expect(week('2027-01-03T23:59:59Z')).toBe('2026-W53')
    expect(week('2027-01-04T00:00:00Z')).toBe('2027-W01')
    expect(week('2025-12-28T23:59:59Z')).toBe('2025-W52')
    expect(week('2025-12-29T00:00:00Z')).toBe('2026-W01')
    expect(week('2026-10-04T23:59:59Z')).toBe('2026-W40')
    expect(week('2026-10-05T00:00:00Z')).toBe('2026-W41')
  })

  it('the newest verified run of each of the previous eight weeks is kept, even older than the daily window', () => {
    const newest = run('2026-10-06T02:00:00Z')
    // W40 .. W33: the previous 8 weeks of 2026-W41. Two runs in each, the newer is the keeper.
    const weeks = [
      ['2026-09-28', 'W40'],
      ['2026-09-21', 'W39'],
      ['2026-09-14', 'W38'],
      ['2026-09-07', 'W37'],
      ['2026-08-31', 'W36'],
      ['2026-08-24', 'W35'],
      ['2026-08-17', 'W34'],
      ['2026-08-10', 'W33'],
    ] as const
    const olderOfEach = weeks.map(([monday]) => run(`${monday}T03:00:00Z`))
    const newerOfEach = weeks.map(([monday]) => run(`${monday}T15:00:00Z`))
    const plan = planRetention(
      [newest, ...olderOfEach, ...newerOfEach],
      NOW,
      policy({ ...PURE, keepDays: 1 }),
    )
    for (const r of newerOfEach) expect(ruleOf(plan, r)).toMatch(/weekly|daily/)
    for (const r of olderOfEach) expect(ruleOf(plan, r)).toBe('outside-policy')
    expect(plan.keep).toHaveLength(9)
  })

  it('the ninth previous week is not kept (W32 is outside W41 minus 8)', () => {
    const w33 = run('2026-08-12T10:00:00Z')
    const w32 = run('2026-08-05T10:00:00Z')
    const plan = planRetention(
      [run('2026-10-06T02:00:00Z'), w33, w32],
      NOW,
      policy({ ...PURE, keepDays: 1 }),
    )
    expect(ruleOf(plan, w33)).toBe('weekly')
    expect(ruleOf(plan, w32)).toBe('outside-policy')
  })

  it('the current ISO week is excluded from the weekly rule', () => {
    const newest = run('2026-10-06T08:00:00Z')
    const mondayOfThisWeek = run('2026-10-05T10:00:00Z')
    // keepDays 1: only the newest day is protected, so Monday survives ONLY if the weekly rule wrongly counts this week
    const plan = planRetention([newest, mondayOfThisWeek], NOW, policy({ ...PURE, keepDays: 1 }))
    expect(ruleOf(plan, mondayOfThisWeek)).toBe('outside-policy')
  })

  it('a run exactly at the Monday boundary instant belongs to the new week; one millisecond earlier to the old', () => {
    const newest = run('2026-10-06T08:00:00Z')
    const atBoundary = run('2026-10-05T00:00:00.000Z') // current week: not a weekly
    const justBefore = run('2026-10-04T23:59:59.999Z') // W40: the weekly for W40
    const plan = planRetention(
      [newest, atBoundary, justBefore],
      NOW,
      policy({ ...PURE, keepDays: 1 }),
    )
    expect(ruleOf(plan, atBoundary)).toBe('outside-policy')
    expect(ruleOf(plan, justBefore)).toBe('weekly')
  })

  it('the ISO year boundary: from 2027-W01 the previous eight weeks run back through 2026-W53', () => {
    const now = new Date('2027-01-05T12:00:00Z') // Tuesday, 2027-W01
    const keepers = [
      run('2027-01-02T10:00:00Z'), // 2026-W53, newest of it
      run('2026-11-14T10:00:00Z'), // 2026-W46: 8 weeks before W01
    ]
    const olderSameWeek = run('2026-12-30T10:00:00Z') // 2026-W53, not the newest
    const tooOld = run('2026-11-07T10:00:00Z') // 2026-W45: 9 weeks before
    const plan = planRetention(
      [run('2027-01-05T02:00:00Z'), ...keepers, olderSameWeek, tooOld],
      now,
      policy({ ...PURE, keepDays: 1 }),
    )
    for (const k of keepers) expect(ruleOf(plan, k)).toBe('weekly')
    expect(ruleOf(plan, olderSameWeek)).toBe('outside-policy')
    expect(ruleOf(plan, tooOld)).toBe('outside-policy')
  })

  it('the other ISO boundary: Monday 2025-12-29 is already 2026-W01, the previous week is 2025-W52', () => {
    const now = new Date('2026-01-02T12:00:00Z') // Friday, 2026-W01 (Monday 29 December)
    const inW52 = run('2025-12-28T23:59:59Z')
    const inW01 = run('2025-12-29T00:00:00Z')
    const plan = planRetention(
      [run('2026-01-02T02:00:00Z'), inW52, inW01],
      now,
      policy({ ...PURE, keepDays: 1 }),
    )
    expect(ruleOf(plan, inW52)).toBe('weekly')
    expect(ruleOf(plan, inW01)).toBe('outside-policy')
  })

  it('a run that is both a daily and a weekly counts once (as the daily)', () => {
    // 2026-10-04 (Sunday of W40) is inside the newest seven days and is also W40's newest run
    const sunday = run('2026-10-04T10:00:00Z')
    const plan = planRetention([run('2026-10-06T02:00:00Z'), sunday], NOW, PURE)
    expect(plan.keep.filter((d) => d.name === sunday.name)).toHaveLength(1)
    expect(ruleOf(plan, sunday)).toBe('daily')
  })
})

describe('the newest verified backup is always kept', () => {
  it('even when the policy keeps nothing else and newer unverified runs exist', () => {
    const verified = run('2025-06-01T00:00:00Z')
    const unverified = nightly(5).map((r) => ({ ...r, verified: false }))
    const plan = planRetention(
      [verified, ...unverified],
      NOW,
      policy({ ...PURE, keepDays: 0, keepWeeks: 0 }),
    )
    expect(ruleOf(plan, verified)).toBe('newest-verified')
    expect(names(plan.remove)).toEqual([])
  })

  it('with keepDays 0 and keepWeeks 0 it is still the only thing kept of a verified series', () => {
    const runs = nightly(10)
    const plan = planRetention(runs, NOW, policy({ ...PURE, keepDays: 0, keepWeeks: 0 }))
    expect(names(plan.keep)).toEqual([runs[0]?.name])
    expect(plan.remove).toHaveLength(9)
  })
})

describe('degenerate inputs', () => {
  it('no backups at all', () => {
    const plan = planRetention([], NOW)
    expect(plan).toMatchObject({ keep: [], remove: [], unknown: [], foreign: [], freedBytes: 0 })
    expect(plan.refused).toContain('no backup exists')
  })

  it('one verified backup: kept, nothing removed', () => {
    const only = run('2025-01-01T00:00:00Z')
    const plan = planRetention([only], NOW)
    expect(names(plan.keep)).toEqual([only.name])
    expect(plan.remove).toEqual([])
    expect(plan.refused).toBeNull()
  })

  it('one unverified backup: reported, nothing kept or removed', () => {
    const only = run('2026-10-05T00:00:00Z', { verified: false })
    const plan = planRetention([only], NOW)
    expect(plan.unknown.map((d) => d.name)).toEqual([only.name])
    expect(plan.remove).toEqual([])
  })

  it('everything within policy deletes nothing', () => {
    const shape = [
      ...nightly(7),
      // W40 is covered by the nightly series (2026-09-30 is its newest run); W39 back to W33 add seven weekly copies
      ...[
        '2026-09-21',
        '2026-09-14',
        '2026-09-07',
        '2026-08-31',
        '2026-08-24',
        '2026-08-17',
        '2026-08-10',
      ].map((d) => run(`${d}T10:00:00Z`)),
    ]
    const plan = planRetention(shape, NOW, PURE)
    expect(plan.remove).toEqual([])
    expect(plan.keep).toHaveLength(14)
  })

  it('the timestamp of a future-dated run does not break the plan', () => {
    const future = run('2026-10-09T00:00:00Z')
    const plan = planRetention([future, ...nightly(3)], NOW, PURE)
    expect(ruleOf(plan, future)).toBe('newest-verified')
  })
})

describe('what this system created, and atomic runs', () => {
  it('recognises its own folders and legacy files and nothing else', () => {
    expect(isOurs(`run-${uuid(1)}`)).toBe(true)
    expect(isOurs('aiteamhq-20260916T123456Z.json.gz')).toBe(true)
    expect(isOurs('grants-hand-made-export.json.gz')).toBe(false)
    expect(isOurs(`run-${uuid(1)}-copy`)).toBe(false)
    expect(isOurs(`xrun-${uuid(1)}`)).toBe(false)
  })

  it('never lists a foreign object for deletion however old, and says it ignored it', () => {
    const foreign: RunInfo = {
      ...run('2020-01-01T00:00:00Z'),
      name: 'grants-hand-made-export.json.gz',
    }
    const plan = planRetention([foreign, ...nightly(40)], NOW, PURE)
    expect(plan.foreign).toEqual(['grants-hand-made-export.json.gz'])
    expect(names(plan.remove)).not.toContain(foreign.name)
    expect(names(plan.keep)).not.toContain(foreign.name)
    expect(names(plan.unknown)).not.toContain(foreign.name)
  })

  it('a legacy single-file backup is one run like any other', () => {
    const legacy: RunInfo = {
      ...run('2026-09-16T12:34:56Z'),
      name: 'aiteamhq-20260916T123456Z.json.gz',
    }
    const plan = planRetention([legacy, ...nightly(10)], NOW, PURE)
    expect(ruleOf(plan, legacy)).toBe('weekly')
  })

  it('a run is kept or dropped whole: every run is named exactly once, as one unit', () => {
    const plan = planRetention(nightly(40), NOW, PURE)
    const all = [...names(plan.keep), ...names(plan.remove), ...names(plan.unknown)]
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(40)
  })
})

describe("the two safety limits that are not the owner's wording", () => {
  it('does not delete anything younger than the minimum age, and the same shape older is deleted', () => {
    const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString()
    const p = policy({ keepDays: 1, keepWeeks: 0, maxDeletes: 100 })
    const young = planRetention([run(hoursAgo(1)), run(hoursAgo(5)), run(hoursAgo(23))], NOW, p)
    expect(young.remove).toEqual([])
    const older = planRetention([run(hoursAgo(1)), run(hoursAgo(5)), run(hoursAgo(25))], NOW, p)
    expect(older.remove).toHaveLength(1)
  })

  it('removes the OLDEST first and respects the per-pass limit, and the passes converge', () => {
    let runs = nightly(120)
    const p = policy({ maxDeletes: 5 })
    const first = planRetention(runs, NOW, p)
    expect(first.remove).toHaveLength(5)
    expect(first.keep.some((d) => d.rule === 'deferred')).toBe(true)
    const oldest = [...runs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, 5)
    expect(names(first.remove)).toEqual(names(oldest))
    let passes = 0
    for (;;) {
      const plan = planRetention(runs, NOW, p)
      if (plan.remove.length === 0) break
      const gone = new Set(names(plan.remove))
      runs = runs.filter((r) => !gone.has(r.name))
      passes += 1
      expect(passes).toBeLessThan(100)
    }
    expect(runs.length).toBeLessThanOrEqual(15)
  })
})

/** An independent oracle for the owner's rules: epoch-day arithmetic, sharing no code with the module. */
const oracleKept = (
  runs: readonly RunInfo[],
  now: Date,
  keepDays: number,
  keepWeeks: number,
): Set<string> => {
  const ok = runs
    .filter((r) => isOurs(r.name) && r.complete && r.verified)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.name < b.name ? 1 : -1))
  const kept = new Set<string>()
  if (ok[0] !== undefined) kept.add(ok[0].name)
  const epochDay = (ms: number): number => Math.floor(ms / DAY)
  const weekIdx = (ms: number): number => Math.floor((epochDay(ms) + 3) / 7) // 1970-01-01 was a Thursday
  const seenDay = new Map<number, string>()
  for (const r of ok)
    if (!seenDay.has(epochDay(Date.parse(r.at)))) seenDay.set(epochDay(Date.parse(r.at)), r.name)
  const days = [...seenDay.keys()].sort((a, b) => b - a).slice(0, keepDays)
  for (const d of days) kept.add(seenDay.get(d) as string)
  const seenWeek = new Map<number, string>()
  for (const r of ok) {
    const ago = weekIdx(now.getTime()) - weekIdx(Date.parse(r.at))
    if (ago >= 1 && ago <= keepWeeks && !seenWeek.has(ago)) seenWeek.set(ago, r.name)
  }
  for (const n of seenWeek.values()) kept.add(n)
  return kept
}

describe('properties, over a seeded fuzz of runs', () => {
  const trials = 600
  const gen = (seed0: number) => {
    let seed = seed0
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const now = new Date(
      Date.UTC(2026, 0, 1) + Math.floor(rnd() * 400) * DAY + Math.floor(rnd() * DAY),
    )
    const n = Math.floor(rnd() * 70)
    const runs: RunInfo[] = Array.from({ length: n }, () =>
      run(
        new Date(
          now.getTime() - Math.floor(rnd() * 160 * DAY) - Math.floor(rnd() * 3) * 3_600_000,
        ).toISOString(),
        {
          complete: rnd() > 0.12,
          verified: rnd() > 0.35,
          bytes: Math.floor(rnd() * 60_000_000),
        },
      ),
    )
    if (rnd() > 0.6) runs.push({ ...run(now.toISOString()), name: 'someone-elses-file.gz' })
    const p: Policy = {
      keepDays: rnd() > 0.5 ? 7 : Math.floor(rnd() * 10),
      keepWeeks: rnd() > 0.5 ? 8 : Math.floor(rnd() * 12),
      minAgeHours: rnd() > 0.5 ? 0 : Math.floor(rnd() * 72),
      maxDeletes: rnd() > 0.5 ? 10_000 : Math.floor(rnd() * 40),
    }
    return { now, runs, p }
  }

  it('never deletes the newest verified, never deletes a kept run, never deletes unverified/unfinished/foreign, bounded keep set, and the oracle agrees', () => {
    let withDeletes = 0
    for (let t = 0; t < trials; t++) {
      const { now, runs, p } = gen(20261007 + t * 7919)
      const plan = planRetention(runs, now, p)
      const removed = new Set(names(plan.remove))
      const eligible = runs
        .filter((r) => isOurs(r.name) && r.complete && r.verified)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.name < b.name ? 1 : -1))
      if (eligible[0] !== undefined) expect(removed.has(eligible[0].name)).toBe(false)
      if (eligible.length === 0) expect(removed.size).toBe(0)
      for (const r of runs) {
        const mine = isOurs(r.name)
        if (!mine) {
          expect([...removed, ...names(plan.keep), ...names(plan.unknown)]).not.toContain(r.name)
          continue
        }
        if (!(r.complete && r.verified)) {
          expect(removed.has(r.name)).toBe(false)
          expect(names(plan.unknown)).toContain(r.name)
        } else {
          // exactly one of keep / remove for a verified run
          expect(names(plan.keep).includes(r.name) !== removed.has(r.name)).toBe(true)
        }
      }
      // the policy-kept set is what the oracle says, whatever the safety limits then add on top
      const oracle = oracleKept(runs, now, p.keepDays, p.keepWeeks)
      for (const name of oracle) expect(removed.has(name)).toBe(false)
      const policyKept = plan.keep.filter((d) =>
        ['newest-verified', 'daily', 'weekly'].includes(d.rule),
      )
      expect(new Set(names(policyKept))).toEqual(oracle)
      expect(policyKept.length).toBeLessThanOrEqual(Math.max(p.keepDays, 1) + p.keepWeeks)
      expect(plan.remove.length).toBeLessThanOrEqual(p.maxDeletes)
      if (removed.size > 0) withDeletes++
    }
    // the fuzz is not vacuous: a policy that never deleted would satisfy every invariant above
    expect(withDeletes).toBeGreaterThan(150)
  })

  it('is idempotent: applying the plan and planning again removes nothing more and keeps the same set', () => {
    let nonTrivial = 0
    for (let t = 0; t < trials; t++) {
      const { now, runs } = gen(777 + t * 104729)
      const p: Policy = { ...DEFAULT_POLICY, minAgeHours: 0, maxDeletes: 10_000 }
      const first = planRetention(runs, now, p)
      const gone = new Set(names(first.remove))
      const after = runs.filter((r) => !gone.has(r.name))
      const second = planRetention(after, now, p)
      expect(second.remove).toEqual([])
      expect(new Set(names(second.keep))).toEqual(new Set(names(first.keep)))
      if (gone.size > 0) nonTrivial++
    }
    expect(nonTrivial).toBeGreaterThan(100)
  })

  it('is independent of the process time zone and of daylight saving: only UTC decides', () => {
    const was = process.env.TZ
    try {
      const results: string[] = []
      for (const tz of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles', 'Europe/London']) {
        process.env.TZ = tz
        let acc = ''
        for (let t = 0; t < 80; t++) {
          const { now, runs, p } = gen(31337 + t * 6007)
          const plan = planRetention(runs, now, p)
          const at = new Map(runs.map((r) => [r.name, r.at]))
          const when = (ds: readonly { name: string }[]): string =>
            ds.map((d) => at.get(d.name)).join(',')
          acc += `${when(plan.remove)}|${when(plan.keep)};`
        }
        results.push(acc)
      }
      expect(new Set(results).size).toBe(1)
      expect(results[0]?.length).toBeGreaterThan(1000)
    } finally {
      if (was === undefined) delete process.env.TZ
      else process.env.TZ = was
    }
  })

  it('the clock change nights do not move a run to another day or week', () => {
    // 2026-03-29 01:30Z is the UK spring-forward instant; 2026-10-25 01:30Z the autumn one
    expect(utcDay('2026-03-29T00:59:59Z')).toBe('2026-03-29')
    expect(utcDay('2026-03-29T01:00:00Z')).toBe('2026-03-29')
    expect(isoWeek('2026-03-29T23:59:59Z')).toBe('2026-W13')
    expect(isoWeek('2026-03-30T00:00:00Z')).toBe('2026-W14')
    expect(isoWeek('2026-10-25T00:30:00Z')).toBe('2026-W43')
    expect(isoWeek('2026-10-26T00:00:00Z')).toBe('2026-W44')
  })
})

describe('the deletion path: dry run by default, refused without the attended flag AND the production-write approval', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const bucket = (): { calls: { method: string; url: string }[]; objects: string[] } => {
    const objects = [
      'run-00000001-0000-4000-8000-000000000000/public.a.json.gz',
      'run-00000001-0000-4000-8000-000000000000/public.a.json.gz.sha256',
      'run-00000001-0000-4000-8000-000000000000/manifest.json.gz',
      'run-00000001-0000-4000-8000-000000000000/manifest.json.gz.sha256',
    ]
    const calls: { method: string; url: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url) })
      if (String(url).includes('/object/list/'))
        return new Response(
          JSON.stringify(
            objects.map((o) => ({ name: o.split('/')[1], id: 'x', metadata: { size: 1 } })),
          ),
        )
      return new Response('{}', { status: 200 })
    })
    return { calls, objects }
  }
  const removable = (): Plan => {
    const victim = run('2026-01-01T00:00:00Z', {
      name: 'run-00000001-0000-4000-8000-000000000000',
    } as Partial<RunInfo>)
    const plan = planRetention([victim, ...nightly(7)], NOW, PURE)
    expect(names(plan.remove)).toEqual([victim.name])
    return plan
  }
  const deletes = (calls: { method: string }[]): number =>
    calls.filter((c) => c.method === 'DELETE').length

  it('the default is a dry run: it names what it would delete and sends nothing', async () => {
    const { calls } = bucket()
    const plan = removable()
    const out = await applyRetention('ref', 'key', plan, { go: false })
    expect(out.dryRun).toBe(true)
    expect(out.deleted).toEqual(names(plan.remove))
    expect(calls).toEqual([])
  })

  it('go without the attended flag is refused, not quietly downgraded, and nothing is sent', async () => {
    const { calls } = bucket()
    await expect(
      applyRetention('ref', 'key', removable(), { go: true, writesAllowed: () => true }),
    ).rejects.toThrow(RetentionRefused)
    expect(deletes(calls)).toBe(0)
  })

  it('go and attended without the production-write approval is refused, and nothing is sent', async () => {
    vi.stubEnv('ALLOW_PRODUCTION_CHECKS', '')
    vi.stubEnv('ALLOW_PRODUCTION_WRITES', '')
    const { calls } = bucket()
    await expect(
      applyRetention('ref', 'key', removable(), { go: true, attended: true }),
    ).rejects.toThrow(/production writes are not allowed/)
    await expect(
      applyRetention('ref', 'key', removable(), {
        go: true,
        attended: true,
        writesAllowed: () => false,
      }),
    ).rejects.toThrow(RetentionRefused)
    expect(deletes(calls)).toBe(0)
  })

  it('only with both does it delete, the whole run, its manifest FIRST', async () => {
    // The manifest goes first: a folder that keeps its manifest reads as complete even with objects missing, so an
    // interrupted deletion must leave no manifest behind. Control: the data objects are still all removed.
    const { calls } = bucket()
    const out = await applyRetention('ref', 'key', removable(), {
      go: true,
      attended: true,
      writesAllowed: () => true,
    })
    expect(out.dryRun).toBe(false)
    const del = calls.filter((c) => c.method === 'DELETE').map((c) => c.url)
    expect(del).toHaveLength(4)
    expect(del.slice(0, 2).every((u) => u.includes('manifest.json.gz'))).toBe(true)
    expect(del.slice(2).every((u) => !u.includes('manifest.json.gz'))).toBe(true)
  })

  it('a plan naming an unverified or unfinished run is refused whole, before anything is sent', async () => {
    const { calls } = bucket()
    const plan = removable()
    const partial = run('2026-01-02T00:00:00Z', { complete: false })
    const corrupted: Plan = {
      ...plan,
      unknown: [{ name: partial.name, bytes: 1, rule: 'incomplete', reason: 'x' }],
      remove: [
        ...plan.remove,
        { name: partial.name, bytes: 1, rule: 'outside-policy', reason: 'x' },
      ],
    }
    await expect(
      applyRetention('ref', 'key', corrupted, {
        go: true,
        attended: true,
        writesAllowed: () => true,
      }),
    ).rejects.toThrow(/unverified or unfinished/)
    expect(deletes(calls)).toBe(0)
  })

  it('a plan naming a foreign file is refused whole', async () => {
    const { calls } = bucket()
    const plan = removable()
    const bad: Plan = {
      ...plan,
      remove: [
        ...plan.remove,
        { name: 'grants-hand-made-export.json.gz', bytes: 1, rule: 'outside-policy', reason: 'x' },
      ],
    }
    await expect(
      applyRetention('ref', 'key', bad, { go: true, attended: true, writesAllowed: () => true }),
    ).rejects.toThrow(/did not create/)
    expect(deletes(calls)).toBe(0)
  })

  it('a refused plan deletes nothing even with every approval', async () => {
    const { calls } = bucket()
    const refused = planRetention(
      nightly(20).map((r) => ({ ...r, verified: false })),
      NOW,
    )
    const out = await applyRetention('ref', 'key', refused, {
      go: true,
      attended: true,
      writesAllowed: () => true,
    })
    expect(out.refused).not.toBeNull()
    expect(out.objectsDeleted).toBe(0)
    expect(deletes(calls)).toBe(0)
  })
})

describe('the command that runs it (assert the CALL)', () => {
  it('prune.ts passes attended to the executor, never an approval override, and --go no longer deletes', async () => {
    const { readFile } = await import('node:fs/promises')
    const src = await readFile(new URL('../../scripts/backup/prune.ts', import.meta.url), 'utf8')
    expect(src).toMatch(
      /await applyRetention\(ref, serviceKey, plan, \{ go: attended, attended \}\)/,
    )
    expect(src).not.toMatch(/writesAllowed/)
    expect(src).toMatch(/'--go'[\s\S]{0,200}process\.exit\(2\)/)
    // the production-write gate is the first import
    expect(src.indexOf("require-production-writes.ts'")).toBeLessThan(src.indexOf('retention.ts'))
  })
})

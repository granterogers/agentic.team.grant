import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  classify,
  type Edge,
  edgeSummary,
  FIVE_XX_ABSOLUTE,
  FIVE_XX_RISE_POINTS,
  HEARTBEAT_SLOW_S,
  IMPROVED_AT,
  likelyImprovement,
  MAX_PAIR_MIN,
  MIN_PAIR_MIN,
  NUMBACKENDS_ABSOLUTE,
  NUMBACKENDS_PERCENT,
  TRAFFIC_CONFOUND,
  UNCHANGED_BAND,
} from '../../scripts/rollout/classify-lib.ts'
import {
  isFirstWrite,
  type Reading,
  readingProblems,
  twoGo,
  type WriteEvent,
} from '../../scripts/rollout/gate-lib.ts'
import { AFTER, BEFORE, thinkingOnly } from '../../scripts/rollout/thinking-only.ts'

const T0 = Date.parse('2026-10-06T12:00:00Z')
const iso = (min: number): string => new Date(T0 + min * 60_000).toISOString()
const HEALTHY = ['auth', 'db', 'rest', 'storage'].map((name) => ({
  name,
  status: 'ACTIVE_HEALTHY',
}))
const OKS = [
  { name: 'the platform reports every service healthy', ok: true, detail: 'ACTIVE_HEALTHY x4' },
  { name: 'the cron canary is quick and succeeding', ok: true, detail: '0.1s succeeded' },
  { name: '10 canary runs are present in the previous 10 minutes', ok: true, detail: '10 present' },
  { name: 'no "job startup timeout" in the last hour', ok: true, detail: '0 in the last hour' },
]
const reading = (min: number, over: Partial<Reading> = {}): Reading => ({
  at: iso(min),
  go: true,
  health: HEALTHY,
  checks: OKS,
  reasons: [],
  ...over,
})

describe('the two-GO gate (the first production write needs two consecutive GO canaries about ten minutes apart)', () => {
  const now = new Date(T0 + 11 * 60_000)

  it('holds for two clean readings ten minutes apart, nothing written between (the control)', () => {
    const v = twoGo([reading(0), reading(10)], [], now)
    expect(v.reasons).toEqual([])
    expect(v.ok).toBe(true)
  })

  it('does not hold with one reading, however good', () => {
    expect(twoGo([reading(10)], [], now).ok).toBe(false)
    expect(twoGo([], [], now).ok).toBe(false)
  })

  it('does not hold when either reading is NO-GO or a service is unhealthy', () => {
    expect(twoGo([reading(0, { go: false }), reading(10)], [], now).ok).toBe(false)
    expect(twoGo([reading(0), reading(10, { go: false })], [], now).ok).toBe(false)
    const sick = [...HEALTHY.slice(0, 3), { name: 'storage', status: 'UNHEALTHY' }]
    expect(twoGo([reading(0), reading(10, { health: sick })], [], now).ok).toBe(false)
  })

  it('judges from the data, not from the reading calling itself GO', () => {
    const lying = reading(10, { go: true, health: HEALTHY.slice(0, 3) })
    expect(readingProblems(lying).join(' ')).toContain('3 service(s), 4 are required')
    const failing = reading(10, {
      checks: [
        {
          name: 'no "job startup timeout" in the last hour',
          ok: false,
          detail: '2 in the last hour',
        },
      ],
    })
    expect(twoGo([reading(0), failing], [], now).ok).toBe(false)
  })

  it('requires the readings to be about ten minutes apart: neither back to back nor far apart', () => {
    expect(twoGo([reading(0), reading(2)], [], new Date(T0 + 3 * 60_000)).ok).toBe(false)
    expect(twoGo([reading(0), reading(45)], [], new Date(T0 + 46 * 60_000)).ok).toBe(false)
    expect(twoGo([reading(0), reading(8)], [], new Date(T0 + 9 * 60_000)).ok).toBe(true)
    expect(twoGo([reading(0), reading(20)], [], new Date(T0 + 21 * 60_000)).ok).toBe(true)
  })

  it('stops holding when the latest reading is stale', () => {
    expect(twoGo([reading(0), reading(10)], [], new Date(T0 + 31 * 60_000)).ok).toBe(false)
  })

  it('stops holding if a later reading deteriorates (the pair is then the last TWO, one of them NO-GO)', () => {
    expect(
      twoGo([reading(0), reading(10), reading(20, { go: false })], [], new Date(T0 + 21 * 60_000))
        .ok,
    ).toBe(false)
  })

  it('does not hold if anything was written since the first reading', () => {
    const w: WriteEvent[] = [{ at: iso(5), what: 'apply 1023', ok: true }]
    expect(twoGo([reading(0), reading(10)], w, now).ok).toBe(false)
    expect(
      twoGo([reading(0), reading(10)], [{ at: iso(-30), what: 'apply 1023', ok: true }], now).ok,
    ).toBe(true)
  })

  it('applies to the first write only', () => {
    expect(isFirstWrite([])).toBe(true)
    expect(isFirstWrite([{ at: iso(0), what: 'apply-attempt 1023', ok: false }])).toBe(true)
    expect(isFirstWrite([{ at: iso(0), what: 'apply 1023', ok: true }])).toBe(false)
    expect(isFirstWrite([{ at: iso(0), what: 'deploy hq-api', ok: true }])).toBe(false)
  })
})

const counters = (
  _minute: number,
  hit: number,
  backends = 10,
  extra: Record<string, unknown> = {},
): Partial<Reading> => ({
  counters: {
    blks_hit: hit,
    blks_read: 0,
    numbackends: backends,
    heartbeat_s: [{ s: 0.1 }, { s: 0.1 }],
    ...extra,
  },
})
// before: 100,000 pages per 10 minutes = 10,000 a minute; 100 hq-api requests a minute = 100 pages per request.
const before = { a: reading(0, counters(0, 0)), b: reading(10, counters(10, 100_000)) }
const edge = (rpm: number, e5 = 0.2): Edge => ({ requestsPerMin: rpm, fiveXxPercent: e5 })
const later = (pagesIn10: number, over: Partial<Reading> = {}) => ({
  a: reading(30, { ...counters(30, 500_000), ...over }),
  b: reading(40, { ...counters(40, 500_000 + pagesIn10), ...over }),
})

describe('the approved health rules', () => {
  it('IMPROVED: buffer traffic per request down at least 25%, everything clean', () => {
    const r = classify(before, later(60_000), edge(100), edge(100))
    expect(r.reasons.join(' ')).toContain('fell 40%')
    expect(r.verdict).toBe('IMPROVED')
  })

  it('UNCHANGED: within +/-15%', () => {
    expect(classify(before, later(95_000), edge(100), edge(100)).verdict).toBe('UNCHANGED')
    expect(classify(before, later(110_000), edge(100), edge(100)).verdict).toBe('UNCHANGED')
  })

  it('a fall between the bands (15% to 25%) is AMBIGUOUS, not IMPROVED', () => {
    expect(classify(before, later(80_000), edge(100), edge(100)).verdict).toBe('AMBIGUOUS')
  })

  it('WORSE: buffer traffic per request up more than 15%', () => {
    expect(classify(before, later(120_000), edge(100), edge(100)).verdict).toBe('WORSE')
  })

  it('traffic is judged per request: the same pages with fewer requests is WORSE; slightly fewer pages for more requests is IMPROVED', () => {
    expect(classify(before, later(100_000), edge(100), edge(60)).verdict).toBe('WORSE')
    expect(classify(before, later(90_000), edge(100), edge(130)).verdict).toBe('IMPROVED')
  })

  it('AMBIGUOUS: the request rate moved more than 40% (a confound), even when pages fell', () => {
    expect(classify(before, later(30_000), edge(100), edge(55)).verdict).toBe('AMBIGUOUS')
    expect(classify(before, later(30_000), edge(100), edge(150)).verdict).toBe('AMBIGUOUS')
  })

  it('AMBIGUOUS: unavailable metrics (no request rate, no counters, a counter that went backwards, a pair too short)', () => {
    expect(classify(before, later(60_000), null, null).verdict).toBe('AMBIGUOUS')
    expect(classify(before, later(60_000), edge(100), null).verdict).toBe('AMBIGUOUS')
    const noCounters = { a: reading(30), b: reading(40) }
    expect(classify(before, noCounters, edge(100), edge(100)).verdict).toBe('AMBIGUOUS')
    const restarted = { a: reading(30, counters(30, 900_000)), b: reading(40, counters(40, 1_000)) }
    expect(classify(before, restarted, edge(100), edge(100)).verdict).toBe('AMBIGUOUS')
    const short = { a: reading(30, counters(30, 500_000)), b: reading(33, counters(33, 520_000)) }
    expect(classify(before, short, edge(100), edge(100)).verdict).toBe('AMBIGUOUS')
  })

  it('WORSE: a service that is not healthy, whatever else is true', () => {
    const sick = [
      ...HEALTHY.slice(0, 2),
      { name: 'rest', status: 'UNHEALTHY' },
      HEALTHY[3] as { name: string; status: string },
    ]
    expect(
      classify(before, later(60_000, { health: sick, go: false }), edge(100), edge(100)).verdict,
    ).toBe('WORSE')
    // and a health fall is not hidden by a traffic confound or missing metrics
    expect(
      classify(before, later(60_000, { health: sick, go: false }), edge(100), edge(400)).verdict,
    ).toBe('WORSE')
    expect(classify(before, later(60_000, { health: sick, go: false }), null, null).verdict).toBe(
      'WORSE',
    )
  })

  it('WORSE: a failed or slow heartbeat, too few runs, or any startup timeout', () => {
    const slow = classify(
      before,
      later(60_000, {
        counters: { blks_hit: 1, blks_read: 0, numbackends: 10, heartbeat_s: [{ s: 2.1 }] },
      }),
      edge(100),
      edge(100),
    )
    expect(slow.verdict).toBe('WORSE')
    const timeout = [
      {
        name: 'no "job startup timeout" in the last hour',
        ok: false,
        detail: '3 in the last hour',
      },
    ]
    expect(
      classify(before, later(60_000, { checks: timeout, go: false }), edge(100), edge(100)).verdict,
    ).toBe('WORSE')
    const few = [
      {
        name: '10 canary runs are present in the previous 10 minutes',
        ok: false,
        detail: '4 present',
      },
    ]
    expect(
      classify(before, later(60_000, { checks: few, go: false }), edge(100), edge(100)).verdict,
    ).toBe('WORSE')
  })

  it('WORSE: hq-api 5xx above 2%, or up by 3 points', () => {
    expect(classify(before, later(60_000), edge(100, 0.2), edge(100, 2.6)).verdict).toBe('WORSE')
    expect(classify(before, later(60_000), edge(100, 0.1), edge(100, 1.9)).verdict).toBe('IMPROVED')
    expect(classify(before, later(60_000), edge(100, 0), edge(100, 2.0)).verdict).toBe('IMPROVED')
  })

  it('WORSE: numbackends up by more than 50% OR by more than 5, whichever comes first', () => {
    const nb = (n: number) => ({
      a: reading(30, counters(30, 500_000, n)),
      b: reading(40, counters(40, 560_000, n)),
    })
    expect(classify(before, nb(10), edge(100), edge(100)).verdict).toBe('IMPROVED')
    expect(classify(before, nb(15), edge(100), edge(100)).verdict).toBe('IMPROVED') // +5 and +50% exactly: not more than either
    expect(classify(before, nb(16), edge(100), edge(100)).verdict).toBe('WORSE') // +6 (more than 5) and +60% (more than 50%)
    // the absolute limit comes first on a large baseline: 40 to 46 is +15% but +6
    const big = { a: reading(0, counters(0, 0, 40)), b: reading(10, counters(10, 100_000, 40)) }
    const grown = {
      a: reading(30, counters(30, 500_000, 46)),
      b: reading(40, counters(40, 560_000, 46)),
    }
    expect(classify(big, grown, edge(100), edge(100)).verdict).toBe('WORSE')
    // the percentage limit comes first on a small baseline: 4 to 7 is +3 but +75%
    const small = { a: reading(0, counters(0, 0, 4)), b: reading(10, counters(10, 100_000, 4)) }
    const jumped = {
      a: reading(30, counters(30, 500_000, 7)),
      b: reading(40, counters(40, 560_000, 7)),
    }
    expect(classify(small, jumped, edge(100), edge(100)).verdict).toBe('WORSE')
  })

  it('latency is not an input: nothing in a reading but its health and counters can change a verdict', () => {
    const slowReading = later(60_000, { reasons: ['the database answered in 9 s'] })
    expect(classify(before, slowReading, edge(100), edge(100)).verdict).toBe('IMPROVED')
  })
})

describe('the 15% to 25% gap (Grant, 6 October 2026)', () => {
  const gap = () => classify(before, later(80_000), edge(100), edge(100))

  it('stays AMBIGUOUS and is flagged as the gap only', () => {
    const r = gap()
    expect(r.verdict).toBe('AMBIGUOUS')
    expect(r.gapOnly).toBe(true)
  })

  it('is reported as a likely improvement only after a SECOND pair also lands in the gap, and never becomes IMPROVED', () => {
    expect(likelyImprovement([gap()])).toBeNull()
    expect(likelyImprovement([gap(), gap()])).toBe(
      'LIKELY IMPROVEMENT, BELOW PREDECLARED IMPROVED THRESHOLD',
    )
    expect(gap().verdict).toBe('AMBIGUOUS')
  })

  it('is not reported if the second pair is outside the gap, or anything else is not clean', () => {
    const improved = classify(before, later(60_000), edge(100), edge(100))
    const unchanged = classify(before, later(95_000), edge(100), edge(100))
    expect(likelyImprovement([gap(), improved])).toBeNull()
    expect(likelyImprovement([gap(), unchanged])).toBeNull()
    // a confound makes it ambiguous for another reason, which is not the gap
    const confounded = classify(before, later(30_000), edge(100), edge(55))
    expect(confounded.gapOnly).toBeUndefined()
    expect(likelyImprovement([gap(), confounded])).toBeNull()
    // a health fall is WORSE, never a likely improvement
    const sick = [...HEALTHY.slice(0, 3), { name: 'storage', status: 'UNHEALTHY' }]
    const worse = classify(before, later(80_000, { health: sick, go: false }), edge(100), edge(100))
    expect(worse.verdict).toBe('WORSE')
    expect(likelyImprovement([gap(), worse])).toBeNull()
  })

  it('the predeclared thresholds are pinned: changing one after seeing a result fails here', () => {
    expect([
      IMPROVED_AT,
      UNCHANGED_BAND,
      TRAFFIC_CONFOUND,
      NUMBACKENDS_PERCENT,
      NUMBACKENDS_ABSOLUTE,
    ]).toEqual([0.25, 0.15, 0.4, 0.5, 5])
    expect([
      FIVE_XX_ABSOLUTE,
      FIVE_XX_RISE_POINTS,
      HEARTBEAT_SLOW_S,
      MIN_PAIR_MIN,
      MAX_PAIR_MIN,
    ]).toEqual([2, 3, 1.5, 8, 20])
  })
})

describe('the request rate from an m1_edge capture', () => {
  const capture = (rows: unknown[], status = 200) => ({
    status,
    window: ['2026-10-06T12:00:00.000Z', '2026-10-06T12:10:00.000Z'],
    rows,
  })
  it('sums the hq-api family only, over the window', () => {
    const e = edgeSummary(
      capture([
        { fam: 'fn:hq-api', n: 600, e5xx: 6 },
        { fam: 'fn:hq-api', n: 400, e5xx: 4 },
        { fam: 'rest', n: 5000, e5xx: 500 },
      ]),
    )
    expect(e?.requestsPerMin).toBeCloseTo(100)
    expect(e?.fiveXxPercent).toBeCloseTo(1)
  })
  it('is unavailable (null), never zero, when the capture failed or holds no hq-api row', () => {
    expect(edgeSummary(capture([], 200))).toBeNull()
    expect(edgeSummary(capture([{ fam: 'rest', n: 5, e5xx: 0 }]))).toBeNull()
    expect(edgeSummary(capture([{ fam: 'fn:hq-api', n: 5, e5xx: 0 }], 429))).toBeNull()
    expect(edgeSummary(null)).toBeNull()
  })
})

describe('the emergency gateway is thinking-only', () => {
  it('changes exactly one line and refuses anything but exactly one match', () => {
    const src = `a\n${BEFORE}\nb\n`
    expect(thinkingOnly(src)).toBe(`a\n${AFTER}\nb\n`)
    expect(() => thinkingOnly('a\nb\n')).toThrow()
    expect(() => thinkingOnly(`${BEFORE}\n${BEFORE}\n`)).toThrow()
  })

  it('the real p4-tip gateway becomes a one-line difference with no session single-flight', () => {
    const base = execFileSync('git', ['show', '1869d7ec:supabase/functions/hq-api/index.ts'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const changed = thinkingOnly(base)
    const a = base.split('\n')
    const b = changed.split('\n')
    expect(b.length).toBe(a.length)
    expect(a.filter((l, i) => l !== b[i])).toEqual([BEFORE])
    expect(changed).not.toMatch(/resolveSession|const resolving = new Map/)
    expect(changed).toContain(AFTER)
  })
})

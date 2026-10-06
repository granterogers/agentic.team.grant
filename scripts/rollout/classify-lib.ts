/**
 * The approved health-interpretation rules (Grant, 6 October 2026), as one pure function.
 *
 * A step is judged from two readings before it (B1, B2) and two after (A1, A2), each pair about ten minutes apart with nothing else
 * changed in the window, each taken with `--counters` so database counters give rates, plus the gateway's hq-api request rate and 5xx
 * share for the same two windows (scripts/rollout/classify.ts reads them from the m1_edge log capture). Latency is never an input.
 *
 * WORSE  (checked first, so a confound can never hide a health fall): after the step
 *          - a service that was healthy is not ACTIVE_HEALTHY;
 *          - a heartbeat run failed or took over 1.5 s, fewer than ten runs in ten minutes, or any "job startup timeout";
 *          - hq-api 5xx above 2% or up by 3 points or more;
 *          - numbackends up by more than 50% OR by more than 5 from baseline, whichever is reached first;
 *          - database buffer traffic per hq-api request up by more than 15% (only when the request rates are comparable).
 * AMBIGUOUS  a needed measurement is missing or unreadable (health, counters, the request rate); a counter went backwards (a restart);
 *          a pair is not 8 to 20 minutes wide; the hq-api request rate changed by more than 40%; or buffer traffic per request fell
 *          by 15% to 25% (between the bands). Nothing changes; one more pair is taken.
 * IMPROVED   buffer traffic per hq-api request down by at least 25%, with everything above clean.
 * UNCHANGED  within +/-15%, everything clean. Kept only if the function is behaviourally equivalent (proved offline); not read as no value.
 */
import type { Reading } from './gate-lib.ts'

export type Verdict = 'IMPROVED' | 'UNCHANGED' | 'WORSE' | 'AMBIGUOUS'
export type Edge = { requestsPerMin: number; fiveXxPercent: number } | null
export type Window = { a: Reading; b: Reading }
export type Result = {
  verdict: Verdict
  reasons: string[]
  numbers: Record<string, string>
  /** True only when AMBIGUOUS because the fall landed between the UNCHANGED and IMPROVED bands and everything else was clean. */
  gapOnly?: boolean
}

/**
 * Grant's rule for the 15% to 25% gap (6 October 2026): take one more pair as planned. If that pair ALSO lands in the gap with every
 * health and canary signal clean, REPORT the wording below, but the formal verdict stays AMBIGUOUS: the predeclared threshold was not
 * crossed, and thresholds are never changed after seeing a result. This returns the wording, never a verdict.
 */
export const LIKELY_IMPROVEMENT = 'LIKELY IMPROVEMENT, BELOW PREDECLARED IMPROVED THRESHOLD'
export const likelyImprovement = (pairs: readonly Result[]): string | null =>
  pairs.length >= 2 && pairs.slice(-2).every((r) => r.verdict === 'AMBIGUOUS' && r.gapOnly === true)
    ? LIKELY_IMPROVEMENT
    : null

export const IMPROVED_AT = 0.25
export const UNCHANGED_BAND = 0.15
export const TRAFFIC_CONFOUND = 0.4
export const NUMBACKENDS_PERCENT = 0.5
export const NUMBACKENDS_ABSOLUTE = 5
export const FIVE_XX_ABSOLUTE = 2
export const FIVE_XX_RISE_POINTS = 3
export const HEARTBEAT_SLOW_S = 1.5
export const MIN_PAIR_MIN = 8
export const MAX_PAIR_MIN = 20

const num = (v: unknown): number =>
  typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
const minutes = (w: Window): number => (Date.parse(w.b.at) - Date.parse(w.a.at)) / 60_000

const buffers = (r: Reading): number => num(r.counters?.blks_hit) + num(r.counters?.blks_read)
const heartbeats = (r: Reading): number[] => {
  const raw = r.counters?.heartbeat_s
  const list = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
  return Array.isArray(list) ? list.map((x) => num((x as { s?: unknown }).s ?? x)) : []
}

/** Buffer pages per minute across a window, or NaN when the counters are missing or went backwards. */
export const bufferRate = (w: Window): number => {
  const d = buffers(w.b) - buffers(w.a)
  const m = minutes(w)
  return d >= 0 && m > 0 ? d / m : Number.NaN
}

/**
 * The hq-api request rate and 5xx share from one `m1_edge` capture (scripts/forensics/logs-capture.ts: a row per minute and family,
 * with `n` requests and `e5xx` errors). Null when the capture failed or holds no hq-api row, which is "unavailable", never zero.
 */
export const edgeSummary = (capture: unknown): Edge => {
  const c = capture as {
    status?: number
    window?: [string, string]
    rows?: Record<string, unknown>[]
  } | null
  if (
    c === null ||
    typeof c !== 'object' ||
    c.status !== 200 ||
    !Array.isArray(c.rows) ||
    c.window === undefined
  )
    return null
  const rows = c.rows.filter((r) => r.fam === 'fn:hq-api')
  const n = rows.reduce((s, r) => s + num(r.n), 0)
  const e = rows.reduce((s, r) => s + num(r.e5xx), 0)
  const mins = (Date.parse(c.window[1]) - Date.parse(c.window[0])) / 60_000
  if (!(n > 0) || !(mins > 0)) return null
  return { requestsPerMin: n / mins, fiveXxPercent: (100 * e) / n }
}

export const classify = (
  before: Window,
  after: Window,
  edgeBefore: Edge,
  edgeAfter: Edge,
): Result => {
  const worse: string[] = []
  const ambiguous: string[] = []
  const numbers: Record<string, string> = {}

  // ---- WORSE: health first -----------------------------------------------------------------------------------------------------
  for (const r of [after.a, after.b]) {
    if (r.health.length === 0) ambiguous.push(`${r.at}: the platform health could not be read`)
    for (const s of r.health)
      if (s.status !== 'ACTIVE_HEALTHY')
        worse.push(`${r.at}: ${s.name ?? 'a service'} is ${s.status}`)
    for (const c of r.checks) {
      if (c.ok) continue
      if (/health/i.test(c.name)) continue // covered above, from the data
      if (/read/i.test(c.detail) && /could not/i.test(c.detail))
        ambiguous.push(`${r.at}: ${c.name}: ${c.detail}`)
      else worse.push(`${r.at}: ${c.name}: ${c.detail}`)
    }
    if (
      !r.go &&
      r.health.length > 0 &&
      r.health.every((s) => s.status === 'ACTIVE_HEALTHY') &&
      r.checks.every((c) => c.ok)
    )
      worse.push(`${r.at}: the canary was NO-GO`)
    const slow = heartbeats(r).filter((s) => Number.isFinite(s) && s > HEARTBEAT_SLOW_S)
    if (slow.length > 0)
      worse.push(
        `${r.at}: ${slow.length} heartbeat run(s) over ${HEARTBEAT_SLOW_S} s (${Math.max(...slow)} s)`,
      )
  }

  // ---- WORSE: gateway errors ---------------------------------------------------------------------------------------------------
  if (edgeAfter !== null) {
    const rise = edgeBefore === null ? 0 : edgeAfter.fiveXxPercent - edgeBefore.fiveXxPercent
    numbers.hq5xx = `${edgeBefore?.fiveXxPercent.toFixed(2) ?? '?'}% to ${edgeAfter.fiveXxPercent.toFixed(2)}%`
    if (edgeAfter.fiveXxPercent > FIVE_XX_ABSOLUTE)
      worse.push(`hq-api 5xx is ${edgeAfter.fiveXxPercent.toFixed(2)}%, above ${FIVE_XX_ABSOLUTE}%`)
    else if (rise >= FIVE_XX_RISE_POINTS) worse.push(`hq-api 5xx rose by ${rise.toFixed(2)} points`)
  }

  // ---- WORSE: backends ---------------------------------------------------------------------------------------------------------
  const nb = (r: Reading): number => num(r.counters?.numbackends)
  const base = (nb(before.a) + nb(before.b)) / 2
  const worst = Math.max(nb(after.a), nb(after.b))
  if (Number.isFinite(base) && Number.isFinite(worst)) {
    numbers.numbackends = `${base} to ${worst}`
    const ratio = base > 0 ? (worst - base) / base : worst > 0 ? Number.POSITIVE_INFINITY : 0
    if (ratio > NUMBACKENDS_PERCENT)
      worse.push(
        `numbackends rose ${(ratio * 100).toFixed(0)}% (${base} to ${worst}), more than ${NUMBACKENDS_PERCENT * 100}%`,
      )
    else if (worst - base > NUMBACKENDS_ABSOLUTE)
      worse.push(
        `numbackends rose by ${worst - base} (${base} to ${worst}), more than ${NUMBACKENDS_ABSOLUTE}`,
      )
  } else ambiguous.push('numbackends could not be read in both windows')

  // ---- measurement windows -----------------------------------------------------------------------------------------------------
  for (const [label, w] of [
    ['before', before],
    ['after', after],
  ] as const) {
    const m = minutes(w)
    if (!(m >= MIN_PAIR_MIN && m <= MAX_PAIR_MIN))
      ambiguous.push(
        `the ${label} pair is ${m.toFixed(1)} minutes wide; ${MIN_PAIR_MIN} to ${MAX_PAIR_MIN} is required`,
      )
  }
  const rateB = bufferRate(before)
  const rateA = bufferRate(after)
  if (!Number.isFinite(rateB) || !Number.isFinite(rateA))
    ambiguous.push(
      'buffer counters are missing or went backwards (a restart), so no rate can be computed',
    )
  else {
    numbers.bufferPagesPerMin = `${Math.round(rateB)} to ${Math.round(rateA)}`
  }

  // ---- traffic ----------------------------------------------------------------------------------------------------------------
  let change = Number.NaN
  if (edgeBefore === null || edgeAfter === null)
    ambiguous.push(
      'the hq-api request rate is unavailable, so buffer traffic cannot be put per request',
    )
  else {
    change = (edgeAfter.requestsPerMin - edgeBefore.requestsPerMin) / edgeBefore.requestsPerMin
    numbers.hqRequestsPerMin = `${edgeBefore.requestsPerMin.toFixed(1)} to ${edgeAfter.requestsPerMin.toFixed(1)}`
    if (!Number.isFinite(change) || Math.abs(change) > TRAFFIC_CONFOUND)
      ambiguous.push(
        `the hq-api request rate changed by ${Number.isFinite(change) ? `${(change * 100).toFixed(0)}%` : 'an unknown amount'} (more than ${TRAFFIC_CONFOUND * 100}%): traffic is a confound`,
      )
  }

  // ---- buffer traffic per request ---------------------------------------------------------------------------------------------
  let per = Number.NaN
  if (
    Number.isFinite(rateB) &&
    Number.isFinite(rateA) &&
    edgeBefore !== null &&
    edgeAfter !== null &&
    edgeBefore.requestsPerMin > 0 &&
    edgeAfter.requestsPerMin > 0
  ) {
    const b = rateB / edgeBefore.requestsPerMin
    const a = rateA / edgeAfter.requestsPerMin
    per = (a - b) / b
    numbers.bufferPagesPerRequest = `${Math.round(b)} to ${Math.round(a)} (${(per * 100).toFixed(0)}%)`
    if (per > UNCHANGED_BAND && !(Number.isFinite(change) && Math.abs(change) > TRAFFIC_CONFOUND))
      worse.push(
        `buffer traffic per hq-api request rose ${(per * 100).toFixed(0)}%, more than ${UNCHANGED_BAND * 100}%`,
      )
  }

  if (worse.length > 0) return { verdict: 'WORSE', reasons: worse, numbers }
  if (ambiguous.length > 0) return { verdict: 'AMBIGUOUS', reasons: ambiguous, numbers }
  if (per <= -IMPROVED_AT)
    return {
      verdict: 'IMPROVED',
      reasons: [
        `buffer traffic per request fell ${(-per * 100).toFixed(0)}% with every health signal clean`,
      ],
      numbers,
    }
  if (Math.abs(per) <= UNCHANGED_BAND)
    return {
      verdict: 'UNCHANGED',
      reasons: [
        `buffer traffic per request moved ${(per * 100).toFixed(0)}%, within +/-${UNCHANGED_BAND * 100}%, with every health signal clean`,
      ],
      numbers,
    }
  return {
    verdict: 'AMBIGUOUS',
    reasons: [
      `buffer traffic per request fell ${(-per * 100).toFixed(0)}%, between the UNCHANGED (+/-${UNCHANGED_BAND * 100}%) and IMPROVED (${IMPROVED_AT * 100}%) bands: take one more pair`,
    ],
    numbers,
    gapOnly: true,
  }
}

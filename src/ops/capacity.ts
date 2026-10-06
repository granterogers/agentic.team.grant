/**
 * Capacity: how full the free tier is, how fast it is filling, and when somebody should be told.
 *
 * G-1 of the 6 October audit: the database was recorded at 63 MB on 17 September and 372 MB on 5 October against a
 * 500 MB free-tier line, backups are never deleted and share a 1 GB Storage allowance, and `app.free_tier_headroom()`
 * was only ever DISPLAYED. Nothing said anything on the way to the line.
 *
 * This file is the SPECIFICATION of three small decisions, written as pure functions so they can be tested without a
 * database. `migrations/1026_*.sql` carries the same three in SQL (the chore path has to work with no worker deploy,
 * 0540's argument), and `scripts/isolated/capacity-warning.ts` drives BOTH over the same table of cases and fails if
 * they ever disagree. A rule held in two places is only safe when something compares them.
 *
 * 1. LEVEL. 70, 85 and 95 percent of a conservative limit, with hysteresis: a level is left only when usage falls
 *    three points below the line that raised it. Without it a table at 84.9 to 85.1 percent (a prune, a backup, a
 *    prune) would announce a "crossing" every few hours, which is the alert storm 0584 exists to prevent.
 * 2. PROJECTION. Days until the limit at the FASTEST recent rate over 3, 7 and 28 days. Deliberately the maximum:
 *    a warning that assumes the optimistic rate arrives late, and a quiet last week must not erase a bad month.
 * 3. NOTICE. Composed here, in code, from the facts. A model is never asked to say a number (§11, and 0489).
 *
 * What it does NOT decide: whether the notice is spoken. That is `app.say_once` at the one place `jobs.announce` is
 * written (0584/0589), keyed on the topic this file produces, so a crossing (the topic changes) speaks at once and an
 * unchanged level speaks at most once every twenty hours.
 */

/** The Supabase free-tier lines in DECIMAL bytes. The conservative reading: 500 MB is not 500 MiB. */
export const DB_LIMIT_BYTES = 500_000_000
export const STORAGE_LIMIT_BYTES = 1_000_000_000

/** Percent lines, ascending. Level n means `LEVEL_LINES[n - 1]` has been crossed. */
export const LEVEL_LINES = [70, 85, 95] as const
/** Points below a line a reading must fall before the level is left. */
export const HYSTERESIS_POINTS = 3
/** Rate windows, in days. The projection uses the fastest. */
export const RATE_WINDOWS_DAYS = [3, 7, 28] as const

export type Level = 0 | 1 | 2 | 3

/** The level a percentage reaches on its own, ignoring where it came from. */
export function rawLevel(percent: number): Level {
  let level = 0
  for (const line of LEVEL_LINES) if (percent >= line) level += 1
  return level as Level
}

/**
 * The level now, given the level before.
 *
 * Going up is immediate and may skip a level. Going down needs `HYSTERESIS_POINTS` of clearance, so a previous level
 * persists while `percent + HYSTERESIS_POINTS` would still reach it.
 */
export function levelFor(percent: number, previous: Level): Level {
  const held = Math.min(previous, rawLevel(percent + HYSTERESIS_POINTS))
  return Math.max(rawLevel(percent), held) as Level
}

export interface Sample {
  /** UTC calendar day, `YYYY-MM-DD`. One sample per day per scope; the last reading of the day wins. */
  readonly day: string
  readonly bytes: number
}

const DAY_MS = 86_400_000
const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS)

/**
 * The fastest growth rate, in bytes a day, over the recent windows. Null when there is no span to measure (fewer than
 * two distinct days) or when nothing grew in any window.
 *
 * For each window the reference is the EARLIEST sample no older than the window, so a window with a gap in it still
 * uses the real elapsed days rather than the window's nominal length.
 */
export function ratePerDay(samples: readonly Sample[]): number | null {
  const g = growth(samples)
  return g === null ? null : Number(g.delta) / g.span
}

/**
 * The fastest window as an exact fraction (bytes gained, days spanned). Kept as integers so the projection below
 * never depends on how a float rounds: the SQL twin does the same sum in integers and the two are compared.
 */
function growth(samples: readonly Sample[]): { delta: bigint; span: number } | null {
  const byDay = new Map<number, number>()
  for (const s of samples) byDay.set(dayNumber(s.day), s.bytes)
  const days = [...byDay.keys()].sort((a, b) => a - b)
  const lastDay = days[days.length - 1]
  if (lastDay === undefined || days.length < 2) return null
  const last = BigInt(byDay.get(lastDay) as number)

  let best: { delta: bigint; span: number } | null = null
  for (const window of RATE_WINDOWS_DAYS) {
    const first = days.find((d) => d >= lastDay - window && d < lastDay)
    if (first === undefined) continue
    const delta = last - BigInt(byDay.get(first) as number)
    const span = lastDay - first
    // delta/span > best.delta/best.span, by cross-multiplication
    if (best === null || delta * BigInt(best.span) > best.delta * BigInt(span))
      best = { delta, span }
  }
  return best !== null && best.delta > 0n ? best : null
}

/** Whole days until the limit at the fastest recent rate; 0 at or past it; null when it is not growing. */
export function daysToLimit(samples: readonly Sample[], limitBytes: number): number | null {
  if (samples.length === 0) return null
  const days = [...new Map(samples.map((s) => [dayNumber(s.day), s.bytes])).entries()].sort(
    (a, b) => a[0] - b[0],
  )
  const current = days[days.length - 1]?.[1] as number
  if (current >= limitBytes) return 0
  const g = growth(samples)
  if (g === null) return null
  return Number(((BigInt(limitBytes) - BigInt(current)) * BigInt(g.span)) / g.delta)
}

export interface Reading {
  readonly scope: 'database' | 'storage'
  readonly bytes: number
  readonly limitBytes: number
  readonly level: Level
  readonly daysToLimit: number | null
  readonly largest?: readonly { readonly table: string; readonly bytes: number }[]
}

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(0)} MB`
const LABEL: Record<Reading['scope'], string> = {
  database: 'The database',
  storage: 'File storage (backups included)',
}

/**
 * The key `app.say_once` compares. It changes when a level changes in either direction and at no other time, so a
 * quiet fortnight at one level is one notice a day at most, and a crossing is never swallowed by yesterday's.
 */
export function topicFor(readings: readonly Reading[]): string {
  return `capacity:${readings.map((r) => `${r.scope}=${String(r.level)}`).join(':')}`
}

/** Null when nothing is at a warning level: a duty with nothing to say says nothing. */
export function composeNotice(readings: readonly Reading[]): string | null {
  const worst = readings.filter((r) => r.level > 0)
  if (worst.length === 0) return null
  const lines = worst
    .sort((a, b) => b.level - a.level)
    .map((r) => {
      const pct = ((r.bytes / r.limitBytes) * 100).toFixed(0)
      const eta =
        r.daysToLimit === null
          ? 'It is not growing at the moment.'
          : r.daysToLimit === 0
            ? 'It is at the limit.'
            : `At the fastest recent rate it is full in about ${String(r.daysToLimit)} days.`
      const big =
        r.scope === 'database' && r.largest !== undefined && r.largest.length > 0
          ? ` Biggest: ${r.largest
              .slice(0, 3)
              .map((t) => `${t.table} (${mb(t.bytes)})`)
              .join(', ')}.`
          : ''
      return (
        `${LABEL[r.scope]} is ${mb(r.bytes)} of ${mb(r.limitBytes)} (${pct}%), warning level ${String(r.level)} of 3. ` +
        eta +
        big
      )
    })
  const critical = worst.some((r) => r.level === 3)
  return (
    (critical ? 'Capacity needs a decision today. ' : 'Capacity is getting tight. ') +
    lines.join(' ') +
    ' Nothing has been deleted; the retention analysis in docs/ops/capacity-scenarios-2026-10-06.md says what can safely be.'
  )
}

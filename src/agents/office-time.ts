/**
 * ONE clock for tasks and reminders: the office's own.
 *
 * Deep systems audit, 6 October 2026 (Z1). "Today" was decided in four places
 * with two answers: `due.ts`, `remind-at.ts` and `mine.ts` and the
 * confirmation sentence in `instruction.ts` each hard-coded Europe/Athens (one
 * comment said the zone was "passed in" while the call site passed nothing),
 * `whenFor` read the UTC calendar day, and the SQL counters bucketed Today and
 * Overdue in UTC while `studio_tasks` used Athens.
 *
 * Now there is one source. `public.offices.timezone` is a person's zone
 * (migration 0654, default UTC, the operator's office seeded as Europe/Athens),
 * `app.office_timezone(office)` is its only SQL reader (1027) and
 * `officeTimezone` below is its only TypeScript reader. Every parser takes the
 * zone as an ARGUMENT, so each stays a pure function a test can drive across a
 * day boundary or a change of clocks.
 *
 * The operator's documented default is the constant below and is used for
 * exactly one situation: the office's zone could not be READ (a database that
 * does not yet carry `app.office_timezone`, because a migration is not a
 * deploy). It is the zone the office has always spoken in for its operator, so
 * the failure is the old behaviour rather than a new wrong one. A readable
 * office with no zone of its own is UTC (the column's default), never Athens.
 */

import type { SqlExecutor } from '../db/executor.ts'

/** The operator office's zone. The fallback only when the office's own zone cannot be read. */
export const OPERATOR_TIMEZONE = 'Europe/Athens'

/** What "remind me on Friday", with no time said, means: nine in the morning, office time. */
export const DEFAULT_REMINDER_HOUR = 9

/** Is this a zone the platform knows? `Intl` throws a RangeError for one it does not. */
export const isTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * The zone of the office a job runs for.
 *
 * Reads `app.office_timezone`, so a missing or invalid zone is already UTC on
 * the database side. An answer that is not a zone at all (nothing came back, or
 * the function does not exist yet) is an UNREADABLE zone, which is the operator
 * default and not UTC: UTC is what the database says about an office it read.
 */
export async function officeTimezone(db: SqlExecutor, jobId: string): Promise<string> {
  try {
    const r = await db.execute(
      `select app.office_timezone(app.job_office(${lit(jobId)}::uuid)) as tz`,
    )
    const tz = String((r.rows[0] as { tz?: unknown } | undefined)?.tz ?? '')
    return tz !== '' && isTimeZone(tz) ? tz : OPERATOR_TIMEZONE
  } catch {
    return OPERATOR_TIMEZONE
  }
}

/** The offset of `timeZone` from UTC at the given instant, in minutes. */
export const offsetMinutes = (at: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000)
}

/**
 * Local wall-clock (y, m0, d, hh, mm) in `timeZone`, as a UTC instant. `m` is
 * zero-based and `d` may overflow into the next month, as `Date.UTC` does.
 * A wall time the clocks skip (spring forward) lands just after the gap; one
 * they repeat (fall back) takes the first.
 */
export const wallClock = (
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  timeZone: string,
): Date => {
  const guess = new Date(Date.UTC(y, m, d, hh, mm))
  const first = offsetMinutes(guess, timeZone)
  const second = offsetMinutes(new Date(guess.getTime() - first * 60_000), timeZone)
  return new Date(guess.getTime() - second * 60_000)
}

/** The calendar day an instant falls on in `timeZone`; `m` is zero-based. */
export const localDay = (at: Date, timeZone: string): { y: number; m: number; d: number } => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  return { y: get('year'), m: get('month') - 1, d: get('day') }
}

/** The calendar day an instant falls on in `timeZone`, as YYYY-MM-DD. */
export const localIsoDay = (at: Date, timeZone: string): string => {
  const { y, m, d } = localDay(at, timeZone)
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** The clock time of an instant in `timeZone` as HH:MM, 24 hour. */
export const localClock = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)

/** The weekday (0 = Sunday) of a local date, from the date itself and never from a UTC instant. */
export const weekdayOf = (y: number, m: number, d: number): number =>
  new Date(Date.UTC(y, m, d)).getUTCDay()

/**
 * Which backups may be deleted, decided as a pure function (G-1).
 *
 * Backups were never deleted ("Nothing is ever deleted automatically", `handlers/backup.ts`), and they live in the same
 * 1 GB Storage allowance as everything else. Grant's rule stands: *"you should always check before making any
 * destructive action with me."* So this file does not delete anything. It answers one question, with no I/O, so the
 * answer can be tested to destruction:
 *
 *     given what is in the bucket, which backups could go, which must stay, and which cannot be judged?
 *
 * ## The owner's policy, in his words (recorded 7 October 2026, NOT executed)
 *
 *     keep (1) the NEWEST 7 DAILY VERIFIED backups, PLUS (2) the NEWEST VERIFIED backup from each of the PREVIOUS 8
 *     ISO WEEKS.
 *
 * `docs/ops/backup-retention-policy.md` carries the full interpretation. In short:
 *
 *  - VERIFIED is the repository's own record: every object of the run was read back and its checksum matched the one
 *    stored beside it (`readFolder` in `portable.ts`, the same read `backup:rehearse` does). It is an input here and
 *    is never inferred. A run that is not verified, or not finished, is `unknown`: it is REPORTED, it is never counted
 *    toward the kept set, it is never selected for deletion, and it never causes a verified run to be deleted.
 *  - DAILY is one per UTC calendar day. A night with several verified runs yields ONE daily, the newest of them. The
 *    newest 7 days that HAVE a verified run are kept (not "the last 7 calendar days": a 3-day outage must not leave
 *    the office with 4 daily copies, and "newest 7 daily backups" is a count of backups).
 *  - WEEKLY is an ISO 8601 week (Monday first, UTC; week 1 holds the first Thursday, so 2027-01-01 is 2026-W53). The
 *    previous 8 ISO weeks are the 8 BEFORE the current week, which is excluded. The newest verified run of each is
 *    kept even when it is older than the daily window. A run that is both a daily and a weekly counts once.
 *  - The newest verified backup is always kept, whatever the numbers in the policy say.
 *  - A backup is ONE unit, however many objects it holds (246 to 286 a night). A run is kept or dropped whole; the
 *    executor (`runs.ts`) deletes its manifest last so an interrupted deletion reads as an unfinished run, which this
 *    policy then reports as unknown and never touches.
 *  - Only things this system created (`run-<uuid>` folders, legacy `aiteamhq-<stamp>.json.gz`) are ever considered.
 *
 * ## Safety limits that are not part of the owner's wording
 *
 *  - Nothing younger than `minAgeHours` is deleted (a second run on the current day is not removed an hour after it
 *    finished).
 *  - At most `maxDeletes` per pass, oldest first: the blast radius of a wrong policy is bounded.
 *
 * The caller decides whether to act on the answer. `scripts/backup/prune.ts` is a dry run unless given `--attended`,
 * behind the production-writes gate; `applyRetention` refuses without both; the nightly handler never plans a deletion.
 */

export interface RunInfo {
  /** The folder name (`run-<uuid>`) or the legacy file name. */
  readonly name: string
  /** The newest object's time in the run. ISO 8601. */
  readonly at: string
  /** Bytes the run occupies, objects and checksums together. */
  readonly bytes: number
  /** A manifest is present: the run finished. */
  readonly complete: boolean
  /** Every object was read back and its checksum matched. Set by the caller from a real read, never inferred here. */
  readonly verified: boolean
}

export interface Policy {
  /** The newest N UTC days that have a verified run: one run each. */
  readonly keepDays: number
  /** The N ISO weeks before the current one: the newest verified run of each. */
  readonly keepWeeks: number
  readonly minAgeHours: number
  readonly maxDeletes: number
}

export const DEFAULT_POLICY: Policy = {
  keepDays: 7,
  keepWeeks: 8,
  minAgeHours: 24,
  maxDeletes: 30,
}

/** Why a run is in the answer, as a value a test can assert on (the sentence is for a person and may be reworded). */
export type Rule =
  | 'newest-verified'
  | 'daily'
  | 'weekly'
  | 'too-young'
  | 'deferred'
  | 'outside-policy'
  | 'unverified'
  | 'incomplete'
  | 'refused'

export interface Decision {
  readonly name: string
  readonly bytes: number
  readonly rule: Rule
  readonly reason: string
}

export interface Plan {
  /** Verified runs that stay (and, when refused, nothing is listed here because nothing is verified). */
  readonly keep: readonly Decision[]
  /** Verified runs outside the policy that may be deleted, oldest first. Never an unverified or unfinished run. */
  readonly remove: readonly Decision[]
  /** Ours, but unverified or unfinished: reported, never counted, never deleted. */
  readonly unknown: readonly Decision[]
  /** Not created by this system: never touched. */
  readonly foreign: readonly string[]
  /** Set when the policy declined to delete anything at all, and why. */
  readonly refused: string | null
  readonly freedBytes: number
}

const FOLDER = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const LEGACY = /^aiteamhq-\d{8}T\d{6}Z\.json\.gz$/

/** Is this name one this system created, and so one it may ever reason about. */
export const isOurs = (name: string): boolean => FOLDER.test(name) || LEGACY.test(name)

const HOUR = 3_600_000
const DAY = 86_400_000

const utcMidnight = (ms: number): number => {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** `YYYY-MM-DD` in UTC. */
export const utcDay = (iso: string): string => new Date(iso).toISOString().slice(0, 10)

/** The Monday 00:00 UTC that starts the ISO week containing this instant. */
export const mondayOf = (iso: string): number => {
  const t = utcMidnight(Date.parse(iso))
  return t - ((new Date(t).getUTCDay() || 7) - 1) * DAY
}

/** `YYYY-Www` in UTC, ISO 8601 weeks (Monday first, week 1 holds the first Thursday). */
export function isoWeek(iso: string): string {
  const t = utcMidnight(Date.parse(iso))
  const day = new Date(t).getUTCDay() || 7
  const thursday = new Date(t + (4 - day) * DAY)
  const year = thursday.getUTCFullYear()
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7)
  return `${String(year)}-W${String(week).padStart(2, '0')}`
}

const newestFirst = (a: RunInfo, b: RunInfo): number =>
  Date.parse(b.at) - Date.parse(a.at) || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)

export function planRetention(
  runs: readonly RunInfo[],
  now: Date,
  policy: Policy = DEFAULT_POLICY,
): Plan {
  const foreign = runs.filter((r) => !isOurs(r.name)).map((r) => r.name)
  const ours = runs.filter((r) => isOurs(r.name))
  const age = (r: RunInfo): number => (now.getTime() - Date.parse(r.at)) / HOUR

  // Only a finished AND verified run can be counted or deleted. Everything else of ours is reported.
  const eligible = ours.filter((r) => r.complete && r.verified).sort(newestFirst)
  const unknown: Decision[] = ours
    .filter((r) => !(r.complete && r.verified))
    .sort(newestFirst)
    .map((r) =>
      r.complete
        ? {
            name: r.name,
            bytes: r.bytes,
            rule: 'unverified' as const,
            reason:
              'not verified readable: reported, never counted toward what is kept and never deleted by this policy',
          }
        : {
            name: r.name,
            bytes: r.bytes,
            rule: 'incomplete' as const,
            reason:
              'an unfinished run (it may be resumed, or left by an interrupted deletion): reported, never deleted by this policy',
          },
    )

  const keepOf = new Map<string, Decision>()
  const keep = (r: RunInfo, rule: Rule, reason: string): void => {
    if (!keepOf.has(r.name)) keepOf.set(r.name, { name: r.name, bytes: r.bytes, rule, reason })
  }

  const newestVerified = eligible[0]
  if (newestVerified === undefined) {
    const refused =
      ours.length === 0
        ? 'no backup exists, so nothing is deleted'
        : 'no backup has been verified readable, so nothing is deleted until one is'
    return { keep: [], remove: [], unknown, foreign, refused, freedBytes: 0 }
  }

  keep(newestVerified, 'newest-verified', 'the newest verified backup, which is never deleted')

  // (1) one per UTC day (the newest verified run of that day), for the newest `keepDays` days that have one
  const dayKeeper = new Map<string, RunInfo>()
  for (const r of eligible) {
    const d = utcDay(r.at)
    if (!dayKeeper.has(d)) dayKeeper.set(d, r)
  }
  const days = [...dayKeeper.keys()].sort().reverse().slice(0, Math.max(0, policy.keepDays))
  for (const d of days)
    keep(
      dayKeeper.get(d) as RunInfo,
      'daily',
      `the newest verified backup of ${d} (one of the newest ${String(policy.keepDays)} days)`,
    )

  // (2) the newest verified run of each of the `keepWeeks` ISO weeks BEFORE the current one
  const thisMonday = mondayOf(now.toISOString())
  const weekKeeper = new Map<number, RunInfo>()
  for (const r of eligible) {
    const weeksAgo = Math.round((thisMonday - mondayOf(r.at)) / (7 * DAY))
    if (weeksAgo < 1 || weeksAgo > policy.keepWeeks) continue
    if (!weekKeeper.has(weeksAgo)) weekKeeper.set(weeksAgo, r)
  }
  for (const r of weekKeeper.values())
    keep(
      r,
      'weekly',
      `the newest verified backup of ${isoWeek(r.at)} (one of the previous ${String(policy.keepWeeks)} ISO weeks)`,
    )

  const candidates: RunInfo[] = []
  for (const r of eligible) {
    if (keepOf.has(r.name)) continue
    if (age(r) < policy.minAgeHours) {
      keep(
        r,
        'too-young',
        `younger than ${String(policy.minAgeHours)} hours: left for a later pass`,
      )
      continue
    }
    candidates.push(r)
  }
  candidates.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.name < b.name ? -1 : 1))
  const chosen = candidates.slice(0, Math.max(0, policy.maxDeletes))
  for (const r of candidates.slice(chosen.length))
    keep(r, 'deferred', 'over the per-pass limit; a later pass takes it')

  const remove: Decision[] = chosen.map((r) => ({
    name: r.name,
    bytes: r.bytes,
    rule: 'outside-policy' as const,
    reason:
      'neither the newest verified backup of one of the newest days nor of one of the previous ISO weeks',
  }))
  const kept = eligible.map((r) => keepOf.get(r.name)).filter((d): d is Decision => d !== undefined)

  // The invariants are asserted on the answer, so a future edit that breaks one throws here instead of producing a
  // plan somebody might act on.
  const removed = new Set(remove.map((d) => d.name))
  if (removed.has(newestVerified.name))
    throw new Error('retention plan would delete the newest verified backup')
  if (remove.some((d) => !isOurs(d.name)))
    throw new Error('retention plan would delete something it did not create')
  const verifiedNames = new Set(eligible.map((r) => r.name))
  if (remove.some((d) => !verifiedNames.has(d.name)))
    throw new Error('retention plan would delete a backup that is not verified')
  if (kept.some((d) => removed.has(d.name)))
    throw new Error('retention plan both keeps and deletes a backup')

  return {
    keep: kept,
    remove,
    unknown,
    foreign,
    refused: null,
    freedBytes: remove.reduce((a, d) => a + d.bytes, 0),
  }
}

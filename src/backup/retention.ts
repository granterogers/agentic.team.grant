/**
 * Which backups may be deleted, decided as a pure function (G-1).
 *
 * Backups were never deleted ("Nothing is ever deleted automatically", `handlers/backup.ts`), and they live in the same
 * 1 GB Storage allowance as everything else. That was a deliberate, defensible choice while the bucket was small.
 * Grant's rule stands: *"you should always check before making any destructive action with me."* So this file does
 * not delete anything. It answers one question, with no I/O, so the answer can be tested to destruction:
 *
 *     given what is in the bucket, which copies could go, and which must stay?
 *
 * The caller decides whether to act on the answer. `scripts/backup/prune.ts` does so only with `--go`, behind the
 * production-writes gate, and the nightly handler only REPORTS the plan.
 *
 * ## The invariants (each is a property test, not a hope)
 *
 *  1. The newest COMPLETE run is never deleted.
 *  2. The newest VERIFIED run is never deleted, even when newer unverified runs exist. If no run is verified, NOTHING
 *     is deleted (a retention pass must never be what leaves the bucket without a copy proven readable).
 *  3. Only things this system created are ever considered: `run-<uuid>` folders and the legacy
 *     `aiteamhq-<stamp>.json.gz` files. Anything else in the bucket is listed as foreign and left alone, whatever its
 *     age (the bucket is private but it is also where a person might drop a hand-made export).
 *  4. Nothing younger than `minAgeHours` is deleted.
 *  5. A folder with no manifest is an interrupted run and may be the RESUME TARGET of a job that is still retrying
 *     (the prefix is derived from the job id, ADR-0042), so it is debris only after `partialGraceHours`.
 *  6. At most `maxDeletes` per pass, oldest first: the blast radius of a wrong policy is bounded.
 *
 * ## The shape it keeps
 *
 * The newest `keepLast` complete runs (recent history, dense), plus the newest complete run of each of the last
 * `keepWeeks` ISO weeks (a thin, long tail).
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
  /** The caller has checked this run can be read (see `Verification` below). Never inferred here. */
  readonly verified: boolean
}

export interface Policy {
  readonly keepLast: number
  readonly keepWeeks: number
  readonly minAgeHours: number
  readonly partialGraceHours: number
  readonly maxDeletes: number
}

export const DEFAULT_POLICY: Policy = {
  keepLast: 7,
  keepWeeks: 8,
  minAgeHours: 24,
  partialGraceHours: 72,
  maxDeletes: 30,
}

export interface Decision {
  readonly name: string
  readonly bytes: number
  readonly reason: string
}

export interface Plan {
  readonly keep: readonly Decision[]
  readonly remove: readonly Decision[]
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

/** `YYYY-Www` in UTC, ISO 8601 weeks (Monday first, week 1 holds the first Thursday). */
export function isoWeek(iso: string): string {
  const d = new Date(iso)
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const day = new Date(t).getUTCDay() || 7
  const thursday = new Date(t + (4 - day) * 86_400_000)
  const year = thursday.getUTCFullYear()
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7)
  return `${String(year)}-W${String(week).padStart(2, '0')}`
}

const mondayOf = (iso: string): number => {
  const d = new Date(iso)
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return t - ((new Date(t).getUTCDay() || 7) - 1) * 86_400_000
}

export function planRetention(
  runs: readonly RunInfo[],
  now: Date,
  policy: Policy = DEFAULT_POLICY,
): Plan {
  const foreign = runs.filter((r) => !isOurs(r.name)).map((r) => r.name)
  const ours = runs.filter((r) => isOurs(r.name))
  const age = (r: RunInfo): number => (now.getTime() - Date.parse(r.at)) / HOUR

  const complete = ours
    .filter((r) => r.complete)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.name < b.name ? 1 : -1))
  const partial = ours.filter((r) => !r.complete)

  const keepReason = new Map<string, string>()
  const keep = (r: RunInfo, why: string): void => {
    if (!keepReason.has(r.name)) keepReason.set(r.name, why)
  }

  const newestComplete = complete[0]
  if (newestComplete !== undefined) keep(newestComplete, 'the newest complete backup')
  const newestVerified = complete.find((r) => r.verified)
  if (newestVerified !== undefined) keep(newestVerified, 'the newest verified backup')
  for (const r of complete.slice(0, Math.max(0, policy.keepLast)))
    keep(r, `one of the newest ${String(policy.keepLast)}`)

  // The newest complete run of each of the most recent `keepWeeks` ISO weeks, counted from the week of `now`.
  const thisMonday = mondayOf(now.toISOString())
  const seenWeek = new Set<string>()
  for (const r of complete) {
    const weeksAgo = Math.round((thisMonday - mondayOf(r.at)) / (7 * 86_400_000))
    if (weeksAgo < 0 || weeksAgo >= policy.keepWeeks) continue
    const w = isoWeek(r.at)
    if (seenWeek.has(w)) continue
    seenWeek.add(w)
    keep(r, `the weekly copy for ${w}`)
  }

  let refused: string | null = null
  if (newestVerified === undefined) {
    refused =
      complete.length === 0
        ? 'no complete backup exists, so nothing is deleted'
        : 'no backup has been verified readable, so nothing is deleted until one is'
  }

  const candidates: { r: RunInfo; why: string }[] = []
  if (refused === null) {
    for (const r of complete) {
      if (keepReason.has(r.name)) continue
      if (age(r) < policy.minAgeHours) {
        keep(r, `younger than ${String(policy.minAgeHours)} hours`)
        continue
      }
      candidates.push({ r, why: 'outside the keep-last and weekly windows' })
    }
    for (const r of partial) {
      if (age(r) < policy.partialGraceHours) {
        keep(
          r,
          `an unfinished run younger than ${String(policy.partialGraceHours)} hours may still be resumed`,
        )
        continue
      }
      candidates.push({ r, why: 'an unfinished run past the resume grace' })
    }
  } else {
    for (const r of complete) keep(r, refused)
    for (const r of partial) keep(r, refused)
  }

  candidates.sort((a, b) => Date.parse(a.r.at) - Date.parse(b.r.at))
  const chosen = candidates.slice(0, Math.max(0, policy.maxDeletes))
  for (const c of candidates.slice(chosen.length))
    keep(c.r, 'over the per-pass limit; a later pass takes it')

  const remove: Decision[] = chosen.map((c) => ({
    name: c.r.name,
    bytes: c.r.bytes,
    reason: c.why,
  }))
  const kept: Decision[] = ours
    .filter((r) => keepReason.has(r.name))
    .map((r) => ({ name: r.name, bytes: r.bytes, reason: keepReason.get(r.name) as string }))

  // Belt and braces: the invariants are asserted on the answer, so a future edit that breaks one throws here
  // instead of producing a plan somebody might act on.
  const removed = new Set(remove.map((d) => d.name))
  if (newestComplete !== undefined && removed.has(newestComplete.name))
    throw new Error('retention plan would delete the newest complete backup')
  if (newestVerified !== undefined && removed.has(newestVerified.name))
    throw new Error('retention plan would delete the newest verified backup')
  if (remove.some((d) => !isOurs(d.name)))
    throw new Error('retention plan would delete something it did not create')

  return {
    keep: kept,
    remove,
    foreign,
    refused,
    freedBytes: remove.reduce((a, d) => a + d.bytes, 0),
  }
}

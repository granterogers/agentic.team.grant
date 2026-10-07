/**
 * The two-GO gate, as pure functions over the rollout's own log (scripts/rollout/gate.ts reads and writes the files).
 *
 * Grant's condition (6 October 2026): before the FIRST production write there must be TWO consecutive GO canaries about ten
 * minutes apart with no production change between them, because this host has shown intermittent recovery followed by
 * degradation. Each must show auth, db, rest and storage ACTIVE_HEALTHY, cron job 1 successful, no startup timeout and the
 * expected heartbeat count. Only then may the read-only baseline run, and the same condition must still hold at the 1023 precheck.
 * If either deteriorates, stop.
 *
 * Nothing here reaches a network. "Still holds" means: the two most recent readings are both GO, they are 8 to 20 minutes apart,
 * the latest is not stale, and no production write has been logged since the first of them.
 */

export type Check = { name: string; ok: boolean; detail: string }
export type Reading = {
  /** ISO time the reading was taken. */
  at: string
  go: boolean
  /** One entry per service the health API returned. Empty means it could not be read. */
  health: { name?: string; status: string }[]
  checks: Check[]
  reasons: string[]
  /** The statistics read (`--counters`), when taken. */
  counters?: Record<string, unknown> | null
}
export type WriteEvent = { at: string; what: string; ok: boolean; detail?: string }

/** "About ten minutes": not back to back (a pair is meant to span an interval) and not so far apart that it says little. */
export const MIN_GAP_MIN = 8
export const MAX_GAP_MIN = 20
/** A reading older than this no longer describes the host. */
export const MAX_AGE_MIN = 20
export const SERVICES_REQUIRED = 4

const minutes = (a: string, b: string): number => (Date.parse(b) - Date.parse(a)) / 60_000

/** Whether ONE reading meets every part of the condition, judged from its data and not only from its own `go`. */
export const readingProblems = (r: Reading): string[] => {
  const problems: string[] = []
  if (!r.go) problems.push('the reading is NO-GO')
  if (r.health.length < SERVICES_REQUIRED)
    problems.push(
      `health returned ${r.health.length} service(s), ${SERVICES_REQUIRED} are required (a reading that cannot be read is not a pass)`,
    )
  for (const s of r.health)
    if (s.status !== 'ACTIVE_HEALTHY')
      problems.push(`${s.name ?? 'a service'} is ${s.status}, not ACTIVE_HEALTHY`)
  if (r.checks.length === 0) problems.push('no canary checks were recorded')
  for (const c of r.checks) if (!c.ok) problems.push(`${c.name}: ${c.detail}`)
  return problems
}

export type TwoGo = { ok: boolean; reasons: string[]; pair: [Reading, Reading] | null }

/** The first-write precondition. `readings` and `writes` in any order; `now` is the moment of asking. */
export const twoGo = (
  readings: readonly Reading[],
  writes: readonly WriteEvent[],
  now: Date,
): TwoGo => {
  const sorted = [...readings].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  if (sorted.length < 2)
    return {
      ok: false,
      reasons: [`${sorted.length} reading(s) logged; two consecutive GO readings are required`],
      pair: null,
    }
  const a = sorted[sorted.length - 2] as Reading
  const b = sorted[sorted.length - 1] as Reading
  const reasons: string[] = []
  for (const [label, r] of [
    ['first', a],
    ['second', b],
  ] as const)
    for (const p of readingProblems(r)) reasons.push(`${label} reading ${r.at}: ${p}`)
  const gap = minutes(a.at, b.at)
  if (!(gap >= MIN_GAP_MIN && gap <= MAX_GAP_MIN))
    reasons.push(
      `the two readings are ${gap.toFixed(1)} minutes apart; ${MIN_GAP_MIN} to ${MAX_GAP_MIN} is required (about ten)`,
    )
  const age = minutes(b.at, now.toISOString())
  if (age > MAX_AGE_MIN)
    reasons.push(
      `the latest reading is ${age.toFixed(1)} minutes old; ${MAX_AGE_MIN} is the most that still describes the host`,
    )
  const between = writes.filter((w) => Date.parse(w.at) >= Date.parse(a.at))
  if (between.length > 0)
    reasons.push(
      `${between.length} production write(s) are logged since the first reading (${between.map((w) => w.what).join(', ')}): a pair must have no change between or after`,
    )
  return { ok: reasons.length === 0, reasons, pair: [a, b] }
}

/** The precondition applies to the FIRST write only; a later step is gated by its own fresh canary inside the tool. */
export const isFirstWrite = (writes: readonly WriteEvent[]): boolean =>
  !writes.some((w) => w.ok && /^(apply|deploy)/.test(w.what))

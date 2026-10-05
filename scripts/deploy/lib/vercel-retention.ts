/**
 * Which superseded Vercel deployments may be PROPOSED for deletion. Pure: no network, no clock, no filesystem.
 *
 * The rule is PRESERVATION-FIRST. A deployment is KEPT if any of these holds:
 *   1. it is the live production deployment;
 *   2. it holds an alias;
 *   3. it is one of the newest 15 READY production deployments;
 *   4. it is a READY production deployment created in the last 7 days;
 *   5. it is the LAST READY production deployment of its UTC day, for each UTC day in the previous 30 days;
 *   6. its id is named in a tracked document (`docIds`: release records and rollback points), whatever its state or target;
 *   7. a reviewer named it (`extraKeep`).
 * Anything else is a deletion CANDIDATE. This module decides nothing on its own authority: it produces a reviewable list and
 * refuses (`assertSafe`) to produce one that deletes something a clause promised to keep. Deleting is a separate act that
 * needs an explicit approval, and nothing here can do it: this module imports nothing, makes no request, and its only output
 * is data. `tests/deploy/vercel-retention.test.ts` asserts that no module in the planner imports a client or names a method.
 *
 * Rollback only ever goes to a production deployment that finished, so the newest-N count, the window and the daily
 * keepers apply to READY production deployments. A preview is not a rollback target; it is kept only while it holds a
 * live alias or a document names it.
 */

export interface DeploymentRow {
  id: string
  url: string
  /** Epoch milliseconds. */
  created: number
  target: 'production' | 'preview'
  /** Vercel state: READY, ERROR, CANCELED, ... */
  state: string
  /** Python function bundles in the deployment. */
  bundles: number
  /** Sum of those bundles' sizes, in bytes. */
  bytes: number
  aliases: string[]
  /** Tracked documents that name this deployment id (informational: release records, rollback points). */
  docRefs: string[]
  /** Label of the experiment that created it, if one did. */
  experiment: string | null
}

export interface Rule {
  liveId: string
  /** Epoch milliseconds the list is generated at. The window and the ranking are relative to this. */
  now: number
  keepNewestProduction: number
  windowDays: number
  /** The last READY production deployment of each UTC day is kept for this many days back. */
  dailyDays: number
  /** Ids a reviewer wants kept regardless (the override path). */
  extraKeep: ReadonlySet<string>
  /** Deployment ids named in tracked documents (release records, rollback points). Kept whatever their state or target. */
  docIds: ReadonlySet<string>
}

export interface Decision extends DeploymentRow {
  action: 'KEEP' | 'DELETE'
  keepReasons: string[]
  deleteReasons: string[]
  /** What Vercel's own Hobby retention exceptions would also protect today (informational). */
  vercelProtection: string[]
  ageDays: number
}

export interface Totals {
  total: { deployments: number; bytes: number }
  keep: { deployments: number; bytes: number }
  delete: { deployments: number; bytes: number }
  deleteShareOfBytes: number
  /** Deletion candidates that a tracked document names (historic release records). */
  deleteWithDocRefs: string[]
}

const DAY = 86_400_000

export const DEFAULT_RULE = { keepNewestProduction: 15, windowDays: 7, dailyDays: 30 } as const

const newestFirst = (a: DeploymentRow, b: DeploymentRow): number =>
  b.created - a.created || a.id.localeCompare(b.id)

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/**
 * The last READY production deployment of each UTC day that falls in the previous `days` days. The day is judged over every
 * READY production deployment (not only those inside the cutoff), so a day that straddles the cutoff keeps its true last.
 */
export function lastOfEachDay(
  rows: readonly DeploymentRow[],
  now: number,
  days: number,
): ReadonlySet<string> {
  const cutoff = now - days * DAY
  const lastByDay = new Map<string, DeploymentRow>()
  for (const r of [...rows].sort(newestFirst)) {
    if (r.target !== 'production' || r.state !== 'READY') continue
    const d = utcDay(r.created)
    if (!lastByDay.has(d)) lastByDay.set(d, r) // newest first: the first seen is the day's last
  }
  return new Set([...lastByDay.values()].filter((r) => r.created >= cutoff).map((r) => r.id))
}

export function classify(rows: readonly DeploymentRow[], rule: Rule): Decision[] {
  const readyProduction = rows
    .filter((r) => r.target === 'production' && r.state === 'READY')
    .sort(newestFirst)
  const newestProd = new Set(readyProduction.slice(0, rule.keepNewestProduction).map((r) => r.id))
  const dailyKeepers = lastOfEachDay(rows, rule.now, rule.dailyDays)
  const lastThreeProd = new Set(readyProduction.slice(0, 3).map((r) => r.id))
  const lastThreeAny = new Set(
    [...rows]
      .sort(newestFirst)
      .slice(0, 3)
      .map((r) => r.id),
  )
  const windowStart = rule.now - rule.windowDays * DAY

  return rows.map((r) => {
    const keepReasons: string[] = []
    if (r.id === rule.liveId) keepReasons.push('live production deployment')
    if (r.aliases.length > 0) keepReasons.push('holds a live alias')
    if (newestProd.has(r.id)) keepReasons.push(`newest ${rule.keepNewestProduction} production`)
    if (r.target === 'production' && r.state === 'READY' && r.created >= windowStart)
      keepReasons.push(`inside ${rule.windowDays}-day rollback window`)
    if (dailyKeepers.has(r.id))
      keepReasons.push(
        `last ready production of ${utcDay(r.created)} (daily keeper, ${rule.dailyDays} days)`,
      )
    if (rule.docIds.has(r.id) || r.docRefs.length > 0)
      keepReasons.push('named in a tracked document')
    if (rule.extraKeep.has(r.id)) keepReasons.push('kept by name on review')

    const deleteReasons: string[] = []
    if (keepReasons.length === 0) {
      if (r.state !== 'READY') deleteReasons.push(`did not build (${r.state})`)
      else if (r.target === 'preview') deleteReasons.push('preview, not a rollback target')
      else
        deleteReasons.push(
          `superseded production (older than ${rule.windowDays}d, outside newest ${rule.keepNewestProduction}, not the last of its UTC day within ${rule.dailyDays}d)`,
        )
      if (r.experiment !== null) deleteReasons.push(`experiment ${r.experiment}`)
    }

    const vercelProtection: string[] = []
    if (r.id === rule.liveId) vercelProtection.push('current production')
    if (r.aliases.length > 0) vercelProtection.push('alias')
    if (lastThreeProd.has(r.id)) vercelProtection.push('3 newest ready production')
    if (lastThreeAny.has(r.id)) vercelProtection.push('3 newest of any type')

    return {
      ...r,
      action: keepReasons.length > 0 ? 'KEEP' : 'DELETE',
      keepReasons,
      deleteReasons,
      vercelProtection,
      ageDays: Math.floor((rule.now - r.created) / DAY),
    }
  })
}

export function totals(decisions: readonly Decision[]): Totals {
  const sum = (ds: readonly Decision[]) => ({
    deployments: ds.length,
    bytes: ds.reduce((n, d) => n + d.bytes, 0),
  })
  const keep = decisions.filter((d) => d.action === 'KEEP')
  const del = decisions.filter((d) => d.action === 'DELETE')
  const all = sum(decisions)
  return {
    total: all,
    keep: sum(keep),
    delete: sum(del),
    deleteShareOfBytes: all.bytes === 0 ? 0 : sum(del).bytes / all.bytes,
    deleteWithDocRefs: del.filter((d) => d.docRefs.length > 0).map((d) => d.id),
  }
}

/**
 * Refuse a list that breaks the promise. Each clause is exercised by a control that builds the bad list on purpose, so this
 * cannot quietly become a function that accepts everything.
 */
export function assertSafe(decisions: readonly Decision[], rule: Rule): void {
  const fail = (m: string): never => {
    throw new Error(`unsafe deletion list: ${m}`)
  }
  const byId = new Map(decisions.map((d) => [d.id, d]))
  if (byId.size !== decisions.length) fail('a deployment id appears twice')
  const live = byId.get(rule.liveId)
  if (live === undefined)
    fail('the live deployment is not in the inventory, so nothing can be checked against it')
  else if (live.action !== 'KEEP') fail('the live deployment is marked DELETE')
  for (const d of decisions) {
    if (d.action === 'DELETE' && d.aliases.length > 0)
      fail(`${d.id} holds a live alias and is marked DELETE`)
    if (d.action === 'DELETE' && rule.extraKeep.has(d.id))
      fail(`${d.id} was named to keep and is marked DELETE`)
  }
  const ready = decisions
    .filter((d) => d.target === 'production' && d.state === 'READY')
    .sort(newestFirst)
  for (const d of ready.slice(0, rule.keepNewestProduction))
    if (d.action === 'DELETE')
      fail(
        `${d.id} is one of the newest ${rule.keepNewestProduction} production deployments and is marked DELETE`,
      )
  const windowStart = rule.now - rule.windowDays * DAY
  for (const d of ready)
    if (d.created >= windowStart && d.action === 'DELETE')
      fail(
        `${d.id} is a production deployment inside the ${rule.windowDays}-day window and is marked DELETE`,
      )
  const daily = lastOfEachDay(decisions, rule.now, rule.dailyDays)
  for (const d of decisions) {
    if (d.action !== 'DELETE') continue
    if (daily.has(d.id))
      fail(
        `${d.id} is the last ready production deployment of ${utcDay(d.created)} (inside ${rule.dailyDays} days) and is marked DELETE`,
      )
    if (rule.docIds.has(d.id)) fail(`${d.id} is named in a tracked document and is marked DELETE`)
    // belt and braces: the row's own record of which documents name it must agree with the list the rule was given
    if (d.docRefs.length > 0)
      fail(`${d.id} is named in ${d.docRefs.join(', ')} and is marked DELETE`)
  }
  const t = totals(decisions)
  if (t.keep.deployments + t.delete.deployments !== t.total.deployments)
    fail('keep and delete do not add up to the inventory')
  if (t.keep.bytes + t.delete.bytes !== t.total.bytes)
    fail('keep and delete bytes do not add up to the inventory')
}

const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z')
const csvCell = (v: string | number): string => {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const CSV_HEADER = [
  'deployment_id',
  'created_utc',
  'age_days',
  'target',
  'state',
  'function_bundles',
  'function_bytes',
  'aliases',
  'vercel_retention_protection',
  'doc_references',
  'action',
  'rationale',
] as const

export function toCsv(decisions: readonly Decision[]): string {
  const lines = [CSV_HEADER.join(',')]
  for (const d of [...decisions].sort(newestFirst)) {
    lines.push(
      [
        d.id,
        iso(d.created),
        d.ageDays,
        d.target,
        d.state,
        d.bundles,
        d.bytes,
        d.aliases.join(' '),
        d.vercelProtection.join('; '),
        d.docRefs.join(' '),
        d.action,
        (d.action === 'KEEP' ? d.keepReasons : d.deleteReasons).join('; '),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return `${lines.join('\n')}\n`
}

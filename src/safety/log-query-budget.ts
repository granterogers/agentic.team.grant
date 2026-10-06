/**
 * The LOG QUERY BUDGET: a hard limit on what automated tooling may ask of the provider's log service.
 *
 * Why it exists. Supabase meters "Logs Query" as the total GB of log data SCANNED, across the Studio UI, the Management API, the
 * CLI and any other interface, and the usage page showed 102 GB against a 100 GB Free allowance, about 85 GB of it on 5 October
 * 2026, the day the forensic tooling ran about a hundred and ten queries (docs/performance/log-query-investigation-2026-10-06.md).
 * The tooling had a rate limit (one query every 65 seconds) and no VOLUME limit: a 24-hour window, no filter, was the default.
 * Rate and volume are different things, and the meter counts volume.
 *
 * What counts as a log query: `/analytics/endpoints/logs` and `/analytics/endpoints/usage.*` on the Management API. The
 * Prometheus scrape (`/analytics/endpoints/metrics`) is a different service and is not counted here.
 *
 * The rules, all of which must hold, none of which a flag can switch off:
 *   1. A stated reason (LOG_QUERY_REASON, at least 20 characters). It is recorded and printed.
 *   2. A narrow source: the SQL must filter on `source`. An unfiltered scan is refused.
 *   3. A short window: at most 60 minutes by default. LOG_QUERY_MAX_WINDOW_MIN may LOWER it. Raising it needs
 *      LOG_QUERY_RAISE_REASON and is still capped at 360 minutes, so a whole-day scan cannot be asked for without changing this
 *      file, which is a reviewed change.
 *   4. A daily allowance over a rolling 24 hours: 6 queries and 180 window-minutes (usage reads: 3), plus a cap on the bytes the
 *      service REPORTS having processed (1 GB). Intent rows count, so a crashed run still spends. The raise reason lifts these to
 *      hard ceilings (20 queries, 720 window-minutes, 5 GB), never past them.
 *   5. Cache first: a query whose text matches an earlier successful one whose window COVERS this one is refused, and the file
 *      that already holds the answer is named.
 *   6. Spacing: 65 seconds between queries, across processes (the ledger is the clock).
 *   7. A breaker: a 402 (usage exceeded) stops every log query for 24 hours; a 429 for 15 minutes. Nothing is retried.
 *
 * What it cannot see: the Studio UI, another machine, another account, a dashboard left open. The ledger is local to a checkout.
 * It is a guard on the automated tooling in this repository and a record that the next investigation can read, not a meter.
 *
 * Pure: it reads nothing and writes nothing. `scripts/forensics/log-guard.ts` owns the file.
 */

export const MIN_REASON = 20
export const DEFAULT_WINDOW_MIN = 60
export const HARD_WINDOW_MIN = 360
export const DEFAULT_QUERIES = 6
export const HARD_QUERIES = 20
export const DEFAULT_USAGE_QUERIES = 3
export const DEFAULT_WINDOW_TOTAL_MIN = 180
export const HARD_WINDOW_TOTAL_MIN = 720
export const DEFAULT_BYTES = 1_000_000_000
export const HARD_BYTES = 5_000_000_000
export const SPACING_S = 65
export const BREAKER_402_H = 24
export const BREAKER_429_MIN = 15
const DAY_MS = 24 * 3600 * 1000

export type LogKind = 'logs' | 'usage'

export interface LogRequest {
  kind: LogKind
  /** The SQL, for a `logs` query. */
  sql: string
  start: Date | null
  end: Date | null
  /** Minutes of log the request asks the service to look at. */
  windowMin: number
}

export interface LedgerRow {
  at: string
  phase: 'intent' | 'outcome'
  id: string
  kind: LogKind
  sqlHash: string
  windowStart: string | null
  windowEnd: string | null
  windowMin: number
  reason: string
  status?: number
  bytesReturned?: number
  /** `total_bytes_processed` from the response when the service reports it, else absent (UNKNOWN, never zero). */
  bytesProcessed?: number
  file?: string
}

export interface Env {
  LOG_QUERY_REASON?: string | undefined
  LOG_QUERY_RAISE_REASON?: string | undefined
  LOG_QUERY_MAX_WINDOW_MIN?: string | undefined
}

export type Verdict = { ok: true; notes: string[] } | { ok: false; reason: string }

/** True for the two endpoints whose use is metered as Logs Query. Matches the path, with or without the host. */
export const isLogQuery = (path: string): boolean =>
  /\/analytics\/endpoints\/(logs|usage\.)/.test(path)

/** A small stable hash (FNV-1a, 32 bit, hex) of the whitespace-normalised SQL, so the same query is recognised. */
export const sqlHash = (sql: string): string => {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const INTERVAL_MIN: Record<string, number> = {
  '15min': 15,
  '30min': 30,
  '1hr': 60,
  '3hr': 180,
  '1day': 1440,
  '3day': 4320,
  '7day': 10080,
}

/** Read what a Management API log or usage request asks for. Unreadable parts become values the rules refuse. */
export const parseLogRequest = (path: string): LogRequest | null => {
  if (!isLogQuery(path)) return null
  const q = path.includes('?') ? path.slice(path.indexOf('?') + 1) : ''
  const p = new URLSearchParams(q)
  if (/\/analytics\/endpoints\/usage\./.test(path)) {
    const interval = p.get('interval') ?? '1day'
    // A usage read with no interval covers its default, so it is treated as a day.
    return {
      kind: 'usage',
      sql: '',
      start: null,
      end: null,
      windowMin: INTERVAL_MIN[interval] ?? Number.POSITIVE_INFINITY,
    }
  }
  const sql = p.get('sql') ?? ''
  const s = p.get('iso_timestamp_start')
  const e = p.get('iso_timestamp_end')
  const start = s === null ? null : new Date(s)
  const end = e === null ? null : new Date(e)
  const ok = start !== null && end !== null && !Number.isNaN(+start) && !Number.isNaN(+end)
  // No window means the service's own default, which is a whole day: refused by the window rule, never assumed small.
  const windowMin = ok ? Math.max(0, (end.getTime() - start.getTime()) / 60_000) : 1440
  return { kind: 'logs', sql, start: ok ? start : null, end: ok ? end : null, windowMin }
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export interface Limits {
  windowMin: number
  queries: number
  usageQueries: number
  windowTotalMin: number
  bytes: number
  raised: boolean
}

/** The limits in force. The environment can lower any of them freely; only a stated raise reason lifts them, and never past the ceilings. */
export const limitsFor = (env: Env): Limits => {
  const raised = (env.LOG_QUERY_RAISE_REASON ?? '').trim().length >= MIN_REASON
  const lowered = num(env.LOG_QUERY_MAX_WINDOW_MIN)
  let windowMin = DEFAULT_WINDOW_MIN
  if (lowered !== null)
    windowMin = raised ? Math.min(lowered, HARD_WINDOW_MIN) : Math.min(lowered, DEFAULT_WINDOW_MIN)
  return {
    windowMin,
    queries: raised ? HARD_QUERIES : DEFAULT_QUERIES,
    usageQueries: DEFAULT_USAGE_QUERIES,
    windowTotalMin: raised ? HARD_WINDOW_TOTAL_MIN : DEFAULT_WINDOW_TOTAL_MIN,
    bytes: raised ? HARD_BYTES : DEFAULT_BYTES,
    raised,
  }
}

export interface Use {
  queries: number
  usageQueries: number
  windowMin: number
  bytesProcessed: number
  bytesUnreported: number
}

/** What the rolling 24 hours before `now` has spent, from intent rows (spend) and outcome rows (measured bytes). */
export const useIn = (ledger: LedgerRow[], now: Date): Use => {
  const since = now.getTime() - DAY_MS
  const use: Use = {
    queries: 0,
    usageQueries: 0,
    windowMin: 0,
    bytesProcessed: 0,
    bytesUnreported: 0,
  }
  const reported = new Set<string>()
  for (const r of ledger) {
    if (Date.parse(r.at) < since) continue
    if (r.phase === 'outcome' && r.bytesProcessed !== undefined) {
      use.bytesProcessed += r.bytesProcessed
      reported.add(r.id)
    }
  }
  for (const r of ledger) {
    if (Date.parse(r.at) < since || r.phase !== 'intent') continue
    if (r.kind === 'usage') use.usageQueries += 1
    else use.queries += 1
    use.windowMin += Number.isFinite(r.windowMin) ? r.windowMin : 0
    if (!reported.has(r.id)) use.bytesUnreported += 1
  }
  return use
}

const covers = (prev: LedgerRow, req: LogRequest): boolean =>
  prev.windowStart !== null &&
  prev.windowEnd !== null &&
  req.start !== null &&
  req.end !== null &&
  Date.parse(prev.windowStart) <= req.start.getTime() &&
  Date.parse(prev.windowEnd) >= req.end.getTime()

/** Decide whether a request may be sent. Pure. `now` and `ledger` are passed in so every rule can be driven by a test. */
export const judgeLogQuery = (
  req: LogRequest,
  ledger: LedgerRow[],
  env: Env,
  now: Date,
): Verdict => {
  const lim = limitsFor(env)
  const refuse = (reason: string): Verdict => ({ ok: false, reason })
  const reason = (env.LOG_QUERY_REASON ?? '').trim()
  if (reason.length < MIN_REASON)
    return refuse(
      `LOG_QUERY_REASON must say, in at least ${MIN_REASON} characters, why this query is needed and why the evidence already held does not answer it.`,
    )

  // The breaker comes first: while the service is refusing, asking again is the defect.
  for (const r of ledger) {
    if (r.phase !== 'outcome') continue
    const age = now.getTime() - Date.parse(r.at)
    if (r.status === 402 && age < BREAKER_402_H * 3600 * 1000)
      return refuse(
        `the log service answered 402 (usage exceeded) at ${r.at}; no log query is sent for ${BREAKER_402_H} hours. Nothing is retried.`,
      )
    if (r.status === 429 && age < BREAKER_429_MIN * 60 * 1000)
      return refuse(
        `the log service answered 429 (rate limited) at ${r.at}; no log query is sent for ${BREAKER_429_MIN} minutes.`,
      )
  }

  if (!(req.windowMin <= lim.windowMin))
    return refuse(
      `the window is ${Number.isFinite(req.windowMin) ? `${Math.round(req.windowMin)} minutes` : 'unbounded or unreadable'}; the most this tooling may ask for is ${lim.windowMin} minutes (hard ceiling ${HARD_WINDOW_MIN} with LOG_QUERY_RAISE_REASON). A whole-day scan is what the meter charges for.`,
    )
  if (req.kind === 'logs') {
    if (req.start === null || req.end === null)
      return refuse('a log query must carry an explicit iso_timestamp_start and iso_timestamp_end.')
    if (req.end.getTime() > now.getTime() + 60_000) return refuse('the window ends in the future.')
    if (!/\bsource\s*(=|in)\s*[('"]/i.test(req.sql))
      return refuse(
        "the SQL does not filter on `source` (for example `where source = 'edge_logs'`). An unfiltered query scans every stream.",
      )
    const h = sqlHash(req.sql)
    const hit = ledger.find(
      (r) =>
        r.phase === 'outcome' &&
        r.status === 200 &&
        r.sqlHash === h &&
        r.file !== undefined &&
        covers(r, req),
    )
    if (hit !== undefined)
      return refuse(
        `this query was already answered for a window that covers this one (${hit.windowStart} to ${hit.windowEnd}); read ${hit.file} instead of asking again.`,
      )
  }

  const use = useIn(ledger, now)
  if (req.kind === 'usage' && use.usageQueries >= lim.usageQueries)
    return refuse(
      `${use.usageQueries} usage read(s) in the last 24 hours; the allowance is ${lim.usageQueries}. Read the saved usage evidence instead.`,
    )
  if (req.kind === 'logs' && use.queries >= lim.queries)
    return refuse(
      `${use.queries} log queries in the last 24 hours; the allowance is ${lim.queries}${lim.raised ? ' (the raised ceiling)' : ''}.`,
    )
  if (req.kind === 'logs' && use.windowMin + req.windowMin > lim.windowTotalMin)
    return refuse(
      `${Math.round(use.windowMin)} window-minutes are already spent in the last 24 hours and this adds ${Math.round(req.windowMin)}; the allowance is ${lim.windowTotalMin}.`,
    )
  if (use.bytesProcessed >= lim.bytes)
    return refuse(
      `the service has reported ${Math.round(use.bytesProcessed / 1e6)} MB processed by this tooling in the last 24 hours; the allowance is ${Math.round(lim.bytes / 1e6)} MB.`,
    )

  const last = ledger
    .filter((r) => r.phase === 'intent')
    .map((r) => Date.parse(r.at))
    .reduce((a, b) => Math.max(a, b), 0)
  const wait = last + SPACING_S * 1000 - now.getTime()
  if (wait > 0)
    return refuse(
      `the previous log query was ${Math.round((SPACING_S * 1000 - wait) / 1000)} s ago; wait ${Math.ceil(wait / 1000)} s.`,
    )

  const notes = [
    `reason: ${reason}`,
    `${use.queries + (req.kind === 'logs' ? 1 : 0)} of ${lim.queries} log queries and ${Math.round(use.windowMin + (req.kind === 'logs' ? req.windowMin : 0))} of ${lim.windowTotalMin} window-minutes in the last 24 hours`,
  ]
  if (use.bytesUnreported > 0)
    notes.push(
      `${use.bytesUnreported} earlier query(ies) did not report bytes processed: that part of the spend is UNKNOWN, not zero.`,
    )
  return { ok: true, notes }
}

/** Pull `total_bytes_processed` out of a response body when the service reports it. Absent stays absent: UNKNOWN is not zero. */
export const bytesProcessedOf = (body: string): number | undefined => {
  try {
    const j = JSON.parse(body) as { total_bytes_processed?: unknown }
    const n = Number(j.total_bytes_processed)
    return j.total_bytes_processed !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined
  } catch {
    return undefined
  }
}

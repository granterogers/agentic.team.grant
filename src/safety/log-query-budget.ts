/**
 * The LOG QUERY BUDGET: a limit on what automated tooling may ask of the provider's analytics endpoints.
 *
 * ## What is the vendor's and what is OURS (read this before quoting any number)
 *
 * VENDOR-DOCUMENTED (Supabase, read 6 October 2026): "Logs Query" is metered as the total GB of log data SCANNED, across the Studio
 * UI, the Management API, the CLI and any other interface; over the Free allowance (100 GB) queries are rate limited and retention
 * is shortened; Logs Ingest is a separate meter; Log Drains exist on Pro, Team and Enterprise only.
 *
 * NOT DOCUMENTED BY THE VENDOR and OBSERVED only in this repository's own notes: the logs endpoint takes a window of at most 24
 * hours and tolerates about one query a minute.
 *
 * OUR POLICY (chosen, conservative, adjustable, and NOT a vendor limit): a 60 minute window, a source filter, 6 log queries and
 * 180 window-minutes per rolling 24 hours, 6 usage reads, a 65 second spacing, a reason, cache-first, and the breaker below. None of
 * these numbers comes from Supabase. They are chosen so that the worst case this tooling can spend in a day is small beside the
 * 100 GB allowance whatever the stream's volume, and they are the part to argue about, not the vendor's meter.
 *
 * UNVERIFIED: whether the logs endpoint reports bytes scanned at all. No saved response in this repository carries
 * `total_bytes_processed`; the usage responses saved on 5 October carry only `result`. The bytes cap below therefore cannot be
 * enforced until a real response shows the field, and the guard says so in every approval it prints. Until then the window and
 * count policy is the only bound, and bytes scanned stays UNKNOWN, never zero.
 *
 * ## Why it exists
 *
 * The usage page showed 102 GB against the allowance, about 85 GB of it on 5 October 2026, the day the forensic tooling ran about a
 * hundred and ten queries (docs/performance/log-query-investigation-2026-10-06.md). The tooling had a rate limit (one query every
 * 65 seconds) and no volume limit: a 24-hour window with no filter was the default. Rate and volume are different things.
 *
 * ## What is covered
 *
 * LOGS: `/analytics/endpoints/logs`. Metered as Logs Query.
 * USAGE: `/analytics/endpoints/usage.*`. Kept SEPARATE: nothing shows that these consume the Logs Query meter (they return a few
 * dozen aggregated points). They get their own count, no window or source rule, and are not added to the log allowance. A 402 or a
 * 429 from either still opens the breaker, because that is the analytics service refusing.
 * NOT COVERED: the Prometheus scrape (`/analytics/endpoints/metrics`), a different service.
 *
 * ## The rules for a LOG query (all must hold)
 *   1. A stated reason (LOG_QUERY_REASON, 20+ characters). Recorded and printed.
 *   2. A source: the SQL must filter on `source` (one stream or several, `source in (...)` is fine).
 *      EMERGENCY OVERRIDE: LOG_QUERY_EMERGENCY_REASON (40+ characters) lifts this rule and the daily allowances to their ceilings,
 *      for a legitimate multi-source incident analysis. It does NOT lift the window ceiling, the spacing or the breaker, it is
 *      printed on stderr, and the ledger row carries `override: 'emergency'` so a later reader can count every use.
 *   3. A short window: 60 minutes. LOG_QUERY_MAX_WINDOW_MIN may LOWER it. LOG_QUERY_RAISE_REASON (20+ characters, or the emergency
 *      reason) raises it to at most 360 minutes, so a whole-day scan cannot be asked for without editing this file.
 *   4. A daily allowance over a rolling 24 hours: 6 queries and 180 window-minutes (ceilings 20 and 720 when raised). Intent rows
 *      count, so a crashed run still spends.
 *   5. Cache first: a successful earlier query with the same text whose window COVERS this one is refused, and its file is named.
 *   6. Spacing: 65 seconds between analytics queries, across processes (the ledger is the clock).
 *   7. A breaker: a 402 stops every analytics query for 24 hours, a 429 for 15 minutes. Nothing is retried.
 *   8. The bytes cap (policy 1 GB, ceiling 5 GB raised): enforced only from bytes the service REPORTS (see UNVERIFIED above).
 *
 * What it cannot see: the Studio UI, another machine, another account, a dashboard left open. The ledger is local to a checkout.
 * It is a guard on the automated tooling in this repository and a record the next investigation can read, not a meter.
 *
 * Pure: it reads nothing and writes nothing. `scripts/forensics/log-guard.ts` owns the file.
 */

export const MIN_REASON = 20
export const MIN_EMERGENCY_REASON = 40
export const DEFAULT_WINDOW_MIN = 60
export const HARD_WINDOW_MIN = 360
export const DEFAULT_QUERIES = 6
export const HARD_QUERIES = 20
export const DEFAULT_USAGE_QUERIES = 6
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
  /** Minutes of log the request asks the service to look at (for a usage read, the interval it asks for; informational). */
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
  /** Set when the emergency override was used, so every use can be counted later. */
  override?: 'emergency'
  status?: number
  bytesReturned?: number
  /** `total_bytes_processed` from the response when the service reports it, else absent (UNKNOWN, never zero). */
  bytesProcessed?: number
  file?: string
}

export interface Env {
  LOG_QUERY_REASON?: string | undefined
  LOG_QUERY_RAISE_REASON?: string | undefined
  LOG_QUERY_EMERGENCY_REASON?: string | undefined
  LOG_QUERY_MAX_WINDOW_MIN?: string | undefined
}

export type Verdict =
  | { ok: true; notes: string[]; override?: 'emergency' }
  | { ok: false; reason: string }

/** True for the two endpoints this guard covers. Matches the path, with or without the host. */
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
    return {
      kind: 'usage',
      sql: '',
      start: null,
      end: null,
      windowMin: INTERVAL_MIN[interval] ?? 1440,
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
  emergency: boolean
}

/**
 * The limits in force. The environment can lower any of them freely; only a stated reason lifts them, and never past the
 * ceilings. The emergency reason implies the raise.
 */
export const limitsFor = (env: Env): Limits => {
  const emergency = (env.LOG_QUERY_EMERGENCY_REASON ?? '').trim().length >= MIN_EMERGENCY_REASON
  const raised = emergency || (env.LOG_QUERY_RAISE_REASON ?? '').trim().length >= MIN_REASON
  const lowered = num(env.LOG_QUERY_MAX_WINDOW_MIN)
  let windowMin = DEFAULT_WINDOW_MIN
  if (lowered !== null)
    windowMin = raised ? Math.min(lowered, HARD_WINDOW_MIN) : Math.min(lowered, DEFAULT_WINDOW_MIN)
  else if (raised) windowMin = HARD_WINDOW_MIN
  return {
    windowMin,
    queries: raised ? HARD_QUERIES : DEFAULT_QUERIES,
    usageQueries: DEFAULT_USAGE_QUERIES,
    windowTotalMin: raised ? HARD_WINDOW_TOTAL_MIN : DEFAULT_WINDOW_TOTAL_MIN,
    bytes: raised ? HARD_BYTES : DEFAULT_BYTES,
    raised,
    emergency,
  }
}

export interface Use {
  queries: number
  usageQueries: number
  windowMin: number
  bytesProcessed: number
  /** Queries in the window whose response did not report bytes (their spend is UNKNOWN, not zero). */
  bytesUnreported: number
  /** Queries in the window whose response DID report bytes. While this is 0 the bytes cap cannot fire. */
  bytesReported: number
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
    bytesReported: 0,
  }
  const reported = new Set<string>()
  for (const r of ledger) {
    if (Date.parse(r.at) < since) continue
    if (r.phase === 'outcome' && r.bytesProcessed !== undefined) {
      use.bytesProcessed += r.bytesProcessed
      use.bytesReported += 1
      reported.add(r.id)
    }
  }
  for (const r of ledger) {
    if (Date.parse(r.at) < since || r.phase !== 'intent') continue
    if (r.kind === 'usage') use.usageQueries += 1
    else {
      use.queries += 1
      // Only a log query's window is spent against the log allowance; a usage read's interval is not.
      use.windowMin += Number.isFinite(r.windowMin) ? r.windowMin : 0
    }
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

  // The breaker comes first: while the service is refusing, asking again is the defect. It covers both kinds.
  for (const r of ledger) {
    if (r.phase !== 'outcome') continue
    const age = now.getTime() - Date.parse(r.at)
    if (r.status === 402 && age < BREAKER_402_H * 3600 * 1000)
      return refuse(
        `the analytics service answered 402 (usage exceeded) at ${r.at}; no analytics query is sent for ${BREAKER_402_H} hours. Nothing is retried.`,
      )
    if (r.status === 429 && age < BREAKER_429_MIN * 60 * 1000)
      return refuse(
        `the analytics service answered 429 (rate limited) at ${r.at}; no analytics query is sent for ${BREAKER_429_MIN} minutes.`,
      )
  }

  const use = useIn(ledger, now)
  if (req.kind === 'logs') {
    if (!(req.windowMin <= lim.windowMin))
      return refuse(
        `the window is ${Number.isFinite(req.windowMin) ? `${Math.round(req.windowMin)} minutes` : 'unbounded or unreadable'}; the most this tooling may ask for is ${lim.windowMin} minutes (our policy, ceiling ${HARD_WINDOW_MIN} with LOG_QUERY_RAISE_REASON). A whole-day scan is what the meter charges for.`,
      )
    if (req.start === null || req.end === null)
      return refuse('a log query must carry an explicit iso_timestamp_start and iso_timestamp_end.')
    if (req.end.getTime() > now.getTime() + 60_000) return refuse('the window ends in the future.')
    if (!lim.emergency && !/\bsource\s*(=|in)\s*[('"]/i.test(req.sql))
      return refuse(
        "the SQL does not filter on `source` (for example `where source = 'edge_logs'`). An unfiltered query scans every stream. A legitimate multi-source incident analysis may use LOG_QUERY_EMERGENCY_REASON (40+ characters); it is recorded.",
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
    if (use.queries >= lim.queries)
      return refuse(
        `${use.queries} log queries in the last 24 hours; the allowance is ${lim.queries}${lim.raised ? ' (the raised ceiling)' : ''} (our policy).`,
      )
    if (use.windowMin + req.windowMin > lim.windowTotalMin)
      return refuse(
        `${Math.round(use.windowMin)} window-minutes are already spent in the last 24 hours and this adds ${Math.round(req.windowMin)}; the allowance is ${lim.windowTotalMin} (our policy).`,
      )
  } else if (use.usageQueries >= lim.usageQueries) {
    return refuse(
      `${use.usageQueries} usage read(s) in the last 24 hours; the allowance is ${lim.usageQueries} (our policy). Read the saved usage evidence instead.`,
    )
  }
  if (use.bytesProcessed >= lim.bytes)
    return refuse(
      `the service has reported ${Math.round(use.bytesProcessed / 1e6)} MB processed by this tooling in the last 24 hours; the allowance is ${Math.round(lim.bytes / 1e6)} MB (our policy).`,
    )

  const last = ledger
    .filter((r) => r.phase === 'intent')
    .map((r) => Date.parse(r.at))
    .reduce((a, b) => Math.max(a, b), 0)
  const wait = last + SPACING_S * 1000 - now.getTime()
  if (wait > 0)
    return refuse(
      `the previous analytics query was ${Math.round((SPACING_S * 1000 - wait) / 1000)} s ago; wait ${Math.ceil(wait / 1000)} s.`,
    )

  const notes = [`reason: ${reason}`]
  if (req.kind === 'logs')
    notes.push(
      `${use.queries + 1} of ${lim.queries} log queries and ${Math.round(use.windowMin + req.windowMin)} of ${lim.windowTotalMin} window-minutes in the last 24 hours`,
    )
  else notes.push(`${use.usageQueries + 1} of ${lim.usageQueries} usage reads in the last 24 hours`)
  if (use.bytesReported === 0)
    notes.push(
      'bytes scanned is UNKNOWN: no response in this ledger has reported it, so the bytes cap cannot fire (the window and count policy is the only bound).',
    )
  else if (use.bytesUnreported > 0)
    notes.push(
      `${use.bytesUnreported} earlier query(ies) did not report bytes processed: that part of the spend is UNKNOWN, not zero.`,
    )
  if (lim.emergency)
    notes.push(
      `EMERGENCY OVERRIDE in use (source filter not required, allowances at their ceilings): ${(env.LOG_QUERY_EMERGENCY_REASON ?? '').trim()}`,
    )
  return lim.emergency ? { ok: true, notes, override: 'emergency' } : { ok: true, notes }
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

/**
 * The CANARY PRECONDITION: may a production-touching run start, and should it keep going? (a PROPOSAL,
 * docs/testing/production-test-budgets.md)
 *
 * The 434 MiB Nano host degrades persistently under verification load, and the cheapest per-minute probe of its health is
 * already in the database: pg_cron job 1 (the worker heartbeat, a one-line function run every minute) records every run in
 * `cron.job_run_details`, with its duration and, when the host could not even start a backend, a "job startup timeout"
 * (docs/ops/supabase-forensics-2026-10-05.md section 12.3). It kept recording through every episode, which most other
 * instruments did not. `scripts/verify/auth-acceptance.ts` was the first suite to use it; this is that logic, shared.
 *
 * Everything here is a pure function over rows the caller read, or takes the reader as a parameter, so every branch can be
 * driven without a network. It FAILS CLOSED: a canary that cannot be read is NO-GO, with the reason, unless a person says
 * `--skip-canary-because=<reason>`. The skip covers only "could not read"; a canary that reads and says the host is unwell
 * is NO-GO whatever anyone passes, because the point is to add refusals, never to remove one.
 *
 * It reaches no environment and imports nothing, so it is safe to bundle anywhere.
 */

export type Row = Record<string, unknown>
export type ReadRows = (sql: string) => Promise<Row[]>
export type ReadHealth = () => Promise<{ status: string }[]>

/** Each of the last five runs must have succeeded in under this many seconds. */
export const CANARY_RUN_LIMIT_S = 1.0
/** During a run, a canary run slower than this aborts it. */
export const IN_RUN_CANARY_LIMIT_S = 1.5
/** During a run, any boundary (page, function, gateway call) slower than this aborts it. */
export const BOUNDARY_LIMIT_MS = 15_000
/** The heartbeat runs every minute: ten must be present in ten minutes. */
export const RUNS_REQUIRED_IN_WINDOW = 10
export const WINDOW_MINUTES = 10
/** A gap between two heartbeat runs, or since the latest, longer than this is a missing run (the schedule is one minute). */
export const MISSING_RUN_AFTER_S = 120
export const MIN_SKIP_REASON = 8

/** Auth-acceptance's own query, unchanged: the last five heartbeat runs. */
export const LAST_RUNS_SQL =
  'select round(extract(epoch from (end_time-start_time))::numeric,2)::float as d, status from cron.job_run_details where jobid = 1 order by start_time desc limit 5'

/** One round trip for the whole precondition: the last five runs, the runs in the window, and startup timeouts in the hour. */
export const PRECONDITION_SQL = `select
  (select coalesce(json_agg(r), '[]'::json) from (select round(extract(epoch from (end_time-start_time))::numeric,2)::float as d, status from cron.job_run_details where jobid = 1 order by start_time desc limit 5) r) as last5,
  (select count(*)::int from cron.job_run_details where jobid = 1 and start_time > now() - interval '${WINDOW_MINUTES} minutes') as runs_in_window,
  (select count(*)::int from cron.job_run_details where start_time > now() - interval '1 hour' and return_message ilike '%job startup timeout%') as startup_timeouts_1h`

/** For the in-run poll: the latest runs with their age, so a missing run is visible as a gap. */
export const IN_RUN_SQL =
  'select round(extract(epoch from (end_time-start_time))::numeric,2)::float as d, status, round(extract(epoch from (now()-start_time))::numeric,0)::float as age_s from cron.job_run_details where jobid = 1 order by start_time desc limit 5'

export type Check = { readonly name: string; readonly ok: boolean; readonly detail: string }

export type Verdict = {
  readonly go: boolean
  /** True when a person's `--skip-canary-because` is what let it through (only possible when nothing could be read). */
  readonly skipped: boolean
  readonly checks: readonly Check[]
  /** One sentence per reason it is NO-GO, or the skip reason when skipped. Printed by the caller. */
  readonly reasons: readonly string[]
}

/** A message with no token in it, whatever threw. */
export const clip = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e))
    .replace(/Bearer\s+\S+/gi, 'Bearer [held]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/sbp_[A-Za-z0-9]+/g, '[token]')
    .slice(0, 160)

export const judgeHealth = (rows: readonly { status: string }[]): Check => ({
  name: 'the platform reports every service healthy',
  ok: rows.length > 0 && rows.every((s) => s.status === 'ACTIVE_HEALTHY'),
  detail: rows.length === 0 ? 'no reading' : rows.map((s) => s.status).join(','),
})

type Run = { d: unknown; status: unknown }

/** The last five heartbeat runs: five rows, every one succeeded, every one under a second. */
export const judgeLastRuns = (rows: readonly Run[]): Check => ({
  name: 'the cron canary is quick and succeeding',
  ok:
    rows.length === 5 &&
    rows.every((r) => r.status === 'succeeded' && Number(r.d) < CANARY_RUN_LIMIT_S),
  detail: rows.map((r) => `${String(r.d)}s ${String(r.status)}`).join(', '),
})

export const judgeWindow = (runs: number): Check => ({
  name: `${RUNS_REQUIRED_IN_WINDOW} canary runs are present in the previous ${WINDOW_MINUTES} minutes`,
  ok: Number.isFinite(runs) && runs >= RUNS_REQUIRED_IN_WINDOW,
  detail: `${runs} present`,
})

export const judgeTimeouts = (n: number): Check => ({
  name: 'no "job startup timeout" in the last hour',
  ok: Number.isFinite(n) && n === 0,
  detail: `${n} in the last hour`,
})

/** The shape the executor hands a json column back in is an object or a string, depending on transport. */
const asRows = (v: unknown): Run[] => {
  const parsed = typeof v === 'string' ? (JSON.parse(v) as unknown) : v
  if (!Array.isArray(parsed)) throw new Error('the canary rows were not a list')
  return parsed as Run[]
}

/** Judge one row of `PRECONDITION_SQL`. A row that does not have the expected shape is NO-GO, never a pass. */
export const judgePreconditionRow = (row: Row | undefined): Check[] => {
  if (row === undefined) return [{ name: 'the canary was read', ok: false, detail: 'no row' }]
  try {
    return [
      judgeLastRuns(asRows(row.last5)),
      judgeWindow(Number(row.runs_in_window)),
      judgeTimeouts(Number(row.startup_timeouts_1h)),
    ]
  } catch (e) {
    return [{ name: 'the canary was read', ok: false, detail: `unreadable: ${clip(e)}` }]
  }
}

const never = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

/**
 * Auth-acceptance's canary, moved here without change: one retry with the reason on the page, because a safety check that
 * cannot read says why. Five rows, all succeeded, all under a second.
 */
export const readLastRunsCanary = async (
  readRows: ReadRows,
  opts: { sleep?: (ms: number) => Promise<void>; attempts?: number } = {},
): Promise<{ ok: boolean; detail: string }> => {
  const sleep = opts.sleep ?? never
  const attempts = opts.attempts ?? 2
  let why = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const rows = (await readRows(LAST_RUNS_SQL)) as Run[]
      const c = judgeLastRuns(rows)
      return { ok: c.ok, detail: c.detail }
    } catch (e) {
      why = `could not read: ${clip(e)}`
      await sleep(3000)
    }
  }
  return { ok: false, detail: why }
}

/** The Management API's health, as auth-acceptance reads it. No reading ([]) is a failure to read, judged NO-GO by the caller. */
export const fetchProviderHealth = async (
  ref: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: string }[]> =>
  fetchFn(
    `https://api.supabase.com/v1/projects/${ref}/health?services=auth&services=db&services=rest&services=storage`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) },
  )
    .then(async (r) => {
      const b = (await r.json()) as unknown
      return Array.isArray(b) ? (b as { status: string }[]) : []
    })
    .catch(() => [] as { status: string }[])

/** `--skip-canary-because=<reason>` from an argument list, or null. A reason too short to be one is refused, not ignored. */
export const parseSkipCanary = (argv: readonly string[]): string | null => {
  const hit = argv.find((a) => a.startsWith('--skip-canary-because'))
  if (hit === undefined) return null
  const reason = hit.startsWith('--skip-canary-because=')
    ? hit.slice('--skip-canary-because='.length).trim()
    : ''
  if (reason.length < MIN_SKIP_REASON)
    throw new Error(
      `REFUSED: --skip-canary-because needs a reason of at least ${MIN_SKIP_REASON} characters, written as ` +
        '--skip-canary-because="<why the canary cannot be read and this run is still worth making>". Nothing was sent.',
    )
  return reason
}

export type PreconditionDeps = {
  readonly readHealth: ReadHealth
  readonly readRows: ReadRows
  /** A person's stated reason for going ahead when the canary cannot be READ. Never overrides a bad reading. */
  readonly skipBecause?: string | null
  readonly sleep?: (ms: number) => Promise<void>
  /** Attempts at reading the canary (default 2, with a pause between). */
  readonly attempts?: number
}

/**
 * GO / NO-GO before a production run: every service healthy, the last five heartbeat runs succeeded in under a second,
 * ten runs in the previous ten minutes, and no "job startup timeout" in the last hour.
 *
 * Health is read first and a bad reading stops there: asking an unwell host for more is the load the canary exists to
 * avoid. Both reads fail closed.
 */
export const canaryPrecondition = async (deps: PreconditionDeps): Promise<Verdict> => {
  const skip = deps.skipBecause === undefined || deps.skipBecause === '' ? null : deps.skipBecause
  const sleep = deps.sleep ?? never
  const attempts = deps.attempts ?? 2
  const checks: Check[] = []
  const reasons: string[] = []

  // 1. Provider health.
  let health: { status: string }[] = []
  let healthRead = true
  try {
    health = await deps.readHealth()
  } catch {
    health = []
  }
  if (health.length === 0) healthRead = false
  const h = judgeHealth(health)
  checks.push(h)
  if (!healthRead) {
    if (skip === null)
      return {
        go: false,
        skipped: false,
        checks,
        reasons: [
          'NO-GO: the platform health could not be read (no token, a timeout, or an error). A canary that cannot be read is not a pass. ' +
            'To go ahead on purpose: --skip-canary-because="<reason>".',
        ],
      }
    reasons.push(`SKIPPED the health reading: ${skip}`)
  } else if (!h.ok) {
    return {
      go: false,
      skipped: false,
      checks,
      reasons: [
        `NO-GO: the platform does not report every service healthy (${h.detail}). Not adding load to a degraded host.`,
      ],
    }
  }

  // 2. The heartbeat canary: one query, retried once, reason kept.
  let row: Row | undefined
  let why = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      row = (await deps.readRows(PRECONDITION_SQL))[0]
      why = ''
      break
    } catch (e) {
      why = `could not read: ${clip(e)}`
      if (attempt < attempts) await sleep(3000)
    }
  }
  if (why !== '') {
    checks.push({ name: 'the canary was read', ok: false, detail: why })
    if (skip === null)
      return {
        go: false,
        skipped: false,
        checks,
        reasons: [
          `NO-GO: the heartbeat canary could not be read (${why}). A canary that cannot be read is not a pass. ` +
            'To go ahead on purpose: --skip-canary-because="<reason>".',
        ],
      }
    reasons.push(`SKIPPED the canary (${why}): ${skip}`)
    return { go: true, skipped: true, checks, reasons }
  }
  const judged = judgePreconditionRow(row)
  checks.push(...judged)
  const bad = judged.filter((c) => !c.ok)
  if (bad.length > 0)
    return {
      go: false,
      skipped: false,
      checks,
      reasons: [`NO-GO: ${bad.map((c) => `${c.name} (${c.detail})`).join('; ')}.`],
    }
  return { go: true, skipped: skip !== null && reasons.length > 0, checks, reasons }
}

export type InRunSample = {
  /** The slowest request boundary seen so far, in ms. */
  readonly boundaryMs?: number
  /** Rows from `IN_RUN_SQL`, newest first, or null when that read was not made. */
  readonly canaryRows?: readonly { d: unknown; status: unknown; age_s: unknown }[] | null
}

/**
 * The abort rule for in-run checks: any boundary over 15 s, any canary run over 1.5 s or not succeeded, or a missing run
 * (a gap longer than two minutes between runs, or since the latest). Pure: the caller polls and passes the reading.
 */
export const judgeInRun = (s: InRunSample): { abort: boolean; reasons: string[] } => {
  const reasons: string[] = []
  if (s.boundaryMs !== undefined && s.boundaryMs > BOUNDARY_LIMIT_MS)
    reasons.push(`a boundary took ${s.boundaryMs} ms (limit ${BOUNDARY_LIMIT_MS} ms)`)
  const rows = s.canaryRows
  if (rows !== undefined && rows !== null) {
    if (rows.length === 0) reasons.push('no canary run is present')
    for (const r of rows) {
      if (r.status !== 'succeeded') reasons.push(`a canary run ${String(r.status)}`)
      else if (Number(r.d) > IN_RUN_CANARY_LIMIT_S)
        reasons.push(`a canary run took ${String(r.d)} s (limit ${IN_RUN_CANARY_LIMIT_S} s)`)
    }
    const ages = rows.map((r) =>
      r.age_s === null || r.age_s === undefined ? Number.NaN : Number(r.age_s),
    )
    if (ages.some((a) => !Number.isFinite(a))) reasons.push('a canary run has no readable age')
    else {
      if (ages.length > 0 && Math.min(...ages) > MISSING_RUN_AFTER_S)
        reasons.push(`the latest canary run is ${Math.min(...ages)} s old: a run is missing`)
      const sorted = [...ages].sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i += 1)
        if ((sorted[i] as number) - (sorted[i - 1] as number) > MISSING_RUN_AFTER_S)
          reasons.push('a gap between two canary runs: a run is missing')
    }
  }
  return { abort: reasons.length > 0, reasons }
}

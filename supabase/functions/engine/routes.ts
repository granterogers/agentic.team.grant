/**
 * The engine gateway's pure half: which path is which, what each request body may contain, and how an answer from the database maps
 * onto an HTTP status. No Deno or Node API, so `tests/engines/gateway-routes.test.ts` runs every refusal by name and the function in
 * `index.ts` is only the I/O around it.
 *
 * The gateway is the bridge's ONLY door into the office (INTERFACE-CONTRACTS section 4). The bridge holds a bridge token and nothing
 * else: it never names an office (the office comes from the verified credential), never touches a table, and can only claim, heartbeat
 * and finish the one run the database hands it.
 */

export const MAX_BODY_BYTES = 65_536
/** A bridge that claims more often than this is told to slow down. Best effort per isolate; see the note on Throttle. */
export const MIN_CLAIM_GAP_MS = 5_000
export const POLL_IDLE_S = 15
export const POLL_UNHEALTHY_S = 60

export type RouteName = 'health' | 'claim' | 'heartbeat' | 'finish'

/**
 * Which route a request path names. Supabase strips `/functions/v1` before the function sees a path and the emulators keep it, so
 * both are accepted; anything that is not exactly `/engine/<route>` is no route (404), never a near miss.
 */
export const routeOf = (pathname: string): RouteName | null => {
  const m = /^(?:\/functions\/v1)?\/engine\/(health|claim|heartbeat|finish)\/?$/.exec(pathname)
  return (m?.[1] as RouteName | undefined) ?? null
}

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly field: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HERMES_RUN = /^run_[0-9a-f]{32}$/
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000

const bad = (field: string): { ok: false; field: string } => ({ ok: false, field })

export interface ClaimBody {
  readonly bridge_version: string
  readonly hermes_ok: boolean
  readonly toolsets_ok: boolean
}
export const parseClaim = (b: unknown): Parsed<ClaimBody> => {
  if (!isObject(b)) return bad('body')
  for (const k of Object.keys(b))
    if (!['bridge_version', 'hermes_ok', 'toolsets_ok'].includes(k)) return bad(k)
  if (
    typeof b.bridge_version !== 'string' ||
    b.bridge_version.length === 0 ||
    b.bridge_version.length > 40
  )
    return bad('bridge_version')
  if (typeof b.hermes_ok !== 'boolean') return bad('hermes_ok')
  if (typeof b.toolsets_ok !== 'boolean') return bad('toolsets_ok')
  return {
    ok: true,
    value: { bridge_version: b.bridge_version, hermes_ok: b.hermes_ok, toolsets_ok: b.toolsets_ok },
  }
}

export interface HeartbeatBody {
  readonly run_id: string
  readonly claim_gen: number
  readonly hermes_run_id: string | null
}
export const parseHeartbeat = (b: unknown): Parsed<HeartbeatBody> => {
  if (!isObject(b)) return bad('body')
  for (const k of Object.keys(b))
    if (!['run_id', 'claim_gen', 'hermes_run_id', 'progress'].includes(k)) return bad(k)
  if (typeof b.run_id !== 'string' || !UUID.test(b.run_id)) return bad('run_id')
  if (
    typeof b.claim_gen !== 'number' ||
    !Number.isInteger(b.claim_gen) ||
    b.claim_gen < 1 ||
    b.claim_gen > 3
  )
    return bad('claim_gen')
  let hermes: string | null = null
  if (b.hermes_run_id !== undefined && b.hermes_run_id !== null) {
    if (typeof b.hermes_run_id !== 'string' || !HERMES_RUN.test(b.hermes_run_id))
      return bad('hermes_run_id')
    hermes = b.hermes_run_id
  }
  if (b.progress !== undefined) {
    const p = b.progress
    if (!isObject(p)) return bad('progress')
    for (const k of Object.keys(p))
      if (!['events', 'tools', 'last_event'].includes(k)) return bad('progress')
    if (!isCount(p.events) || !isCount(p.tools)) return bad('progress')
    if (typeof p.last_event !== 'string' || p.last_event.length > 60) return bad('progress')
  }
  return { ok: true, value: { run_id: b.run_id, claim_gen: b.claim_gen, hermes_run_id: hermes } }
}

export interface FinishBody {
  readonly run_id: string
  readonly claim_gen: number
  readonly outcome: 'completed' | 'failed' | 'cancelled'
  readonly result: Record<string, unknown>
}
export const parseFinish = (b: unknown): Parsed<FinishBody> => {
  if (!isObject(b)) return bad('body')
  for (const k of Object.keys(b))
    if (!['run_id', 'claim_gen', 'outcome', 'result'].includes(k)) return bad(k)
  if (typeof b.run_id !== 'string' || !UUID.test(b.run_id)) return bad('run_id')
  if (
    typeof b.claim_gen !== 'number' ||
    !Number.isInteger(b.claim_gen) ||
    b.claim_gen < 1 ||
    b.claim_gen > 3
  )
    return bad('claim_gen')
  if (b.outcome !== 'completed' && b.outcome !== 'failed' && b.outcome !== 'cancelled')
    return bad('outcome')
  if (!isObject(b.result)) return bad('result')
  return {
    ok: true,
    value: { run_id: b.run_id, claim_gen: b.claim_gen, outcome: b.outcome, result: b.result },
  }
}

/** What the gateway answers, as data: a status, a body, and optionally a retry hint. */
export interface Answer {
  readonly status: number
  readonly body: Record<string, unknown>
  readonly retryAfterS?: number
}

export const badRequest = (field: string): Answer => ({
  status: 400,
  body: { error: 'bad_request', field },
})

/** The claim answer. A run handed over means the bridge will be busy, so it may ask again at once when it finishes. */
export const claimAnswer = (sql: unknown): Answer => {
  const r = (isObject(sql) ? sql : {}) as { run?: unknown; refused?: unknown }
  const run = isObject(r.run) ? r.run : null
  return {
    status: 200,
    body: {
      run,
      ...(typeof r.refused === 'string' ? { refused: r.refused } : {}),
      poll_after_s: run === null ? POLL_IDLE_S : 0,
    },
  }
}

/** What the bridge is told when its own preflight failed: nothing is claimed, and it is told to wait before trying again. */
export const unhealthyAnswer = (c: ClaimBody): Answer => ({
  status: 200,
  body: {
    run: null,
    refused: `the bridge reported that ${!c.hermes_ok ? 'Hermes is not answering' : 'a toolset other than the office is enabled'}, so nothing was handed out`,
    poll_after_s: POLL_UNHEALTHY_S,
  },
})

/** A heartbeat the database says is not this bridge's is a lost claim (409), not a stop instruction the bridge might misread. */
export const heartbeatAnswer = (sql: unknown): Answer => {
  const r = (isObject(sql) ? sql : {}) as {
    stop?: unknown
    because?: unknown
    lease_until?: unknown
  }
  if (r.stop === true && r.because === 'not yours')
    return { status: 409, body: { error: 'not_yours' } }
  return {
    status: 200,
    body: {
      stop: r.stop === true,
      because: typeof r.because === 'string' ? r.because : null,
      lease_until: typeof r.lease_until === 'string' ? r.lease_until : null,
    },
  }
}

export const finishAnswer = (sql: unknown): Answer => {
  const r = (isObject(sql) ? sql : {}) as {
    ok?: unknown
    resumed?: unknown
    state?: unknown
    error?: unknown
    because?: unknown
  }
  if (r.ok === true)
    return {
      status: 200,
      body: {
        ok: true,
        resumed: r.resumed === true,
        state: typeof r.state === 'string' ? r.state : null,
      },
    }
  if (r.error === 'not_yours') return { status: 409, body: { error: 'not_yours' } }
  if (r.error === 'not_running') return { status: 409, body: { error: 'not_running' } }
  if (r.error === 'bad_result')
    return {
      status: 400,
      body: {
        error: 'bad_request',
        field: 'result',
        because: typeof r.because === 'string' ? r.because : 'the result was not acceptable',
      },
    }
  if (r.error === 'bad_outcome') return badRequest('outcome')
  return { status: 503, body: { error: 'unavailable' }, retryAfterS: 30 }
}

/**
 * How a failure of the database call maps. A PostgREST 403 is the database refusing an inactive office (`no_office`): the bridge is told
 * the office is not active, not that the database is down. Anything else, including a thrown network error, is "back off": a bridge
 * that retried in a tight loop against a database in trouble would be the problem rather than the symptom.
 */
export const upstreamAnswer = (status: number | null): Answer =>
  status === 403
    ? { status: 403, body: { error: 'disabled', because: 'this office is not active' } }
    : { status: 503, body: { error: 'unavailable' }, retryAfterS: 30 }

/**
 * A claim throttle that remembers each bridge's last claim in memory. An edge isolate is reused for a while and replaced without notice,
 * so this is a courtesy that stops a runaway bridge hammering one warm isolate, not a guarantee: the bridge's own 15 second poll is the
 * rate, and the database work behind a claim is a single indexed read. It never refuses the FIRST claim of an isolate.
 */
export class Throttle {
  private readonly last = new Map<string, number>()
  constructor(
    private readonly gapMs: number = MIN_CLAIM_GAP_MS,
    private readonly now: () => number = Date.now,
  ) {}
  /** Null when the claim may go ahead, else how many whole seconds to wait. */
  check(bridge: string): number | null {
    const t = this.now()
    const before = this.last.get(bridge)
    if (before !== undefined && t - before < this.gapMs)
      return Math.max(1, Math.ceil((this.gapMs - (t - before)) / 1000))
    this.last.set(bridge, t)
    if (this.last.size > 500)
      for (const [k, v] of this.last) if (t - v > this.gapMs * 4) this.last.delete(k)
    return null
  }
}

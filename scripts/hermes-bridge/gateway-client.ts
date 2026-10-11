/**
 * The bridge's client for the office's engine gateway (INTERFACE-CONTRACTS section 4): claim, heartbeat, finish.
 *
 * The bridge never names an office and never sends an office id: the gateway takes it from the bridge token. Every call answers a
 * typed result instead of throwing, so the bridge's loop decides what each failure means (a lost claim is not a retry, a 503 is a
 * back-off, a 401 is a stop) in one place.
 */
import type {
  ClaimedRun,
  EngineOutcome,
  EngineRunResult,
  FinishAnswer,
  HeartbeatAnswer,
} from '../../src/engines/hermes/types.ts'
import type { Fetch } from './hermes-client.ts'

export type GatewayFailure =
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'not_yours' }
  | { readonly kind: 'not_running' }
  | { readonly kind: 'rate_limited'; readonly retryAfterS: number }
  | { readonly kind: 'unavailable'; readonly retryAfterS: number }
  | { readonly kind: 'bad_request'; readonly field: string }
  | { readonly kind: 'other'; readonly status: number }

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GatewayFailure }

export interface ClaimAnswerBody {
  readonly run: ClaimedRun | null
  readonly poll_after_s: number
  readonly refused?: string
}

const REQUEST_MS = 15_000
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export class GatewayClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
    private readonly fetcher: Fetch = (i, init) => fetch(i, init),
  ) {}

  private async post<T>(path: string, body: unknown): Promise<Result<T>> {
    let response: Response
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_MS),
      })
    } catch {
      return { ok: false, error: { kind: 'unavailable', retryAfterS: 15 } }
    }
    const text = await response.text().catch(() => '')
    let parsed: unknown = null
    try {
      parsed = text === '' ? null : JSON.parse(text)
    } catch {
      /* a non-JSON body is treated by status alone */
    }
    const o = isObject(parsed) ? parsed : {}
    const retry = Number(response.headers.get('retry-after') ?? o.retry_after_s ?? 15)
    const retryAfterS = Number.isFinite(retry) && retry > 0 ? Math.min(retry, 300) : 15
    if (response.status === 200) return { ok: true, value: parsed as T }
    if (response.status === 401) return { ok: false, error: { kind: 'unauthorized' } }
    if (response.status === 409)
      return {
        ok: false,
        error: { kind: o.error === 'not_running' ? 'not_running' : 'not_yours' },
      }
    if (response.status === 429) return { ok: false, error: { kind: 'rate_limited', retryAfterS } }
    if (response.status === 503 || response.status === 502 || response.status === 504)
      return { ok: false, error: { kind: 'unavailable', retryAfterS } }
    if (response.status === 400)
      return {
        ok: false,
        error: { kind: 'bad_request', field: typeof o.field === 'string' ? o.field : 'body' },
      }
    return { ok: false, error: { kind: 'other', status: response.status } }
  }

  claim(body: {
    bridge_version: string
    hermes_ok: boolean
    toolsets_ok: boolean
  }): Promise<Result<ClaimAnswerBody>> {
    return this.post('/claim', body)
  }

  heartbeat(body: {
    run_id: string
    claim_gen: number
    hermes_run_id?: string
    progress: { events: number; tools: number; last_event: string }
  }): Promise<Result<HeartbeatAnswer>> {
    return this.post('/heartbeat', body)
  }

  finish(body: {
    run_id: string
    claim_gen: number
    outcome: EngineOutcome
    result: EngineRunResult
  }): Promise<Result<FinishAnswer>> {
    return this.post('/finish', body)
  }
}

/**
 * The bridge's client for the Hermes API on this machine: exactly the calls INTERFACE-CONTRACTS section 5 lists, nothing else.
 *
 * Every shape here was OBSERVED against a real Hermes (scripts/hermes-m0/m5-observe.ts), not read from source:
 *   GET /health                    200 {status: 'ok'}
 *   GET /v1/capabilities           {features: {run_events_sse, run_stop, approval_events, ...}}
 *   GET /v1/toolsets               {data: [{name, enabled, tools}]}
 *   POST /v1/runs                  202 {run_id: 'run_<32 hex>', status: 'started', replayed: boolean}; 409 conflicting key; 429 busy
 *   GET /v1/runs/<id>              {status: started|running|completed|failed|cancelled|interrupted, output?, error?, usage?, runtime?}
 *   POST /v1/runs/<id>/stop        200 {status: 'stopping'}
 *   GET /v1/runs/<id>/events       text/event-stream; `id:` is the sequence number, `data:` one JSON object carrying `event`
 *   POST /v1/runs/<id>/approval    {choice, request_id?}
 */
import { type SseEvent, SseParser } from './sse.ts'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface Started {
  readonly status: number
  readonly runId: string | null
  readonly replayed: boolean
  readonly body: unknown
}

export interface RunStatus {
  readonly status: string
  readonly output: string | null
  readonly error: string | null
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number } | null
  readonly model: string | null
  readonly interrupted: boolean
  readonly turnExitReason: string | null
}

const REQUEST_MS = 10_000
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export class HermesClient {
  constructor(
    private readonly base: string,
    private readonly key: string,
    private readonly fetcher: Fetch = (i, init) => fetch(i, init),
  ) {}

  private async call(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: unknown }> {
    const response = await this.fetcher(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.key}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_MS),
    })
    const text = await response.text()
    let parsed: unknown = text
    try {
      parsed = text === '' ? null : JSON.parse(text)
    } catch {
      /* keep the text */
    }
    return { status: response.status, body: parsed }
  }

  /** Liveness. Never throws: an unreachable Hermes is `false`. */
  async healthy(): Promise<boolean> {
    try {
      return (await this.call('GET', '/health')).status === 200
    } catch {
      return false
    }
  }

  /** The three features the bridge relies on, all true, or false. */
  async capable(): Promise<boolean> {
    try {
      const r = await this.call('GET', '/v1/capabilities')
      const f = isObject(r.body) && isObject(r.body.features) ? r.body.features : {}
      return (
        r.status === 200 &&
        f.run_events_sse === true &&
        f.run_stop === true &&
        f.approval_events === true
      )
    } catch {
      return false
    }
  }

  /** The names of every ENABLED toolset (null when the list could not be read). */
  async enabledToolsets(): Promise<string[] | null> {
    try {
      const r = await this.call('GET', '/v1/toolsets')
      if (r.status !== 200 || !isObject(r.body) || !Array.isArray(r.body.data)) return null
      return r.body.data
        .filter((t): t is Record<string, unknown> => isObject(t) && t.enabled === true)
        .map((t) => String(t.name))
    } catch {
      return null
    }
  }

  async startRun(body: string, idempotencyKey: string): Promise<Started> {
    const r = await this.call('POST', '/v1/runs', body, { 'idempotency-key': idempotencyKey })
    const o = isObject(r.body) ? r.body : {}
    return {
      status: r.status,
      runId: typeof o.run_id === 'string' ? o.run_id : null,
      replayed: o.replayed === true,
      body: r.body,
    }
  }

  async run(runId: string): Promise<RunStatus | null> {
    const r = await this.call('GET', `/v1/runs/${encodeURIComponent(runId)}`)
    if (r.status !== 200 || !isObject(r.body)) return null
    const o = r.body
    const usage = isObject(o.usage)
      ? { input_tokens: num(o.usage.input_tokens), output_tokens: num(o.usage.output_tokens) }
      : null
    return {
      status: typeof o.status === 'string' ? o.status : 'unknown',
      output: typeof o.output === 'string' ? o.output : null,
      error: typeof o.error === 'string' ? o.error : null,
      usage,
      model: isObject(o.runtime) && typeof o.runtime.model === 'string' ? o.runtime.model : null,
      interrupted: o.interrupted === true,
      turnExitReason: typeof o.turn_exit_reason === 'string' ? o.turn_exit_reason : null,
    }
  }

  /** Ask Hermes to stop a run. Best effort: a run that is already over, or unknown, is not an error. */
  async stop(runId: string): Promise<void> {
    try {
      await this.call('POST', `/v1/runs/${encodeURIComponent(runId)}/stop`, {})
    } catch {
      /* the caller keeps reading until the run is terminal or its own wait runs out */
    }
  }

  async deny(runId: string, requestId: string | null): Promise<boolean> {
    try {
      const r = await this.call('POST', `/v1/runs/${encodeURIComponent(runId)}/approval`, {
        choice: 'deny',
        ...(requestId === null ? {} : { request_id: requestId }),
      })
      return r.status === 200
    } catch {
      return false
    }
  }

  /**
   * Read a run's event stream until it ends or `signal` aborts. Yields each parsed event. A dropped connection ends the generator
   * normally: the caller decides whether to reconnect (with `lastEventId`) or to read the run's terminal status instead.
   */
  async *events(
    runId: string,
    options: { lastEventId?: number; signal: AbortSignal },
  ): AsyncGenerator<SseEvent> {
    const response = await this.fetcher(
      `${this.base}/v1/runs/${encodeURIComponent(runId)}/events`,
      {
        headers: {
          authorization: `Bearer ${this.key}`,
          accept: 'text/event-stream',
          ...(options.lastEventId === undefined
            ? {}
            : { 'last-event-id': String(options.lastEventId) }),
        },
        signal: options.signal,
      },
    )
    if (response.status !== 200 || response.body === null) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`the event stream answered ${String(response.status)}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const parser = new SseParser()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        for (const event of parser.push(decoder.decode(value, { stream: true }))) yield event
      }
    } finally {
      await reader.cancel().catch(() => undefined)
    }
  }
}

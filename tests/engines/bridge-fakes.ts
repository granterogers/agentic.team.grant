// biome-ignore-all format: dense fake servers kept readable as written
/**
 * A fake Hermes API and a fake engine gateway on loopback, for the bridge's tests. Nothing here is the real thing: they record every
 * request and answer what the test scripts. The bridge talks to them through its real clients over real HTTP.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

// ------------------------------------------------------------------------------------------------------------------------------
// Hermes
// ------------------------------------------------------------------------------------------------------------------------------

export interface ScriptedEvent {
  readonly afterMs: number
  readonly data: Record<string, unknown>
}

export interface FakeRun {
  readonly id: string
  readonly events: { seq: number; data: Record<string, unknown> }[]
  status: string
  output: string | null
  error: string | null
  stopped: boolean
  /** Connections of the event stream opened so far. */
  streams: { lastEventId: string | null }[]
}

export interface Behaviour {
  /** What starting a run answers (default 202). */
  readonly start?: { status: number; body?: Record<string, unknown> }
  /** The events the run emits, in order, each after its delay. A terminal one ends the run. */
  readonly script?: readonly ScriptedEvent[]
  /** Close the event stream after this many events have been sent on a connection (once per connection count). */
  readonly dropStreamAfter?: number
  /** Answer 500 on every event-stream request. */
  readonly streamBroken?: boolean
  /** Make GET /v1/runs/<id> report this terminal status and output (used when the stream cannot be kept). */
  readonly finalStatus?: { status: string; output?: string; error?: string }
}

let counter = 0
export const hermesId = (): string => `run_${(++counter).toString(16).padStart(32, '0')}`

export class FakeHermes {
  server: Server
  port = 0
  readonly key = 'k'.repeat(40)
  healthy = true
  features: Record<string, boolean> = { run_events_sse: true, run_stop: true, approval_events: true }
  toolsets: { name: string; enabled: boolean }[] = [{ name: 'office', enabled: true }, { name: 'terminal', enabled: false }]
  readonly runs = new Map<string, FakeRun>()
  readonly started: { key: string | null; body: Record<string, unknown>; raw: string; id: string }[] = []
  readonly stops: string[] = []
  readonly approvals: { run: string; body: Record<string, unknown> }[] = []
  readonly order: string[] = []
  /** The behaviour for the next run started; falls back to `defaults`. */
  queue: Behaviour[] = []
  defaults: Behaviour = { script: [{ afterMs: 5, data: { event: 'run.completed', output: 'ok', usage: { input_tokens: 3, output_tokens: 2 }, runtime: { model: 'm:free' } } }] }
  private readonly behaviours = new Map<string, Behaviour>()

  constructor() {
    this.server = createServer((req, res) => void this.handle(req, res))
  }

  async start(): Promise<void> {
    this.port = await listen(this.server)
  }
  get url(): string {
    return `http://127.0.0.1:${String(this.port)}`
  }
  async stop(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>((r) => this.server.close(() => r()))
  }

  /** Register a run that already exists (a re-attach), with a behaviour for its stream. */
  adopt(id: string, behaviour: Behaviour): FakeRun {
    const run: FakeRun = { id, events: [], status: 'running', output: null, error: null, stopped: false, streams: [] }
    this.runs.set(id, run)
    this.behaviours.set(id, behaviour)
    this.play(run, behaviour)
    return run
  }

  private play(run: FakeRun, b: Behaviour): void {
    let seq = 0
    let at = 0
    for (const ev of b.script ?? []) {
      at += ev.afterMs
      const s = seq++
      setTimeout(() => {
        if (run.stopped || run.status !== 'running') return
        run.events.push({ seq: s, data: { run_id: run.id, seq: s, ...ev.data } })
        const name = String(ev.data.event)
        if (name === 'run.completed') {
          run.status = 'completed'
          run.output = String(ev.data.output ?? '')
        } else if (name === 'run.failed') {
          run.status = 'failed'
          run.error = String(ev.data.error ?? '')
        } else if (name === 'run.cancelled') run.status = 'cancelled'
        else if (name === 'run.interrupted') run.status = 'interrupted'
      }, at)
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    const raw = req.method === 'GET' ? '' : await readBody(req)
    if (path === '/health') return json(res, this.healthy ? 200 : 503, { status: this.healthy ? 'ok' : 'down' })
    if (req.headers.authorization !== `Bearer ${this.key}`) return json(res, 401, { error: 'unauthorized' })
    if (path === '/v1/capabilities') return json(res, 200, { object: 'hermes.api_server.capabilities', features: this.features })
    if (path === '/v1/toolsets') return json(res, 200, { object: 'list', data: this.toolsets })
    if (path === '/v1/runs' && req.method === 'POST') {
      this.order.push('POST /v1/runs')
      const b = this.queue.shift() ?? this.defaults
      const id = hermesId()
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(raw)
      } catch {
        /* recorded raw */
      }
      this.started.push({ key: (req.headers['idempotency-key'] as string | undefined) ?? null, body, raw, id })
      if (b.start !== undefined && b.start.status !== 202) return json(res, b.start.status, b.start.body ?? { error: 'refused' })
      const run: FakeRun = { id, events: [], status: 'running', output: null, error: null, stopped: false, streams: [] }
      this.runs.set(id, run)
      this.behaviours.set(id, b)
      this.play(run, b)
      return json(res, 202, { run_id: b.start?.body?.run_id ?? id, status: 'started', replayed: false })
    }
    const m = /^\/v1\/runs\/([^/]+)(?:\/(stop|events|approval))?$/.exec(path)
    if (m === null) return json(res, 404, { error: 'not found' })
    const run = this.runs.get(decodeURIComponent(m[1] ?? ''))
    const sub = m[2]
    if (run === undefined) return json(res, 404, { error: 'unknown run' })
    if (sub === 'stop') {
      this.order.push(`stop ${run.id}`)
      this.stops.push(run.id)
      run.stopped = true
      if (run.status === 'running') {
        setTimeout(() => {
          run.status = 'cancelled'
          run.events.push({ seq: run.events.length, data: { run_id: run.id, event: 'run.cancelled', seq: run.events.length } })
        }, 10)
      }
      return json(res, 200, { run_id: run.id, status: 'stopping' })
    }
    if (sub === 'approval') {
      this.approvals.push({ run: run.id, body: JSON.parse(raw || '{}') })
      return json(res, 200, { ok: true })
    }
    if (sub === 'events') return void this.stream(req, res, run)
    const b = this.behaviours.get(run.id)
    if (b?.finalStatus !== undefined && run.status === 'running') {
      return json(res, 200, { run_id: run.id, ...b.finalStatus })
    }
    return json(res, 200, { run_id: run.id, status: run.status, output: run.output ?? undefined, error: run.error ?? undefined })
  }

  private stream(req: IncomingMessage, res: ServerResponse, run: FakeRun): void {
    const b = this.behaviours.get(run.id) ?? {}
    const last = (req.headers['last-event-id'] as string | undefined) ?? null
    run.streams.push({ lastEventId: last })
    if (b.streamBroken === true) {
      res.writeHead(500)
      res.end('broken')
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
    let sent = last === null ? 0 : Number(last) + 1
    let sentOnThis = 0
    const timer = setInterval(() => {
      for (const e of run.events) {
        if (e.seq < sent) continue
        res.write(`id: ${String(e.seq)}\nevent: message\ndata: ${JSON.stringify(e.data)}\n\n`)
        sent = e.seq + 1
        sentOnThis += 1
        if (b.dropStreamAfter !== undefined && run.streams.length === 1 && sentOnThis >= b.dropStreamAfter) {
          clearInterval(timer)
          res.destroy()
          return
        }
      }
      const terminal = run.events.some((e) => /^run\.(completed|failed|cancelled|interrupted)$/.test(String(e.data.event)))
      if (terminal && sent >= run.events.length) {
        clearInterval(timer)
        res.end()
      }
    }, 5)
    req.on('close', () => clearInterval(timer))
  }
}

// ------------------------------------------------------------------------------------------------------------------------------
// The engine gateway
// ------------------------------------------------------------------------------------------------------------------------------

export interface Recorded {
  readonly path: string
  /** The query string with its `?`, or empty. */
  readonly query?: string
  readonly auth: string | null
  readonly body: Record<string, unknown>
}

export class FakeGateway {
  server: Server
  port = 0
  readonly calls: Recorded[] = []
  /** Answers for successive claims; the last is repeated. */
  claims: { status?: number; body: Record<string, unknown> }[] = [{ body: { run: null, poll_after_s: 15 } }]
  /** What a heartbeat answers. */
  heartbeat: (n: number, body: Record<string, unknown>) => { status: number; body: Record<string, unknown> } = () => ({ status: 200, body: { stop: false, because: null, lease_until: null } })
  /** What a finish answers (n counts finishes). */
  finish: (n: number) => { status: number; body: Record<string, unknown>; headers?: Record<string, string> } = () => ({ status: 200, body: { ok: true, resumed: true, state: 'completed' } })
  /** What the skills read answers (M8b). */
  skills: (query: string) => { status: number; body: Record<string, unknown> } = () => ({ status: 200, body: { skills: [], generated_at: null } })
  /** What a skill proposal answers (M8b). */
  proposal: (body: Record<string, unknown>) => { status: number; body: Record<string, unknown> } = () => ({ status: 200, body: { ok: true, suggestion_id: '55555555-5555-4555-8555-555555555555' } })
  /** The method each call used, in order, beside `calls`. */
  readonly methods: string[] = []
  private claimN = 0
  private beatN = 0
  private finishN = 0

  constructor() {
    this.server = createServer((req, res) => void this.handle(req, res))
  }
  async start(): Promise<void> {
    this.port = await listen(this.server)
  }
  get url(): string {
    return `http://127.0.0.1:${String(this.port)}/functions/v1/engine`
  }
  async stop(): Promise<void> {
    this.server.closeAllConnections()
    await new Promise<void>((r) => this.server.close(() => r()))
  }
  of(path: string): Recorded[] {
    return this.calls.filter((c) => c.path === path)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const full = (req.url ?? '').replace('/functions/v1/engine', '')
    const path = full.split('?')[0] ?? full
    this.methods.push(req.method ?? '')
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(raw || '{}')
    } catch {
      /* recorded empty */
    }
    this.calls.push({ path, query: full.slice(path.length), auth: (req.headers.authorization as string | undefined) ?? null, body })
    if (path === '/skills') {
      const a = this.skills(full.slice(path.length))
      return json(res, a.status, a.body)
    }
    if (path === '/proposal') {
      const a = this.proposal(body)
      return json(res, a.status, a.body)
    }
    if (path === '/claim') {
      const a = this.claims[Math.min(this.claimN++, this.claims.length - 1)] ?? { body: {} }
      return json(res, a.status ?? 200, a.body)
    }
    if (path === '/heartbeat') {
      const a = this.heartbeat(++this.beatN, body)
      return json(res, a.status, a.body)
    }
    if (path === '/finish') {
      const a = this.finish(++this.finishN)
      return json(res, a.status, a.body, a.headers ?? {})
    }
    return json(res, 404, { error: 'not found' })
  }
}

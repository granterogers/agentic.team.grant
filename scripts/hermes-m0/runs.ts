/**
 * Drives Hermes's real /v1/runs API: start a run, read its server-sent events, wait for a terminal status.
 * The event names and fields are those documented in docs/hermes/INTERFACE-CONTRACTS.md section 5.2.
 */
import { type HermesHost, hermes } from './hermes-host.ts'
import { sleep } from './lib.ts'

export interface RunEvent {
  readonly event: string
  readonly [k: string]: unknown
}

export const TERMINAL = ['completed', 'failed', 'cancelled', 'interrupted']

export interface Started {
  readonly status: number
  readonly runId: string | null
  readonly body: unknown
}

export const startRun = async (
  host: HermesHost,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Started> => {
  const r = await hermes(host, 'POST', '/v1/runs', body, headers)
  const id = (r.body as { run_id?: unknown } | null)?.run_id
  return { status: r.status, runId: typeof id === 'string' ? id : null, body: r.body }
}

/** Read the SSE stream for a run until it closes, a terminal event arrives, or the timeout passes. */
export const readEvents = async (
  host: HermesHost,
  runId: string,
  options: { timeoutMs?: number; lastEventId?: number; stopAfter?: (e: RunEvent) => boolean } = {},
): Promise<{ events: RunEvent[]; ids: number[]; closed: boolean }> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000)
  const events: RunEvent[] = []
  const ids: number[] = []
  let closed = false
  try {
    const response = await fetch(`${host.url}/v1/runs/${runId}/events`, {
      headers: {
        authorization: `Bearer ${host.key}`,
        accept: 'text/event-stream',
        ...(options.lastEventId === undefined
          ? {}
          : { 'last-event-id': String(options.lastEventId) }),
      },
      signal: controller.signal,
    })
    const reader = response.body?.getReader()
    if (reader === undefined) return { events, ids, closed: true }
    const decoder = new TextDecoder()
    let buffer = ''
    let currentId: number | null = null
    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        closed = true
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let cut = buffer.indexOf('\n\n')
      while (cut !== -1) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        for (const line of block.split('\n')) {
          if (line.startsWith('id:')) currentId = Number(line.slice(3).trim())
          if (line.startsWith('data:')) {
            try {
              const parsed = JSON.parse(line.slice(5).trim()) as RunEvent
              events.push(parsed)
              ids.push(currentId ?? -1)
              if (options.stopAfter?.(parsed) === true) {
                controller.abort()
                return { events, ids, closed: false }
              }
            } catch {
              /* a comment or keep-alive */
            }
          }
        }
        cut = buffer.indexOf('\n\n')
      }
      if (events.some((e) => e.event.startsWith('run.') && TERMINAL.includes(e.event.slice(4)))) {
        // The stream normally ends itself; give it a moment, then stop reading.
        await sleep(200)
      }
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') throw error
  } finally {
    clearTimeout(timer)
  }
  return { events, ids, closed }
}

export const status = async (host: HermesHost, runId: string): Promise<Record<string, unknown>> =>
  ((await hermes(host, 'GET', `/v1/runs/${runId}`)).body ?? {}) as Record<string, unknown>

export const waitTerminal = async (
  host: HermesHost,
  runId: string,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> => {
  const until = Date.now() + timeoutMs
  for (;;) {
    const s = await status(host, runId)
    if (typeof s.status === 'string' && TERMINAL.includes(s.status)) return s
    if (Date.now() > until) return { ...s, timedOut: true }
    await sleep(300)
  }
}

/** Convenience: run one input to the end and return its status, events and final output text. */
export const runToEnd = async (
  host: HermesHost,
  input: string,
  extra: Record<string, unknown> = {},
  timeoutMs = 60_000,
): Promise<{
  started: Started
  events: RunEvent[]
  final: Record<string, unknown>
  output: string
}> => {
  const started = await startRun(host, { input, ...extra })
  if (started.runId === null) return { started, events: [], final: {}, output: '' }
  const { events } = await readEvents(host, started.runId, { timeoutMs })
  const final = await waitTerminal(host, started.runId, timeoutMs)
  const output = String(
    final.output ?? events.find((e) => e.event === 'run.completed')?.output ?? '',
  )
  return { started, events, final, output }
}

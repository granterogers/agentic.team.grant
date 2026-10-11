/**
 * A local guard between Hermes and a real model provider, for the M0 free-inference experiments (V5, V6 substitute, V8).
 *
 * Why it exists: the only credential available in the build environment is the office's own funded OpenRouter key, which
 * Hermes must never hold (HD-12). So Hermes is given a dummy key and this proxy's address; the real key lives only in this
 * process. The proxy:
 *   1. forwards a request ONLY when its model is in the allowlist (checked against the live catalogue: every price field is
 *      exactly zero, context >= 64,000, tools supported), and refuses everything else with a 403 and a log line;
 *   2. removes the routing fields that could send a request to a different (paid) model (`models`, `route`, provider fallbacks);
 *   3. asks OpenRouter to report each call's cost (`usage.include`), so cost is measured per call and not assumed;
 *   4. enforces a hard cap on upstream calls for the whole run, to protect the shared free-model quota.
 * Every decision is appended to a JSONL log. The upstream credential is never written anywhere.
 */
import { appendFileSync } from 'node:fs'
import { type CatalogueModel, isZeroPriced } from './catalogue.ts'
import { close, listen, newServer, readBody, scrub, sendJson } from './lib.ts'

export interface GuardOptions {
  readonly upstreamKey: string
  readonly allowed: ReadonlySet<string>
  readonly maxUpstreamCalls: number
  readonly logFile: string
  /** OpenRouter's model catalogue entries, served back for Hermes's context-length detection. */
  readonly catalogue: readonly CatalogueModel[]
}

export interface GuardCall {
  readonly model: string
  readonly verdict: 'forwarded' | 'blocked_model' | 'blocked_cap'
  readonly status: number
  readonly ms: number
  readonly promptTokens: number | null
  readonly completionTokens: number | null
  readonly cost: number | null
  readonly removed: readonly string[]
  readonly error: string | null
  /** The provider's id for the generation (gen-...), so its true cost can be looked up afterwards. */
  readonly generationId?: string | null
}

export interface Guard {
  readonly url: string
  readonly calls: GuardCall[]
  /** Upstream calls made so far (blocked ones do not count). */
  upstreamCalls: () => number
  stop: () => Promise<void>
}

const UPSTREAM = 'https://openrouter.ai/api/v1'

export const startGuard = async (o: GuardOptions): Promise<Guard> => {
  const calls: GuardCall[] = []
  let upstream = 0
  const record = (c: GuardCall): void => {
    calls.push(c)
    appendFileSync(o.logFile, `${JSON.stringify({ at: Date.now(), ...c })}\n`)
  }
  // The catalogue entries Hermes asks about, served from memory so no extra upstream call is made.
  const catalogueResponse = { object: 'list', data: o.catalogue.filter((m) => o.allowed.has(m.id)) }

  const server = newServer(async (req, res) => {
    const url = req.url ?? ''
    if (req.method === 'GET' && (url === '/v1/models' || url.startsWith('/v1/models?'))) {
      sendJson(res, 200, catalogueResponse)
      return
    }
    if (req.method !== 'POST' || !url.startsWith('/v1/chat/completions')) {
      sendJson(res, 404, {
        error: { message: 'the guard serves chat completions and the model list only' },
      })
      return
    }
    const started = Date.now()
    const body = JSON.parse((await readBody(req, 8_000_000)) || '{}') as Record<string, unknown>
    const model = String(body.model ?? '')
    const removed: string[] = []
    if (!o.allowed.has(model)) {
      record({
        model,
        verdict: 'blocked_model',
        status: 403,
        ms: 0,
        promptTokens: null,
        completionTokens: null,
        cost: null,
        removed,
        error: 'not in the zero-priced allowlist',
      })
      sendJson(res, 403, {
        error: { message: `guard: model ${model} is not on the zero-priced allowlist` },
      })
      return
    }
    if (upstream >= o.maxUpstreamCalls) {
      record({
        model,
        verdict: 'blocked_cap',
        status: 429,
        ms: 0,
        promptTokens: null,
        completionTokens: null,
        cost: null,
        removed,
        error: 'call cap reached',
      })
      sendJson(res, 429, {
        error: { message: 'guard: the upstream call cap for this run is reached' },
      })
      return
    }
    // Remove routing that could leave the allowlisted model.
    for (const field of ['models', 'route', 'transforms']) {
      if (field in body) {
        delete body[field]
        removed.push(field)
      }
    }
    const provider =
      typeof body.provider === 'object' && body.provider !== null
        ? { ...(body.provider as Record<string, unknown>) }
        : {}
    if (provider.allow_fallbacks !== false) removed.push('provider.allow_fallbacks')
    provider.allow_fallbacks = false
    body.provider = provider
    // Measure cost per call.
    body.usage = { include: true }
    if (body.stream === true) body.stream_options = { include_usage: true }

    upstream += 1
    let status = 0
    let promptTokens: number | null = null
    let completionTokens: number | null = null
    let cost: number | null = null
    let error: string | null = null
    let generationId: string | null = null
    try {
      const response = await fetch(`${UPSTREAM}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${o.upstreamKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      status = response.status
      const text = await response.text()
      // Usage and cost: a JSON body, or the last usage-bearing line of an event stream.
      const scan = (obj: unknown): void => {
        const id = (obj as { id?: unknown } | null)?.id
        if (generationId === null && typeof id === 'string' && id.startsWith('gen-'))
          generationId = id
        const usage = (
          obj as {
            usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
          } | null
        )?.usage
        if (usage === undefined || usage === null) return
        promptTokens = usage.prompt_tokens ?? promptTokens
        completionTokens = usage.completion_tokens ?? completionTokens
        cost = usage.cost ?? cost
      }
      if (body.stream === true) {
        for (const line of text.split('\n')) {
          if (!line.startsWith('data:') || line.includes('[DONE]')) continue
          try {
            scan(JSON.parse(line.slice(5).trim()))
          } catch {
            /* a keep-alive comment */
          }
        }
      } else {
        try {
          const parsed = JSON.parse(text) as { error?: { message?: string } }
          scan(parsed)
          if (parsed.error?.message !== undefined) error = scrub(parsed.error.message).slice(0, 200)
        } catch {
          error = 'unparseable upstream body'
        }
      }
      if (status >= 400 && error === null) error = scrub(text).slice(0, 200)
      res.writeHead(status, {
        'content-type': response.headers.get('content-type') ?? 'application/json',
      })
      res.end(text)
    } catch (e) {
      error = scrub(String((e as Error).message)).slice(0, 200)
      status = 502
      sendJson(res, 502, { error: { message: 'guard: upstream unreachable' } })
    }
    record({
      model,
      verdict: 'forwarded',
      status,
      ms: Date.now() - started,
      promptTokens,
      completionTokens,
      cost,
      removed,
      error,
      generationId,
    })
  })
  const port = await listen(server, 0)
  return {
    url: `http://127.0.0.1:${String(port)}`,
    calls,
    upstreamCalls: () => upstream,
    stop: () => close(server),
  }
}

export { isZeroPriced }

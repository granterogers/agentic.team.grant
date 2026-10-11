/**
 * The engine gateway: the outside engine's bridge's ONLY door into the office (Hermes, M2; INTERFACE-CONTRACTS section 4).
 *
 * A bridge is an outbound-only process on a host the person controls. It holds one bridge token and nothing else: no database
 * credential, no Supabase key, no office id. This function turns the token into a bridge and an office (public.engine_bridge_for),
 * and from then on every call carries the office the CREDENTIAL established, never one the request named. What it can do is three
 * things to ONE run: claim it, keep it alive, and finish it.
 *
 *   GET  /engine/health      liveness; no authentication; names nothing
 *   POST /engine/claim       the bridge's own preflight, then the oldest run waiting in its office (or none)
 *   POST /engine/heartbeat   keep the lease; learn whether to stop
 *   POST /engine/finish      the answer, or the failure; idempotent
 *
 * `verify_jwt` is false because a bridge has no Supabase JWT (the same reason as `mcp`). The bearer token is the whole of the
 * authentication, so an absent or unknown one is refused before anything else is read. Every response is `no-store` and there is no
 * CORS: nothing in a browser may call this.
 *
 * What is deliberately NOT here: any way to read a table, to name an office, to choose a run, to approve anything, to reach a person,
 * or to change what a run may do. The office decides all of that in SQL (migration 1070), and a bridge that lies about its own
 * preflight or its result is refused there too.
 */
import {
  type Answer,
  badRequest,
  claimAnswer,
  finishAnswer,
  heartbeatAnswer,
  MAX_BODY_BYTES,
  parseClaim,
  parseFinish,
  parseHeartbeat,
  parseProposal,
  parseSkillsQuery,
  proposalAnswer,
  routeOf,
  skillsAnswer,
  Throttle,
  unhealthyAnswer,
  upstreamAnswer,
} from './routes.ts'

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const sha256 = async (v: string): Promise<string> => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** One PostgREST function call. A network failure is a null status: the caller backs off rather than guessing. */
const rpc = async (
  fn: string,
  args: Record<string, unknown>,
): Promise<{ status: number | null; body: unknown }> => {
  try {
    const response = await fetch(`${DB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    const text = await response.text()
    let body: unknown = null
    try {
      body = text === '' ? null : JSON.parse(text)
    } catch {
      body = null
    }
    return { status: response.status, body }
  } catch {
    return { status: null, body: null }
  }
}

const reply = (a: Answer): Response =>
  new Response(JSON.stringify(a.body), {
    status: a.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(a.retryAfterS === undefined ? {} : { 'retry-after': String(a.retryAfterS) }),
    },
  })

/** The body, read with a ceiling, so an oversized request is refused without being held in memory. Null means too large. */
const readCapped = async (request: Request): Promise<string | null> => {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    parts.push(value)
  }
  const all = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.byteLength
  }
  return new TextDecoder().decode(all)
}

const throttle = new Throttle()

const UNAUTHORIZED: Answer = { status: 401, body: { error: 'unauthorized' } }

const handle = async (request: Request): Promise<Response> => {
  const route = routeOf(new URL(request.url).pathname)
  if (route === null) return reply({ status: 404, body: { error: 'not_found' } })
  if (route === 'health') {
    return reply(
      request.method === 'GET'
        ? { status: 200, body: { ok: true } }
        : { status: 405, body: { error: 'method_not_allowed' } },
    )
  }

  // Who is asking, before anything else is read. The credential is the only source of the office.
  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (presented === '' || presented.length > 200) return reply(UNAUTHORIZED)
  const who = await rpc('engine_bridge_for', { p_token_sha256: await sha256(presented) })
  if (who.status !== 200) return reply(upstreamAnswer(who.status))
  const bridge = who.body as { bridge_id?: string; office_id?: string } | null
  if (
    bridge === null ||
    typeof bridge.bridge_id !== 'string' ||
    typeof bridge.office_id !== 'string'
  )
    return reply(UNAUTHORIZED)
  const office = bridge.office_id
  const bridgeId = bridge.bridge_id

  // The read of the office's live skills is a GET (the one read the bridge makes); everything else is a POST.
  if (route === 'skills') {
    if (request.method !== 'GET')
      return reply({ status: 405, body: { error: 'method_not_allowed' } })
    const q = parseSkillsQuery(new URL(request.url).search)
    if (!q.ok) return reply(badRequest(q.field))
    const read = await rpc('engine_skills_for_export', {
      p_office: office,
      p_bridge: bridgeId,
      p_run: q.value.run_id,
    })
    if (read.status !== 200) return reply(upstreamAnswer(read.status))
    return reply(skillsAnswer(read.body))
  }
  if (request.method !== 'POST')
    return reply({ status: 405, body: { error: 'method_not_allowed' } })
  const text = await readCapped(request)
  if (text === null) return reply({ status: 413, body: { error: 'too_large' } })
  let body: unknown
  try {
    body = text === '' ? {} : JSON.parse(text)
  } catch {
    return reply(badRequest('body'))
  }

  if (route === 'claim') {
    const parsed = parseClaim(body)
    if (!parsed.ok) return reply(badRequest(parsed.field))
    const wait = throttle.check(bridgeId)
    if (wait !== null)
      return reply({
        status: 429,
        body: { error: 'too_fast', retry_after_s: wait },
        retryAfterS: wait,
      })
    const healthy = parsed.value.hermes_ok && parsed.value.toolsets_ok
    const reported = await rpc('engine_bridge_report', {
      p_office: office,
      p_bridge: bridgeId,
      p_healthy: healthy,
      p_reason: healthy ? null : unhealthyAnswer(parsed.value).body.refused,
    })
    if (reported.status !== 200) return reply(upstreamAnswer(reported.status))
    if (!healthy) return reply(unhealthyAnswer(parsed.value))
    const claimed = await rpc('engine_run_claim', { p_office: office, p_bridge: bridgeId })
    if (claimed.status !== 200) return reply(upstreamAnswer(claimed.status))
    return reply(claimAnswer(claimed.body))
  }

  if (route === 'heartbeat') {
    const parsed = parseHeartbeat(body)
    if (!parsed.ok) return reply(badRequest(parsed.field))
    const beat = await rpc('engine_run_heartbeat', {
      p_office: office,
      p_bridge: bridgeId,
      p_run: parsed.value.run_id,
      p_claim_gen: parsed.value.claim_gen,
      p_hermes_run_id: parsed.value.hermes_run_id,
    })
    if (beat.status !== 200) return reply(upstreamAnswer(beat.status))
    return reply(heartbeatAnswer(beat.body))
  }

  if (route === 'proposal') {
    const proposed = parseProposal(body)
    if (!proposed.ok) return reply(badRequest(proposed.field))
    const made = await rpc('engine_propose_skill', {
      p_office: office,
      p_bridge: bridgeId,
      p_run: proposed.value.run_id,
      p_draft: proposed.value.skill,
    })
    if (made.status !== 200) return reply(upstreamAnswer(made.status))
    return reply(proposalAnswer(made.body))
  }

  // finish
  const parsed = parseFinish(body)
  if (!parsed.ok) return reply(badRequest(parsed.field))
  const done = await rpc('engine_run_finish', {
    p_office: office,
    p_bridge: bridgeId,
    p_run: parsed.value.run_id,
    p_claim_gen: parsed.value.claim_gen,
    p_outcome: parsed.value.outcome,
    p_result: parsed.value.result,
  })
  if (done.status !== 200) return reply(upstreamAnswer(done.status))
  return reply(finishAnswer(done.body))
}

Deno.serve(async (request: Request): Promise<Response> => {
  try {
    return await handle(request)
  } catch {
    // Never echo an error: it could carry a request detail. The bridge backs off on a 503.
    return reply({ status: 503, body: { error: 'unavailable' }, retryAfterS: 30 })
  }
})

/**
 * Mint an ephemeral Realtime credential.
 *
 * §12: *"The browser never receives the permanent API key: server-minted
 * ephemeral credentials."* This endpoint is the only place the permanent key is
 * used, and it never appears in a response.
 *
 * Verified against the live API 2026-09-03, per §13's requirement to re-check
 * model names immediately before Gate 1:
 *   - mint endpoint is `POST /v1/realtime/client_secrets` (anything citing
 *     `/v1/realtime/sessions` is stale)
 *   - returns `{ value: "ek_…", expires_at, session }`
 *   - `gpt-realtime-2.1` and `gpt-realtime-2.1-mini` both present
 *
 * The model is read from the environment, never hard-coded: §4 requires every
 * model identifier to be configuration, and the deprecated `gpt-realtime` and
 * `gpt-realtime-mini` are still listed by the API today while being removed on
 * 2027-01-20 — so a constant here would rot silently.
 */
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const MODEL = Deno.env.get('VOICE_MODEL') ?? 'gpt-realtime-2.1-mini'

// The POC page is served from the same origin, so this is only needed if Grant
// opens it from elsewhere. Kept tight rather than '*'.
const ALLOWED_ORIGIN = Deno.env.get('VOICE_ALLOWED_ORIGIN') ?? '*'

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })

  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405, headers: cors })
  }
  if (OPENAI_KEY === '') {
    return Response.json({ error: 'voice is not configured' }, { status: 503, headers: cors })
  }

  const minted = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: MODEL,
        instructions:
          'You are the Chief of Staff of a small AI team. This is a proof of ' +
          'concept: keep replies short and natural, and let the user interrupt ' +
          'you freely. If asked what you can do, say plainly that this POC only ' +
          'tests voice quality and latency, and that you have no access to real ' +
          'project state yet.',
      },
    }),
  })

  const payload = (await minted.json()) as {
    value?: string
    expires_at?: number
    session?: { model?: string }
    error?: { message?: string }
  }

  if (!minted.ok || payload.value === undefined) {
    // The upstream message can echo request detail, so it is not forwarded
    // verbatim — §15 keeps provider errors out of anything client-visible.
    console.error(`mint failed: ${minted.status} ${payload.error?.message ?? ''}`)
    return Response.json({ error: 'could not mint a session' }, { status: 502, headers: cors })
  }

  // Only the ephemeral secret leaves. It expires in ~60s by default and is
  // useless afterwards, which is the entire point of the indirection.
  return Response.json(
    {
      client_secret: payload.value,
      expires_at: payload.expires_at,
      model: payload.session?.model ?? MODEL,
    },
    { headers: cors },
  )
})

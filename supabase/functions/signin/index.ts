/**
 * Signing a browser in, without a credential passing through a person.
 *
 * ## The defect this replaces
 *
 * One bearer token is the whole of the authorisation in this office, and that
 * is a hard constraint. The way it reached a browser was `npm run hq:token`,
 * which says the shape of the problem in its own message: "Access token —
 * paste it once, per device." So the credential travelled through a chat log,
 * a clipboard and a password field, and Grant met the consequence as an
 * interruption he had never asked for — "Couldn't reach the office, browser's
 * not signed in", in front of Chat, Voice, Settings, appearance and every
 * write on the page.
 *
 * ## What changes, and what deliberately does not
 *
 * Not the credential: `hq-api` still compares the same bearer token in
 * constant time, and rotating one vault row still rotates everything. Not the
 * trust model: the only thing that can approve a sign-in is a tap in the
 * Telegram chat the office already knows is Grant's, which is exactly where
 * `hq:token` sent the token before. What changes is that the token is handed
 * to the browser that asked, instead of to a human who must carry it.
 *
 * That is strictly LESS exposure than the paste it replaces — the token is
 * never rendered, never in a message, never in a clipboard, and a screenshot
 * of the sign-in screen is worth nothing.
 *
 * ## Why there is a code on the screen
 *
 * This endpoint takes no authentication; it cannot. Anybody who can reach the
 * page can therefore START a request, and a request Grant did not start is an
 * attempt to have him sign somebody else's browser in. The page shows a
 * six-character code, the message carries the same one, and the message asks
 * him to tap only if they match. The code is not a second secret — it is
 * something to compare, which is the whole of its job.
 *
 * ## Why an origin allowlist
 *
 * Same reasoning as `voice-token`, and for the same reason: with no bearer
 * token to check, the origin is the only thing distinguishing the office's own
 * page from a stranger's. It is a list of stable aliases, never per-deployment
 * hostnames, because that list would grow without bound and never shrink.
 *
 * ## What never crosses this boundary
 *
 * The pager bot token and the approve secret are read here and go into one
 * Telegram message. The HQ token is returned exactly once, to the browser
 * holding the request id of a row a human approved, and the row is spent by
 * that call. Nothing here is logged.
 */

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const HQ_TOKEN = Deno.env.get('HQ_API_TOKEN') ?? ''

const ALLOWED_ORIGINS = (Deno.env.get('SIGNIN_ALLOWED_ORIGIN') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o !== '')

const corsFor = (request: Request): Record<string, string> => {
  const asked = request.headers.get('origin') ?? ''
  const allowed =
    ALLOWED_ORIGINS.includes(asked) && asked !== ''
      ? asked
      : // A well-formed refusal rather than a header the caller can misread: the
        // browser compares this with its own origin and stops. Same choice as
        // voice-token, and the reason the stranger-origin control can assert it.
        (ALLOWED_ORIGINS[0] ?? 'null')
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

const json = (body: unknown, status: number, request: Request): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsFor(request),
    },
  })

/** One RPC, through PostgREST, with the service key. */
const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown[]> => {
  const response = await fetch(`${DB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(args),
  })
  if (!response.ok) throw new Error(`rpc ${fn}: ${String(response.status)}`)
  const body = await response.json().catch(() => [])
  return Array.isArray(body) ? body : [body]
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A tiny page for the tap, and for every way the tap can fail.
 *
 * It is HTML rather than JSON because the only thing that ever opens this URL
 * is Telegram's browser, and a person reading `{"ok":true}` cannot tell
 * whether it worked.
 */
const page = (title: string, said: string, tone: 'ok' | 'no'): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #0e1211; color: #e8efec;
         font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif }
  main { max-width: 30rem; padding: 2rem 1.5rem; text-align: center }
  h1 { font-size: 1.35rem; margin: 0 0 .6rem; letter-spacing: -.01em;
       color: ${tone === 'ok' ? '#7fdcab' : '#f0b9a6'} }
  p { margin: 0; color: #a9b7b1 }
</style></head><body><main>
<h1>${esc(title)}</h1><p>${esc(said)}</p>
</main></body></html>`,
    {
      status: tone === 'ok' ? 200 : 400,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  )

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return json({ ok: true }, 200, request)

  // --- the tap, from Telegram ---------------------------------------------
  const secret = url.searchParams.get('approve') ?? ''
  if (request.method === 'GET' && secret !== '') {
    const rows = (await rpc('sign_in_approve', { p_secret: secret }).catch(() => [])) as {
      ok?: boolean
      code?: string
      reason?: string
    }[]
    const said = rows[0]
    if (said?.ok !== true) {
      return page('Not signed in', said?.reason ?? 'that link is not one of ours', 'no')
    }
    return page(
      `Signed in — ${String(said.code ?? '')}`,
      'Check that code matches the screen that asked. If it does not, tell the office: ' +
        'somebody else asked to be let in.',
      'ok',
    )
  }

  if (request.method === 'GET' && url.pathname.endsWith('/health')) {
    return json({ ok: true, endpoint: 'signin', configured: HQ_TOKEN !== '' }, 200, request)
  }

  if (request.method !== 'POST') return json({ error: 'method' }, 405, request)

  // Everything below is a page action, so the origin allowlist decides. An
  // empty allowlist would mean "let anybody" and is treated as misconfiguration
  // rather than waved through — the same rule hq-api applies to an absent
  // token.
  const origin = request.headers.get('origin') ?? ''
  if (ALLOWED_ORIGINS.length === 0 || !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: 'origin' }, 403, request)
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action ?? '')

  if (action === 'begin') {
    // What the message says the request came FROM. Not trusted for anything —
    // it decides no access — it is there so Grant can see whether the ask looks
    // like him. Bounded, and never rendered as HTML by Telegram's parse mode.
    const asked = String(body.asked_from ?? '').slice(0, 80)
    let rows: {
      request_id?: string
      code?: string
      approve_secret?: string
      chat_id?: string
      bot_id?: string
      bot_token?: string
      expires_at?: string
    }[]
    try {
      rows = (await rpc('sign_in_begin', { p_asked_from: asked })) as typeof rows
    } catch {
      // The rate limit raises, and it is the one failure worth naming: the
      // alternative is a button that silently does nothing.
      return json(
        { error: 'too many sign-in requests just now — wait a few minutes' },
        429,
        request,
      )
    }
    const started = rows[0]
    if (started?.request_id === undefined) {
      return json({ error: 'the office could not start a sign-in' }, 500, request)
    }
    if (
      started.chat_id === undefined ||
      started.chat_id === null ||
      started.chat_id === '' ||
      started.bot_token === undefined ||
      started.bot_token === null ||
      started.bot_token === ''
    ) {
      // No pager, or Grant has never messaged it. Saying so is the only honest
      // answer: the page cannot be signed in this way until it is fixed, and a
      // request nobody can approve would sit there looking broken.
      return json(
        { error: 'no Telegram pager is set up, so there is nowhere to send the request' },
        503,
        request,
      )
    }

    const link = `${url.origin}${url.pathname}?approve=${encodeURIComponent(String(started.approve_secret))}`
    const text =
      `<b>Sign in to Team HQ</b>\n\n` +
      `A browser asked to be signed in.\n\n` +
      `Code on that screen: <code>${esc(String(started.code))}</code>\n` +
      `Asked from: ${esc(asked === '' ? 'a browser' : asked)}\n\n` +
      `Tap only if that code matches the screen in front of you:\n${esc(link)}\n\n` +
      `<i>It expires in five minutes. If you did not ask for this, ignore it — ` +
      `nothing happens until you tap.</i>`

    const sent = await fetch(
      `https://api.telegram.org/bot${String(started.bot_token)}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(started.chat_id),
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          // Silent, deliberately. A sign-in request is something you are already
          // waiting for, with the screen that asked in front of you — the buzz
          // adds nothing. `npm run notify` has the same rule: only a decision
          // makes a sound.
          disable_notification: true,
        }),
      },
    ).catch(() => null)

    if (sent === null || !sent.ok) {
      return json({ error: 'the office could not reach Telegram just now' }, 502, request)
    }

    // The secret is NOT in this answer. The browser holds the request id and
    // the code; the thing that authorises is only ever in the chat.
    return json(
      { request_id: started.request_id, code: started.code, expires_at: started.expires_at },
      200,
      request,
    )
  }

  if (action === 'claim') {
    const id = String(body.request_id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'request_id' }, 400, request)
    const rows = (await rpc('sign_in_claim', { p_request: id }).catch(() => [])) as {
      ok?: boolean
      reason?: string
    }[]
    const said = rows[0]
    if (said?.ok !== true) {
      // `waiting` is the ordinary case while the page polls, so it is a 200
      // with a reason rather than an error: a poll that looks like a failure
      // every two seconds is how a console fills with noise nobody reads.
      return json({ ok: false, reason: said?.reason ?? 'unknown' }, 200, request)
    }
    if (HQ_TOKEN === '') return json({ error: 'not configured' }, 500, request)
    return json({ ok: true, token: HQ_TOKEN }, 200, request)
  }

  return json({ error: 'unknown action' }, 400, request)
})

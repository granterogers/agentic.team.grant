/**
 * Signing in to the office — the product's own login, and no office token.
 *
 * ## The correction this is written to
 *
 * Grant, 24 September: *"He does not want an office-token interaction in the
 * normal user experience AT ALL. The intended experience is: OPEN AGENTIC TEAM
 * -> APPLICATION LOADS -> USER IS AUTHENTICATED -> USE APPLICATION. If an
 * internal credential/token is required for secure communication with the
 * office, that is an IMPLEMENTATION DETAIL."*
 *
 * An earlier version of this file kept the office token and made the ceremony
 * nicer — ask, tap in Telegram, collect. That was the wrong shape: it is still
 * a person handling the office's own key.
 *
 * ## What the trace found
 *
 * There was already an identity system here and nobody had ever used it.
 * `auth.users` held zero rows. All 117 row-level policies name `ai_team_app`;
 * not one names `anon` or `authenticated`, and the browser has never spoken to
 * PostgREST at all — it speaks to `hq-api`, which holds the service key. So
 * adopting Supabase Auth changes exactly one thing: WHICH FACT the gateway
 * checks before it answers. Nothing about the data path moves, and no policy
 * is loosened.
 *
 * ## The shape
 *
 * The browser never holds a shared secret and never sees the anon key either.
 * It asks this endpoint for a sign-in link; the office asks Supabase to send
 * one; the link comes back to the page with the person's OWN short-lived
 * session in it; the page presents that session to `hq-api`, which verifies it
 * with Supabase and checks `public.office_members`.
 *
 * Two boundaries, and they are different questions on purpose:
 *
 *   Supabase says WHO PROVED AN ADDRESS.
 *   `office_members` says WHO THE OFFICE WORKS FOR.
 *
 * So a stranger who signs up gets a perfectly valid session and is refused by
 * the office, which is why signup being open is a nuisance rather than a hole.
 *
 * ## Why the anon key stays here
 *
 * Supabase's auth endpoints want it, and it is a public key by design — but
 * putting it in the repository or the page would be one more thing to rotate
 * and one more thing to explain. Edge functions are handed it in the
 * environment, so the browser asks the office and the office asks Supabase.
 *
 * ## What is never said
 *
 * Whether an address is known. A sign-in request answers the same way for
 * every address, because an endpoint that says "no such person" is an address
 * oracle. The office's refusal happens later, at the gateway, to a caller who
 * has already proved they own the mailbox.
 */

import {
  NOT_SWITCHED_ON,
  normaliseEmail,
  passwordProblem,
  passwordSessionFrom,
  passwordSignInEnabled,
  RESET_SENT,
  SIGN_IN_REFUSED,
  SIGN_UP_SENT,
  UNAVAILABLE,
} from '../../../src/auth/password.ts'
import { safeRedirectTarget } from '../../../src/auth/redirect-target.ts'

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const HQ_TOKEN = Deno.env.get('HQ_API_TOKEN') ?? ''

/** Constant time, the same comparison `hq-api` makes, for the same reason. */
const isOfficeKey = async (presented: string): Promise<boolean> => {
  if (HQ_TOKEN === '' || presented === '') return false
  const digest = async (v: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
  const [a, b] = await Promise.all([digest(presented), digest(HQ_TOKEN)])
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

const ALLOWED_ORIGINS = (Deno.env.get('SIGNIN_ALLOWED_ORIGIN') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o !== '')

const corsFor = (request: Request): Record<string, string> => {
  const asked = request.headers.get('origin') ?? ''
  const allowed =
    ALLOWED_ORIGINS.includes(asked) && asked !== ''
      ? asked
      : // A well-formed refusal rather than a header the caller can misread:
        // the browser compares this with its own origin and stops.
        (ALLOWED_ORIGINS[0] ?? 'null')
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

/*
  EVERY CALL TO THE AUTH SERVICE ENDS.

  On 5 October at 06:14 UTC one invocation of this function took 59,096 ms and a call to Auth behind it answered 500
  after 22,448 ms: a fetch with no deadline waits for as long as the service behind it does, and the page waiting on this
  function had no deadline either. The function now gives up first, with a sentence, so the page can say what happened.
  The page's own deadline (web/studio/net.js) is longer than this one on purpose, so the answer that arrives is this
  function's, with a reason, rather than the browser's.
*/
const UPSTREAM_MS = 12_000
const upstream = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_MS) })

const json = (body: unknown, status: number, request: Request): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsFor(request),
    },
  })

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return json({ ok: true }, 200, request)

  if (request.method === 'GET' && url.pathname.endsWith('/health')) {
    return json(
      { ok: true, endpoint: 'signin', configured: ANON !== '' && DB_URL !== '' },
      200,
      request,
    )
  }

  if (request.method !== 'POST') return json({ error: 'method' }, 405, request)

  // The origin allowlist, for the same reason `voice-token` has one: these
  // routes take no credential of ours, so the origin is the only thing that
  // distinguishes the office's own page from a stranger's. An empty allowlist
  // is treated as misconfiguration rather than waved through.
  const origin = request.headers.get('origin') ?? ''
  if (ALLOWED_ORIGINS.length === 0 || !ALLOWED_ORIGINS.includes(origin)) {
    return json({ error: 'origin' }, 403, request)
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action ?? '')

  if (action === 'link') {
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'that does not look like an email address' }, 400, request)
    }
    const back = String(body.back ?? '')
    const redirect = safeRedirectTarget(back, ALLOWED_ORIGINS, origin)

    const asked = await upstream(`${DB_URL}/auth/v1/otp`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ email, create_user: true, redirect_to: redirect }),
    }).catch(() => null)

    /*
      THE SAME ANSWER WHATEVER HAPPENED, with one exception. A rate limit is
      worth saying out loud because it tells the person to wait rather than to
      keep pressing; everything else would tell a stranger whether an address
      is known here.
    */
    if (asked !== null && asked.status === 429) {
      return json(
        { ok: false, wait: true, said: 'Too many sign-in emails just now. Try again in an hour.' },
        200,
        request,
      )
    }
    /*
      WHETHER IT WAS SENT IS NOT AN ORACLE, and saying nothing about it was a
      defect. Signup is open at the identity layer, so Supabase's answer does
      not depend on whether the office knows this address -- it depends on
      whether the mail went. The first version returned ok for everything and
      reported a silent failure as success, which is the exact shape this
      repository keeps paying for. What is still never said is whether the
      person is allowed in; that refusal happens at the gateway, later, to
      somebody who has already proved they own the mailbox.
    */
    if (asked === null || !asked.ok) {
      const why = asked === null ? '' : await asked.text().catch(() => '')
      return json(
        {
          ok: false,
          said: 'The office could not send that. Check the address, or try again shortly.',
          status: asked === null ? 0 : asked.status,
          detail: why.slice(0, 200),
        },
        200,
        request,
      )
    }
    return json({ ok: true, said: 'Check your email for a link to sign in.' }, 200, request)
  }

  /*
    A LINK, HANDED OVER INSTEAD OF EMAILED.

    Two things need this and neither is a person: an operator onboarding a TEST
    member, and the verification suites, which have to sign a browser in without
    an inbox and must not email anybody every run.

    It requires the OFFICE KEY and it mints a session for a TEST member only (see
    the refusal below). It used to mint one for any member on the argument that the
    key already opened everything; that argument is false now that the key cannot
    decide as a person, and a link for a person's own address would have been the
    way round that (#385).
  */
  if (action === 'link_for_operator') {
    const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!(await isOfficeKey(presented))) return json({ error: 'unauthorized' }, 401, request)

    const email = String(body.email ?? '')
      .trim()
      .toLowerCase()
    const member = await upstream(`${DB_URL}/rest/v1/rpc/office_member`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_email: email }),
    }).catch(() => null)
    const rows =
      member === null
        ? []
        : ((await member.json().catch(() => [])) as { ok?: boolean; kind?: string }[])
    if (rows[0]?.ok !== true)
      return json({ error: 'not somebody the office works for' }, 403, request)
    /*
      THE OFFICE KEY MINTS A SESSION FOR A TEST MEMBER ONLY (#385, 0614).

      This used to mint one for ANY member, and the only member was Grant - so
      the machine key that "already opens the whole gateway" could also become
      him: a signed-in person's session, with every approval and every reach
      grant that carries. The comment above argued it escalated nothing because
      the key already opened everything, which stopped being true the moment the
      key stopped being able to decide as a person. A person signs in by mail; the
      verification suites sign in as the test member, whose session the database
      lets decide only test traffic. A kind the database did not say is not
      'harness', so a database that predates 0614 mints nothing.
    */
    if (rows[0]?.kind !== 'harness') {
      return json(
        { error: 'an operator link is made only for a test member; a person signs in by mail' },
        403,
        request,
      )
    }

    const back = String(body.back ?? '')
    const redirect = safeRedirectTarget(back, ALLOWED_ORIGINS, ALLOWED_ORIGINS[0] ?? '')
    const made = await upstream(`${DB_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
      },
      /*
        `redirect_to` is TOP LEVEL here. Nesting it under `options` is the
        JavaScript client's shape, and the REST endpoint silently ignores it --
        so the first version produced links that went to `site_url` instead of
        the page that asked, which on a deployment running older bytes meant
        the session arrived and was dropped on the floor. Silently: the link
        worked, the redirect worked, and nobody was signed in.
      */
      body: JSON.stringify({ type: 'magiclink', email, redirect_to: redirect }),
    }).catch(() => null)
    if (made === null || !made.ok) {
      const why = made === null ? '' : await made.text().catch(() => '')
      return json({ ok: false, status: made?.status ?? 0, detail: why.slice(0, 200) }, 200, request)
    }
    const link = (await made.json()) as {
      action_link?: string
      properties?: { action_link?: string }
    }
    return json(
      { ok: true, action_link: link.action_link ?? link.properties?.action_link ?? '' },
      200,
      request,
    )
  }

  /*
    EXPLORE THE SAMPLE OFFICE: a visitor with no account (0897).

    Takes no credential and no address. It asks the database whose login the public Sample Office is (answered only while
    the office is sealed, so a visitor can never be handed an office that is open for seeding), has Auth make a one-time
    link for that login, and spends the link here, server side, so the visitor receives a session and never the link.

    What that session is worth is decided at the gateway, not here: its member is a guest, which may read the Sample
    Office and ask its team a question, and nothing else. Nothing in this branch can name any other login, and nothing
    in the request is read except the action.
  */
  if (action === 'sample') {
    const door = await upstream(`${DB_URL}/rest/v1/rpc/sample_login`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
      },
      body: '{}',
    }).catch(() => null)
    if (door === null || !door.ok) {
      return json(
        {
          ok: false,
          reason: 'unavailable',
          said: 'The sample office could not be opened just now. Try again in a moment.',
        },
        503,
        request,
      )
    }
    const asked = (await door.json().catch(() => ({}))) as { ok?: boolean; email?: string }
    if (asked.ok !== true || typeof asked.email !== 'string' || asked.email === '') {
      return json(
        {
          ok: false,
          reason: 'closed',
          said: 'The sample office is not open at the moment. You can still create your own office.',
        },
        200,
        request,
      )
    }
    const made = await upstream(`${DB_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ type: 'magiclink', email: asked.email }),
    }).catch(() => null)
    const link =
      made?.ok === true
        ? ((await made.json().catch(() => ({}))) as {
            hashed_token?: string
            properties?: { hashed_token?: string }
          })
        : {}
    const hashed = link.hashed_token ?? link.properties?.hashed_token ?? ''
    if (hashed === '') {
      return json(
        {
          ok: false,
          reason: 'unavailable',
          said: 'The sample office could not be opened just now. Try again in a moment.',
        },
        503,
        request,
      )
    }
    const spent = await upstream(`${DB_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
    }).catch(() => null)
    const session =
      spent?.ok === true
        ? ((await spent.json().catch(() => ({}))) as {
            access_token?: string
            refresh_token?: string
            expires_in?: number
          })
        : {}
    if (typeof session.access_token !== 'string' || session.access_token === '') {
      return json(
        {
          ok: false,
          reason: 'unavailable',
          said: 'The sample office could not be opened just now. Try again in a moment.',
        },
        503,
        request,
      )
    }
    return json(
      {
        ok: true,
        access_token: session.access_token,
        refresh_token: session.refresh_token ?? '',
        expires_in: session.expires_in ?? 3600,
      },
      200,
      request,
    )
  }

  /*
    PASSWORD SIGN-IN (#466, A1). Off unless the deployment sets PASSWORD_SIGN_IN to 1 or true: every action below answers
    "not switched on" until then, and `methods` is how the page learns which to show. Auth checks the password; the
    decisions (policy, address shape, what a session is, what a refusal says) live in src/auth/password.ts.

    Every answer that could reveal whether an address has an account is the same sentence. The one exception is a 422
    from Auth for a weak password, which says nothing about the address and is passed on as a sentence of its own.
  */
  if (action === 'methods') {
    return json(
      { ok: true, password: passwordSignInEnabled(Deno.env.get('PASSWORD_SIGN_IN')) },
      200,
      request,
    )
  }

  if (
    action === 'password_sign_in' ||
    action === 'password_sign_up' ||
    action === 'password_reset'
  ) {
    if (!passwordSignInEnabled(Deno.env.get('PASSWORD_SIGN_IN'))) {
      return json({ ok: false, said: NOT_SWITCHED_ON }, 404, request)
    }
    const email = normaliseEmail(String(body.email ?? ''))
    if (email === null)
      return json({ ok: false, said: 'That does not look like an email address.' }, 400, request)

    if (action === 'password_reset') {
      const asked = await upstream(`${DB_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: { apikey: ANON, 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      }).catch(() => null)
      if (asked === null || asked.status >= 500)
        return json({ ok: false, said: UNAVAILABLE }, 503, request)
      return json({ ok: true, said: RESET_SENT }, 200, request)
    }

    const password = String(body.password ?? '')
    if (action === 'password_sign_up') {
      const problem = passwordProblem(password, email)
      if (problem !== null) return json({ ok: false, said: problem }, 400, request)
      const made = await upstream(`${DB_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: { apikey: ANON, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }).catch(() => null)
      if (made === null || made.status >= 500)
        return json({ ok: false, said: UNAVAILABLE }, 503, request)
      if (made.status === 422) {
        return json(
          { ok: false, said: 'That password is not strong enough for this office.' },
          400,
          request,
        )
      }
      return json({ ok: true, said: SIGN_UP_SENT }, 200, request)
    }

    // password_sign_in
    if (password === '') return json({ ok: false, said: SIGN_IN_REFUSED }, 400, request)
    const signed = await upstream(`${DB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).catch(() => null)
    if (signed === null || signed.status >= 500)
      return json({ ok: false, said: UNAVAILABLE }, 503, request)
    if (signed.status === 429) {
      return json(
        { ok: false, said: 'Too many attempts. Wait a few minutes and try again.' },
        429,
        request,
      )
    }
    if (!signed.ok) return json({ ok: false, said: SIGN_IN_REFUSED }, 400, request)
    const session = passwordSessionFrom(await signed.json(), Date.now())
    if (session === null) return json({ ok: false, said: UNAVAILABLE }, 503, request)
    return json({ ok: true, session }, 200, request)
  }

  if (action === 'refresh') {
    const refresh = String(body.refresh_token ?? '')
    if (refresh === '') return json({ error: 'refresh_token' }, 400, request)
    const swapped = await upstream(`${DB_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    }).catch(() => null)
    /*
      AN OUTAGE IS NOT AN EXPIRED SESSION. This branch used to answer "expired" for every failure, including Auth timing
      out or answering 5xx, and the page signs a person out on "expired": somebody returning during an Auth incident lost a
      perfectly good session because the service that checks it was down. Only an answer from Auth that says the token is
      no good (a 4xx other than a rate limit) is "expired". No answer, a 5xx and a 429 are "unavailable": the page keeps
      the session, says so, and tries again later.
    */
    if (swapped === null || swapped.status >= 500 || swapped.status === 429) {
      return json({ ok: false, reason: 'unavailable' }, 503, request)
    }
    if (!swapped.ok) {
      // Expired or revoked. The page signs itself out rather than retrying, and
      // saying which is not useful to anybody holding a dead token.
      return json({ ok: false, reason: 'expired' }, 200, request)
    }
    const got = (await swapped.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }
    return json(
      {
        ok: true,
        access_token: got.access_token,
        refresh_token: got.refresh_token,
        expires_in: got.expires_in,
      },
      200,
      request,
    )
  }

  if (action === 'whoami') {
    const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (presented === '') return json({ ok: false, reason: 'nothing presented' }, 200, request)
    const who = await upstream(`${DB_URL}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${presented}` },
    }).catch(() => null)
    if (who === null || who.status >= 500) {
      return json({ ok: false, reason: 'unavailable' }, 503, request)
    }
    if (!who.ok) return json({ ok: false, reason: 'not a session' }, 200, request)
    const user = (await who.json()) as { email?: string }
    return json({ ok: true, email: user.email ?? '' }, 200, request)
  }

  return json({ error: 'unknown action' }, 400, request)
})

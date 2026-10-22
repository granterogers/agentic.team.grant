/**
 * Connecting Grant's Microsoft To Do, once (1093).
 *
 * The same handshake as `google-oauth`, for the same reason: a callback URL Microsoft can reach, and a place to keep a
 * refresh token that a browser must never see. The page asks hq-api for a one-time state (minted only for a deployment
 * operator, for one office), and this function carries it through Microsoft's consent screen and back.
 *
 * ## Two endpoints and nothing else
 *
 *   /start     → redirect to Microsoft's consent screen, when the state is live
 *   /callback  → consume the state, exchange the code, store the refresh token, say so
 *
 * ## Why the state is consumed before the code is exchanged
 *
 * A callback is reachable by anybody with the URL, and what it does with a code is replace the stored refresh token.
 * Without a state minted for a signed-in operator and not yet used, a code from ANY Microsoft account would connect the
 * office to that account. Consuming marks it used in the statement that checks it, so a replayed callback is refused.
 *
 * ## Why the office comes from the state
 *
 * The state was minted for one office by hq-api. The callback takes that office from the consumed state, never from the
 * request, so nothing a visitor sends can name the office a token is stored for.
 *
 * ## The refresh token is kept; the access token is not
 *
 * An access token lasts about an hour. A refresh token lasts until it is revoked, and is what lets the unattended duty
 * keep the list in step. It is the sensitive one, so it goes in the vault and nothing else does.
 */

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// The scopes asked for. `offline_access` is what makes Microsoft issue a refresh token at all.
const SCOPES = 'Tasks.ReadWrite offline_access'
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'

const rpc = async (fn: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  const response = await fetch(`${DB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  if (!response.ok) throw new Error(`upstream ${String(response.status)}`)
  return await response.json()
}

/*
  BACK INTO THE APP, rather than a page from here (0486). The shared functions domain refuses to serve HTML, so the
  outcome travels as a query on the studio's own address, which may serve what it likes.
*/
const backToApp = async (
  outcome: string,
  extra: Record<string, string> = {},
): Promise<Response | null> => {
  const base = String(await rpc('app_base_url', {}).catch(() => ''))
  if (base === '' || !base.startsWith('https://')) return null
  const to = new URL(base)
  to.searchParams.set('microsoft', outcome)
  for (const [k, v] of Object.entries(extra)) if (v !== '') to.searchParams.set(k, v)
  return new Response(null, { status: 302, headers: { location: to.toString() } })
}

/*
  And the fallback, which is PLAIN TEXT on purpose. Markup served from this host is flattened into a wall of source
  (0486); a sentence works everywhere.
*/
const plainly = (body: string, status = 200): Response =>
  new Response(`${body}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^.*?\/microsoft-oauth/, '')

  const config = (await rpc('microsoft_oauth_config')) as {
    client_id?: string
    redirect_uri?: string
    has_secret?: boolean
  }

  if (config.client_id === undefined || config.client_id === '') {
    return plainly(
      'No application ID yet. Save the Microsoft application ID in Settings first.',
      400,
    )
  }

  // --- start ---------------------------------------------------------------

  if (path === '' || path === '/' || path === '/start') {
    /*
      A START WITHOUT A LIVE STATE IS REFUSED. Starting here with nothing is how a stranger would begin a flow whose end
      overwrites the office's Microsoft connection, so nothing is offered: no redirect and no hint of what was missing.
    */
    const state = url.searchParams.get('state') ?? ''
    if ((await rpc('microsoft_oauth_state_live', { p_state: state })) !== true) {
      return plainly('Start connecting Microsoft To Do from Settings in the app.', 400)
    }

    const consent = new URL(`${AUTHORITY}/authorize`)
    consent.searchParams.set('client_id', String(config.client_id))
    consent.searchParams.set('redirect_uri', String(config.redirect_uri))
    consent.searchParams.set('response_type', 'code')
    consent.searchParams.set('response_mode', 'query')
    consent.searchParams.set('scope', SCOPES)
    consent.searchParams.set('state', state)
    // Let the person pick the account, so a second Microsoft account cannot be connected by accident.
    consent.searchParams.set('prompt', 'select_account')
    return new Response(null, { status: 302, headers: { location: consent.toString() } })
  }

  // --- callback ------------------------------------------------------------

  if (path === '/callback') {
    const error = url.searchParams.get('error')
    if (error !== null) {
      return (
        (await backToApp('refused', { why: error.slice(0, 160) })) ??
        plainly(`Microsoft said no: ${error}`, 400)
      )
    }
    const code = url.searchParams.get('code') ?? ''
    if (code === '') return plainly('No code came back from Microsoft.', 400)

    // The state is consumed BEFORE the code is exchanged (see the header). It yields the operator and the office the
    // connect was started for, and nothing else.
    const consumed = (await rpc('microsoft_oauth_state_consume', {
      p_state: url.searchParams.get('state') ?? '',
    })) as { operator?: string; office?: string } | null
    if (
      consumed === null ||
      typeof consumed.operator !== 'string' ||
      typeof consumed.office !== 'string'
    ) {
      return (
        (await backToApp('refused', { why: 'This connection was not started from Settings.' })) ??
        plainly('This connection was not started from Settings, so nothing was changed.', 400)
      )
    }

    if (config.has_secret !== true) {
      return plainly(
        'No client secret. Save the Microsoft client secret in Settings and try again.',
        400,
      )
    }

    // The secret is read HERE, through the one resolver, as the operator the state was minted for. It never leaves
    // this function, and there is deliberately no RPC that returns it.
    const held = await rpc('deployment_credential', {
      p_office: consumed.office,
      p_name: 'microsoft.client_secret',
      p_operator: consumed.operator,
      p_job: null,
    }).catch(() => null)
    const clientSecret = typeof held === 'string' ? held : ''
    if (clientSecret === '') {
      return plainly('The client secret is missing.', 400)
    }

    const exchange = await fetch(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: String(config.client_id),
        client_secret: clientSecret,
        redirect_uri: String(config.redirect_uri),
        grant_type: 'authorization_code',
        scope: SCOPES,
      }).toString(),
    })
    const tokens = (await exchange.json().catch(() => ({}))) as {
      refresh_token?: string
      scope?: string
      error?: string
      error_description?: string
    }

    if (!exchange.ok || tokens.refresh_token === undefined) {
      // Named precisely: a redirect URI that does not match Entra to the character is the commonest cause, and it reads
      // as a generic refusal otherwise. The description may name the app, never a secret: Microsoft does not echo one.
      const why = tokens.error_description ?? tokens.error ?? 'Microsoft returned no refresh token.'
      return (
        (await backToApp('failed', { why: why.slice(0, 160) })) ??
        plainly(
          `Could not finish connecting Microsoft To Do. ${why}\n` +
            'Check the redirect URI is listed under the Web platform of the app registration, exactly.',
          400,
        )
      )
    }

    const stored = (await rpc('hq_store_microsoft_refresh', {
      p_office: consumed.office,
      p_refresh_token: tokens.refresh_token,
      p_scopes: tokens.scope ?? SCOPES,
    })) as { ok?: boolean; error?: string } | null
    if (stored === null || stored.ok !== true) {
      return (
        (await backToApp('failed', { why: stored?.error ?? 'the token could not be stored' })) ??
        plainly('Microsoft To Do could not be stored, so nothing was changed.', 400)
      )
    }

    return (
      (await backToApp('connected')) ??
      plainly(
        'Microsoft To Do is connected. The office will keep your tasks in step. You can close this tab.',
      )
    )
  }

  return plainly('Nothing here.', 404)
})

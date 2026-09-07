/**
 * Connecting Grant's Google account, once.
 *
 * Grant: *"put the google oauth on the web front end please."* The page does
 * the configuring; this does the handshake, because a handshake needs a
 * callback URL that Google can reach and a place to keep a refresh token that
 * a browser must never see.
 *
 * ## Two endpoints and nothing else
 *
 *   /start     → redirect him to Google's consent screen
 *   /callback  → exchange the code, store the refresh token, say so
 *
 * ## Why the refresh token and not the access token
 *
 * An access token lasts an hour. A refresh token lasts until he revokes it, and
 * is what lets an unattended worker read his calendar at 3am without a browser
 * anywhere. It is the more dangerous of the two and the only one worth storing,
 * so it goes in the vault and nothing else does.
 *
 * ## `access_type=offline&prompt=consent`
 *
 * Google issues a refresh token only on the first consent unless `prompt` says
 * otherwise — so a second run of this, after he has already approved it once,
 * would return an access token and no refresh token, and the connection would
 * look successful and stop working within the hour. Asking every time costs one
 * extra click and removes that entirely.
 */

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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

const page = (title: string, body: string, status = 200): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>:root{color-scheme:light dark}body{font:15px/1.6 -apple-system,BlinkMacSystemFont,
"Segoe UI",system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;
background:#0f1115;color:#e8eaed;padding:24px;text-align:center}
.card{max-width:420px;background:#171a21;border:1px solid #262a33;border-radius:14px;padding:28px}
h1{font-size:18px;margin:0 0 8px}p{color:#9aa3b2;margin:0 0 6px;font-size:14px}
a{color:#4f7cff}</style></head><body><div class="card">${body}</div></body></html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    },
  )

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^.*?\/google-oauth/, '')

  const config = (await rpc('hq_google')) as {
    client_id?: string
    redirect_uri?: string
    scopes?: string
    has_secret?: boolean
  }

  if (config.client_id === undefined || config.client_id === '') {
    return page(
      'Not configured',
      '<h1>No client id yet</h1><p>Add the Google client id on the web front end first.</p>',
      400,
    )
  }

  // --- start ---------------------------------------------------------------

  if (path === '' || path === '/' || path === '/start') {
    const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    consent.searchParams.set('client_id', String(config.client_id))
    consent.searchParams.set('redirect_uri', String(config.redirect_uri))
    consent.searchParams.set('response_type', 'code')
    consent.searchParams.set('scope', String(config.scopes))
    // Both are required for an unattended worker. See the header: without
    // `prompt=consent` a second run returns no refresh token and the connection
    // silently expires within the hour.
    consent.searchParams.set('access_type', 'offline')
    consent.searchParams.set('prompt', 'consent')
    consent.searchParams.set('include_granted_scopes', 'true')
    return new Response(null, { status: 302, headers: { location: consent.toString() } })
  }

  // --- callback ------------------------------------------------------------

  if (path === '/callback') {
    const error = url.searchParams.get('error')
    if (error !== null) {
      return page('Refused', `<h1>Google said no</h1><p>${error}</p>`, 400)
    }
    const code = url.searchParams.get('code') ?? ''
    if (code === '') return page('Nothing to exchange', '<h1>No code came back</h1>', 400)

    if (config.has_secret !== true) {
      return page(
        'Not configured',
        '<h1>No client secret</h1><p>Paste it on the web front end and try again.</p>',
        400,
      )
    }

    // The secret is read HERE, with the service key, and never leaves this
    // function. There is deliberately no RPC that returns it.
    const secretRows = (await rpc('vault_secret', { p_name: 'google.client_secret' })) as
      | string
      | null
    if (secretRows === null) {
      return page('Not configured', '<h1>The client secret is missing</h1>', 400)
    }

    const exchange = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: String(config.client_id),
        client_secret: String(secretRows),
        redirect_uri: String(config.redirect_uri),
        grant_type: 'authorization_code',
      }).toString(),
    })
    const tokens = (await exchange.json()) as {
      refresh_token?: string
      access_token?: string
      scope?: string
      error_description?: string
      error?: string
    }

    if (!exchange.ok || tokens.refresh_token === undefined) {
      // Named precisely: "no refresh token" and "Google refused" need
      // different things done about them, and the second most common cause of
      // the first is a redirect URI that does not match to the character.
      return page(
        'Not connected',
        `<h1>Could not finish</h1><p>${
          tokens.error_description ?? tokens.error ?? 'Google returned no refresh token.'
        }</p><p>Check the redirect URI matches the Cloud console exactly.</p>`,
        400,
      )
    }

    await rpc('hq_store_google_refresh', {
      p_refresh_token: tokens.refresh_token,
      p_scopes: tokens.scope ?? '',
    })

    return page(
      'Connected',
      '<h1>Google is connected</h1><p>Calendar can be switched on from Settings now.</p>' +
        '<p>You can close this tab.</p>',
    )
  }

  return page('Not found', '<h1>Nothing here</h1>', 404)
})

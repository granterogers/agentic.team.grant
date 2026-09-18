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
    // Which service's permission to ask for.
    //
    // Grant: *"if someone wants to add connection to Gmail, connection to
    // Google Calendar, you just click on a button and it brings up the Google
    // authenticator."* That is one consent screen per service, asking only for
    // what that service needs — so the scopes come from the row, not from one
    // global string that every button would have to share.
    //
    // The slug arrives in a query string, which is not a trusted input: it is
    // resolved through `google_service_scopes`, which returns empty for
    // anything it does not recognise. An unknown service therefore asks for no
    // permission rather than asking for someone else's.
    /*
      THE DEFAULT IS EVERYTHING THE OFFICE ACTUALLY USES (#172, migration 0485).

      It used to be `'calendar'`, and the Connect Google button in Settings
      links to the bare `/start` — so the one control in the product for
      reconnecting Google asked for two Calendar scopes and nothing else, while
      `src/google/mail.ts`, `src/google/drive.ts` and `src/google/calendar.ts`
      all authenticate with the SAME `google.refresh_token` and each callback
      REPLACES it. Pressing it reconnected Calendar and left Gmail and Drive
      dead, which is precisely the state the office was in — and it would have
      looked like it had worked.

      Found by probing the link before sending Grant to press it.

      `google_scopes_in_use` is derived, not a list: the union over offered
      services that have an enabled `tool_permissions` row under the same name.
      So a fourth service is covered the day it is switched on, and `youtube`
      — offered, no tool — is not asked for, because over-asking on a consent
      screen is its own defect.

      The per-service door is untouched and so is its safety property: an
      unknown slug still resolves to the empty string and asks for nothing.
      Only an absent parameter or the literal `all` gets the union.
    */
    const service = url.searchParams.get('service') ?? 'all'
    const scopes =
      service === 'all'
        ? String(await rpc('google_scopes_in_use', {}))
        : String(await rpc('google_service_scopes', { p_slug: service }))
    if (scopes === '') {
      return page(
        'Unknown service',
        `<h1>No such service</h1><p>Nothing here is called ${service.replace(
          /[^a-z0-9_-]/gi,
          '',
        )}, or it is switched off.</p>`,
        400,
      )
    }

    const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    consent.searchParams.set('client_id', String(config.client_id))
    consent.searchParams.set('redirect_uri', String(config.redirect_uri))
    consent.searchParams.set('response_type', 'code')
    consent.searchParams.set('scope', scopes)
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

    /*
      What Google actually granted, said back in words.

      From `tokens.scope`, which is Google's own answer rather than what was
      asked for — those differ when a person unticks something on the consent
      screen, and the office should say what it HAS rather than what it wanted.
    */
    const granted = (tokens.scope ?? '').split(' ').filter((x) => x !== '')
    const families = [
      granted.some((s) => s.includes('gmail')) ? 'Gmail' : '',
      granted.some((s) => s.includes('calendar')) ? 'Calendar' : '',
      granted.some((s) => s.includes('drive')) ? 'Drive' : '',
    ].filter((x) => x !== '')
    const connected =
      families.length === 0
        ? 'Nothing was granted — try again and leave the permissions ticked.'
        : `${families.join(', ')} can be used now.`

    return page(
      'Connected',
      /*
        Naming what was connected, rather than one service the page happened to
        be written about. The old wording said "Calendar can be switched on"
        after a consent that may have covered Gmail and Drive too — a sentence
        that is narrower than the truth is how somebody concludes the other two
        did not work and presses it again.
      */
      `<h1>Google is connected</h1><p>${connected}</p>` + '<p>You can close this tab.</p>',
    )
  }

  return page('Not found', '<h1>Nothing here</h1>', 404)
})

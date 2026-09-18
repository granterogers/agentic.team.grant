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

/*
  BACK INTO THE APP, rather than a page from here (0486).

  `page()` below sets `content-type: text/html` and Supabase rewrites it to
  `text/plain` with `nosniff` — the shared `*.supabase.co` functions domain
  refuses to serve HTML, which is an ordinary anti-phishing measure on a host
  thousands of projects share. The control that settles it: `hq-api` returns
  `application/json` through the same gateway untouched.

  So every page this function has produced since it was written has been a wall
  of raw markup. Grant met it this morning, after a consent that had WORKED,
  and reasonably concluded something was broken.

  A header cannot win an argument with the host. The studio is on our own
  domain and may serve what it likes, so consent ends there — which is the
  better product anyway: the old page was a dead end with no way back, which is
  what #216 exists about.
*/
const backToApp = async (
  outcome: string,
  extra: Record<string, string> = {},
): Promise<Response | null> => {
  const base = String(await rpc('app_base_url', {}).catch(() => ''))
  if (base === '' || !base.startsWith('https://')) return null
  const to = new URL(base)
  to.searchParams.set('google', outcome)
  for (const [k, v] of Object.entries(extra)) if (v !== '') to.searchParams.set(k, v)
  return new Response(null, { status: 302, headers: { location: to.toString() } })
}

/*
  And the fallback, which is PLAIN TEXT on purpose.

  If there is no app to return to, a person still has to be told what happened.
  Serving markup the host will flatten is how this defect happened; serving a
  sentence works everywhere and cannot be rewritten into nonsense.
*/
const plainly = (body: string, status = 200): Response =>
  new Response(`${body}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })

Deno.serve(async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^.*?\/google-oauth/, '')

  const config = (await rpc('hq_google')) as {
    client_id?: string
    redirect_uri?: string
    has_secret?: boolean
  }

  if (config.client_id === undefined || config.client_id === '') {
    return plainly('No client id yet. Add the Google client id in Settings first.', 400)
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
      return plainly(
        `No such service: nothing here is called ${service.replace(/[^a-z0-9_-]/gi, '')}, ` +
          'or it is switched off.',
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
      return (
        (await backToApp('refused', { why: error.slice(0, 160) })) ??
        plainly(`Google said no: ${error}`, 400)
      )
    }
    const code = url.searchParams.get('code') ?? ''
    if (code === '') return plainly('No code came back from Google.', 400)

    if (config.has_secret !== true) {
      return plainly('No client secret. Paste it in Settings and try again.', 400)
    }

    // The secret is read HERE, with the service key, and never leaves this
    // function. There is deliberately no RPC that returns it.
    const secretRows = (await rpc('vault_secret', { p_name: 'google.client_secret' })) as
      | string
      | null
    if (secretRows === null) {
      return plainly('The client secret is missing.', 400)
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
      const why = tokens.error_description ?? tokens.error ?? 'Google returned no refresh token.'
      return (
        (await backToApp('failed', { why: why.slice(0, 160) })) ??
        plainly(
          `Could not finish connecting Google. ${why}\n` +
            'Check the redirect URI matches the Cloud console exactly.',
          400,
        )
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

    /*
      Naming what was connected, rather than one service the page happened to
      be written about. The old wording said "Calendar can be switched on"
      after a consent that may have covered Gmail and Drive too — a sentence
      narrower than the truth is how somebody concludes the rest failed and
      presses it again.
    */
    return (
      (await backToApp('connected', { with: families.join(',') })) ??
      plainly(`Google is connected. ${connected} You can close this tab.`)
    )
  }

  return plainly('Nothing here.', 404)
})

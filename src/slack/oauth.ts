/**
 * Installing the Slack app into a person's own workspace (ADR-0065): the authorise link and the callback.
 *
 * Pure, with the network and the environment passed in, so the whole flow runs in a unit test against a transport double and
 * in the edge function against Slack. It uses only web-standard APIs (`fetch`, `URL`, `Response`), as the other uploaded
 * adapters do.
 *
 * What it must never do, each asserted in tests/slack/oauth.test.ts:
 *   - choose an office. The office is the STATE's, resolved in the database by `slack_link_redeem`; nothing here sees it.
 *   - put the code, the state, the client secret or the bot token in a URL it returns, a log line or a response body.
 *   - say WHY a refusal happened beyond three words (connected, refused, failed), because the reason is a probing aid.
 */

/** What the app asks a workspace for when `slack.bot_scopes` is not set: enough to hear a person and answer them. */
export const DEFAULT_SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'chat:write',
  'im:history',
  'im:read',
  'im:write',
  'channels:history',
  'channels:read',
  'users:read',
] as const

export interface InstallRequest {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly scopes?: string | null
}

/** Slack's authorise URL for one install. The state is the only thing that ties the redirect back to a person. */
export function authorizeUrl(input: InstallRequest): string {
  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set(
    'scope',
    input.scopes !== undefined && input.scopes !== null && input.scopes.trim() !== ''
      ? input.scopes
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '')
          .join(',')
      : DEFAULT_SLACK_BOT_SCOPES.join(','),
  )
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  return url.toString()
}

export type Exchange =
  | {
      readonly ok: true
      readonly teamId: string
      readonly teamName: string
      readonly botUserId: string
      readonly appId: string
      readonly userId: string
      readonly token: string
    }
  | { readonly ok: false }

/** Trade the one-time code for the install. Anything that is not a clean bot install is a refusal, whatever Slack said. */
export async function exchangeCode(
  fetchImpl: typeof fetch,
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
): Promise<Exchange> {
  let body: Record<string, unknown>
  try {
    const response = await fetchImpl('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }).toString(),
    })
    body = (await response.json()) as Record<string, unknown>
  } catch {
    return { ok: false }
  }
  const team = (body.team ?? {}) as { id?: unknown; name?: unknown }
  const authed = (body.authed_user ?? {}) as { id?: unknown }
  if (
    body.ok !== true ||
    typeof body.access_token !== 'string' ||
    !body.access_token.startsWith('xoxb-') ||
    typeof body.bot_user_id !== 'string' ||
    typeof team.id !== 'string' ||
    typeof team.name !== 'string' ||
    typeof authed.id !== 'string'
  ) {
    return { ok: false }
  }
  return {
    ok: true,
    teamId: team.id,
    teamName: team.name,
    botUserId: body.bot_user_id,
    appId: typeof body.app_id === 'string' ? body.app_id : '',
    userId: authed.id,
    token: body.access_token,
  }
}

export interface CallbackDeps {
  readonly fetch: typeof fetch
  readonly supabaseUrl: string
  readonly serviceKey: string
  readonly clientSecret: string
  /** Where the person is sent afterwards: the dashboard, never anything Slack supplied. */
  readonly siteUrl: string
}

const STATE = /^[0-9a-f]{36}$/
const CODE = /^[A-Za-z0-9._-]{8,400}$/

const back = (siteUrl: string, outcome: 'connected' | 'refused' | 'failed'): Response =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `${siteUrl}/?settings=channels&slack=${outcome}`,
      'Cache-Control': 'no-store',
    },
  })

const rpc = async (
  deps: CallbackDeps,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown | null> => {
  try {
    const r = await deps.fetch(`${deps.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: deps.serviceKey,
        Authorization: `Bearer ${deps.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

/** Slack redirects the installing person here with `code` and `state`. */
export async function handleCallback(request: Request, deps: CallbackDeps): Promise<Response> {
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405 })
  const params = new URL(request.url).searchParams
  const state = params.get('state') ?? ''
  const code = params.get('code') ?? ''
  // The person said no at Slack, or the link is malformed: nothing is exchanged and nothing is spent.
  if (params.get('error') !== null || !STATE.test(state) || !CODE.test(code)) {
    return back(deps.siteUrl, 'refused')
  }
  if (deps.clientSecret === '') return back(deps.siteUrl, 'failed')

  const client = (await rpc(deps, 'slack_link_client', {})) as { client_id?: string | null } | null
  if (client === null || typeof client.client_id !== 'string' || client.client_id === '') {
    return back(deps.siteUrl, 'failed')
  }
  const redirectUri = `${deps.supabaseUrl}/functions/v1/slack-oauth`
  const got = await exchangeCode(deps.fetch, {
    clientId: client.client_id,
    clientSecret: deps.clientSecret,
    code,
    redirectUri,
  })
  if (!got.ok) return back(deps.siteUrl, 'refused')

  // The database takes the office from the state. A failure to ASK is `failed`; an answer that is not a yes is `refused`.
  const said = (await rpc(deps, 'slack_link_redeem', {
    p_state: state,
    p_team_id: got.teamId,
    p_team_name: got.teamName,
    p_bot_user_id: got.botUserId,
    p_app_id: got.appId,
    p_user_id: got.userId,
    p_bot_token: got.token,
  })) as { ok?: boolean } | null
  if (said === null) return back(deps.siteUrl, 'failed')
  return back(deps.siteUrl, said.ok === true ? 'connected' : 'refused')
}

/** Revoke a bot token at Slack when a person disconnects. A failure here is reported, never thrown with the token in it. */
export async function revokeToken(fetchImpl: typeof fetch, token: string): Promise<boolean> {
  try {
    const r = await fetchImpl('https://slack.com/api/auth.revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await r.json()) as { ok?: boolean }
    return body.ok === true
  } catch {
    return false
  }
}

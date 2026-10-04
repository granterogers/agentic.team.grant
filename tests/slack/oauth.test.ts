import { describe, expect, it } from 'vitest'
import {
  authorizeUrl,
  type CallbackDeps,
  DEFAULT_SLACK_BOT_SCOPES,
  exchangeCode,
  handleCallback,
  revokeToken,
} from '../../src/slack/oauth.ts'

const STATE = 'a1b2c3d4e5f60718293a4b5c6d7e8f901234'
const CODE = '1234567890.0987654321.abcdef0123456789'
const SECRET = 'client-secret-value-not-real'
const TOKEN = 'xoxb-1234567890-abcdefghijklmnop'
const SUPABASE = 'https://ref.supabase.co'

type Call = { url: string; body: string }

/** A Slack and a database, as doubles: records every call and answers what each would. */
const world = (
  over: { slack?: unknown; redeem?: unknown; client?: unknown; redeemStatus?: number } = {},
) => {
  const calls: Call[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    calls.push({ url, body: String(init?.body ?? '') })
    if (url === 'https://slack.com/api/oauth.v2.access') {
      return Response.json(
        over.slack ?? {
          ok: true,
          access_token: TOKEN,
          bot_user_id: 'U0BOTUSER1',
          app_id: 'A0123456789',
          team: { id: 'T0TEAMID01', name: 'Acme Studio' },
          authed_user: { id: 'U0PERSON01' },
        },
      )
    }
    if (url.endsWith('/rpc/slack_link_client')) {
      return Response.json(over.client ?? { client_id: '1234.5678', scopes: null })
    }
    if (url.endsWith('/rpc/slack_link_redeem')) {
      return Response.json(over.redeem ?? { ok: true, team_name: 'Acme Studio' }, {
        status: over.redeemStatus ?? 200,
      })
    }
    if (url === 'https://slack.com/api/auth.revoke') return Response.json({ ok: true })
    return new Response('unexpected', { status: 500 })
  }) as typeof fetch
  const deps: CallbackDeps = {
    fetch: impl,
    supabaseUrl: SUPABASE,
    serviceKey: 'service-key-not-real',
    clientSecret: SECRET,
    siteUrl: 'https://site.example',
  }
  return { calls, deps }
}
const cb = (qs: string, method = 'GET') =>
  new Request(`${SUPABASE}/functions/v1/slack-oauth?${qs}`, { method })
const where = (r: Response): string => r.headers.get('Location') ?? ''

describe('the authorise link', () => {
  it('carries the client id, the redirect, the scopes and the state, and nothing else', () => {
    const u = new URL(
      authorizeUrl({
        clientId: '1234.5678',
        redirectUri: `${SUPABASE}/functions/v1/slack-oauth`,
        state: STATE,
      }),
    )
    expect(u.origin + u.pathname).toBe('https://slack.com/oauth/v2/authorize')
    expect(u.searchParams.get('client_id')).toBe('1234.5678')
    expect(u.searchParams.get('state')).toBe(STATE)
    expect(u.searchParams.get('redirect_uri')).toBe(`${SUPABASE}/functions/v1/slack-oauth`)
    expect(u.searchParams.get('scope')).toBe(DEFAULT_SLACK_BOT_SCOPES.join(','))
    expect([...u.searchParams.keys()].sort()).toEqual([
      'client_id',
      'redirect_uri',
      'scope',
      'state',
    ])
  })

  it('takes the deployment’s own scope list, tidied', () => {
    const u = new URL(
      authorizeUrl({
        clientId: 'c',
        redirectUri: 'r',
        state: STATE,
        scopes: ' chat:write , im:history,, ',
      }),
    )
    expect(u.searchParams.get('scope')).toBe('chat:write,im:history')
  })
})

describe('the callback', () => {
  it('a clean install connects, and the person is sent back to the dashboard with one word', async () => {
    const w = world()
    const r = await handleCallback(cb(`code=${CODE}&state=${STATE}`), w.deps)
    expect(r.status).toBe(302)
    expect(where(r)).toBe('https://site.example/?settings=channels&slack=connected')
    const redeem = w.calls.find((c) => c.url.endsWith('/rpc/slack_link_redeem'))
    expect(JSON.parse(redeem?.body ?? '{}')).toEqual({
      p_state: STATE,
      p_team_id: 'T0TEAMID01',
      p_team_name: 'Acme Studio',
      p_bot_user_id: 'U0BOTUSER1',
      p_app_id: 'A0123456789',
      p_user_id: 'U0PERSON01',
      p_bot_token: TOKEN,
    })
  })

  it('exchanges the code with the registered redirect, and only Slack ever receives the client secret', async () => {
    const w = world()
    await handleCallback(cb(`code=${CODE}&state=${STATE}`), w.deps)
    const exchange = w.calls.find((c) => c.url === 'https://slack.com/api/oauth.v2.access')
    const form = new URLSearchParams(exchange?.body)
    expect(form.get('redirect_uri')).toBe(`${SUPABASE}/functions/v1/slack-oauth`)
    expect(form.get('client_secret')).toBe(SECRET)
    for (const c of w.calls.filter((x) => x.url !== 'https://slack.com/api/oauth.v2.access')) {
      expect(c.body).not.toContain(SECRET)
    }
  })

  it('never puts the code, the state, the secret or the token in what it returns', async () => {
    const w = world()
    const r = await handleCallback(cb(`code=${CODE}&state=${STATE}`), w.deps)
    const everything = `${where(r)} ${[...r.headers.values()].join(' ')} ${await r.text()}`
    for (const secret of [CODE, STATE, SECRET, TOKEN]) expect(everything).not.toContain(secret)
  })

  it('takes no office from the request: an office parameter is ignored and reaches nothing', async () => {
    const w = world()
    await handleCallback(
      cb(`code=${CODE}&state=${STATE}&office=00000000-0000-4000-8000-000000000000&p_office=x`),
      w.deps,
    )
    for (const c of w.calls) expect(c.body).not.toContain('00000000-0000-4000')
    const redeem = JSON.parse(
      w.calls.find((c) => c.url.endsWith('/rpc/slack_link_redeem'))?.body ?? '{}',
    )
    expect(Object.keys(redeem).some((k) => /office/i.test(k))).toBe(false)
  })

  it('a person who declines at Slack, or a malformed link, exchanges and spends nothing', async () => {
    for (const qs of [
      `error=access_denied&state=${STATE}`,
      `code=${CODE}`,
      `state=${STATE}`,
      `code=${CODE}&state=not-a-state`,
      `code=${CODE}&state=${STATE.toUpperCase()}`,
      `code=${'x'.repeat(500)}&state=${STATE}`,
      '',
    ]) {
      const w = world()
      const r = await handleCallback(cb(qs), w.deps)
      expect(where(r)).toBe('https://site.example/?settings=channels&slack=refused')
      expect(w.calls).toHaveLength(0)
    }
  })

  it('Slack saying no is a refusal and the database is never asked', async () => {
    const w = world({ slack: { ok: false, error: 'invalid_code' } })
    const r = await handleCallback(cb(`code=${CODE}&state=${STATE}`), w.deps)
    expect(where(r)).toContain('slack=refused')
    expect(w.calls.some((c) => c.url.endsWith('/rpc/slack_link_redeem'))).toBe(false)
  })

  it('a USER token (not a bot install) is refused whatever else is right', async () => {
    const w = world({
      slack: {
        ok: true,
        access_token: 'xoxp-1234567890-abcdefghijklmnop',
        bot_user_id: 'U0BOTUSER1',
        team: { id: 'T0TEAMID01', name: 'Acme' },
        authed_user: { id: 'U0PERSON01' },
      },
    })
    const r = await handleCallback(cb(`code=${CODE}&state=${STATE}`), w.deps)
    expect(where(r)).toContain('slack=refused')
    expect(w.calls.some((c) => c.url.endsWith('/rpc/slack_link_redeem'))).toBe(false)
  })

  it('every refusal the database gives reads the same to the person (taken, used, expired, invalid)', async () => {
    const seen = new Set<string>()
    for (const error of ['taken', 'invalid', 'office_already_connected']) {
      const w = world({ redeem: { ok: false, error } })
      seen.add(where(await handleCallback(cb(`code=${CODE}&state=${STATE}`), w.deps)))
    }
    expect([...seen]).toEqual(['https://site.example/?settings=channels&slack=refused'])
  })

  it('failing to ASK is "failed", not a refusal and not a connection', async () => {
    expect(
      where(
        await handleCallback(cb(`code=${CODE}&state=${STATE}`), world({ redeemStatus: 503 }).deps),
      ),
    ).toContain('slack=failed')
    expect(
      where(
        await handleCallback(
          cb(`code=${CODE}&state=${STATE}`),
          world({ client: { client_id: null } }).deps,
        ),
      ),
    ).toContain('slack=failed')
    const noSecret = world()
    const r = await handleCallback(cb(`code=${CODE}&state=${STATE}`), {
      ...noSecret.deps,
      clientSecret: '',
    })
    expect(where(r)).toContain('slack=failed')
    expect(noSecret.calls).toHaveLength(0)
  })

  it('only a GET is accepted', async () => {
    const w = world()
    expect((await handleCallback(cb(`code=${CODE}&state=${STATE}`, 'POST'), w.deps)).status).toBe(
      405,
    )
    expect(w.calls).toHaveLength(0)
  })

  it('CONTROL: a connection is reported only when the database said yes', async () => {
    const yes = await handleCallback(cb(`code=${CODE}&state=${STATE}`), world().deps)
    const no = await handleCallback(
      cb(`code=${CODE}&state=${STATE}`),
      world({ redeem: { ok: false } }).deps,
    )
    expect(where(yes)).toContain('slack=connected')
    expect(where(no)).not.toContain('slack=connected')
  })
})

describe('the exchange and the revocation', () => {
  it('an unreachable Slack is a refusal, never a throw carrying the secret', async () => {
    const failing = (async () => {
      throw new Error(`connect failed for client_secret=${SECRET}`)
    }) as unknown as typeof fetch
    const r = await exchangeCode(failing, {
      clientId: 'c',
      clientSecret: SECRET,
      code: CODE,
      redirectUri: 'r',
    })
    expect(r).toEqual({ ok: false })
    expect(await revokeToken(failing, TOKEN)).toBe(false)
  })

  it('revokes at Slack with the token as a bearer, and reports ok or not', async () => {
    const w = world()
    expect(await revokeToken(w.deps.fetch, TOKEN)).toBe(true)
    expect(w.calls[0]?.url).toBe('https://slack.com/api/auth.revoke')
    const notOk = (async () =>
      Response.json({ ok: false, error: 'invalid_auth' })) as unknown as typeof fetch
    expect(await revokeToken(notOk, TOKEN)).toBe(false)
  })
})

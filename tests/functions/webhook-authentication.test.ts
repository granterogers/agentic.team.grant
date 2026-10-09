/**
 * The two public webhooks authenticate before they do anything (deep systems audit, M1, M2, M2b).
 *
 * The signature and secret FUNCTIONS were well tested; the call that makes them matter - the entrypoint refusing a
 * request they reject - was read by no test, so deleting it left 5,313 tests green. This loads the REAL entrypoints
 * (the deploy's own bundle, `tests/helpers/edge-bundle.ts`) and asserts BEHAVIOUR: an unauthenticated request is
 * answered 401 and the function reaches NOTHING (no database call, no worker kick); an authenticated one is let through
 * to its first real work. The authenticated control is what stops these passing against a function that refuses
 * everything.
 */
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadEdge, SLACK_BUNDLE, TELEGRAM_BUNDLE } from '../helpers/edge-bundle.ts'

const calls: string[] = []
const recorder: typeof fetch = async (url) => {
  calls.push(String(url))
  // staff_for_bot answers "no such bot": the first real work after authentication, and a 200 for the sender.
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
}
afterEach(() => {
  calls.length = 0
  vi.unstubAllGlobals()
})

const BASE_ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
}

describe('telegram-webhook', () => {
  const SECRET = 'telegram-shared-secret'
  const post = (headers: Record<string, string>): Request =>
    new Request('https://fn.test/telegram-webhook?bot=123', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ update_id: 1 }),
    })

  it('refuses a request with no secret header, and reaches nothing', async () => {
    const h = await loadEdge(
      TELEGRAM_BUNDLE,
      { ...BASE_ENV, TELEGRAM_WEBHOOK_SECRET: SECRET },
      recorder,
    )
    const res = await h(post({}))
    expect(res.status).toBe(401)
    expect(calls).toEqual([])
  })

  it('refuses a wrong secret, and one of a different length', async () => {
    const h = await loadEdge(
      TELEGRAM_BUNDLE,
      { ...BASE_ENV, TELEGRAM_WEBHOOK_SECRET: SECRET },
      recorder,
    )
    for (const wrong of ['telegram-shared-secreT', 'x', `${SECRET}-and-more`, '']) {
      const res = await h(post({ 'X-Telegram-Bot-Api-Secret-Token': wrong }))
      expect(res.status, wrong).toBe(401)
    }
    expect(calls).toEqual([])
  })

  it('fails closed when no secret is configured, even for a request that presents an empty one', async () => {
    const h = await loadEdge(TELEGRAM_BUNDLE, { ...BASE_ENV }, recorder)
    for (const headers of [{}, { 'X-Telegram-Bot-Api-Secret-Token': '' }] as const) {
      const res = await h(post(headers))
      expect(res.status).toBe(401)
    }
    expect(calls).toEqual([])
  })

  it('CONTROL: the right secret is let through to the first real work (it is not refusing everything)', async () => {
    const h = await loadEdge(
      TELEGRAM_BUNDLE,
      { ...BASE_ENV, TELEGRAM_WEBHOOK_SECRET: SECRET },
      recorder,
    )
    const res = await h(post({ 'X-Telegram-Bot-Api-Secret-Token': SECRET }))
    expect(res.status).not.toBe(401)
    expect(calls.some((c) => c.endsWith('/rpc/staff_for_bot'))).toBe(true)
  })
})

describe('slack-events', () => {
  const SECRET = 'slack-signing-secret'
  const sign = (secret: string, ts: string, body: string): string =>
    `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`
  const nowTs = (): string => String(Math.floor(Date.now() / 1000))
  const BODY = JSON.stringify({ type: 'url_verification', challenge: 'c-123' })
  const post = (headers: Record<string, string>, body = BODY): Request =>
    new Request('https://fn.test/slack-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    })

  it('refuses an unsigned request and a wrongly signed one, and reaches nothing', async () => {
    const h = await loadEdge(SLACK_BUNDLE, { ...BASE_ENV, SLACK_SIGNING_SECRET: SECRET }, recorder)
    const ts = nowTs()
    for (const headers of [
      {},
      { 'X-Slack-Request-Timestamp': ts },
      { 'X-Slack-Signature': sign(SECRET, ts, BODY) },
      { 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': sign('another-secret', ts, BODY) },
      { 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': sign(SECRET, ts, `${BODY} `) },
    ]) {
      const res = await h(post(headers))
      expect(res.status, JSON.stringify(Object.keys(headers))).toBe(401)
    }
    expect(calls).toEqual([])
  })

  it('refuses a correctly signed request that is stale (replay)', async () => {
    const h = await loadEdge(SLACK_BUNDLE, { ...BASE_ENV, SLACK_SIGNING_SECRET: SECRET }, recorder)
    const old = String(Math.floor(Date.now() / 1000) - 3600)
    const res = await h(
      post({ 'X-Slack-Request-Timestamp': old, 'X-Slack-Signature': sign(SECRET, old, BODY) }),
    )
    expect(res.status).toBe(401)
  })

  it('fails closed when no signing secret is configured, even for a request signed with the empty secret', async () => {
    const h = await loadEdge(SLACK_BUNDLE, { ...BASE_ENV }, recorder)
    const ts = nowTs()
    const res = await h(
      post({ 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': sign('', ts, BODY) }),
    )
    expect(res.status).toBe(401)
    expect(calls).toEqual([])
  })

  it('CONTROL: a correctly signed, fresh request is answered (it is not refusing everything)', async () => {
    const h = await loadEdge(SLACK_BUNDLE, { ...BASE_ENV, SLACK_SIGNING_SECRET: SECRET }, recorder)
    const ts = nowTs()
    const res = await h(
      post({ 'X-Slack-Request-Timestamp': ts, 'X-Slack-Signature': sign(SECRET, ts, BODY) }),
    )
    expect(res.status).toBe(200)
    expect(JSON.stringify(await res.json())).toContain('c-123')
  })
})

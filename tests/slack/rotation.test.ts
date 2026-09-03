import { describe, expect, it, vi } from 'vitest'
import {
  RotationError,
  rotateTokens,
  secondsUntilExpiry,
  shouldRotate,
} from '../../src/slack/rotation.ts'

const respond = (payload: unknown, status = 200): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch

const GOOD = {
  ok: true,
  // secret-scan:allow-shape
  token: 'xoxe.xoxp-1-FAKE-ACCESS',
  // secret-scan:allow-shape
  refresh_token: 'xoxe-1-FAKE-REFRESH',
  exp: 1_800_000_000,
  team_id: 'T0BUCJ2L5FD',
}

describe('rotateTokens', () => {
  it('returns the new pair and its expiry', async () => {
    const pair = await rotateTokens('old-refresh', respond(GOOD))
    expect(pair.accessToken).toBe(GOOD.token)
    expect(pair.refreshToken).toBe(GOOD.refresh_token)
    expect(pair.expiresAt).toBe(GOOD.exp)
  })

  it('sends the refresh token in the BODY, never the query string', async () => {
    // The refresh token IS the credential here. In a URL it would reach access
    // logs, proxies and browser history.
    const fetchImpl = respond(GOOD)
    await rotateTokens('old-refresh', fetchImpl)

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? []
    expect(String(url)).not.toContain('old-refresh')
    expect(String(init?.body)).toContain('refresh_token=old-refresh')
  })

  it.each([
    'invalid_refresh_token',
    'token_revoked',
    'token_expired',
    'invalid_auth',
    'account_inactive',
  ])('flags %s as needing a human', async (error) => {
    // Retrying a dead refresh token forever, silently, is the failure this
    // distinction prevents.
    await expect(rotateTokens('x', respond({ ok: false, error }))).rejects.toMatchObject({
      needsHuman: true,
      slackError: error,
    })
  })

  it.each(['ratelimited', 'service_unavailable', 'internal_error'])(
    'treats %s as retryable, not fatal',
    async (error) => {
      await expect(rotateTokens('x', respond({ ok: false, error }))).rejects.toMatchObject({
        needsHuman: false,
      })
    },
  )

  it('rejects an ok response missing the token', async () => {
    // Otherwise `undefined` would be persisted over a working credential.
    await expect(
      rotateTokens('x', respond({ ok: true, refresh_token: 'r', exp: 1 })),
    ).rejects.toThrow(/omitted token/)
  })

  it('rejects an ok response missing exp', async () => {
    await expect(
      rotateTokens('x', respond({ ok: true, token: 't', refresh_token: 'r' })),
    ).rejects.toThrow(/omitted token, refresh_token or exp/)
  })

  it('raises RotationError rather than a bare Error', async () => {
    await expect(rotateTokens('x', respond({ ok: false, error: 'nope' }))).rejects.toBeInstanceOf(
      RotationError,
    )
  })
})

describe('shouldRotate', () => {
  const now = 1_000_000

  it('rotates when already expired', () => {
    expect(shouldRotate(now - 1, now)).toBe(true)
  })

  it('rotates inside the margin', () => {
    expect(shouldRotate(now + 1800, now)).toBe(true)
  })

  it('does not rotate well before the margin', () => {
    expect(shouldRotate(now + 7200, now)).toBe(false)
  })

  it('treats the margin boundary as due', () => {
    // Rotating early is nearly free; rotating late costs an outage. The
    // boundary therefore resolves toward rotating.
    expect(shouldRotate(now + 3600, now)).toBe(true)
  })

  it('gives an hourly scheduler room to miss a run', () => {
    // A 12-hour token with a 1-hour margin can miss a run and still rotate.
    const twelveHours = now + 12 * 3600
    expect(shouldRotate(twelveHours, now)).toBe(false)
    expect(shouldRotate(twelveHours, twelveHours - 3600)).toBe(true)
  })
})

describe('secondsUntilExpiry', () => {
  it('is negative once expired', () => {
    expect(secondsUntilExpiry(100, 200)).toBe(-100)
  })
})

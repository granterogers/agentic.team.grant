import { describe, expect, it, vi } from 'vitest'
import {
  RotationError,
  rotateAndPersist,
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

describe('rotateAndPersist — §18: an invalid refresh token must not lock us out', () => {
  /** Records every statement, and answers none of them meaningfully. */
  const recordingDb = (): {
    execute: (sql: string) => Promise<{ rows: never[] }>
    statements: string[]
  } => {
    const statements: string[] = []
    return {
      statements,
      execute: async (sql: string) => {
        statements.push(sql)
        return { rows: [] }
      },
    }
  }

  const refuses = (error: string): typeof fetch =>
    vi.fn(
      async () => new Response(JSON.stringify({ ok: false, error }), { status: 200 }),
    ) as unknown as typeof fetch

  const issues = (): typeof fetch =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            token: 'xoxe-new',
            refresh_token: 'xoxe-1-new',
            exp: 1_800_000_000,
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch

  it('persists the current refresh token BEFORE spending it', async () => {
    // A refresh token is single-use: the moment Slack accepts it, it is gone.
    // A crash between "sent" and "stored the reply" would leave nothing on
    // either side, which is why the copy is first and not merely somewhere.
    const db = recordingDb()
    await rotateAndPersist(
      { office: 'app.test_office()', execute: db.execute, fetchImpl: issues() },
      'A0APP',
      'xoxe-1-current',
    )
    const firstWrite = db.statements[0] ?? ''
    expect(firstWrite).toContain('store_secret')
    expect(firstWrite).toContain('slack.config_refresh_token')
    expect(firstWrite).toContain('xoxe-1-current')
  })

  it('does NOT touch the access token when the rotation is refused', async () => {
    // The property that matters. The stored access token keeps working until it
    // expires, which buys hours — and hours are the difference between a retry
    // and a human at api.slack.com.
    const db = recordingDb()
    const outcome = await rotateAndPersist(
      {
        office: 'app.test_office()',
        execute: db.execute,
        fetchImpl: refuses('invalid_refresh_token'),
      },
      'A0APP',
      'xoxe-1-current',
    )
    expect(outcome.kind).toBe('failed')
    const wroteAccessToken = db.statements.some(
      (s) => s.includes('store_secret') && s.includes('slack.config_token'),
    )
    expect(wroteAccessToken).toBe(false)
  })

  it('records the failure so a second attempt is not blind', async () => {
    const db = recordingDb()
    await rotateAndPersist(
      {
        office: 'app.test_office()',
        execute: db.execute,
        fetchImpl: refuses('invalid_refresh_token'),
      },
      'A0APP',
      'xoxe-1-current',
    )
    const failure = db.statements.find((s) => s.includes('rotation_failures'))
    expect(failure).toBeDefined()
    expect(failure).toContain('rotation_failures + 1')
    expect(failure).toContain('invalid_refresh_token')
    expect(failure).toContain('A0APP')
  })

  it('says when a human is needed, and when one is not', async () => {
    const db = recordingDb()
    const dead = await rotateAndPersist(
      {
        office: 'app.test_office()',
        execute: db.execute,
        fetchImpl: refuses('invalid_refresh_token'),
      },
      'A0APP',
      'x',
    )
    const transient = await rotateAndPersist(
      { office: 'app.test_office()', execute: db.execute, fetchImpl: refuses('ratelimited') },
      'A0APP',
      'x',
    )
    // The distinction is the whole value of the message: one of these is worth
    // retrying in an hour and the other never will be.
    expect(dead).toMatchObject({ kind: 'failed', needsHuman: true })
    expect(transient).toMatchObject({ kind: 'failed', needsHuman: false })
  })

  it('never puts a token in the failure it records', async () => {
    const db = recordingDb()
    await rotateAndPersist(
      {
        office: 'app.test_office()',
        execute: db.execute,
        fetchImpl: refuses('invalid_refresh_token'),
      },
      'A0APP',
      // Token-shaped on purpose: the check is that a real one would not reach
      // the recorded failure, and a fixture that did not look like a token
      // would not exercise that. The marker is per-line by design — a blanket
      // one would eventually hide something real.
      // secret-scan:allow-shape
      'xoxe-1-supersecret',
    )
    const failure = db.statements.find((s) => s.includes('rotation_failures')) ?? ''
    expect(failure).not.toContain('supersecret')
  })

  it('persists the new pair before anything else on success', async () => {
    // Before the row update, before verification. A verification that failed
    // must not lose a pair Slack has already issued — and already invalidated
    // the old one for.
    const db = recordingDb()
    const outcome = await rotateAndPersist(
      { office: 'app.test_office()', execute: db.execute, fetchImpl: issues() },
      'A0APP',
      'xoxe-1-current',
    )
    expect(outcome).toEqual({ kind: 'rotated', expiresAt: 1_800_000_000 })
    const stored = db.statements.filter((s) => s.includes('store_secret'))
    expect(stored).toHaveLength(2) // the pre-rotation copy, then the new pair TOGETHER
    expect(stored[1]).toContain('xoxe-new')
    expect(stored[1]).toContain('xoxe-1-new')
  })

  it('never stores half of the new pair: the two tokens are one statement (review L2)', async () => {
    // The access token alone would leave the consumed refresh token in the vault: the next rotation fails and only a
    // person can repair it. So no statement may name one of the new tokens without the other.
    const db = recordingDb()
    await rotateAndPersist(
      { office: 'app.test_office()', execute: db.execute, fetchImpl: issues() },
      'A0APP',
      'xoxe-1-current',
    )
    const withAccess = db.statements.filter((s) => s.includes('xoxe-new'))
    const withRefresh = db.statements.filter((s) => s.includes('xoxe-1-new'))
    expect(withAccess).toHaveLength(1)
    expect(withRefresh).toEqual(withAccess)
  })

  it('CONTROL: a successful rotation DOES write the access token', async () => {
    // Without this, "did not touch the access token" would pass against a
    // function that never writes one at all.
    const db = recordingDb()
    await rotateAndPersist(
      { office: 'app.test_office()', execute: db.execute, fetchImpl: issues() },
      'A0APP',
      'x',
    )
    expect(
      db.statements.some((s) => s.includes('store_secret') && s.includes('slack.config_token')),
    ).toBe(true)
  })
})

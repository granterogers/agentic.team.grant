/**
 * The Google sign-in decisions, with fixtures (#467, A2). Each refusal is asserted by its reason, and each accepted case is
 * asserted as the exact action, so a policy that refuses everything, or allows everything, fails.
 */
import { describe, expect, it } from 'vitest'
import {
  callbackOutcome,
  createState,
  decideLink,
  googleSignInEnabled,
  redirectAllowed,
  verifyState,
} from '../../src/auth/google-policy.ts'

const ORIGINS = ['https://app.example.test', 'https://preview.example.test']
const SECRET = new Uint8Array(32).fill(7)
const NOW = 1_800_000_000_000

describe('redirectAllowed: no open redirects', () => {
  it('accepts a path on this app', () => {
    expect(redirectAllowed('/p/legacy/tasks', ORIGINS)).toEqual({ ok: true })
  })

  it('accepts an allowlisted https origin', () => {
    expect(redirectAllowed('https://app.example.test/after', ORIGINS)).toEqual({ ok: true })
  })

  it('refuses an origin that is not on the allowlist, even one that looks like it', () => {
    expect(redirectAllowed('https://app.example.test.evil.test/x', ORIGINS)).toEqual({
      ok: false,
      reason: 'origin not allowlisted',
    })
    expect(redirectAllowed('https://evil.test/x', ORIGINS)).toEqual({
      ok: false,
      reason: 'origin not allowlisted',
    })
  })

  it('refuses a protocol-relative address, which would leave the origin', () => {
    expect(redirectAllowed('//evil.test/x', ORIGINS)).toEqual({
      ok: false,
      reason: 'protocol-relative',
    })
  })

  it('refuses a backslash, which some browsers read as a slash', () => {
    expect(redirectAllowed('/\\evil.test', ORIGINS)).toEqual({ ok: false, reason: 'backslash' })
  })

  it('refuses credentials in the address, and a non-https scheme', () => {
    expect(redirectAllowed('https://user:pass@app.example.test/x', ORIGINS)).toEqual({
      ok: false,
      reason: 'credentials in the address',
    })
    expect(redirectAllowed('http://app.example.test/x', ORIGINS)).toEqual({
      ok: false,
      reason: 'not https',
    })
    expect(redirectAllowed('javascript:alert(1)', ORIGINS)).toEqual({
      ok: false,
      reason: 'not https',
    })
  })

  it('refuses a relative form that does not start with a slash', () => {
    expect(redirectAllowed('evil.test/x', ORIGINS)).toEqual({
      ok: false,
      reason: 'relative path must start with /',
    })
  })
})

describe('the state token: no forged, altered or replayed sign-in', () => {
  const token = () =>
    createState(SECRET, { nowMs: NOW, ttlMs: 600_000, nonce: 'n-1', returnTo: '/p/x' })

  it('verifies a token it issued, and returns the nonce and the return address', async () => {
    expect(await verifyState(SECRET, await token(), NOW + 1_000)).toEqual({
      ok: true,
      nonce: 'n-1',
      returnTo: '/p/x',
    })
  })

  it('refuses a missing token', async () => {
    expect(await verifyState(SECRET, null, NOW)).toEqual({ ok: false, reason: 'missing' })
  })

  it('refuses a token whose payload was altered, even though the rest is intact', async () => {
    const [payload, mac] = (await token()).split('.') as [string, string]
    const forged = Buffer.from(
      JSON.stringify({ n: 'n-1', r: '/evil', exp: NOW + 600_000 }),
    ).toString('base64url')
    expect(await verifyState(SECRET, `${forged}.${mac}`, NOW)).toEqual({
      ok: false,
      reason: 'bad signature',
    })
    expect(payload).not.toBe(forged)
  })

  it('refuses a token signed with a different secret', async () => {
    const other = await createState(new Uint8Array(32).fill(9), {
      nowMs: NOW,
      ttlMs: 600_000,
      nonce: 'n',
      returnTo: '/',
    })
    expect(await verifyState(SECRET, other, NOW)).toEqual({ ok: false, reason: 'bad signature' })
  })

  it('refuses an expired token, and an unexpired one just before expiry is still accepted', async () => {
    expect(await verifyState(SECRET, await token(), NOW + 600_000)).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(await verifyState(SECRET, await token(), NOW + 599_999)).toMatchObject({ ok: true })
  })

  it('refuses a token that is not the right shape', async () => {
    expect(await verifyState(SECRET, 'no-dot-here', NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    })
    expect(await verifyState(SECRET, '.onlyasignature', NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })
})

describe('callbackOutcome', () => {
  const good = { ok: true as const, nonce: 'n', returnTo: '/' }

  it('treats a cancellation as a cancellation, not as a failure', () => {
    expect(
      callbackOutcome({ providerError: 'access_denied', hasCode: false, state: good }),
    ).toEqual({ action: 'cancelled' })
  })

  it('refuses any other provider error', () => {
    expect(callbackOutcome({ providerError: 'server_error', hasCode: false, state: good })).toEqual(
      {
        action: 'refused',
        reason: 'the provider returned an error',
      },
    )
  })

  it('refuses a callback whose state did not verify, and names why', () => {
    expect(
      callbackOutcome({
        providerError: null,
        hasCode: true,
        state: { ok: false, reason: 'expired' },
      }),
    ).toEqual({
      action: 'refused',
      reason: 'state expired',
    })
  })

  it('refuses a verified state with no code', () => {
    expect(callbackOutcome({ providerError: null, hasCode: false, state: good })).toEqual({
      action: 'refused',
      reason: 'no authorisation code',
    })
  })

  it('continues only when there is no error, a verified state and a code', () => {
    expect(callbackOutcome({ providerError: null, hasCode: true, state: good })).toEqual({
      action: 'continue',
    })
  })
})

describe('decideLink: no account is ever linked on email alone', () => {
  const base = {
    providerEmailVerified: true,
    identityOwner: null,
    signedInAs: null,
    emailAccountExists: false,
  }

  it('creates a new account for a verified email with no existing account', () => {
    expect(decideLink(base)).toEqual({ action: 'create_account' })
  })

  it('refuses a same-email account when nobody is signed in: the Google mailbox must not take over the account', () => {
    const d = decideLink({ ...base, emailAccountExists: true })
    expect(d).toMatchObject({ action: 'refuse' })
    expect(d.action === 'refuse' && d.reason).toMatch(/sign in to it first/)
  })

  it('does not create or link anything for an unverified provider email, even when the email is new', () => {
    expect(decideLink({ ...base, providerEmailVerified: false })).toEqual({
      action: 'refuse',
      reason: 'the Google email address is not verified',
    })
  })

  it('signs in the account that already holds this identity, whatever email is shown', () => {
    expect(decideLink({ ...base, identityOwner: 'acct-1', emailAccountExists: true })).toEqual({
      action: 'sign_in',
      accountId: 'acct-1',
    })
  })

  it('refuses a Google identity that belongs to another account than the one signed in', () => {
    expect(decideLink({ ...base, identityOwner: 'acct-1', signedInAs: 'acct-2' })).toEqual({
      action: 'refuse',
      reason: 'this Google identity belongs to another account',
    })
  })

  it('links a new identity to the account the person is signed into, when the identity is nobody else’s', () => {
    expect(decideLink({ ...base, signedInAs: 'acct-2', emailAccountExists: true })).toEqual({
      action: 'link_to_signed_in',
      accountId: 'acct-2',
    })
  })

  it('does not link to the signed-in account when the Google email is unverified', () => {
    expect(decideLink({ ...base, signedInAs: 'acct-2', providerEmailVerified: false })).toEqual({
      action: 'refuse',
      reason: 'the Google email address is not verified',
    })
  })
})

describe('the flag', () => {
  it('is off unless it is exactly true', () => {
    expect(googleSignInEnabled(undefined)).toBe(false)
    expect(googleSignInEnabled({})).toBe(false)
    expect(googleSignInEnabled({ 'auth.google_sign_in': 'true' })).toBe(false)
    expect(googleSignInEnabled({ 'auth.google_sign_in': true })).toBe(true)
  })
})

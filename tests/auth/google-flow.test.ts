/**
 * The Google sign-in flow's decisions (issue #467): off by default, refused without a valid return address, and built
 * only from the provider's https origin. Fixtures only; no provider is contacted.
 */
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_CANCELLED,
  GOOGLE_OFF,
  GOOGLE_REFUSED,
  googleOffered,
  googleReturnProblem,
  googleStartPlan,
} from '../../src/auth/google-flow.ts'

const ORIGIN = 'https://office.example'
const BASE = 'https://abcdefgh.supabase.co'
const NONCE = 'a'.repeat(30)
const BACK = `${ORIGIN}/?flow=${NONCE}`

function plan(overrides: Partial<Parameters<typeof googleStartPlan>[0]> = {}) {
  return googleStartPlan({
    switchedOn: true,
    authorizeBase: BASE,
    back: BACK,
    allowedOrigins: [ORIGIN],
    nonce: NONCE,
    ...overrides,
  })
}

describe('the feature flag', () => {
  it('is on only for the exact word true', () => {
    expect(googleOffered('true')).toBe(true)
    for (const v of [undefined, null, '', 'false', 'TRUE', '1', 'yes', ' true']) {
      expect(googleOffered(v)).toBe(false)
    }
  })

  it('refuses to start when switched off, whatever else is right', () => {
    expect(plan({ switchedOn: false })).toEqual({ ok: false, said: GOOGLE_OFF })
  })
})

describe('starting a sign-in', () => {
  it('builds the provider address with the page as the return, and the flow nonce kept', () => {
    const out = plan()
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const url = new URL(out.url)
    expect(url.origin).toBe(BASE)
    expect(url.pathname).toBe('/auth/v1/authorize')
    expect(url.searchParams.get('provider')).toBe('google')
    expect(url.searchParams.get('redirect_to')).toBe(BACK)
  })

  it('refuses a return address that is not on the allowlist', () => {
    expect(plan({ back: `https://evil.example/?flow=${NONCE}` })).toEqual({
      ok: false,
      said: GOOGLE_REFUSED,
    })
  })

  it('refuses a protocol-relative or backslash return address', () => {
    expect(plan({ back: '//evil.example/' }).ok).toBe(false)
    expect(plan({ back: `${ORIGIN}\\..\\x` }).ok).toBe(false)
  })

  it('refuses a flow nonce that is missing or malformed', () => {
    expect(plan({ nonce: '' }).ok).toBe(false)
    expect(plan({ nonce: 'short' }).ok).toBe(false)
    expect(plan({ nonce: 'UPPER'.repeat(6) }).ok).toBe(false)
  })

  it('refuses a provider base that is not an https origin with no credentials', () => {
    expect(plan({ authorizeBase: 'http://abcdefgh.supabase.co' }).ok).toBe(false)
    expect(plan({ authorizeBase: 'https://user:pass@abcdefgh.supabase.co' }).ok).toBe(false)
    expect(plan({ authorizeBase: 'not a url' }).ok).toBe(false)
  })

  it('builds nothing on a refusal', () => {
    const out = plan({ switchedOn: false })
    expect('url' in out).toBe(false)
  })
})

describe('a return that carries a provider error', () => {
  it('names a cancellation as one', () => {
    expect(googleReturnProblem('access_denied')).toBe(GOOGLE_CANCELLED)
  })

  it('shows every other error as the same plain sentence, never the provider wording', () => {
    expect(googleReturnProblem('server_error')).toBe(GOOGLE_REFUSED)
    expect(googleReturnProblem('')).toBe(GOOGLE_REFUSED)
  })
})

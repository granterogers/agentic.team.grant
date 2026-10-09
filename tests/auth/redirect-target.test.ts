/**
 * B-04: the sign-in link's redirect check compared by PREFIX, so a host that merely begins with an allowed origin
 * received the magic link. These drive the shared function with adversarial addresses, and drive the real `signin`
 * handler (under a stubbed Deno) to prove the function is what decides what goes to the identity provider.
 *
 * Every refusal has a positive control beside it: a guard that refuses everything fails the controls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normaliseAllowedOrigin, safeRedirectTarget } from '../../src/auth/redirect-target.ts'

const A = 'https://allowed.example'
const B = 'https://second.example'
const LOCAL = 'http://localhost:3000'
const ALLOWED = [A, B]
const FALLBACK = 'https://fallback.example'
const decide = (back: unknown, allowed: readonly string[] = ALLOWED): string =>
  safeRedirectTarget(back, allowed, FALLBACK)

describe('positive controls: an allowed origin with an ordinary path still passes', () => {
  it.each([
    [`${A}`, `${A}/`],
    [`${A}/`, `${A}/`],
    [`${A}/p/legacy/tasks`, `${A}/p/legacy/tasks`],
    [`${A}/studio/?flow=abc123def`, `${A}/studio/?flow=abc123def`],
    [`${B}/p/x?flow=k1&x=2`, `${B}/p/x?flow=k1&x=2`],
    [`${A}/page#ignored`, `${A}/page`], // a caller-chosen fragment is dropped, never kept
  ])('%s', (back, wanted) => {
    expect(decide(back)).toBe(wanted)
  })

  it('every configured origin works, not only the first', () => {
    expect(decide(`${B}/x`)).toBe(`${B}/x`)
    expect(decide(`${A}/x`)).toBe(`${A}/x`)
  })

  it('an explicitly configured loopback http origin is honoured, and only that', () => {
    expect(decide(`${LOCAL}/x?flow=1`, [A, LOCAL])).toBe(`${LOCAL}/x?flow=1`)
    expect(decide('http://localhost:3001/x', [A, LOCAL])).toBe(FALLBACK)
    expect(decide('http://localhost/x', [A, LOCAL])).toBe(FALLBACK)
    expect(decide(`${LOCAL}/x`, [A])).toBe(FALLBACK) // loopback not configured: refused
  })

  it('default-port equivalence is the same origin and is normalised', () => {
    expect(decide(`${A}:443/x`)).toBe(`${A}/x`)
  })

  it('host case is the same origin and is normalised to the configured spelling', () => {
    expect(decide('https://ALLOWED.Example/x')).toBe(`${A}/x`)
  })
})

describe('adversarial origins are refused (the fallback is returned)', () => {
  const refused: [string, string][] = [
    ['subdomain-lookalike suffix', 'https://allowed.example.evil.com/x'],
    ['userinfo, allowed first', 'https://allowed.example@evil.com/x'],
    ['userinfo, allowed last', 'https://evil.com@allowed.example/x'],
    ['userinfo with password', 'https://user:pw@allowed.example/x'],
    ['other port', 'https://allowed.example:444/x'],
    ['port as lookalike path', 'https://allowed.example:evil/x'],
    ['http for https', 'http://allowed.example/x'],
    ['ftp scheme', 'ftp://allowed.example/x'],
    ['javascript scheme', 'javascript:alert(1)//https://allowed.example'],
    ['data scheme', 'data:text/html,https://allowed.example'],
    ['protocol-relative', '//allowed.example/x'],
    ['protocol-relative evil', '//evil.com'],
    ['subdomain of allowed', 'https://evil.allowed.example/x'],
    ['parent domain', 'https://example/x'],
    ['sibling domain', 'https://allowed.examples/x'],
    ['trailing-dot host', 'https://allowed.example./x'],
    ['percent-encoded dot in host', 'https://allowed%2eexample/x'],
    ['percent-encoded at-sign', 'https://allowed.example%40evil.com/x'],
    ['double-encoded at-sign', 'https://allowed.example%2540evil.com/x'],
    ['percent-encoded slash then host', 'https://allowed.example%2f@evil.com/x'],
    ['percent-encoded slash in path', `${A}/%2f%2fevil.com`],
    ['percent-encoded dots in path', `${A}/%2e%2e/x`],
    ['double-encoded dots in path', `${A}/%252e%252e/x`],
    ['double slash path', `${A}//evil.com`],
    ['backslash path', `${A}/\\evil.com`],
    ['backslash host', 'https://allowed.example\\@evil.com'],
    ['semicolon dot segment', `${A}/..;/x`],
    ['dot-dot segment', `${A}/a/../b`],
    ['dot segment', `${A}/./b`],
    ['cyrillic lookalike host', 'https://аllowed.example/x'],
    ['unicode full-width dot host', 'https://allowed。example/x'],
    ['punycode host', 'https://xn--llowed-9fe.example/x'],
    ['trailing newline', `${A}/x\n`],
    ['embedded newline', `${A}/x\nSet-Cookie: a=b`],
    ['embedded tab in host', 'https://allow\ted.example/x'],
    ['leading space', ` ${A}/x`],
    ['trailing space', `${A}/x `],
    ['NUL byte', `${A}/x\u0000`],
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a url', 'allowed.example/x'],
    ['allowed origin only inside the query', `https://evil.com/?u=${A}`],
    ['allowed origin only inside the path', `https://evil.com/${A}`],
    ['allowed origin inside a fragment', `https://evil.com/#${A}`],
  ]
  it.each(refused)('%s', (_why, back) => {
    expect(decide(back)).toBe(FALLBACK)
  })

  it('missing and non-string input', () => {
    for (const v of [undefined, null, 5, {}, [], [`${A}/x`], true]) expect(decide(v)).toBe(FALLBACK)
  })

  it('very long input', () => {
    expect(decide(`${A}/${'a'.repeat(5000)}`)).toBe(FALLBACK)
    expect(decide(`${A}/${'a'.repeat(1900)}`)).toBe(`${A}/${'a'.repeat(1900)}`) // control: under the cap
  })

  it('an empty allow-list refuses everything rather than waving everything through', () => {
    expect(decide(`${A}/x`, [])).toBe(FALLBACK)
  })

  it('a malformed configured entry is dropped and never widens the list', () => {
    expect(decide('https://evil.com/x', ['https://', 'allowed', '*', '', ' '])).toBe(FALLBACK)
    expect(decide(`${A}/x`, ['https://allowed.example/with/path'])).toBe(FALLBACK)
    expect(decide(`${A}/x`, ['https://u@allowed.example'])).toBe(FALLBACK)
    expect(decide('http://allowed.example/x', ['http://allowed.example'])).toBe(FALLBACK)
    // the good entry beside the bad ones still works
    expect(decide(`${A}/x`, ['*', A])).toBe(`${A}/x`)
  })

  it('never throws, whatever it is given', () => {
    const nasty = ['https://[', 'https://%', 'http://', '::::', `${A}/${'%'.repeat(10)}`, '\ud800']
    for (const v of nasty) expect(() => decide(v)).not.toThrow()
  })
})

describe('normaliseAllowedOrigin', () => {
  it('accepts clean origins and rejects the rest', () => {
    expect(normaliseAllowedOrigin(A)).toBe(A)
    expect(normaliseAllowedOrigin(`  ${A} `)).toBe(A)
    expect(normaliseAllowedOrigin('http://localhost:3000')).toBe('http://localhost:3000')
    expect(normaliseAllowedOrigin('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(normaliseAllowedOrigin('http://allowed.example')).toBeNull()
    expect(normaliseAllowedOrigin('https://allowed.example/path')).toBeNull()
    expect(normaliseAllowedOrigin('https://allowed.example?x=1')).toBeNull()
    expect(normaliseAllowedOrigin('ftp://allowed.example')).toBeNull()
  })
})

describe('the deploy carries the shared check', () => {
  it('the signin bundle is closed and includes src/auth/redirect-target.ts', async () => {
    const { prepareBundle } = await import('../../scripts/deploy/lib/bundle.ts')
    const prepared = await prepareBundle('signin', 'supabase/functions/signin/index.ts')
    expect([...prepared.files.keys()]).toContain('src/auth/redirect-target.ts')
    expect(prepared.files.size).toBe(2)
  })
})

/*
  The real handler. It reads Deno.env at import time and registers itself with Deno.serve, so both are stubbed; the
  upstream identity provider is a stub that records the redirect_to it is handed.
*/
describe('the signin handler hands the identity provider only a checked redirect', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  const boot = async (): Promise<{ ask: (back: string) => Promise<string | null> }> => {
    let handler: ((r: Request) => Promise<Response>) | null = null
    const env: Record<string, string> = {
      SUPABASE_URL: 'https://auth.invalid',
      SUPABASE_ANON_KEY: 'anon',
      SIGNIN_ALLOWED_ORIGIN: `${A},${B}`,
    }
    vi.stubGlobal('Deno', {
      env: { get: (k: string) => env[k] },
      serve: (h: (r: Request) => Promise<Response>) => {
        handler = h
      },
    })
    let seen: string | null = null
    vi.stubGlobal('fetch', async (_url: string, init: { body?: string }) => {
      seen = (JSON.parse(String(init.body)) as { redirect_to?: string }).redirect_to ?? null
      return new Response('{}', { status: 200 })
    })
    // A variable specifier: this is a Deno module, and tsc must not type-check it as Node.
    const entry = '../../supabase/functions/signin/index.ts'
    await import(/* @vite-ignore */ entry)
    const ask = async (back: string): Promise<string | null> => {
      seen = null
      const response = await (handler as unknown as (r: Request) => Promise<Response>)(
        new Request('https://fn.invalid/signin', {
          method: 'POST',
          headers: { origin: A, 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'link', email: 'a@b.co', back }),
        }),
      )
      expect(response.status).toBe(200)
      return seen
    }
    return { ask }
  }

  it('passes a good return address through, rebuilt', async () => {
    const { ask } = await boot()
    expect(await ask(`${A}/p/x?flow=abc`)).toBe(`${A}/p/x?flow=abc`)
    expect(await ask(`${B}/`)).toBe(`${B}/`)
  })

  it('replaces every adversarial return address with the requesting page', async () => {
    const { ask } = await boot()
    for (const bad of [
      'https://allowed.example.evil.com/',
      'https://allowed.example@evil.com/',
      'https://allowed.example:444/',
      'http://allowed.example/',
      'javascript:alert(1)',
    ]) {
      expect(await ask(bad)).toBe(A)
    }
  })
})

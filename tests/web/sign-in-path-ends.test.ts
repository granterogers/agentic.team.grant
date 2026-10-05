import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Grant, 5 October 2026: "My actual login attempt hung indefinitely."
 *
 * The sign-in path (the link request, the refresh exchange, every office read and write, the first-office call) made its
 * requests with no deadline, and the boot sequence awaits the refresh before it asks for the studio payload. These
 * properties keep it ended:
 *
 *   1. a request that never answers is given up on, with an error that names the boundary it stopped at;
 *   2. the trace records the stall at that boundary;
 *   3. the files on the sign-in path make their requests through net.js and not with a bare fetch;
 *   4. the sign-in function bounds every call to Auth, and an outage is never reported as an expired session.
 *
 * Each source property carries a synthetic control: the detector is shown the defect and must fire.
 */

type Entry = { boundary: string; outcome: string }
type Net = {
  bounded: (boundary: string, url: string, init?: object, ms?: number) => Promise<Response>
  lastStall: () => Entry | null
  unreachable: (boundary: string, ms: number) => Error
  trace: Entry[]
}
/** A plain browser module has no declaration file; one typed door instead of four casts. */
const loadNet = async (): Promise<Net> =>
  // @ts-expect-error -- a plain browser module, no declaration file
  (await import('../../web/studio/net.js')) as Net

const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (p: string): string => readFileSync(p, 'utf8')

/** Calls to the global fetch, as opposed to `bounded(` or a method named fetch. */
const bareFetches = (c: string): number =>
  [...c.matchAll(/\bfetch\s*\(/g)].filter((m) => {
    const prev = c[(m.index ?? 0) - 1] ?? ''
    return !/[.\w$]/.test(prev)
  }).length

describe('a request that never answers is given up on', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('throws Unreachable naming the boundary, and records the stall', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise((_ok, no) => {
          init.signal?.addEventListener('abort', () => no(init.signal?.reason))
        }),
    )
    const net = await loadNet()
    const began = Date.now()
    const error = await net
      .bounded('auth:refresh', 'https://x.invalid/', {}, 60)
      .catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('Unreachable')
    expect((error as Error).message).toMatch(/did not answer/)
    expect((error as Error).message).toMatch(/stopped at auth:refresh/)
    expect(Date.now() - began).toBeLessThan(2000)
    expect(net.lastStall()?.boundary).toBe('auth:refresh')
    expect(net.lastStall()?.outcome).toBe('timeout')
  })

  it('does not tell somebody who is asking for a link that they are signed in', async () => {
    const net = await loadNet()
    expect(net.unreachable('auth:link', 20_000).message).not.toMatch(/signed in/)
    expect(net.unreachable('auth:refresh', 16_000).message).toMatch(/still signed in/)
  })

  it('control: a request that answers is passed through and traced as answered', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }))
    const net = await loadNet()
    const r = await net.bounded('office:read:studio', 'https://x.invalid/', {}, 500)
    expect(r.status).toBe(200)
    expect(net.trace.at(-1)?.outcome).toBe('answered')
  })

  it('a network failure is named in the same plain words, not as a timeout', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const net = await loadNet()
    const error = await net
      .bounded('auth:link', 'https://x.invalid/', {}, 500)
      .catch((e: Error) => e)
    expect((error as Error).name).toBe('Unreachable')
    expect((error as Error).message).toMatch(/could not be reached/)
    expect(net.trace.at(-1)?.outcome).toBe('failed')
  })
})

describe('the sign-in path makes no request without a deadline', () => {
  const PATH = ['web/studio/session.js', 'web/studio/office.js', 'web/studio/bc/account.js']
  for (const f of PATH) {
    it(`${f} calls bounded(), never a bare fetch`, () => {
      const c = code(read(f))
      expect(bareFetches(c)).toBe(0)
      expect(c).toMatch(/\bbounded\s*\(/)
    })
  }

  it('the page clears a stored session only on an explicit expired answer', () => {
    const c = code(read('web/studio/session.js'))
    const refresh = c.slice(c.indexOf("action: 'refresh'"), c.indexOf('export const heldToken'))
    // Everything that is not a success or an explicit expired throws before the forget() that signs a person out.
    const guard = refresh.indexOf("body.reason !== 'expired'")
    const forget = refresh.indexOf('forget()', guard)
    expect(guard).toBeGreaterThan(-1)
    expect(forget).toBeGreaterThan(guard)
    expect(refresh.slice(guard, forget)).toMatch(/throw unreachable\('auth:refresh', 0\)/)
    // And nothing forgets the session before that guard inside the refresh exchange.
    expect(refresh.slice(0, guard)).not.toMatch(/forget\(\)/)
  })

  it('control: the detector fires on a bare fetch and not on a method or a comment', () => {
    expect(bareFetches(`const r = await fetch(url)`)).toBe(1)
    expect(bareFetches(`const r = await client.fetch(url)`)).toBe(0)
    expect(bareFetches(code(`/* fetch(x) */\n// fetch(y)\nconst z = 1`))).toBe(0)
  })

  it('the boot sequence handles the refresh not answering instead of awaiting it bare', () => {
    const c = code(read('web/studio/app.js'))
    // Both callers wrap the refresh in a try, and the failure becomes a visible state with the reason.
    const calls = [...c.matchAll(/await presentedFresh\(\)/g)]
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const m of calls) {
      const before = c.slice(Math.max(0, (m.index ?? 0) - 80), m.index)
      expect(before).toMatch(/try\s*\{\s*(?:token|fresh)\s*=\s*$/)
    }
  })
})

describe('the sign-in function', () => {
  const fn = code(read('supabase/functions/signin/index.ts'))

  it('bounds every call to Auth and to the gateway', () => {
    // The one global fetch left is the helper that adds the deadline; every other call goes through it.
    expect(bareFetches(fn)).toBe(1)
    expect(fn).toMatch(
      /const upstream = [^\n]*\n\s*fetch\(url, \{ \.\.\.init, signal: AbortSignal\.timeout\(UPSTREAM_MS\) \}\)/,
    )
    expect([...fn.matchAll(/await upstream\(/g)].length).toBeGreaterThanOrEqual(5)
  })

  it('does not report an outage as an expired session', () => {
    const refresh = fn.slice(fn.indexOf("action === 'refresh'"), fn.indexOf("action === 'whoami'"))
    // The unavailable answer comes BEFORE the expired one, so a 5xx never reaches the branch that signs a person out.
    const unavailable = refresh.indexOf("reason: 'unavailable'")
    const expired = refresh.indexOf("reason: 'expired'")
    expect(unavailable).toBeGreaterThan(-1)
    expect(expired).toBeGreaterThan(unavailable)
    expect(refresh).toMatch(/swapped\.status >= 500/)
    expect(refresh).toMatch(/503/)
  })

  it('control: an old-shape handler (any failure is expired) would not satisfy the property', () => {
    const old = `const swapped = await fetch(u).catch(() => null)
      if (swapped === null || !swapped.ok) { return json({ ok: false, reason: 'expired' }, 200, request) }`
    expect(old.indexOf("reason: 'unavailable'")).toBe(-1)
  })
})

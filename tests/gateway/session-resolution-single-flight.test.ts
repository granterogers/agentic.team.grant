import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * A page load sends about eight reads in parallel with one token, and on a cold isolate each of them made the three-step identity
 * resolution because none found the cache filled (efficiency run, October 2026). Concurrent callers of the same credential now share
 * one resolution. The gateway is a Deno entry point and cannot be imported here, so this asserts the wired decision over the source and
 * proves its own detector can fail: the wrapper is evaluated as a function over a stand-in resolver, and a copy without the shared map
 * is shown to resolve once per caller.
 */
const source = readFileSync(
  new URL('../../supabase/functions/hq-api/index.ts', import.meta.url),
  'utf8',
)
const from = source.indexOf('const resolving = new Map<string, Promise<Answer>>()')
const to = source.indexOf('const resolveSession = async')
const wrapper = source.slice(from, to)

describe('the gateway resolves a session once for concurrent callers of the same credential', () => {
  it('keeps in-flight resolutions keyed by the whole credential and drops them when they settle', () => {
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    expect(wrapper).toContain('resolving.get(presented)')
    expect(wrapper).toContain('resolving.set(presented, started)')
    expect(wrapper).toContain('resolving.delete(presented)')
    expect(wrapper).toContain('resolveSession(presented).finally(')
  })

  it('shares one resolution between concurrent callers, and only for the same credential (the wrapper, run)', async () => {
    // Evaluate the wrapper's own text over a stand-in resolver, so the test runs the shipped logic and not a restatement of it.
    const build = new Function(
      'resolveSession',
      `${wrapper
        .replace(/: Promise<Answer>/g, '')
        .replace(/new Map<string, Promise<Answer>>\(\)/, 'new Map()')
        .replace(/\(presented: string\)/, '(presented)')}; return sessionAllowed`,
    ) as (r: (p: string) => Promise<string>) => (p: string) => Promise<string>
    let calls = 0
    const resolver = async (p: string): Promise<string> => {
      calls += 1
      await new Promise((r) => setTimeout(r, 5))
      return `answer:${p}`
    }
    const allowed = build(resolver)
    const same = await Promise.all(Array.from({ length: 8 }, () => allowed('token-a')))
    expect(calls).toBe(1)
    expect(new Set(same)).toEqual(new Set(['answer:token-a']))
    // Another credential is its own resolution and never receives the first one's answer.
    const mixed = await Promise.all([allowed('token-a'), allowed('token-b')])
    expect(mixed).toEqual(['answer:token-a', 'answer:token-b'])
    expect(calls).toBe(3)
    // Nothing is kept once it has settled: a later call resolves again (only a 'yes' is cached, and that is resolveSession's job).
    await allowed('token-a')
    expect(calls).toBe(4)
  })

  it('credentials that share a long prefix are still different resolutions (a prefix key would leak one answer to the other)', async () => {
    // Every HS256 JWT begins with the same header, so a key built from the first characters collides across people.
    const build = new Function(
      'resolveSession',
      `${wrapper
        .replace(/: Promise<Answer>/g, '')
        .replace(/new Map<string, Promise<Answer>>\(\)/, 'new Map()')
        .replace(/\(presented: string\)/, '(presented)')}; return sessionAllowed`,
    ) as (r: (p: string) => Promise<string>) => (p: string) => Promise<string>
    let calls = 0
    const resolver = async (p: string): Promise<string> => {
      calls += 1
      await new Promise((r) => setTimeout(r, 5))
      return `answer:${p.slice(-6)}`
    }
    const allowed = build(resolver)
    const shared = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${'x'.repeat(40)}.`
    const a = `${shared}aaaaaa`
    const b = `${shared}bbbbbb`
    const [ra, rb] = await Promise.all([allowed(a), allowed(b)])
    expect(calls).toBe(2)
    expect([ra, rb]).toEqual(['answer:aaaaaa', 'answer:bbbbbb'])
  })

  it('control: a wrapper without the shared map resolves once per caller', async () => {
    let calls = 0
    const unshared = async (p: string): Promise<string> => {
      calls += 1
      await new Promise((r) => setTimeout(r, 5))
      return p
    }
    await Promise.all(Array.from({ length: 8 }, () => unshared('token-a')))
    expect(calls).toBe(8)
  })
})

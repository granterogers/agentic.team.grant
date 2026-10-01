/**
 * Who is speaking (multi-user P1.1, #400): an unauthenticated caller is nobody, a signed-in member
 * speaks as THEMSELVES, and nothing in the environment can stand in for an identity.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bearerOf, resolveSpeaker, type SpeakerEnv, tokenMatches } from '../../src/auth/speaker.ts'

const env: SpeakerEnv = {
  hqToken: 'machine-key-for-tests',
  supabaseUrl: 'https://db.test',
  anonKey: 'anon',
  serviceKey: 'service',
}
const jwt = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`

type Member = { ok: boolean; owner_key?: string | null; kind?: string | null }
/** A fake Supabase: /auth/v1/user answers for `email`, office_member answers for `member`. */
const OFFICE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const world = (email: string | null, member: Member | null, office: string | null = OFFICE) => {
  const calls: string[] = []
  const fetcher = (async (url: string | URL | Request) => {
    const u = String(url)
    calls.push(u)
    if (u.endsWith('/auth/v1/user')) {
      return email === null
        ? new Response('{}', { status: 401 })
        : new Response(JSON.stringify({ email }), { status: 200 })
    }
    if (u.endsWith('/rpc/resolve_office')) {
      return new Response(
        JSON.stringify(
          office === null ? { ok: false, reason: 'no_office' } : { ok: true, office_id: office },
        ),
        { status: 200 },
      )
    }
    if (u.endsWith('/rpc/office_member')) {
      return member === null
        ? new Response('[]', { status: 200 })
        : new Response(JSON.stringify([member]), { status: 200 })
    }
    return new Response('no', { status: 404 })
  }) as typeof fetch
  return { fetcher, calls }
}
const fresh = () => new Map<string, { until: number; speaker: never }>() as never

describe('the office comes from the verified login (P3)', () => {
  it('refuses a signed-in member whose login has no active office - it is never defaulted to the person', async () => {
    const w = world('sam@example.com', { ok: true, owner_key: 'sam', kind: 'person' }, null)
    expect(await resolveSpeaker(jwt, env, { fetch: w.fetcher, cache: fresh() })).toBeNull()
  })

  it('carries the office the database resolved, and the machine key carries none', async () => {
    const w = world('sam@example.com', { ok: true, owner_key: 'sam', kind: 'harness' })
    expect((await resolveSpeaker(jwt, env, { fetch: w.fetcher, cache: fresh() }))?.office).toBe(
      OFFICE,
    )
    expect((await resolveSpeaker('machine-key-for-tests', env, {}))?.office).toBeNull()
  })

  it('does not trust an office named in the request: the resolver is asked about the auth user id only', async () => {
    const asked: string[] = []
    const w = world('sam@example.com', { ok: true, owner_key: 'sam', kind: 'person' })
    const spy = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/rpc/resolve_office')) asked.push(String(init?.body))
      return await w.fetcher(url, init)
    }) as typeof fetch
    await resolveSpeaker(jwt, env, { fetch: spy, cache: fresh() })
    expect(asked).toHaveLength(1)
    expect(Object.keys(JSON.parse(asked[0] as string))).toEqual(['p_auth_user_id'])
  })
})

describe('resolveSpeaker', () => {
  it('refuses a caller who presents nothing (the unauthenticated mint)', async () => {
    const w = world('grant@example.com', { ok: true, owner_key: 'grant', kind: 'person' })
    for (const nothing of [null, '']) {
      expect(await resolveSpeaker(nothing, env, { fetch: w.fetcher, cache: fresh() })).toBeNull()
    }
    expect(w.calls).toEqual([]) // and costs no network call
  })

  it('refuses a wrong machine key and a token that is not a session', async () => {
    const w = world(null, null)
    expect(await resolveSpeaker('machine-key-for-testz', env, { fetch: w.fetcher })).toBeNull()
    expect(await resolveSpeaker('short.jwt.like', env, { fetch: w.fetcher })).toBeNull()
    expect(w.calls).toEqual([])
  })

  it('refuses a machine key when none is configured, even an empty one', async () => {
    expect(await resolveSpeaker('x', { ...env, hqToken: '' }, {})).toBeNull()
  })

  it('accepts the machine key as a service speaker that names nobody real', async () => {
    const s = await resolveSpeaker('machine-key-for-tests', env, {})
    expect(s?.kind).toBe('service')
    expect(s?.actor).not.toBe('grant')
  })

  it('speaks a signed-in person as THEIR OWN owner key, never a configured subject', async () => {
    const w = world('sam@example.com', { ok: true, owner_key: 'sam', kind: 'person' })
    const s = await resolveSpeaker(jwt, env, { fetch: w.fetcher, cache: fresh() })
    expect(s).toEqual({ kind: 'person', actor: 'sam', office: OFFICE })
  })

  it('fails closed for a person with no owner key instead of defaulting to anybody', async () => {
    for (const owner_key of [null, '', '   ']) {
      const w = world('sam@example.com', { ok: true, owner_key, kind: 'person' })
      expect(await resolveSpeaker(jwt, env, { fetch: w.fetcher, cache: fresh() })).toBeNull()
    }
  })

  it('refuses a session Supabase did not issue, and an address the office does not work for', async () => {
    expect(
      await resolveSpeaker(jwt, env, { fetch: world(null, null).fetcher, cache: fresh() }),
    ).toBeNull()
    expect(
      await resolveSpeaker(jwt, env, {
        fetch: world('stranger@example.com', { ok: false }).fetcher,
        cache: fresh(),
      }),
    ).toBeNull()
    expect(
      await resolveSpeaker(jwt, env, {
        fetch: world('stranger@example.com', null).fetcher,
        cache: fresh(),
      }),
    ).toBeNull()
  })

  it('treats any non-person member as a restrictive harness speaker', async () => {
    const w = world('t@example.com', { ok: true, owner_key: 'verify-operator', kind: 'harness' })
    expect((await resolveSpeaker(jwt, env, { fetch: w.fetcher, cache: fresh() }))?.kind).toBe(
      'harness',
    )
    const odd = world('t@example.com', { ok: true, owner_key: 'x', kind: 'something-new' })
    expect((await resolveSpeaker(jwt, env, { fetch: odd.fetcher, cache: fresh() }))?.kind).toBe(
      'harness',
    )
  })

  it('caches a positive answer for a minute and NEVER a refusal', async () => {
    const cache = fresh()
    const t = 0
    const ok = world('sam@example.com', { ok: true, owner_key: 'sam', kind: 'person' })
    await resolveSpeaker(jwt, env, { fetch: ok.fetcher, cache, now: () => t })
    await resolveSpeaker(jwt, env, { fetch: ok.fetcher, cache, now: () => t + 59_000 })
    expect(ok.calls.length).toBe(3) // one lookup triple, then served from the cache
    await resolveSpeaker(jwt, env, { fetch: ok.fetcher, cache, now: () => t + 61_000 })
    expect(ok.calls.length).toBe(6)

    const bad = world(null, null)
    const refusals = fresh()
    await resolveSpeaker(jwt, env, { fetch: bad.fetcher, cache: refusals })
    await resolveSpeaker(jwt, env, { fetch: bad.fetcher, cache: refusals })
    expect(bad.calls.length).toBe(2) // asked twice: a refusal is not remembered
  })
})

describe('tokenMatches / bearerOf', () => {
  it('compares exactly', async () => {
    expect(await tokenMatches('abc', 'abc')).toBe(true)
    expect(await tokenMatches('abd', 'abc')).toBe(false)
    expect(await tokenMatches(null, 'abc')).toBe(false)
    expect(await tokenMatches('abc', '')).toBe(false)
  })
  it('reads only a Bearer header', () => {
    const h = (v: string | null) => ({ headers: { get: () => v } })
    expect(bearerOf(h('Bearer tok'))).toBe('tok')
    expect(bearerOf(h('bearer  tok '))).toBe('tok')
    expect(bearerOf(h('Basic tok'))).toBeNull()
    expect(bearerOf(h(null))).toBeNull()
  })
})

/*
  THE WIRING, asserted on the wired expression rather than on a name appearing in a file. Removing the
  gate or bringing back an ambient subject must turn these red; scripts/isolated/p1-voice-sabotage.sh
  does exactly that and prints that the change landed.
*/
describe('the voice functions are wired to the verifier', () => {
  const token = readFileSync('supabase/functions/voice-token/index.ts', 'utf8')
  const voice = readFileSync('supabase/functions/voice/index.ts', 'utf8')

  it('voice-token refuses an unauthenticated mint BEFORE any lookup or OpenAI call (behaviour)', async () => {
    const g = globalThis as unknown as { Deno?: unknown }
    const before = g.Deno
    let handler: ((r: Request) => Promise<Response>) | undefined
    const envVars: Record<string, string> = {
      OPENAI_API_KEY: 'sk-test',
      HQ_API_TOKEN: 'machine-key-for-tests',
      SUPABASE_URL: 'https://db.test',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      VOICE_ALLOWED_ORIGIN: 'https://page.test',
    }
    g.Deno = {
      env: { get: (k: string) => envVars[k] },
      serve: (h: (r: Request) => Promise<Response>) => {
        handler = h
      },
    }
    const urls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (u: string | URL | Request) => {
      urls.push(String(u))
      return new Response(
        JSON.stringify({ value: 'eph', expires_at: 1, session: { model: 'm' } }),
        {
          status: 200,
        },
      )
    }) as typeof fetch
    try {
      // A variable specifier: this is a Deno module, and tsc must not type-check it as Node.
      const entry = '../../supabase/functions/voice-token/index.ts'
      await import(/* @vite-ignore */ entry)
      const mint = (headers: Record<string, string>) =>
        handler?.(
          new Request('https://fn.test/voice-token', {
            method: 'POST',
            headers: { origin: 'https://page.test', ...headers },
          }),
        ) as Promise<Response>

      const stranger = await mint({})
      expect(stranger.status).toBe(401)
      expect(stranger.headers.get('access-control-allow-origin')).toBe('https://page.test')
      expect(urls).toEqual([]) // no state read, no OpenAI call, nothing spent

      const wrong = await mint({ authorization: 'Bearer not-the-key' })
      expect(wrong.status).toBe(401)
      expect(urls).toEqual([])

      const machine = await mint({ authorization: 'Bearer machine-key-for-tests' })
      expect(machine.status).toBe(200) // the legitimate flow still works
      expect(urls.some((u) => u.includes('openai.com'))).toBe(true)
    } finally {
      globalThis.fetch = realFetch
      g.Deno = before
    }
  })

  it('voice-token allows the Authorization header in its preflight', () => {
    expect(token).toMatch(/Access-Control-Allow-Headers': 'content-type, authorization'/)
  })

  it('voice has no ambient subject and no private session check', () => {
    expect(voice).not.toMatch(/VOICE_SUBJECT['"`]?\)/)
    expect(voice).not.toMatch(/Deno\.env\.get\('VOICE_SUBJECT'\)/)
    expect(voice).not.toMatch(/const sessionAllowed/)
    expect(voice).toMatch(/await resolveSpeaker\(presented,/)
  })
})

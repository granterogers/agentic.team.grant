/**
 * The gateway turns a verified login into an office, and nothing the caller sends can stand in for it (P3, wave 1).
 * Loads the REAL handler under a stubbed Deno and a fake Supabase, so the property is the behaviour and not a name.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const OFFICE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
/** What the machine key resolves to: the test office, never a person. */
const TEST_OFFICE = 'e13ce7a9-831b-49d7-83a5-2ede9c1a97d0'
const jwt = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`

type Handler = (r: Request) => Promise<Response>
let handler: Handler
let office: string | null = OFFICE
let resolverDown = false
const rpc: { fn: string; body: Record<string, unknown> }[] = []

const answer = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = String(url)
  if (u.endsWith('/auth/v1/user'))
    return new Response(JSON.stringify({ id: 'auth-1', email: 'sam@example.com' }), { status: 200 })
  /*
    The gateway asks ONE question about a session now (principal_for_session, 23 October 2026: sign-in asks the database once). It is
    answered from the two answers this test gives for the member and the office, so each test keeps its own meaning. The inner call goes
    to the implementation directly, so it is not recorded as a call of its own.
  */
  if (u.endsWith('/rpc/principal_for_session')) {
    const member = await answer(u.replace(/\/rpc\/[a-z_0-9]+$/, '/rpc/office_member'), init)
    const office = await answer(u.replace(/\/rpc\/[a-z_0-9]+$/, '/rpc/resolve_office'), init)
    if (!member.ok || !office.ok) return new Response('boom', { status: 500 })
    const [row] = (await member.json()) as { ok?: boolean; owner_key?: string; kind?: string }[]
    return new Response(
      JSON.stringify({ member: row ?? { ok: false }, office: await office.json() }),
      { status: 200 },
    )
  }
  if (u.endsWith('/rpc/office_member'))
    return new Response(JSON.stringify([{ ok: true, owner_key: 'sam', kind: 'person' }]), {
      status: 200,
    })
  if (u.endsWith('/rpc/resolve_machine_office'))
    return new Response(JSON.stringify({ ok: true, office_id: TEST_OFFICE }), { status: 200 })
  if (u.endsWith('/rpc/resolve_office')) {
    if (resolverDown) return new Response('boom', { status: 500 })
    return new Response(
      JSON.stringify(
        office === null ? { ok: false, reason: 'no_office' } : { ok: true, office_id: office },
      ),
      { status: 200 },
    )
  }
  const m = /\/rpc\/([a-z_0-9]+)$/.exec(u)
  if (m) {
    rpc.push({ fn: m[1] as string, body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response('{}', { status: 200 })
  }
  return new Response('{}', { status: 200 })
}
const fake = vi.fn(answer)

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: {
      get: (k: string): string | undefined =>
        ({
          HQ_API_TOKEN: 'machine-key-for-tests',
          SUPABASE_URL: 'https://db.test',
          SUPABASE_SERVICE_ROLE_KEY: 'service',
          SUPABASE_ANON_KEY: 'anon',
        })[k],
    },
    serve: (h: Handler) => {
      handler = h
    },
  })
  vi.stubGlobal('fetch', fake)
  // A computed path: the gateway is Deno code and is not part of the TypeScript program.
  const gateway = '../../supabase/functions/hq-api/index.ts'
  await import(/* @vite-ignore */ gateway)
})
afterEach(() => {
  rpc.length = 0
  office = OFFICE
  resolverDown = false
})

const post = (token: string, action: string, args: Record<string, unknown>): Promise<Response> =>
  handler(
    new Request('https://gw.test/', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, args }),
    }),
  )

describe('the gateway resolves the office from the verified login', () => {
  it('refuses a valid login with no active office as 403 no_office, and calls nothing else', async () => {
    office = null
    const token = `${jwt}1`
    const res = await post(token, 'appearance_set', { p_settings: {} })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'no_office' })
    expect(rpc).toEqual([])
  })

  it('could not ask is 503, not no_office and not a default', async () => {
    resolverDown = true
    const res = await post(`${jwt}2`, 'appearance_set', { p_settings: {} })
    expect(res.status).toBe(503)
    expect(rpc).toEqual([])
  })

  it('discards every office the caller names, for a signed-in person and for the machine key alike', async () => {
    const hostile = {
      p_settings: {},
      p_office: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      office_id: 'x',
      owner_key: 'grant',
    }
    // The entry takes an office, so the gateway SUPPLIES one: the verified login's (the machine key's is the test
    // office's). It is never the one the caller named, and the other office-shaped keys are discarded outright.
    for (const [token, expected] of [
      [`${jwt}3`, OFFICE],
      ['machine-key-for-tests', TEST_OFFICE],
    ] as const) {
      rpc.length = 0
      await post(token, 'appearance_set', hostile)
      const call = rpc.find((c) => c.fn === 'hq_appearance_set')
      expect(call, token).toBeDefined()
      expect(call?.body.p_office, token).toBe(expected)
      expect(call?.body.p_office, token).not.toBe(hostile.p_office)
      for (const k of ['office_id', 'owner_key'])
        expect(call?.body, `${token} ${k}`).not.toHaveProperty(k)
    }
  })
})

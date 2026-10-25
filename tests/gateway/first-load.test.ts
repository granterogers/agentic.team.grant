/**
 * `first_load` answers the home board's sections in one request (26 October 2026). Each section in the bundle must be exactly what
 * that section answers on its own, and the sign-in check must not be repeated for each of them.
 * Loads the REAL handler under a stubbed Deno and a fake Supabase, so the property is the behaviour.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const OFFICE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const jwt = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`
const LISTED = [
  'studio',
  'projects',
  'pulse',
  'thinking',
  'team_work',
  'unseen',
  'workspace',
  'portfolio_tasks',
  'activity_ledger',
  'lately',
  'google_connection',
]

type Handler = (r: Request) => Promise<Response>
let handler: Handler
let identityCalls = 0

const answer = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = String(url)
  if (u.endsWith('/auth/v1/user')) {
    identityCalls += 1
    return new Response(JSON.stringify({ id: 'auth-1', email: 'sam@example.com' }), { status: 200 })
  }
  if (u.endsWith('/rpc/principal_for_session'))
    return new Response(
      JSON.stringify({
        member: { ok: true, owner_key: 'sam', kind: 'person' },
        office: { ok: true, office_id: OFFICE },
      }),
      { status: 200 },
    )
  const m = /\/rpc\/([a-z_0-9]+)$/.exec(u)
  if (m) {
    // Each database function answers with its own name, so a bundle that mixed two sections up would be caught.
    return new Response(
      JSON.stringify({ answered_by: m[1], args: JSON.parse(String(init?.body ?? '{}')) }),
      {
        status: 200,
      },
    )
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
  const gateway = '../../supabase/functions/hq-api/index.ts'
  await import(/* @vite-ignore */ gateway)
})
afterEach(() => {
  identityCalls = 0
})

const get = (token: string | null, section: string): Promise<Response> =>
  handler(
    new Request(`https://gw.test/?section=${section}`, {
      method: 'GET',
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    }),
  )

describe('the first load in one request', () => {
  it('answers every listed section with exactly what that section answers on its own', async () => {
    const bundle = (await (await get(`${jwt}1`, 'first_load')).json()) as {
      data: Record<string, { status: number; body: unknown }>
    }
    for (const section of LISTED) {
      const alone = await get(`${jwt}1`, section)
      expect(bundle.data[section]?.status, section).toBe(alone.status)
      expect(bundle.data[section]?.body, section).toEqual(await alone.json())
    }
  })

  it('checks the sign-in once for the whole bundle, not once per section', async () => {
    identityCalls = 0
    const res = await get(`${jwt}2`, 'first_load')
    expect(res.status).toBe(200)
    expect(identityCalls).toBe(1)
  })

  it('lists exactly the sections it promises, and answers each by name', async () => {
    const body = (await (await get(`${jwt}3`, 'first_load')).json()) as {
      section: string
      data: Record<string, { status: number; body: { data?: { answered_by?: string } } }>
    }
    expect(body.section).toBe('first_load')
    expect(Object.keys(body.data).sort()).toEqual([...LISTED].sort())
    expect(body.data.studio?.body.data?.answered_by).toBe('hq_studio')
    expect(body.data.pulse?.body.data?.answered_by).toBe('hq_pulse')
  })

  it('refuses an unsigned bundle section by section, and does not answer any of them', async () => {
    const body = (await (await get(null, 'first_load')).json()) as {
      data: Record<string, { status: number; body: unknown }>
    }
    for (const section of LISTED) expect(body.data[section]?.status, section).toBe(401)
  })
})

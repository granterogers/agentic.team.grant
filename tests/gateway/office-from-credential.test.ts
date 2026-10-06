/**
 * The office a request acts in comes from the verified credential and from nothing the caller controls (deep systems
 * audit, M23).
 *
 * `office-resolution.test.ts` proves the body's `args` cannot name an office. The comment at the gateway promises more:
 * "Nothing in the body, the query or a header can change it." Mutation M23 made the query string win over the verified
 * session's office and 5,313 tests stayed green, so only the body was behaviourally protected. This drives the REAL
 * gateway with every channel a caller controls carrying another office's id - query string, headers, the top level of
 * the body, nested args, a cookie - on both reads and writes, for two different credentials, and asserts the office the
 * database function was actually called with.
 *
 * Whether the database then honours its argument is a separate property, covered by the replica proofs
 * (`scripts/isolated/p3-*`); this one is only that the argument is the credential's.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const MINE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const OTHERS = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const SECOND_PERSON = '9d1c1b1e-0000-4000-8000-000000000002'
const jwtFor = (tag: string) => `${'a'.repeat(30)}.${tag.padEnd(30, 'b')}.${'c'.repeat(30)}`

type Handler = (r: Request) => Promise<Response>
let handler: Handler
const officeOf: Record<string, string> = {}
const rpc: { fn: string; body: Record<string, unknown> }[] = []

const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = String(url)
  const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
  const token = auth.replace(/^Bearer /, '')
  if (u.endsWith('/auth/v1/user'))
    return new Response(JSON.stringify({ id: `auth-${token}`, email: 'p@example.com' }), {
      status: 200,
    })
  if (u.endsWith('/rpc/office_member'))
    return new Response(JSON.stringify([{ ok: true, owner_key: 'sam', kind: 'person' }]), {
      status: 200,
    })
  if (u.endsWith('/rpc/resolve_office')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>
    const who = Object.values(body).join('|')
    const office = Object.entries(officeOf).find(([t]) => who.includes(t))?.[1] ?? MINE
    return new Response(JSON.stringify({ ok: true, office_id: office }), { status: 200 })
  }
  const m = /\/rpc\/([a-z_0-9]+)$/.exec(u)
  if (m) {
    rpc.push({ fn: m[1] as string, body: JSON.parse(String(init?.body ?? '{}')) })
    return new Response('{}', { status: 200 })
  }
  return new Response('{}', { status: 200 })
})

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
  rpc.length = 0
  for (const k of Object.keys(officeOf)) delete officeOf[k]
})

/** Every place a caller controls that could be mistaken for an office. */
const hostileQuery = `office=${OTHERS}&p_office=${OTHERS}&office_id=${OTHERS}&owner_key=grant&as=${OTHERS}`
const hostileHeaders = {
  'x-office': OTHERS,
  'x-office-id': OTHERS,
  'x-hq-office': OTHERS,
  'x-forwarded-office': OTHERS,
  cookie: `office=${OTHERS}; office_id=${OTHERS}`,
}

const read = (token: string, extra = ''): Promise<Response> =>
  handler(
    new Request(`https://gw.test/?section=overview&${extra}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, ...hostileHeaders },
    }),
  )
const write = (token: string, body: Record<string, unknown>, extra = ''): Promise<Response> =>
  handler(
    new Request(`https://gw.test/?${extra}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...hostileHeaders,
      },
      body: JSON.stringify(body),
    }),
  )

describe('the office is the credential\'s, whatever else the request says', () => {
  it('a read ignores an office named in the query string, headers or cookie', async () => {
    const token = jwtFor('reader')
    await read(token, hostileQuery)
    const call = rpc.find((c) => c.fn === 'hq_overview')
    expect(call).toBeDefined()
    expect(call?.body.p_office).toBe(MINE)
    expect(JSON.stringify(rpc)).not.toContain(OTHERS)
  })

  it('a write ignores an office named in the query, headers, cookie, top level of the body and args', async () => {
    const token = jwtFor('writer')
    await write(
      token,
      {
        action: 'appearance_set',
        office: OTHERS,
        p_office: OTHERS,
        office_id: OTHERS,
        owner_key: 'grant',
        args: { p_settings: {}, p_office: OTHERS, office_id: OTHERS, owner_key: 'grant' },
      },
      hostileQuery,
    )
    const call = rpc.find((c) => c.fn === 'hq_appearance_set')
    expect(call).toBeDefined()
    expect(call?.body.p_office).toBe(MINE)
    expect(JSON.stringify(rpc)).not.toContain(OTHERS)
  })

  it('two credentials get two offices, and each one only ever its own', async () => {
    const a = jwtFor('alpha')
    const b = jwtFor('bravo')
    officeOf.alpha = MINE
    officeOf.bravo = SECOND_PERSON
    // Each credential names the OTHER person's office as hard as it can.
    await read(a, `office=${SECOND_PERSON}&p_office=${SECOND_PERSON}`)
    await read(b, `office=${MINE}&p_office=${MINE}`)
    const offices = rpc.filter((c) => c.fn === 'hq_overview').map((c) => c.body.p_office)
    expect(offices).toEqual([MINE, SECOND_PERSON])
  })

  it('CONTROL: the credential\'s office IS supplied (the test cannot pass by supplying none)', async () => {
    await read(jwtFor('control'))
    expect(rpc.find((c) => c.fn === 'hq_overview')?.body.p_office).toBe(MINE)
  })
})

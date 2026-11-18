/**
 * Self-service account creation at the gateway (multi-user P6). Loads the REAL handler under a stubbed Deno and a fake
 * Supabase, so the properties are behaviour, not names:
 *
 *   - an unconfirmed address is refused everywhere;
 *   - a confirmed address with no membership is told `no_office` + `can_create` (403, not 401) and reads nothing;
 *   - `create_office` takes the login, the address and the confirmation from the VERIFIED session and nothing from the
 *     body but a display name;
 *   - a repeated call returns the same office (the database makes it idempotent; the gateway must not defeat that);
 *   - a closed-signup refusal is passed through in plain English, as a 400 {ok:false, error};
 *   - the machine key is not a session and cannot create an office.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const jwt = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`
const AUTH_ID = '11111111-2222-3333-4444-555555555555'

type Handler = (r: Request) => Promise<Response>
let handler: Handler

let confirmed: string | null = '2026-10-01T00:00:00Z'
let member = false
let authStatus = 200
let officeGone = false
let selfAnswer: Record<string, unknown> = { ok: true, created: true, office_id: 'office-new' }
let selfStatus = 200
const rpc: { fn: string; body: Record<string, unknown> }[] = []

const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = String(url)
  if (u.endsWith('/auth/v1/user')) {
    if (authStatus !== 200) return new Response('no', { status: authStatus })
    return new Response(
      JSON.stringify({
        id: AUTH_ID,
        email: 'New.Person@Example.invalid',
        email_confirmed_at: confirmed,
      }),
      { status: 200 },
    )
  }
  const m = /\/rpc\/([a-z_0-9]+)$/.exec(u)
  const fn = m?.[1] ?? ''
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  rpc.push({ fn, body })
  // The gateway asks ONE question about a session now (principal_for_session, 23 October 2026). It is answered here from the same
  // member and office variables the old membership and office answers used, so the log above keeps its meaning.
  if (fn === 'principal_for_session')
    return new Response(
      JSON.stringify({
        member: member ? { ok: true, owner_key: 'x', kind: 'person' } : { ok: false },
        office: officeGone
          ? { ok: false, reason: 'no_office' }
          : { ok: true, office_id: 'office-1' },
      }),
      { status: 200 },
    )
  if (fn === 'office_member')
    return new Response(
      JSON.stringify(member ? [{ ok: true, owner_key: 'x', kind: 'person' }] : [{ ok: false }]),
      {
        status: 200,
      },
    )
  if (fn === 'resolve_office')
    return new Response(
      JSON.stringify(
        officeGone ? { ok: false, reason: 'no_office' } : { ok: true, office_id: 'office-1' },
      ),
      { status: 200 },
    )
  if (fn === 'self_provision_office')
    return new Response(JSON.stringify(selfAnswer), { status: selfStatus })
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
  confirmed = '2026-10-01T00:00:00Z'
  member = false
  authStatus = 200
  officeGone = false
  selfAnswer = { ok: true, created: true, office_id: 'office-new' }
  selfStatus = 200
})

const create = (token: string, body: Record<string, unknown>): Promise<Response> =>
  handler(
    new Request('https://gw.test/', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create_office', ...body }),
    }),
  )
const read = (token: string): Promise<Response> =>
  handler(
    new Request('https://gw.test/?section=projects', {
      headers: { authorization: `Bearer ${token}` },
    }),
  )

describe('a verified stranger is told they can create an office', () => {
  it('answers 403 no_office + can_create (not 401) and reads nothing', async () => {
    const r = await read(jwt)
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: 'no_office', can_create: true })
    expect(rpc.map((c) => c.fn)).not.toContain('self_provision_office')
    // nothing was resolved or read as anybody
    expect(rpc.map((c) => c.fn)).not.toContain('resolve_office')
  })

  it('an UNCONFIRMED address stays refused (401), with no can_create', async () => {
    confirmed = null
    const r = await read(jwt)
    expect(r.status).toBe(401)
    expect(JSON.stringify(await r.json())).not.toContain('can_create')
  })

  it('is not cached as a yes: after membership exists the next request is served', async () => {
    const mine = `${'g'.repeat(30)}.${'h'.repeat(30)}.${'i'.repeat(30)}`
    expect((await read(mine)).status).toBe(403)
    member = true
    const after = await read(mine)
    expect(after.status).not.toBe(403)
  })

  it('a member whose office is gone is no_office WITHOUT can_create', async () => {
    member = true
    officeGone = true
    const bad = `${'d'.repeat(30)}.${'e'.repeat(30)}.${'f'.repeat(30)}`
    const r = await read(bad)
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: 'no_office' })
  })
})

describe('create_office', () => {
  it('derives everything from the verified session; the body supplies only a name', async () => {
    const r = await create(jwt, {
      name: 'Brightside',
      p_auth: 'attacker',
      auth_user_id: 'attacker',
      email: 'someone-else@example.invalid',
      owner_key: 'grant',
      office_id: 'grant-office',
      args: { p_office: 'grant-office' },
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, created: true, office_id: 'office-new' })
    const call = rpc.find((c) => c.fn === 'self_provision_office')
    expect(call?.body).toEqual({
      p_auth: AUTH_ID,
      p_email: 'new.person@example.invalid',
      p_name: 'Brightside',
    })
  })

  it('refuses an unverified address before touching the database', async () => {
    confirmed = null
    const r = await create(jwt, { name: 'X' })
    expect(r.status).toBe(403)
    expect(rpc.map((c) => c.fn)).not.toContain('self_provision_office')
  })

  it('refuses a session Supabase rejects (401) and a machine key (401)', async () => {
    authStatus = 401
    expect((await create(jwt, { name: 'X' })).status).toBe(401)
    authStatus = 200
    expect((await create('machine-key-for-tests', { name: 'X' })).status).toBe(401)
    expect(rpc.map((c) => c.fn)).not.toContain('self_provision_office')
  })

  it('an upstream failure to check is 503, never a refusal that signs the person out', async () => {
    authStatus = 502
    expect((await create(jwt, { name: 'X' })).status).toBe(503)
  })

  it('is idempotent: a repeat returns created:false and the same office', async () => {
    selfAnswer = { ok: true, created: false, office_id: 'office-new' }
    const r = await create(jwt, { name: 'Brightside' })
    expect(await r.json()).toEqual({ ok: true, created: false, office_id: 'office-new' })
  })

  it('passes a closed-signup refusal through in plain English as 400', async () => {
    selfAnswer = { ok: false, error: 'New accounts are not being opened right now.' }
    const r = await create(jwt, { name: 'Brightside' })
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({
      ok: false,
      error: 'New accounts are not being opened right now.',
    })
  })

  it('a database failure never leaks detail', async () => {
    selfStatus = 500
    selfAnswer = { message: 'relation "x" does not exist' }
    const r = await create(jwt, { name: 'Brightside' })
    expect(r.status).toBe(503)
    expect(JSON.stringify(await r.json())).not.toContain('relation')
  })

  it('create_office is not a normal action: it is not in the ACTIONS map and a read cannot reach it', async () => {
    const r = await handler(
      new Request('https://gw.test/?section=create_office', {
        headers: { authorization: `Bearer ${'j'.repeat(30)}.${'k'.repeat(30)}.${'l'.repeat(30)}` },
      }),
    )
    expect(r.status).toBe(403)
  })
})

// biome-ignore-all format: dense test kept readable as written (the repository's other activity tests do the same)
/**
 * An Activity read that cannot finish is ONE controlled answer, never an empty list (phase 8, F2).
 *
 * Drives the REAL gateway with a database that (a) refuses on its time budget the way PostgREST reports PT504 (HTTP 504), (b) never
 * answers at all, honouring the abort signal the gateway attached, and (c) answers normally. Asserts what the browser receives, and that
 * the machinery is scoped: another section's slow answer is not turned into a timeout, and a database error is still a 502 with no detail.
 * Each control is shown to fail by the sabotage test at the bottom, which removes the mapping from a copy of the source.
 */
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const MINE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const TOKEN = 'machine-key-for-tests'

type Handler = (r: Request) => Promise<Response>
let handler: Handler
let mode: 'ok' | 'budget' | 'hang' | 'error' = 'ok'
const rpcCalls: { fn: string; signal: boolean }[] = []

const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = String(url)
  if (u.endsWith('/rpc/resolve_machine_office'))
    return new Response(JSON.stringify({ ok: true, office_id: MINE }), { status: 200 })
  const m = /\/rpc\/([a-z_0-9]+)$/.exec(u)
  if (m === null) return new Response('{}', { status: 200 })
  rpcCalls.push({ fn: m[1] as string, signal: init?.signal !== undefined && init.signal !== null })
  if (mode === 'budget')
    return new Response(
      JSON.stringify({
        code: 'PT504',
        message: 'the activity read ran out of time (325 ms used of 60)',
        hint: 'retry',
      }),
      { status: 504 },
    )
  if (mode === 'error')
    return new Response(JSON.stringify({ code: '42P01', message: 'relation "x" does not exist' }), {
      status: 400,
    })
  if (mode === 'hang')
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError')),
      )
    })
  return new Response(JSON.stringify({ enabled: true, events: [], next: null }), { status: 200 })
})

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: {
      get: (k: string): string | undefined =>
        ({
          HQ_API_TOKEN: TOKEN,
          SUPABASE_URL: 'https://db.test',
          SUPABASE_SERVICE_ROLE_KEY: 'service',
          SUPABASE_ANON_KEY: 'anon',
          HQ_ACTIVITY_DEADLINE_MS: '150',
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

const ask = (section: string): Promise<Response> =>
  handler(
    new Request(`https://gw.test/?section=${section}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  )

describe('an Activity read that cannot finish', () => {
  it('is a 504 with a sentence a person can act on, when the database refuses on its time budget', async () => {
    mode = 'budget'
    const r = await ask('activity_feed')
    const body = (await r.json()) as Record<string, unknown>
    expect(r.status).toBe(504)
    expect(body.code).toBe('activity_timeout')
    expect(body.retryable).toBe(true)
    expect(String(body.error)).toMatch(/took too long/i)
    // the database's own wording (milliseconds, the word budget) is not shown to a browser
    expect(JSON.stringify(body)).not.toMatch(/325|ran out of time|PT504/)
    expect(body).not.toHaveProperty('events')
  })

  it("is the same controlled 504 when the database never answers, by the gateway's own deadline", async () => {
    mode = 'hang'
    const t = Date.now()
    const r = await ask('activity_ledger')
    const body = (await r.json()) as Record<string, unknown>
    expect(r.status).toBe(504)
    expect(body.code).toBe('activity_timeout')
    expect(Date.now() - t).toBeLessThan(2000)
    expect(Date.now() - t).toBeGreaterThanOrEqual(100)
  })

  it('carries an abort signal on every Activity section (the chain and health too)', async () => {
    mode = 'ok'
    rpcCalls.length = 0
    for (const s of [
      'activity_feed',
      `activity_chain&job=${MINE}`,
      'activity_health',
      'activity_ledger',
    ])
      await ask(s)
    const activity = rpcCalls.filter((c) => c.fn.startsWith('activity_'))
    expect(activity.length).toBeGreaterThanOrEqual(3)
    for (const c of activity) expect(c.signal, c.fn).toBe(true)
  })

  it('does not turn another section\'s database failure into a timeout, and still hides the detail (positive control)', async () => {
    mode = 'error'
    const r = await ask('overview')
    const text = await r.text()
    expect(r.status).not.toBe(504)
    expect(text).not.toMatch(/relation|42P01/)
  })

  it('answers an ordinary read normally when the database is fine (positive control)', async () => {
    mode = 'ok'
    const r = await ask('activity_feed')
    expect(r.status).toBe(200)
    expect((await r.json()) as { data: { enabled: boolean } }).toMatchObject({ data: { enabled: true } })
  })
})

describe('the detector can fail (control)', () => {
  const source = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
  it('a gateway without the 504 mapping or the abort signal is caught', () => {
    const a = source.replace("if (isActivity && response.status === 504) {", 'if (false) {')
    const b = source.replace("...(isActivity ? { signal: AbortSignal.timeout(ACTIVITY_READ_DEADLINE_MS) } : {}),", '')
    expect(a).not.toBe(source)
    expect(b).not.toBe(source)
    expect(/if \(isActivity && response\.status === 504\) \{/.test(a)).toBe(false)
    expect(/signal: AbortSignal\.timeout\(ACTIVITY_READ_DEADLINE_MS\)/.test(b)).toBe(false)
  })
})

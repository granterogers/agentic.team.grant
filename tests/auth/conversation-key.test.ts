/*
 * H1 - Team HQ conversational memory is the PERSON'S thread in a project, not a page visit.
 *
 * Two layers, both hermetic:
 *   1. the pure derivation (`src/auth/conversation-key.ts`): what the durable head is made of;
 *   2. the REAL `/voice/turn` handler driven with a stubbed network, reading back the row it would have written
 *      (`origin_ref`, `dedupe_key`), so the wired call is what is asserted and not a name in a file.
 * The database half (conversation_before, open_questions_for_reply against these rows) is the replica proof
 * `scripts/isolated/e2e-convergence.ts` (the reload section).
 */
import { describe, expect, it, vi } from 'vitest'
import { conversationHead, durableHead, PAGE_SESSION } from '../../src/auth/conversation-key.ts'

const OFFICE_A = '11111111-1111-4111-8111-111111111111'
const OFFICE_B = '22222222-2222-4222-8222-222222222222'
const PROJ_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJ_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const head = (o: Partial<Parameters<typeof conversationHead>[0]> = {}) =>
  conversationHead({
    office: OFFICE_A,
    actor: 'grant',
    kind: 'person',
    session: 's1abc2def3',
    project: PROJ_1,
    ...o,
  })

describe('the durable conversation head', () => {
  it('is the same across page visits (reload, second tab, another device)', async () => {
    expect(await head({ session: 's1abc2def3' })).toBe(await head({ session: 'szzzzzzzzzz' }))
  })

  it('differs by PERSON, by OFFICE and by PROJECT', async () => {
    const base = await head()
    expect(await head({ actor: 'sam' })).not.toBe(base)
    expect(await head({ office: OFFICE_B })).not.toBe(base)
    expect(await head({ project: PROJ_2 })).not.toBe(base)
    expect(await head({ project: null })).not.toBe(base)
  })

  it('carries person and office independently (swapping them is not a collision)', async () => {
    expect(await durableHead(OFFICE_A, 'sam')).not.toBe(await durableHead(OFFICE_B, 'sam'))
    expect(await durableHead(OFFICE_A, 'sam')).not.toBe(await durableHead(OFFICE_A, 'grant'))
    // the separator means ("ab", "c") and ("a", "bc") are different people
    expect(await durableHead('x', 'ab')).not.toBe(await durableHead('xa', 'b'))
  })

  it('never contains a colon, so it cannot split into two chats, and reveals neither id', async () => {
    const h = await head()
    expect(h).not.toContain(':')
    expect(h).not.toContain(OFFICE_A)
    expect(h).not.toContain('grant')
    expect(h.endsWith(`/${PROJ_1}`)).toBe(true)
  })

  it('does NOT make a harness session durable: it keeps its own per-visit head', async () => {
    for (const session of ['verify-h1run', 'probe1234567', 'fixture-abc', 'gate-xyz']) {
      expect(PAGE_SESSION.test(session)).toBe(false)
      expect(await head({ session })).toBe(`${session}/${PROJ_1}`)
    }
    // a harness and a real visit never share a thread, so a harness turn is not in front of the person's next real one
    expect(await head({ session: 'verify-h1run' })).not.toBe(await head())
  })

  it('never makes the office key durable, whatever session it presents', async () => {
    expect(await head({ kind: 'service', session: 's1abc2def3' })).toBe(`s1abc2def3/${PROJ_1}`)
  })

  it('degrades to the visit rather than to anything shared when identity is missing', async () => {
    expect(await head({ actor: '' })).toBe(`s1abc2def3/${PROJ_1}`)
    expect(await head({ office: '' })).toBe(`s1abc2def3/${PROJ_1}`)
  })

  it('the page-minted shape (what chat.js and call.js mint) is exactly what counts as a page', () => {
    for (let i = 0; i < 500; i += 1) {
      const minted = `s${Math.random().toString(36).slice(2, 12)}`
      expect(PAGE_SESSION.test(minted)).toBe(true)
    }
  })
})

/* ---- the real handler -------------------------------------------------------------------------------------- */

type Posted = { origin_ref: string; dedupe_key: string; actor: string; office_id: string }

const TOKEN_A = `aaa.bbb.${'a'.repeat(70)}`
const TOKEN_B = `aaa.bbb.${'b'.repeat(70)}`
// A colleague in the SAME office as A, and the SAME owner key as B in a DIFFERENT office (office and person each vary alone).
const TOKEN_C = `aaa.bbb.${'c'.repeat(70)}`
const TOKEN_D = `aaa.bbb.${'d'.repeat(70)}`
const PERSONS: Record<string, { email: string; owner: string; user: string; office: string }> = {
  [TOKEN_A]: { email: 'a@x.test', owner: 'grant', user: 'u-a', office: OFFICE_A },
  [TOKEN_B]: { email: 'b@x.test', owner: 'sam', user: 'u-b', office: OFFICE_B },
  [TOKEN_C]: { email: 'c@x.test', owner: 'colleague', user: 'u-c', office: OFFICE_A },
  [TOKEN_D]: { email: 'd@x.test', owner: 'grant', user: 'u-d', office: OFFICE_B },
}

const driveVoice = async (
  turns: { token: string; session: string; project: string | null }[],
): Promise<Posted[]> => {
  const g = globalThis as unknown as { Deno?: unknown }
  const envVars: Record<string, string> = {
    HQ_API_TOKEN: 'machine-key-for-tests',
    SUPABASE_URL: 'https://db.test',
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  }
  let handler: ((r: Request) => Promise<Response>) | undefined
  const priorDeno = g.Deno
  g.Deno = {
    env: { get: (k: string) => envVars[k] },
    serve: (h: (r: Request) => Promise<Response>) => {
      handler = h
    },
  }
  const posted: Posted[] = []
  const realFetch = globalThis.fetch
  const ok = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith('https://db.test')) throw new Error(`REFUSED ${url}`)
    const path = new URL(url).pathname
    const headers = (init?.headers ?? {}) as Record<string, string>
    const bearer = String(headers.Authorization ?? '').replace(/^Bearer\s+/i, '')
    if (path === '/auth/v1/user') {
      const p = PERSONS[bearer]
      return p === undefined ? ok({}, 401) : ok({ id: p.user, email: p.email })
    }
    if (path.endsWith('/rpc/office_member')) {
      const email = JSON.parse(String(init?.body)).p_email
      const p = Object.values(PERSONS).find((x) => x.email === email)
      return ok(p === undefined ? [] : [{ ok: true, owner_key: p.owner, kind: 'person' }])
    }
    if (path.endsWith('/rpc/resolve_office')) {
      const id = JSON.parse(String(init?.body)).p_auth_user_id
      const p = Object.values(PERSONS).find((x) => x.user === id)
      return ok(p === undefined ? { ok: false } : { ok: true, office_id: p.office })
    }
    if (path.endsWith('/rest/v1/inbound_commands')) {
      posted.push(JSON.parse(String(init?.body)) as Posted)
      return ok([{ command_id: `c${posted.length}` }], 201)
    }
    if (path.endsWith('/rpc/voice_answer')) return ok({})
    if (path.endsWith('/rpc/enqueue_inbound')) return ok({ job_id: `j${posted.length}` })
    return ok({})
  }) as typeof fetch
  try {
    // A fresh evaluation each time: the module registers its handler with Deno.serve when it loads.
    vi.resetModules()
    const entry = '../../supabase/functions/voice/index.ts'
    await import(/* @vite-ignore */ entry)
    for (const t of turns) {
      const r = await (handler as (r: Request) => Promise<Response>)(
        new Request('https://fn.test/voice/turn', {
          method: 'POST',
          headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            said: 'Yes, do that.',
            session: t.session,
            ...(t.project === null ? {} : { project: t.project }),
          }),
        }),
      )
      expect(r.status).toBe(200)
    }
  } finally {
    globalThis.fetch = realFetch
    g.Deno = priorDeno
  }
  return posted
}

const headOf = (p: Posted): string => p.origin_ref.split(':')[0] ?? ''

describe('the real /voice/turn door writes the durable conversation into origin_ref', () => {
  it('a reload (new visit id, same person and project) lands in the SAME conversation', async () => {
    const [a, b] = await driveVoice([
      { token: TOKEN_A, session: 's1abc2def3', project: PROJ_1 },
      { token: TOKEN_A, session: 'sreloaded9', project: PROJ_1 },
    ])
    expect(headOf(a as Posted)).toBe(headOf(b as Posted))
    expect(headOf(a as Posted).endsWith(`/${PROJ_1}`)).toBe(true)
  })

  it('another person, another office, and another project each get a DIFFERENT conversation, even with a replayed visit id', async () => {
    const [mine, otherPerson, otherProject, noProject] = await driveVoice([
      { token: TOKEN_A, session: 's1abc2def3', project: PROJ_1 },
      { token: TOKEN_B, session: 's1abc2def3', project: PROJ_1 },
      { token: TOKEN_A, session: 's1abc2def3', project: PROJ_2 },
      { token: TOKEN_A, session: 's1abc2def3', project: null },
    ])
    const heads = [mine, otherPerson, otherProject, noProject].map((p) => headOf(p as Posted))
    expect(new Set(heads).size).toBe(4)
    // the speaker and office written are the verified ones, never anything the page sent
    expect((otherPerson as Posted).actor).toBe('sam')
    expect((otherPerson as Posted).office_id).toBe(OFFICE_B)
  })

  it('a colleague in the SAME office, and the same owner key in ANOTHER office, each get their own conversation', async () => {
    const [mine, colleague, sameKeyOtherOffice] = await driveVoice([
      { token: TOKEN_A, session: 's1abc2def3', project: PROJ_1 },
      { token: TOKEN_C, session: 's1abc2def3', project: PROJ_1 },
      { token: TOKEN_D, session: 's1abc2def3', project: PROJ_1 },
    ])
    expect((colleague as Posted).office_id).toBe((mine as Posted).office_id)
    expect(headOf(colleague as Posted)).not.toBe(headOf(mine as Posted))
    expect((sameKeyOtherOffice as Posted).actor).toBe((mine as Posted).actor)
    expect(headOf(sameKeyOtherOffice as Posted)).not.toBe(headOf(mine as Posted))
  })

  it('the dedupe key keeps the visit session and a per-turn id: two turns are never one webhook', async () => {
    const posted = await driveVoice([
      { token: TOKEN_A, session: 's1abc2def3', project: PROJ_1 },
      { token: TOKEN_A, session: 's1abc2def3', project: PROJ_1 },
      { token: TOKEN_A, session: 's1abc2def3', project: PROJ_1 },
    ])
    const keys = posted.map((p) => p.dedupe_key)
    expect(new Set(keys).size).toBe(3)
    for (const k of keys) {
      // exactly the shape 0598 and 0603 treat as the dashboard's own, so a durable head cannot trip the harness rule
      expect(k).toMatch(/^voice:turn:s[a-z0-9]{1,10}\.[a-z0-9]+$/)
      expect(k.startsWith('voice:turn:s1abc2def3.')).toBe(true)
    }
    expect(new Set(posted.map((p) => p.origin_ref)).size).toBe(3)
  })

  it('a harness session from a signed-in person keeps its per-visit head and its harness dedupe key', async () => {
    const [real, harness] = await driveVoice([
      { token: TOKEN_A, session: 's1abc2def3', project: PROJ_1 },
      { token: TOKEN_A, session: 'verify-h1run', project: PROJ_1 },
    ])
    expect(headOf(harness as Posted)).toBe(`verify-h1run/${PROJ_1}`)
    expect(headOf(harness as Posted)).not.toBe(headOf(real as Posted))
    expect((harness as Posted).dedupe_key.startsWith('voice:turn:verify-h1run.')).toBe(true)
  })
})

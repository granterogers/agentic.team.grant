/**
 * The project archive through the REAL gateway handler (issue #471, C2): the download and the restore, under a stubbed
 * Deno and a fake Supabase. The properties are behavioural: who may restore, what reaches the database, and what a
 * tampered or oversize body does. Same harness as office-resolution.test.ts.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildArchive, readZip, sha256Hex } from '../../src/portability/archive.ts'

const OFFICE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const TEST_OFFICE = 'e13ce7a9-831b-49d7-83a5-2ede9c1a97d0'
const PROJECT = '6f1c2b8e-0000-4000-8000-0000000000aa'
const MACHINE_KEY = 'machine-key-for-tests'
const jwt = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`
const EXPORTED_AT = '2026-10-14T08:00:00.000Z'

const pkg = {
  format: 'ai-team-hq/project-package',
  format_version: 1,
  exported_at: EXPORTED_AT,
  project: {
    slug: 'wellness',
    name: 'Wellness',
    brief: 'A brief that is long enough to read as a real brief here.',
  },
  documents: [{ path: 'budget.txt', title: 'Budget', text: 'Totals: 40 and 14' }],
  tasks: [],
}

type Handler = (r: Request) => Promise<Response>
let handler: Handler
let kind = 'person'
let restoreReply: Record<string, unknown> = {
  ok: true,
  already: false,
  project_id: 'new',
  slug: 'wellness',
  report: {},
}
const rpc: { fn: string; body: Record<string, unknown> }[] = []

const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = String(url)
  if (u.endsWith('/auth/v1/user'))
    return new Response(JSON.stringify({ id: 'auth-1', email: 'sam@example.com' }), { status: 200 })
  if (u.endsWith('/rpc/office_member'))
    return new Response(JSON.stringify([{ ok: true, owner_key: 'sam', kind }]), { status: 200 })
  if (u.endsWith('/rpc/resolve_machine_office'))
    return new Response(JSON.stringify({ ok: true, office_id: TEST_OFFICE }), { status: 200 })
  if (u.endsWith('/rpc/resolve_office'))
    return new Response(JSON.stringify({ ok: true, office_id: OFFICE }), { status: 200 })
  const m = /\/rpc\/([a-z_0-9]+)$/.exec(u)
  if (m) {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    rpc.push({ fn: m[1] as string, body })
    if (m[1] === 'project_export') {
      return new Response(
        JSON.stringify(
          body.p_project_id === PROJECT ? pkg : { format: 'ai-team-hq/project-package' },
        ),
        {
          status: 200,
        },
      )
    }
    if (m[1] === 'project_restore')
      return new Response(JSON.stringify(restoreReply), { status: 200 })
    return new Response('{}', { status: 200 })
  }
  return new Response('{}', { status: 200 })
})

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: {
      get: (k: string): string | undefined =>
        ({
          HQ_API_TOKEN: MACHINE_KEY,
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
  kind = 'person'
  restoreReply = { ok: true, already: false, project_id: 'new', slug: 'wellness', report: {} }
})

const restoreRequest = (
  token: string,
  body: Uint8Array,
  headers: Record<string, string> = {},
): Promise<Response> =>
  handler(
    new Request(`https://gw.test/?section=project_restore`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip', ...headers },
      body: body as unknown as NonNullable<RequestInit['body']>,
    }),
  )

describe('restoring a project from an archive, through the gateway', () => {
  it('a person restores a valid archive: one RPC, keyed on the archive hash, attributed to the person', async () => {
    const { bytes, key } = await buildArchive(pkg, { slug: 'wellness', exportedAt: EXPORTED_AT })
    const res = await restoreRequest(`${jwt}r1`, bytes)
    expect(res.status).toBe(201)
    const calls = rpc.filter((c) => c.fn === 'project_restore')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body.p_office).toBe(OFFICE)
    expect(calls[0]?.body.p_key).toBe(key)
    expect(calls[0]?.body.p_by).toBe('sam')
    expect(calls[0]?.body.p_package).toEqual(pkg)
  })

  it('a replay of the same archive answers 200 with the stored result', async () => {
    const { bytes } = await buildArchive(pkg, { slug: 'wellness', exportedAt: EXPORTED_AT })
    restoreReply = { ok: true, already: true, project_id: 'first', slug: 'wellness', report: {} }
    const res = await restoreRequest(`${jwt}r2`, bytes)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: { already: boolean } }).data.already).toBe(true)
  })

  it('a tampered archive is refused before any database call', async () => {
    const { bytes } = await buildArchive(pkg, { slug: 'wellness', exportedAt: EXPORTED_AT })
    const tampered = new Uint8Array(bytes)
    const at = tampered.indexOf('T'.charCodeAt(0))
    tampered[at] = 0x78
    const res = await restoreRequest(`${jwt}r3`, tampered)
    expect(res.status).toBe(400)
    expect(rpc.filter((c) => c.fn === 'project_restore')).toHaveLength(0)
  })

  it('a file that is not a ZIP is refused before any database call', async () => {
    const res = await restoreRequest(`${jwt}r4`, new TextEncoder().encode('{"not":"an archive"}'))
    expect(res.status).toBe(400)
    expect(rpc).toEqual([])
  })

  it('the machine key cannot restore: a restore has to be attributed to a person', async () => {
    const { bytes } = await buildArchive(pkg, { slug: 'wellness', exportedAt: EXPORTED_AT })
    const res = await restoreRequest(MACHINE_KEY, bytes)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(/attributed to a person/)
    expect(rpc.filter((c) => c.fn === 'project_restore')).toHaveLength(0)
  })

  it('a Sample visitor changes nothing, and is told why in words', async () => {
    kind = 'guest'
    const { bytes } = await buildArchive(pkg, { slug: 'wellness', exportedAt: EXPORTED_AT })
    const res = await restoreRequest(`${jwt}r5`, bytes)
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe('sample_readonly')
    expect(rpc.filter((c) => c.fn === 'project_restore')).toHaveLength(0)
  })

  it('an archive declared larger than the limit is refused before it is read', async () => {
    const { bytes } = await buildArchive(pkg, { slug: 'wellness', exportedAt: EXPORTED_AT })
    const res = await restoreRequest(`${jwt}r6`, bytes, {
      'content-length': String(9 * 1024 * 1024),
    })
    expect(res.status).toBe(413)
    expect(rpc).toEqual([])
  })

  it('a refusal from the database is passed on as its sentence, not as a success', async () => {
    restoreReply = { ok: false, error: 'the package has no project name' }
    const { bytes } = await buildArchive(pkg, { slug: 'wellness', exportedAt: EXPORTED_AT })
    const res = await restoreRequest(`${jwt}r7`, bytes)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('the package has no project name')
  })
})

describe('downloading a project as an archive, through the gateway', () => {
  const download = (token: string, id: string): Promise<Response> =>
    handler(
      new Request(`https://gw.test/?section=project_archive&id=${id}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      }),
    )

  it('returns a ZIP of the project that reads back to the same package and checksums', async () => {
    const res = await download(`${jwt}d1`, PROJECT)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="wellness-archive.zip"',
    )
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect([...readZip(bytes).keys()].sort()).toEqual([
      'README.txt',
      'manifest.json',
      'project.json',
    ])
    const packageText = new TextDecoder().decode(readZip(bytes).get('project.json'))
    expect(JSON.parse(packageText)).toEqual(pkg)
    expect(await sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('asks the database for this office and this project only', async () => {
    await download(`${jwt}d2`, PROJECT)
    const exported = rpc.find((c) => c.fn === 'project_export')
    expect(exported?.body).toEqual({ p_office: OFFICE, p_project_id: PROJECT })
  })

  it('a project that is not in this office is 404, with no archive built', async () => {
    const res = await download(`${jwt}d3`, '6f1c2b8e-0000-4000-8000-0000000000bb')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).not.toBe('application/zip')
  })

  it('a malformed project id is refused before the database is asked', async () => {
    const res = await download(`${jwt}d4`, 'not-a-uuid')
    expect(res.status).toBe(400)
    expect(rpc.filter((c) => c.fn === 'project_export')).toHaveLength(0)
  })
})

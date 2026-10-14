/**
 * A document upload through the REAL gateway handler (issue #468, storage policy): a file is checked for its type,
 * extension and contents before anything is written to storage. Stubbed Deno and a fake Supabase, the same harness as
 * project-archive.test.ts. Properties: a disguised or disallowed file is refused and nothing is stored; a genuine PNG is
 * stored under the project's upload prefix.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const OFFICE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const PROJECT = '6f1c2b8e-0000-4000-8000-0000000000aa'
const MACHINE_KEY = 'machine-key-for-tests'
const jwt = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8,
])
const base64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

type Handler = (r: Request) => Promise<Response>
let handler: Handler
const stored: { path: string; mime: string }[] = []
const recorded: Record<string, unknown>[] = []

const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = String(url)
  if (u.endsWith('/auth/v1/user'))
    return new Response(JSON.stringify({ id: 'auth-1', email: 'sam@example.com' }), { status: 200 })
  if (u.endsWith('/rpc/office_member'))
    return new Response(JSON.stringify([{ ok: true, owner_key: 'sam', kind: 'person' }]), {
      status: 200,
    })
  if (u.endsWith('/rpc/resolve_office'))
    return new Response(JSON.stringify({ ok: true, office_id: OFFICE }), { status: 200 })
  if (/\/storage\/v1\/object\/files\//.test(u)) {
    const path = decodeURIComponent(u.split('/storage/v1/object/files/')[1] ?? '')
    const mime = new Headers(init?.headers).get('content-type') ?? ''
    stored.push({ path, mime })
    return new Response('{"Key":"files/x"}', { status: 200 })
  }
  if (u.endsWith('/rpc/hq_upload_target'))
    return new Response(JSON.stringify({ ok: true, project_id: PROJECT }), { status: 200 })
  if (u.endsWith('/rpc/record_file_document')) {
    recorded.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
    return new Response(JSON.stringify({ ok: true, document_id: 'doc-1' }), { status: 200 })
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
  stored.length = 0
  recorded.length = 0
})

const upload = (token: string, args: Record<string, unknown>): Promise<Response> =>
  handler(
    new Request('https://gw.test/', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'document_upload', args }),
    }),
  )

describe('a document upload is checked before it is stored, through the gateway', () => {
  it('refuses a file whose contents are not the type it declares, and stores nothing', async () => {
    const res = await upload(`${jwt}u1`, {
      p_project_id: PROJECT,
      p_name: 'report.pdf',
      p_mime: 'application/pdf',
      p_base64: base64(new TextEncoder().encode('this is not a pdf')),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain(
      'contents do not match the declared type',
    )
    expect(stored).toEqual([])
    expect(recorded).toEqual([])
  })

  it('refuses a name whose extension does not agree with the declared type', async () => {
    const res = await upload(`${jwt}u2`, {
      p_project_id: PROJECT,
      p_name: 'plan.exe',
      p_mime: 'image/png',
      p_base64: base64(PNG),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain(
      'extension does not match the declared type',
    )
    expect(stored).toEqual([])
  })

  it('refuses a type the office does not take, and stores nothing', async () => {
    const res = await upload(`${jwt}u3`, {
      p_project_id: PROJECT,
      p_name: 'tool.bin',
      p_mime: 'application/x-msdownload',
      p_base64: base64(PNG),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toContain('type not allowed')
    expect(stored).toEqual([])
  })

  it('stores a genuine PNG under the project upload prefix and records it', async () => {
    const res = await upload(`${jwt}u4`, {
      p_project_id: PROJECT,
      p_name: 'Floor plan.png',
      p_mime: 'image/png',
      p_base64: base64(PNG),
    })
    expect(res.status).not.toBe(400)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.path.startsWith(`${PROJECT}/upload/`)).toBe(true)
    expect(stored[0]?.path.endsWith('.png')).toBe(true)
    expect(stored[0]?.mime).toBe('image/png')
    expect(recorded).toHaveLength(1)
  })
})

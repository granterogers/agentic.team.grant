/**
 * Signed download links through the REAL gateway section read (issue #468): a link is minted only for a file whose owner
 * is the office asking. Stubbed Deno and a fake database holding one document per office. Same harness as
 * project-archive.test.ts.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const OFFICE_A = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const OFFICE_B = 'e13ce7a9-831b-49d7-83a5-2ede9c1a97d0'
const PROJECT_A = 'a0000000-0000-4000-8000-000000000001'
const PROJECT_B = 'b0000000-0000-4000-8000-000000000001'
const DOC_A_ID = 'a1000000-0000-4000-8000-000000000001'
const DOC_B_ID = 'b1000000-0000-4000-8000-000000000001'
const PATH_A = `${PROJECT_A}/upload/plan.png`
const PATH_B = `${PROJECT_B}/upload/secret.pdf`
const jwt = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`

type Handler = (r: Request) => Promise<Response>
let handler: Handler
const signed: string[] = []

/** The documents the database holds, by id. The section RPC answers for one of them. */
const documents: Record<string, { office_id: string; project_id: string; storage_path: string }> = {
  [DOC_A_ID]: { office_id: OFFICE_A, project_id: PROJECT_A, storage_path: PATH_A },
  [DOC_B_ID]: { office_id: OFFICE_B, project_id: PROJECT_B, storage_path: PATH_B },
}
/** Which document the section RPC returns for an id, so a test can ask for either. */
let rpcAnswer: { document_id: string; title: string; path: string } | null = null

const fake = vi.fn(async (url: string | URL | Request): Promise<Response> => {
  const u = decodeURIComponent(String(url))
  if (u.endsWith('/auth/v1/user'))
    return new Response(JSON.stringify({ id: 'auth-1', email: 'sam@example.com' }), { status: 200 })
  if (u.endsWith('/rpc/office_member'))
    return new Response(JSON.stringify([{ ok: true, owner_key: 'sam', kind: 'person' }]), {
      status: 200,
    })
  if (u.endsWith('/rpc/resolve_office'))
    return new Response(JSON.stringify({ ok: true, office_id: OFFICE_A }), { status: 200 })
  if (u.endsWith('/rpc/studio_document')) {
    return new Response(JSON.stringify(rpcAnswer), { status: 200 })
  }
  // The owner lookup: a document row, filtered by path and office.
  if (u.includes('/rest/v1/documents?')) {
    const path = /storage_path=eq\.([^&]+)/.exec(u)?.[1] ?? ''
    const office = /office_id=eq\.([^&]+)/.exec(u)?.[1] ?? ''
    const hit = Object.values(documents).find(
      (d) => d.storage_path === path && d.office_id === office,
    )
    return new Response(
      JSON.stringify(
        hit === undefined ? [] : [{ office_id: hit.office_id, project_id: hit.project_id }],
      ),
      { status: 200 },
    )
  }
  if (u.includes('/rest/v1/projects?')) {
    const office = /office_id=eq\.([^&]+)/.exec(u)?.[1] ?? ''
    const projects = [PROJECT_A, PROJECT_B].filter((p) =>
      office === OFFICE_A ? p === PROJECT_A : p === PROJECT_B,
    )
    return new Response(
      JSON.stringify(projects.map((project_id) => ({ project_id, office_id: office }))),
      {
        status: 200,
      },
    )
  }
  if (u.includes('/object/sign/files/')) {
    signed.push(u)
    return new Response(
      JSON.stringify({ signedURL: `/object/sign/files/${u.split('/files/')[1]}?token=t` }),
      {
        status: 200,
      },
    )
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
  signed.length = 0
  rpcAnswer = null
})

const readDocument = (token: string, id: string): Promise<Response> =>
  handler(
    new Request(`https://gw.test/?section=document&id=${id}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    }),
  )

describe('a signed link to a document, through the gateway', () => {
  it('is minted for a document the asking office owns', async () => {
    rpcAnswer = { document_id: DOC_A_ID, title: 'Floor plan', path: PATH_A }
    const res = await readDocument(`${jwt}s1`, DOC_A_ID)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { url?: string; path?: string } }
    expect(body.data.url).toContain('/object/sign/files/')
    expect(signed).toHaveLength(1)
    expect(body.data.path).toBeUndefined()
  })

  it('is refused for another office document: no link is minted, and the path is still dropped', async () => {
    rpcAnswer = { document_id: DOC_B_ID, title: 'Secret', path: PATH_B }
    const res = await readDocument(`${jwt}s2`, DOC_B_ID)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { url?: string | null; path?: string } }
    expect(body.data.url).toBeUndefined()
    expect(body.data.path).toBeUndefined()
    expect(signed).toHaveLength(0)
  })

  it('is refused for a path the database does not hold under this office', async () => {
    rpcAnswer = { document_id: DOC_A_ID, title: 'Forged', path: `${PROJECT_B}/upload/forged.png` }
    const res = await readDocument(`${jwt}s3`, DOC_A_ID)
    const body = (await res.json()) as { data: { url?: string } }
    expect(body.data.url).toBeUndefined()
    expect(signed).toHaveLength(0)
  })
})

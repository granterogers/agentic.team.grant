/**
 * Signed download links through the REAL gateway section reads (issue #468): a link is minted only for a file whose owner
 * is the office asking. Stubbed Deno and a fake database holding one document, one contact photo and one screenshot per
 * office. Same harness as project-archive.test.ts.
 *
 * Every read path that signs a link is covered here: document, contact photo (studio), browser screenshot (browser_lately).
 * Each has a cross-office denial, and each has a positive control in the caller's own office, so a denial cannot pass
 * because nothing is ever signed.
 *
 * Cross-PROJECT within one office is allowed by design, and is stated as such: the product has no per-person project
 * membership (an office's people all see the office's projects), so the policy's project test is applied against every
 * project of the asking office. A link to a project that belongs to another office is refused.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const OFFICE_A = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const OFFICE_B = 'e13ce7a9-831b-49d7-83a5-2ede9c1a97d0'
const PROJECT_A = 'a0000000-0000-4000-8000-000000000001'
const PROJECT_A2 = 'a0000000-0000-4000-8000-000000000002'
const PROJECT_B = 'b0000000-0000-4000-8000-000000000001'
const DOC_A_ID = 'a1000000-0000-4000-8000-000000000001'
const DOC_B_ID = 'b1000000-0000-4000-8000-000000000001'
const PATH_A = `${PROJECT_A}/upload/plan.png`
const PATH_B = `${PROJECT_B}/upload/secret.pdf`
const PHOTO_A = `${PROJECT_A}/contacts/ana.jpg`
const PHOTO_B = `${PROJECT_B}/contacts/bo.jpg`
const SHOT_A = `${PROJECT_A}/shots/home.png`
const SHOT_B = `${PROJECT_B}/shots/secret.png`
const jwt = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`

type Handler = (r: Request) => Promise<Response>
let handler: Handler
const signed: string[] = []

/** Which office each project belongs to: the database's answer, served to the link lookups. */
const projectOffice: Record<string, string> = {
  [PROJECT_A]: OFFICE_A,
  [PROJECT_A2]: OFFICE_A,
  [PROJECT_B]: OFFICE_B,
}
/** The documents the database holds, by id. The section RPC answers for one of them. */
const documents: Record<string, { office_id: string; project_id: string; storage_path: string }> = {
  [DOC_A_ID]: { office_id: OFFICE_A, project_id: PROJECT_A, storage_path: PATH_A },
  [DOC_B_ID]: { office_id: OFFICE_B, project_id: PROJECT_B, storage_path: PATH_B },
}
/** The contacts that hold a photograph, by path. */
const contactPhotos: Record<string, string> = { [PHOTO_A]: PROJECT_A, [PHOTO_B]: PROJECT_B }
/** Which document the section RPC returns for an id, so a test can ask for either. */
let rpcAnswer: { document_id: string; title: string; path: string } | null = null
/** What the studio section returns: projects with their contacts' photographs. */
let studioAnswer: unknown = null
/** What the browsing ledger returns for the asking office. */
let browserAnswer: unknown[] = []

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
  if (u.endsWith('/rpc/studio_document'))
    return new Response(JSON.stringify(rpcAnswer), { status: 200 })
  if (u.endsWith('/rpc/hq_studio'))
    return new Response(JSON.stringify(studioAnswer), { status: 200 })
  if (u.endsWith('/rpc/browser_lately'))
    return new Response(JSON.stringify(browserAnswer), { status: 200 })
  // The owner lookup for a document: a row, filtered by path and office.
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
  // The project a contact photograph belongs to.
  if (u.includes('/rest/v1/contacts?')) {
    const path = /photo_path=eq\.([^&]+)/.exec(u)?.[1] ?? ''
    const project = contactPhotos[path]
    return new Response(JSON.stringify(project === undefined ? [] : [{ project_id: project }]), {
      status: 200,
    })
  }
  // The office a project belongs to.
  if (u.includes('/rest/v1/projects?project_id=eq.')) {
    const project = /project_id=eq\.([^&]+)/.exec(u)?.[1] ?? ''
    const office = projectOffice[project]
    return new Response(JSON.stringify(office === undefined ? [] : [{ office_id: office }]), {
      status: 200,
    })
  }
  // Every project of an office, for the office's own membership.
  if (u.includes('/rest/v1/projects?')) {
    const office = /office_id=eq\.([^&]+)/.exec(u)?.[1] ?? ''
    const projects = Object.keys(projectOffice).filter((p) => projectOffice[p] === office)
    return new Response(JSON.stringify(projects.map((project_id) => ({ project_id }))), {
      status: 200,
    })
  }
  if (u.includes('/object/sign/files/')) {
    signed.push(u)
    return new Response(
      JSON.stringify({ signedURL: `/object/sign/files/${u.split('/files/')[1]}?token=t` }),
      { status: 200 },
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
  studioAnswer = null
  browserAnswer = []
})

const section = (token: string | null, name: string, extra = ''): Promise<Response> =>
  handler(
    new Request(`https://gw.test/?section=${name}${extra}`, {
      method: 'GET',
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    }),
  )

const readDocument = (token: string, id: string): Promise<Response> =>
  section(token, 'document', `&id=${id}`)

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

  it('is refused with no session at all, and the gateway answers 401 before any link is minted', async () => {
    rpcAnswer = { document_id: DOC_A_ID, title: 'Floor plan', path: PATH_A }
    const res = await readDocument('', DOC_A_ID)
    expect(res.status).toBe(401)
    expect(signed).toHaveLength(0)
  })

  it('is refused for the machine key, which has no office, so it signs nothing for a document', async () => {
    rpcAnswer = { document_id: DOC_A_ID, title: 'Floor plan', path: PATH_A }
    const res = await readDocument('machine-key-for-tests', DOC_A_ID)
    if (res.status === 200) {
      const body = (await res.json()) as { data: { url?: string | null } | null }
      expect(body.data?.url ?? null).toBeNull()
    }
    expect(signed).toHaveLength(0)
  })
})

describe('a signed link to a contact photograph, through the gateway', () => {
  it('is minted for a photograph of a contact in the asking office', async () => {
    studioAnswer = {
      projects: [{ project_id: PROJECT_A, contacts: [{ photo: PHOTO_A }] }],
    }
    const res = await section(`${jwt}p1`, 'studio')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { projects: { contacts: { photo?: string }[] }[] } }
    expect(body.data.projects[0]?.contacts[0]?.photo).toContain('/object/sign/files/')
    expect(signed).toHaveLength(1)
  })

  it('is refused for a photograph of a contact in another office, and the raw path is not sent either', async () => {
    studioAnswer = {
      projects: [{ project_id: PROJECT_B, contacts: [{ photo: PHOTO_B }] }],
    }
    const res = await section(`${jwt}p2`, 'studio')
    const body = (await res.json()) as { data: { projects: { contacts: { photo?: string }[] }[] } }
    expect(body.data.projects[0]?.contacts[0]?.photo).toBeUndefined()
    expect(signed).toHaveLength(0)
  })
})

describe('a signed link to a browser screenshot, through the gateway', () => {
  it('is minted for a screenshot of a project in the asking office', async () => {
    browserAnswer = [{ shot_path: SHOT_A, title: 'Home' }]
    const res = await section(`${jwt}b1`, 'browser_lately', `&id=${PROJECT_A}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { shot_url?: string | null }[] }
    expect(body.data[0]?.shot_url).toContain('/object/sign/files/')
    expect(signed).toHaveLength(1)
  })

  it('is refused for a screenshot of another office project, and the raw path is dropped', async () => {
    browserAnswer = [{ shot_path: SHOT_B, title: 'Secret' }]
    const res = await section(`${jwt}b2`, 'browser_lately', `&id=${PROJECT_B}`)
    const body = (await res.json()) as { data: { shot_url?: string | null; shot_path?: string }[] }
    expect(body.data[0]?.shot_url).toBeNull()
    expect(body.data[0]?.shot_path).toBeUndefined()
    expect(signed).toHaveLength(0)
  })
})

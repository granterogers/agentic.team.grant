/**
 * A project larger than one archive, through the REAL gateway handler (issue #471, item 5): the index, each part, the restore of
 * each part, the single commit, and the abandon. A stubbed Deno and a fake Supabase, the same harness as project-archive.test.ts.
 * Each property is behavioural: what reaches storage, what reaches the database, and what a refused step leaves behind.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readZip, sha256Hex } from '../../src/portability/archive.ts'
import { SET_LIMITS } from '../../src/portability/parts.ts'

const OFFICE = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const OTHER_OFFICE = 'e13ce7a9-831b-49d7-83a5-2ede9c1a97d0'
const PROJECT = '6f1c2b8e-0000-4000-8000-0000000000aa'
const MACHINE_KEY = 'machine-key-for-tests'
const jwt = `${'a'.repeat(30)}.${'b'.repeat(30)}.${'c'.repeat(30)}`
const MB = 1024 * 1024
/** The part at an index. A test that asks for a part that is not there fails here, with a reason. */
const partAt = (list: readonly Uint8Array[], i: number): Uint8Array => {
  const part = list[i]
  if (part === undefined) throw new Error(`there is no part ${String(i)}`)
  return part
}

const bucket = new Map<string, { bytes: Uint8Array; mime: string }>()
/** When a stored object was created, for the storage listing (the sweep reads it). Absent means "now". */
const createdAt = new Map<string, string>()
const rpc: { fn: string; body: Record<string, unknown> }[] = []
let restoreReply: Record<string, unknown> = {
  ok: true,
  already: false,
  project_id: 'new',
  slug: 'big',
  report: {},
}
let exportOverride: unknown = null

type Handler = (r: Request) => Promise<Response>
let handler: Handler

const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = String(url)
  const stored = /\/storage\/v1\/object\/files\/(.+)$/.exec(u)
  if (stored) {
    const path = decodeURIComponent(stored[1] ?? '')
    const method = init?.method ?? 'GET'
    if (method === 'GET') {
      const hit = bucket.get(path)
      if (hit === undefined) return new Response('{}', { status: 404 })
      return new Response(hit.bytes as unknown as NonNullable<RequestInit['body']>, {
        status: 200,
        headers: { 'content-type': hit.mime },
      })
    }
    if (method === 'POST') {
      const body = init?.body
      const bytes =
        body instanceof Uint8Array ? new Uint8Array(body) : new TextEncoder().encode(String(body))
      const mime = new Headers(init?.headers).get('content-type') ?? 'application/octet-stream'
      bucket.set(path, { bytes, mime })
      return new Response(`{"Key":"files/${path}"}`, { status: 200 })
    }
    if (method === 'DELETE') {
      const had = bucket.delete(path)
      return new Response('{}', { status: had ? 200 : 404 })
    }
  }
  if (u.endsWith('/storage/v1/object/list/files') && init?.method === 'POST') {
    // The storage listing: files directly under the prefix, and folders (no id) for anything deeper.
    const prefix = String(
      (JSON.parse(String(init.body ?? '{}')) as { prefix?: string }).prefix ?? '',
    )
    const seen = new Map<string, { name: string; id: string | null; created_at?: string }>()
    for (const [path] of bucket) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash >= 0) {
        const folder = rest.slice(0, slash)
        if (!seen.has(folder)) seen.set(folder, { name: folder, id: null })
      } else {
        seen.set(rest, {
          name: rest,
          id: 'file',
          created_at: createdAt.get(path) ?? new Date().toISOString(),
        })
      }
    }
    return new Response(JSON.stringify([...seen.values()]), { status: 200 })
  }
  if (u.endsWith('/auth/v1/user'))
    return new Response(JSON.stringify({ id: 'auth-1', email: 'sam@example.com' }), { status: 200 })
  if (u.endsWith('/rpc/office_member'))
    return new Response(JSON.stringify([{ ok: true, owner_key: 'sam', kind: 'person' }]), {
      status: 200,
    })
  if (u.endsWith('/rpc/resolve_machine_office'))
    return new Response(JSON.stringify({ ok: true, office_id: OTHER_OFFICE }), { status: 200 })
  if (u.endsWith('/rpc/resolve_office'))
    return new Response(JSON.stringify({ ok: true, office_id: OFFICE }), { status: 200 })
  const m = /\/rpc\/([a-z_0-9]+)$/.exec(u)
  if (m) {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    rpc.push({ fn: m[1] as string, body })
    if (m[1] === 'project_export') {
      return new Response(JSON.stringify(exportOverride), { status: 200 })
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
  bucket.clear()
  createdAt.clear()
  exportOverride = null
  restoreReply = { ok: true, already: false, project_id: 'new', slug: 'big', report: {} }
})

/** A project holding three originals of 3 MB, 3 MB and 1 MB, as the office stores them. */
function projectWithLargeFiles() {
  bucket.set('src/a.pdf', { bytes: new Uint8Array(3 * MB).fill(1), mime: 'application/pdf' })
  bucket.set('src/b.pdf', { bytes: new Uint8Array(3 * MB).fill(2), mime: 'application/pdf' })
  bucket.set('src/c.png', { bytes: new Uint8Array(1 * MB).fill(3), mime: 'image/png' })
  exportOverride = {
    format: 'ai-team-hq/project-package',
    format_version: 1,
    exported_at: '2026-10-14T08:00:00.000Z',
    project: {
      slug: 'big',
      name: 'Big',
      brief: 'A brief long enough to read as a real brief here.',
    },
    documents: [
      {
        title: 'Plan',
        original: { mime_type: 'application/pdf', bytes: 3 * MB, storage_path: 'src/a.pdf' },
      },
      {
        title: 'Deck',
        original: { mime_type: 'application/pdf', bytes: 3 * MB, storage_path: 'src/b.pdf' },
      },
      {
        title: 'Sketch',
        original: { mime_type: 'image/png', bytes: 1 * MB, storage_path: 'src/c.png' },
      },
    ],
    tasks: [],
  }
}

const get = (token: string, query: string): Promise<Response> =>
  handler(
    new Request(`https://gw.test/?section=project_archive&id=${PROJECT}&${query}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    }),
  )

const restorePart = (token: string, setKey: string, part: number, body: Uint8Array) =>
  handler(
    new Request(`https://gw.test/?section=project_restore&set=${setKey}&part=${String(part)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
      body: body as unknown as NonNullable<RequestInit['body']>,
    }),
  )

const restoreAction = (token: string, setKey: string, action: 'commit' | 'abandon') =>
  handler(
    new Request(`https://gw.test/?section=project_restore&set=${setKey}&${action}=1`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/zip' },
      body: new Uint8Array(0) as unknown as NonNullable<RequestInit['body']>,
    }),
  )

/** Export the project as a set and return its key, cache id and the part bodies, in order. */
async function exportSet(): Promise<{ setKey: string; cache: string; parts: Uint8Array[] }> {
  const index = await get(`${jwt}e1`, 'set=index')
  expect(index.status).toBe(200)
  const body = (await index.json()) as { data: { set: string; cache: string; part_count: number } }
  const parts: Uint8Array[] = []
  for (let n = 1; n <= body.data.part_count; n++) {
    const part = await get(
      `${jwt}e${String(n + 1)}`,
      `set=${body.data.set}&cache=${body.data.cache}&part=${String(n)}`,
    )
    expect(part.status).toBe(200)
    parts.push(new Uint8Array(await part.arrayBuffer()))
  }
  return { setKey: body.data.set, cache: body.data.cache, parts }
}

describe('exporting a project larger than one archive, through the gateway', () => {
  it('describes the set, then refuses a part request that names no cache', async () => {
    projectWithLargeFiles()
    const index = await get(`${jwt}x1`, 'set=index')
    const body = (await index.json()) as {
      data: { set: string; part_count: number; parts: { number: number; bytes: number }[] }
    }
    expect(body.data.part_count).toBe(2)
    expect(body.data.parts.map((p) => p.bytes)).toEqual([3 * MB, 4 * MB])
    // A part request without the export it belongs to is refused, not answered with someone else's part.
    const bare = await get(`${jwt}x2`, `set=${body.data.set}&part=1`)
    expect(bare.status).toBe(400)
  })

  it('a part carries the index and its own files; part 1 alone carries the package', async () => {
    projectWithLargeFiles()
    const { parts } = await exportSet()
    expect(parts).toHaveLength(2)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(8 * MB)
    const first = readZip(partAt(parts, 0))
    const second = readZip(partAt(parts, 1))
    expect(first.has('project.json')).toBe(true)
    expect(second.has('project.json')).toBe(false)
    expect(first.has('set.json') && second.has('set.json')).toBe(true)
  })

  it('a project with no large files still downloads as one ZIP, unchanged', async () => {
    exportOverride = {
      format: 'ai-team-hq/project-package',
      format_version: 1,
      exported_at: '2026-10-14T08:00:00.000Z',
      project: {
        slug: 'small',
        name: 'Small',
        brief: 'A brief long enough to read as a real brief here.',
      },
      documents: [{ title: 'Note' }],
      tasks: [],
    }
    const res = await get(`${jwt}s1`, '')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
  })

  it('a single-archive download of a project too large for one archive says so, and offers the set', async () => {
    projectWithLargeFiles()
    // Force the single path with a package whose originals total more than one archive holds.
    bucket.set('src/huge.bin', {
      bytes: new Uint8Array(9 * MB).fill(4),
      mime: 'application/octet-stream',
    })
    exportOverride = {
      documents: [
        {
          title: 'Huge',
          original: {
            mime_type: 'application/octet-stream',
            bytes: 9 * MB,
            storage_path: 'src/huge.bin',
          },
        },
      ],
      project: {
        slug: 'huge',
        name: 'Huge',
        brief: 'A brief long enough to read as a real brief here.',
      },
      tasks: [],
    }
    const res = await get(`${jwt}s2`, '')
    expect(res.status).toBe(413)
    const body = (await res.json()) as { use_set: boolean }
    expect(body.use_set).toBe(true)
  })

  it('starting an export sweeps a cache older than a day, and keeps a fresh one', async () => {
    projectWithLargeFiles()
    const stale = `exports/${OFFICE}/stale-cache/set.json`
    const fresh = `exports/${OFFICE}/fresh-cache/set.json`
    bucket.set(stale, { bytes: new Uint8Array([1]), mime: 'application/json' })
    createdAt.set(stale, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
    bucket.set(fresh, { bytes: new Uint8Array([2]), mime: 'application/json' })
    createdAt.set(fresh, new Date().toISOString())
    const res = await get(`${jwt}sw1`, 'set=index')
    expect(res.status).toBe(200)
    expect(bucket.has(stale)).toBe(false)
    expect(bucket.has(fresh)).toBe(true)
  })

  it('a part cannot be read through another office: its export is held under the office that made it', async () => {
    projectWithLargeFiles()
    const { setKey, cache } = await exportSet()
    const other = await handler(
      new Request(
        `https://gw.test/?section=project_archive&id=${PROJECT}&set=${setKey}&cache=${cache}&part=1`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${MACHINE_KEY}` },
        },
      ),
    )
    expect(other.status).toBe(404)
  })

  it('refuses an original larger than one part before reading anything, and names it', async () => {
    exportOverride = {
      documents: [
        {
          title: 'The deck',
          original: {
            mime_type: 'application/pdf',
            bytes: SET_LIMITS.fileBytesPerPart + 1,
            storage_path: 'src/x.pdf',
          },
        },
      ],
      project: { slug: 's', name: 's', brief: 'A brief long enough to read as a real brief here.' },
      tasks: [],
    }
    const res = await get(`${jwt}s3`, 'set=index')
    expect(res.status).toBe(413)
    expect(((await res.json()) as { error: string }).error).toContain(
      '"The deck" is larger than one part',
    )
  })
})

describe('restoring a project set through the gateway: each part, one commit, and rollback', () => {
  it('restores every original under this office and this set, and creates the project once', async () => {
    projectWithLargeFiles()
    const { setKey, parts } = await exportSet()
    // A fresh destination: the source files are gone, and the restore must write its own copies.
    bucket.clear()
    const one = await restorePart(`${jwt}r1`, setKey, 1, partAt(parts, 0))
    const two = await restorePart(`${jwt}r2`, setKey, 2, partAt(parts, 1))
    expect(one.status).toBe(201)
    expect(two.status).toBe(201)
    const commit = await restoreAction(`${jwt}r3`, setKey, 'commit')
    expect(commit.status).toBe(201)
    const calls = rpc.filter((c) => c.fn === 'project_restore')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body.p_key).toBe(setKey)
    const pkg = calls[0]?.body.p_package as {
      documents: { original?: { storage_path?: string; sha256?: string } }[]
    }
    for (const doc of pkg.documents) {
      const path = doc.original?.storage_path ?? ''
      expect(path.startsWith(`restores/${OFFICE}/${setKey}/`)).toBe(true)
      expect(bucket.get(path)).toBeDefined()
      // The stored name carries the file's own checksum: the bytes written are the bytes the index named.
      expect(path).toContain(`/${await sha256Hex(bucket.get(path)?.bytes ?? new Uint8Array())}.`)
    }
  })

  it('refuses the commit until part 2 has been received, and names it', async () => {
    projectWithLargeFiles()
    const { setKey, parts } = await exportSet()
    await restorePart(`${jwt}q1`, setKey, 1, partAt(parts, 0))
    const early = await restoreAction(`${jwt}q2`, setKey, 'commit')
    expect(early.status).toBe(409)
    expect(((await early.json()) as { error: string }).error).toBe(
      'part 2 of 2 has not been received',
    )
    expect(rpc.filter((c) => c.fn === 'project_restore')).toHaveLength(0)
  })

  it('refuses a corrupted part with nothing written from it, and leaves the good part to be abandoned', async () => {
    projectWithLargeFiles()
    const { setKey, parts } = await exportSet()
    bucket.clear()
    await restorePart(`${jwt}c1`, setKey, 1, partAt(parts, 0))
    const bad = partAt(parts, 1).slice()
    bad[Math.floor(bad.length / 2)] = (bad[Math.floor(bad.length / 2)] ?? 0) ^ 0xff
    const refused = await restorePart(`${jwt}c2`, setKey, 2, bad)
    expect(refused.status).toBe(400)
    // Part 1 was recorded; part 2 left no record, and no original of its own.
    expect(bucket.has(`restores/${OFFICE}/${setKey}/_parts/1.json`)).toBe(true)
    expect(bucket.has(`restores/${OFFICE}/${setKey}/_parts/2.json`)).toBe(false)
    const abandoned = await restoreAction(`${jwt}c3`, setKey, 'abandon')
    expect(abandoned.status).toBe(200)
    expect(((await abandoned.json()) as { data: { removed: number } }).data.removed).toBe(1)
    expect([...bucket.keys()].filter((k) => k.startsWith(`restores/${OFFICE}/${setKey}/`))).toEqual(
      [],
    )
  })

  it('a database refusal at the commit removes every original the set wrote', async () => {
    projectWithLargeFiles()
    const { setKey, parts } = await exportSet()
    bucket.clear()
    await restorePart(`${jwt}d1`, setKey, 1, partAt(parts, 0))
    await restorePart(`${jwt}d2`, setKey, 2, partAt(parts, 1))
    restoreReply = { ok: false, error: 'a project with that name already exists' }
    const refused = await restoreAction(`${jwt}d3`, setKey, 'commit')
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: string }).error).toBe(
      'a project with that name already exists',
    )
    // No original is left. The set's index and package stay, so the parts can be sent again; the markers are gone with the files.
    const originals = [...bucket.keys()].filter(
      (k) => k.startsWith(`restores/${OFFICE}/${setKey}/`) && !k.includes('/_'),
    )
    expect(originals).toEqual([])
    expect(bucket.has(`restores/${OFFICE}/${setKey}/_parts/1.json`)).toBe(false)
  })

  it('refuses a part whose body is larger than one archive, before reading it', async () => {
    const res = await handler(
      new Request(`https://gw.test/?section=project_restore&set=${'a'.repeat(64)}&part=1`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${jwt}big`,
          'content-type': 'application/zip',
          'content-length': String(9 * MB),
        },
        body: new Uint8Array(0) as unknown as NonNullable<RequestInit['body']>,
      }),
    )
    expect(res.status).toBe(413)
  })

  it('the machine key cannot restore a set: a restore has to be attributed to a person', async () => {
    const res = await restorePart(MACHINE_KEY, 'a'.repeat(64), 1, new Uint8Array(10))
    expect(res.status).toBe(403)
    expect(rpc.filter((c) => c.fn === 'project_restore')).toHaveLength(0)
  })
})

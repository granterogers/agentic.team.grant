/**
 * Getting a style's logo to the renderer (src/artifacts/logo.ts), and the style snapshot a report keeps (style.ts,
 * versions.ts). No network: the fetcher is injected and the database is a stub that records what it was asked.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadLogo, storageFetcher } from '../../src/artifacts/logo.ts'
import { styleSnapshot } from '../../src/artifacts/style.ts'
import { recordProvenance } from '../../src/artifacts/versions.ts'

const ID = '11111111-2222-3333-4444-555555555555'
const png = new Uint8Array(readFileSync('tests/artifacts/fixtures/logo-rgba.png'))
const db = (rows: Record<string, unknown>[]) => {
  const seen: string[] = []
  return {
    execute: async (sql: string) => {
      seen.push(sql)
      return { rows }
    },
    seen,
  }
}
const row = { byte_size: 3000, mime_type: 'image/png', storage_path: 'p/logo.png' }

describe('loadLogo fails open, with a sentence', () => {
  it('returns the image for a document the office holds, asking the fetcher for its own path', async () => {
    const asked: string[] = []
    const d = db([row])
    const r = await loadLogo(d as never, { office: ID }, { logo_document_id: ID }, async (p) => {
      asked.push(p)
      return png
    })
    expect(r.logo?.width).toBe(240)
    expect(r.logoProblem).toBeUndefined()
    expect(asked).toEqual(['p/logo.png'])
    expect(d.seen[0]).toContain(`office_id = '${ID}'`) // scoped to the office, never just the id
  })
  it('a style with no logo asks for nothing', async () => {
    const r = await loadLogo(db([]) as never, { office: ID }, { tone: 'x' }, async () => {
      throw new Error('must not be called')
    })
    expect(r).toEqual({ logo: null })
  })
  it.each([
    ['a document that is gone', [], png, /not held by this office/],
    ['a document with no file', [{ ...row, storage_path: '' }], png, /no file/],
    [
      'a file over the limit, without fetching it',
      [{ ...row, byte_size: 9_000_000 }],
      png,
      /over the/,
    ],
    ['storage that cannot give it', [row], null, /could not be fetched/],
    ['bytes that are not an image', [row], new TextEncoder().encode('hello'), /PNG and JPEG/],
  ])('%s: no logo and the reason', async (_n, rows, bytes, why) => {
    const r = await loadLogo(
      db(rows) as never,
      { office: ID },
      { logo_document_id: ID },
      async () => bytes,
    )
    expect(r.logo).toBeNull()
    expect(r.logoProblem).toMatch(why)
  })
  it('a throwing fetcher or database never throws', async () => {
    const r = await loadLogo(
      db([row]) as never,
      { office: ID },
      { logo_document_id: ID },
      async () => {
        throw new Error('socket hang up')
      },
    )
    expect(r.logoProblem).toMatch(/socket hang up/)
    const bad = await loadLogo(
      {
        execute: async () => {
          throw new Error('db down')
        },
      } as never,
      { office: ID },
      { logo_document_id: ID },
      async () => png,
    )
    expect(bad.logoProblem).toMatch(/db down/)
  })
  it('a non-uuid reference is refused before any query', async () => {
    const d = db([row])
    const r = await loadLogo(
      d as never,
      { office: ID },
      { logo_document_id: "x'; drop table y; --" },
      async () => png,
    )
    expect(r.logoProblem).toMatch(/not a document id/)
    expect(d.seen).toEqual([])
  })
})

describe('storageFetcher', () => {
  it('signs a short link then fetches the bytes, and refuses a declared-oversize body', async () => {
    const urls: string[] = []
    const impl = (async (u: string | URL, init?: { method?: string }) => {
      urls.push(`${init?.method ?? 'GET'} ${String(u)}`)
      if (init?.method === 'POST')
        return new Response(JSON.stringify({ signedURL: '/object/sign/files/p/logo.png?token=t' }))
      return new Response(png, { headers: { 'content-length': String(png.length) } })
    }) as typeof fetch
    expect((await storageFetcher('ref', 'key', impl)('p/logo.png'))?.length).toBe(png.length)
    expect(urls[0]).toContain(
      'POST https://ref.supabase.co/storage/v1/object/sign/files/p/logo.png',
    )
    const big = (async (_u: string | URL, init?: { method?: string }) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ signedURL: '/x?token=t' }))
        : new Response('x', { headers: { 'content-length': '99999999' } })) as typeof fetch
    expect(await storageFetcher('ref', 'key', big)('p/logo.png')).toBeNull()
    expect(await storageFetcher('ref', '', impl)('p/logo.png')).toBeNull()
  })
})

describe('the style snapshot a report keeps', () => {
  it('is the resolved profile with the design laid over formatting, and keeps what the renderer does not draw', () => {
    const snap = styleSnapshot(
      {
        palette: { primary: '#117755' },
        terminology: { a: 'b' },
        chart: { series_colors: ['#112233'] },
        formatting: { density: 'compact' },
      },
      { density: 'comfortable', titlePage: 'band' },
    )
    expect(snap).toEqual({
      chart: { series_colors: ['#112233'] },
      formatting: { density: 'comfortable', title_page: 'band' },
      palette: { primary: '#117755' },
      terminology: { a: 'b' },
    })
  })
  it('with no style at all it is just the design, never empty and never null', () => {
    expect(styleSnapshot(null, { density: 'compact', titlePage: 'standard' })).toEqual({
      formatting: { density: 'compact', title_page: 'standard' },
    })
  })
})

describe('recordProvenance passes the snapshot only when it has one', () => {
  const p = { design: {}, jobId: ID, sources: [], styleHash: 'default', styleUpdatedAt: null }
  it('asks the new argument when given a snapshot, the old arity when not (a database without 0970 still works)', async () => {
    const withSnap = db([{ r: { ok: true } }])
    await recordProvenance(
      withSnap as never,
      { documentId: ID, office: ID },
      { ...p, styleSnapshot: { tone: "it's" } },
    )
    expect(withSnap.seen[0]).toMatch(/p_style_snapshot => '\{"tone":"it''s"\}'::jsonb/)
    const without = db([{ r: { ok: true } }])
    await recordProvenance(without as never, { documentId: ID, office: ID }, p)
    expect(without.seen[0]).not.toContain('p_style_snapshot')
  })
})

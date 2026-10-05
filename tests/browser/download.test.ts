/** Safe downloads: an allow-list, a size cap, byte sniffing, and no private address on any hop. Injected fetch only. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_TYPES,
  DOWNLOAD_MAX_BYTES,
  downloadFile,
  looksLikeAFile,
  refusalFor,
} from '../../src/browser/download.ts'

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

const serve = (
  bytes: Uint8Array | string,
  type: string,
  extra: Record<string, string> = {},
): typeof fetch =>
  (async () =>
    new Response(bytes as never, {
      headers: { 'content-type': type, ...extra },
      status: 200,
    })) as unknown as typeof fetch

describe('refusalFor (before a byte is read)', () => {
  it('lets a document type through and names why it refuses the rest', () => {
    expect(refusalFor('application/pdf', 1000)).toBeNull()
    expect(refusalFor('text/csv; charset=utf-8', 10)).toBeNull()
    for (const t of [
      'text/html',
      'image/svg+xml',
      'application/zip',
      'application/x-msdownload',
      'application/octet-stream',
      'application/javascript',
      'application/vnd.ms-excel.sheet.macroEnabled.12',
      'video/mp4',
    ]) {
      expect(refusalFor(t, 100), t).toMatch(/not a type the office keeps/)
    }
    expect(refusalFor('', 100)).toMatch(/did not say/)
  })
  it('enforces the size cap and refuses an empty file', () => {
    expect(refusalFor('application/pdf', DOWNLOAD_MAX_BYTES)).toBeNull()
    expect(refusalFor('application/pdf', DOWNLOAD_MAX_BYTES + 1)).toMatch(/cap/)
    expect(refusalFor('application/pdf', 0)).toMatch(/empty/)
  })
})

describe('downloadFile', () => {
  it('keeps a PDF whose bytes are a PDF, and names it from the type, never from the url', async () => {
    const out = await downloadFile('https://example.org/report?id=../../etc/passwd', {
      fetchImpl: serve(PDF, 'application/pdf'),
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.ext).toBe('pdf')
      expect(out.mime).toBe('application/pdf')
      expect(out.bytes.byteLength).toBe(PDF.byteLength)
    }
  })

  it('refuses bytes that are not what the server called them', async () => {
    const lie = await downloadFile('https://example.org/a.pdf', {
      fetchImpl: serve('<html><script>steal()</script></html>', 'application/pdf'),
    })
    expect(lie.ok).toBe(false)
    if (!lie.ok) expect(lie.detail).toMatch(/not application\/pdf/)
    // text/plain that is really a page is refused too
    const page = await downloadFile('https://example.org/a.txt', {
      fetchImpl: serve('<!DOCTYPE html><html><body>hi</body></html>', 'text/plain'),
    })
    expect(page.ok).toBe(false)
    // control: honest plain text passes
    const ok = await downloadFile('https://example.org/a.txt', {
      fetchImpl: serve('just some words', 'text/plain'),
    })
    expect(ok.ok).toBe(true)
  })

  it('refuses a type that is not allowed without ever taking a reader on the body', async () => {
    // A stream's pull may run eagerly under a queue strategy, so "was read" is judged by whether a reader was taken.
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1]))
        c.close()
      },
    })
    const out = await downloadFile('https://example.org/x.zip', {
      fetchImpl: (async () =>
        new Response(body, {
          headers: { 'content-type': 'application/zip' },
        })) as unknown as typeof fetch,
    })
    expect(out.ok).toBe(false)
    expect(body.locked).toBe(false)
  })

  it('stops at the cap whether or not the server told the truth about the length', async () => {
    const big = new Uint8Array(DOWNLOAD_MAX_BYTES + 10)
    big.set([0x25, 0x50, 0x44, 0x46])
    const liar = await downloadFile('https://example.org/big.pdf', {
      fetchImpl: serve(big, 'application/pdf', { 'content-length': '100' }),
    })
    expect(liar.ok).toBe(false)
    if (!liar.ok) expect(liar.detail).toMatch(/cap/)
    const honest = await downloadFile('https://example.org/big.pdf', {
      fetchImpl: serve(big, 'application/pdf', { 'content-length': String(big.byteLength) }),
    })
    expect(honest.ok).toBe(false)
  })

  it('never sends a cookie and only ever GETs', async () => {
    const seen: RequestInit[] = []
    await downloadFile('https://example.org/a.png', {
      fetchImpl: (async (_u: string, init?: RequestInit) => {
        seen.push(init ?? {})
        return new Response(PNG, { headers: { 'content-type': 'image/png' } })
      }) as unknown as typeof fetch,
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method ?? 'GET').toBe('GET')
    expect(seen[0]?.body).toBeUndefined()
    expect(JSON.stringify(seen[0]?.headers).toLowerCase()).not.toContain('cookie')
  })

  it('judges every hop of a redirect chain, so a public address cannot bounce to a private one', async () => {
    const reached: string[] = []
    const out = await downloadFile('https://example.org/go', {
      fetchImpl: (async (u: string) => {
        reached.push(u)
        return u.startsWith('https://example.org')
          ? new Response(null, {
              headers: { location: 'http://169.254.169.254/latest/meta-data/' },
              status: 302,
            })
          : new Response(PDF, { headers: { 'content-type': 'application/pdf' } })
      }) as unknown as typeof fetch,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.detail).toMatch(/private network/)
    expect(reached).toEqual(['https://example.org/go'])
  })

  it('refuses non-web schemes, an unparseable address, an http error and a thrown fetch', async () => {
    expect((await downloadFile('file:///etc/passwd')).ok).toBe(false)
    expect((await downloadFile('not a url')).ok).toBe(false)
    expect(
      (await downloadFile('https://example.org/x', { fetchImpl: serve('', 'text/plain') })).ok,
    ).toBe(false)
    const notFound = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch
    expect((await downloadFile('https://example.org/x', { fetchImpl: notFound })).ok).toBe(false)
  })
})

describe('the two allow-lists agree', () => {
  /*
    TS refuses first; app.web_file_refusal (migration 0930) is the writer's own check. A property, not a wording: every type
    TS allows must appear in the SQL list, and the SQL list must hold nothing TS does not.
  */
  const sql = readFileSync(
    'migrations/0930_a_page_the_office_read_says_where_it_came_from.sql',
    'utf8',
  )
  const fn = sql.slice(
    sql.indexOf('function app.web_file_refusal'),
    sql.indexOf('function app.record_web_file'),
  )
  const listed = [...fn.matchAll(/'((?:application|text|image)\/[a-z0-9.+-]+)'/g)].map(
    (m) => m[1] as string,
  )
  it('found the list (a scan that finds nothing proves nothing)', () => {
    expect(listed.length).toBeGreaterThan(8)
  })
  it('is the same set', () => {
    expect([...new Set(listed)].sort()).toEqual(Object.keys(ALLOWED_TYPES).sort())
  })
})

describe('looksLikeAFile', () => {
  it('tells a file from a page by its path', () => {
    expect(looksLikeAFile('https://example.org/q3.pdf')).toBe(true)
    expect(looksLikeAFile('https://example.org/q3')).toBe(false)
    expect(looksLikeAFile('https://example.org/a.pdf.html')).toBe(false)
  })
})

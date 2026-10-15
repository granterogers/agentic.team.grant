/**
 * The object store contract (#469, B2). The same cases run against every implementation, so a second provider cannot
 * quietly behave differently from the first. The Supabase implementation is driven through a fake fetch that records what
 * it was asked to do, so the test sees the request and not just the answer.
 */
import { describe, expect, it } from 'vitest'
import {
  assertSafePath,
  memoryObjectStore,
  type ObjectStore,
  supabaseObjectStore,
  UnsafePathError,
} from '../../src/files/object-store.ts'

const BYTES = new TextEncoder().encode('a budget line')

/** A fake Supabase Storage that keeps objects, answers like the real endpoints, and records each request. */
function fakeSupabase() {
  const objects = new Map<string, Uint8Array>()
  const calls: { method: string; url: string }[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url })
    const at = url.indexOf('/object/')
    const rest = url.slice(at + '/object/'.length)
    if (method === 'POST' && rest.startsWith('sign/')) {
      const path = rest.slice('sign/files/'.length)
      if (!objects.has(path)) return new Response('not found', { status: 404 })
      return new Response(JSON.stringify({ signedURL: `/object/sign/files/${path}?token=t` }), {
        status: 200,
      })
    }
    if (method === 'POST') {
      const path = rest.slice('files/'.length)
      objects.set(path, new Uint8Array(init?.body as Uint8Array))
      return new Response('{}', { status: 200 })
    }
    if (method === 'DELETE') {
      const path = decodeURI(rest.slice('files/'.length))
      const existed = objects.delete(path)
      return new Response('{}', { status: existed ? 200 : 404 })
    }
    if (method === 'GET') {
      const path = decodeURI(rest.slice('files/'.length))
      const bytes = objects.get(path)
      if (!bytes) return new Response('not found', { status: 404 })
      return new Response(bytes, { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return new Response('unexpected', { status: 500 })
  }) as typeof fetch
  return { fetchImpl, objects, calls }
}

const implementations: [string, () => ObjectStore][] = [
  ['memory', () => memoryObjectStore(() => 1_000_000)],
  [
    'supabase (fake endpoint)',
    () => supabaseObjectStore('projref', 'service-key', 'files', fakeSupabase().fetchImpl),
  ],
]

describe.each(implementations)('the object store contract: %s', (_name, make) => {
  it('stores bytes and reports the size', async () => {
    const store = make()
    const stored = await store.put('p1/drive/doc.txt', BYTES, 'text/plain')
    expect(stored).toEqual({
      ok: true,
      path: 'p1/drive/doc.txt',
      bytes: BYTES.byteLength,
      error: null,
    })
  })

  it('refuses a zero-length object, and says why', async () => {
    const store = make()
    const stored = await store.put('p1/drive/empty.txt', new Uint8Array(0), 'text/plain')
    expect(stored.ok).toBe(false)
    expect(stored.error).toContain('empty')
  })

  it('replaces an object written to the same path', async () => {
    const store = make()
    await store.put('p1/drive/doc.txt', BYTES, 'text/plain')
    const second = await store.put(
      'p1/drive/doc.txt',
      new TextEncoder().encode('revised'),
      'text/plain',
    )
    expect(second.ok).toBe(true)
  })

  it('reads back the bytes it stored, and reports a missing object as absent', async () => {
    const store = make()
    await store.put('p1/drive/doc.txt', BYTES, 'text/plain')
    const back = await store.read('p1/drive/doc.txt')
    expect(back?.bytes).toEqual(BYTES)
    expect(back?.mime).toBe('text/plain')
    expect(await store.read('p1/drive/none.txt')).toBeNull()
  })

  it('gives no link for an object that is not there', async () => {
    const store = make()
    expect(await store.link('p1/drive/missing.txt', 600)).toBeNull()
  })

  it('gives a link for an object that is there', async () => {
    const store = make()
    await store.put('p1/drive/doc.txt', BYTES, 'text/plain')
    expect(await store.link('p1/drive/doc.txt', 600)).toEqual(expect.any(String))
  })

  it('counts a removed object as gone, and a missing one as gone too', async () => {
    const store = make()
    await store.put('p1/drive/doc.txt', BYTES, 'text/plain')
    expect(await store.remove('p1/drive/doc.txt')).toBe(true)
    expect(await store.remove('p1/drive/doc.txt')).toBe(true)
  })

  it('refuses a path that would reach outside its prefix, before any provider sees it', async () => {
    const store = make()
    for (const path of [
      '../other/doc.txt',
      'p1/../../doc.txt',
      '/abs.txt',
      'p1\\doc.txt',
      'p1//doc.txt',
      'p1/./doc.txt',
    ]) {
      await expect(store.put(path, BYTES, 'text/plain'), path).rejects.toBeInstanceOf(
        UnsafePathError,
      )
    }
  })
})

describe('assertSafePath', () => {
  it('accepts an ordinary nested path', () => {
    expect(() => assertSafePath('p1/drive/file-id.pdf')).not.toThrow()
  })

  it('names the reason for each refusal', () => {
    const reason = (path: string) => {
      try {
        assertSafePath(path)
        return 'accepted'
      } catch (error) {
        return error instanceof UnsafePathError ? error.reason : 'other'
      }
    }
    expect(reason('')).toBe('empty')
    expect(reason('/x')).toBe('absolute')
    expect(reason('a\\b')).toBe('backslash')
    expect(reason('a\u0000b')).toBe('control character')
    expect(reason('a/../b')).toBe('dot segment')
    expect(reason('a//b')).toBe('empty segment')
  })
})

describe('the Supabase implementation sends what the existing functions send', () => {
  it('uses the files bucket and the service key for a put, a link and a remove', async () => {
    const fake = fakeSupabase()
    const store = supabaseObjectStore('projref', 'service-key', 'files', fake.fetchImpl)
    await store.put('p1/drive/doc.txt', BYTES, 'text/plain')
    await store.link('p1/drive/doc.txt', 600)
    await store.remove('p1/drive/doc.txt')
    expect(fake.calls.map((c) => c.method)).toEqual(['POST', 'POST', 'DELETE'])
    expect(fake.calls[0]?.url).toBe(
      'https://projref.supabase.co/storage/v1/object/files/p1/drive/doc.txt',
    )
    expect(fake.calls[1]?.url).toBe(
      'https://projref.supabase.co/storage/v1/object/sign/files/p1/drive/doc.txt',
    )
  })

  it('does not link a bucket other than files, because signing is done for files only', async () => {
    const fake = fakeSupabase()
    const store = supabaseObjectStore('projref', 'service-key', 'screenshots', fake.fetchImpl)
    expect(await store.link('p1/drive/doc.txt', 600)).toBeNull()
    expect(fake.calls).toHaveLength(0)
  })
})

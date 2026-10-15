/**
 * One interface for where a document's bytes live, so the office can move them (#469, B2).
 *
 * store.ts is the Supabase Storage implementation and every caller uses its functions directly. This module names the
 * operations those callers need (put, link, remove) so a second provider can be built and tested beside it without any
 * caller changing. It does not choose a provider, read a credential or contact anything: the Supabase implementation takes
 * the same arguments `store.ts` already takes, and the in-memory one is for tests and local runs.
 *
 * The contract every implementation must keep, and which tests/files/object-store.test.ts runs against each one:
 *   - a zero-length object is refused, because a document row cannot point at nothing (0205);
 *   - a path is relative, has no empty, dot or dot-dot segment and no backslash or control character, so a path a caller
 *     builds from a remote id cannot reach outside its own prefix;
 *   - a put to an existing path replaces it (a retried read lands on the same object);
 *   - a remove of a missing object counts as gone;
 *   - a link is short-lived, and null when the object is not there.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */

import { BUCKET, putFile, removeFrom, type Stored, signedUrl } from './store.ts'

export interface ObjectStore {
  /** A short name for the provider, for messages and reports. Never a credential. */
  readonly kind: string
  put(path: string, bytes: Uint8Array, mime: string): Promise<Stored>
  /** The bytes and content type of an object, or null when there is no such object. Used to verify a copy. */
  read(path: string): Promise<{ bytes: Uint8Array; mime: string } | null>
  /** A link a browser can follow for `seconds`, or null when there is no such object. */
  link(path: string, seconds: number): Promise<string | null>
  /** True when the object is gone afterwards, whether or not it existed before. */
  remove(path: string): Promise<boolean>
}

/** Why a path was refused. Named so a test can assert the reason rather than any message. */
export class UnsafePathError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`refused object path (${reason})`)
    this.name = 'UnsafePathError'
  }
}

/**
 * Check a path before any provider sees it. Throws rather than returning, so a caller that forgets to check cannot store
 * under a path that escapes its prefix.
 */
export function assertSafePath(path: string): void {
  if (path === '') throw new UnsafePathError(path, 'empty')
  if (path.startsWith('/')) throw new UnsafePathError(path, 'absolute')
  if (path.includes('\\')) throw new UnsafePathError(path, 'backslash')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: a control character in a path is the thing being refused
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new UnsafePathError(path, 'control character')
  for (const segment of path.split('/')) {
    if (segment === '') throw new UnsafePathError(path, 'empty segment')
    if (segment === '.' || segment === '..') throw new UnsafePathError(path, 'dot segment')
  }
}

/** The Supabase Storage implementation: the functions in store.ts, behind the interface. */
export function supabaseObjectStore(
  projectRef: string,
  serviceKey: string,
  bucket: string = BUCKET,
  fetchImpl: typeof fetch = fetch,
): ObjectStore {
  return {
    kind: 'supabase-storage',
    async put(path, bytes, mime) {
      assertSafePath(path)
      return await putFile(projectRef, serviceKey, path, bytes, mime, fetchImpl)
    },
    async read(path) {
      assertSafePath(path)
      if (serviceKey === '') return null
      const r = await fetchImpl(
        `https://${projectRef}.supabase.co/storage/v1/object/${bucket}/${encodeURI(path)}`,
        {
          headers: { Authorization: `Bearer ${serviceKey}` },
        },
      )
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`storage read failed with status ${String(r.status)}`)
      return {
        bytes: new Uint8Array(await r.arrayBuffer()),
        mime: r.headers.get('content-type') ?? 'application/octet-stream',
      }
    },
    async link(path, seconds) {
      assertSafePath(path)
      if (bucket !== BUCKET) return null
      return await signedUrl(projectRef, serviceKey, path, seconds, fetchImpl)
    },
    async remove(path) {
      assertSafePath(path)
      return await removeFrom(bucket, projectRef, serviceKey, path, fetchImpl)
    },
  }
}

/**
 * A store held in memory. For tests and for a local run with no provider configured. Its link is a memory address that
 * only this process can resolve, so it cannot be mistaken for a real signed link.
 */
export function memoryObjectStore(now: () => number = Date.now): ObjectStore {
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>()
  return {
    kind: 'memory',
    async put(path, bytes, mime) {
      assertSafePath(path)
      if (bytes.byteLength === 0) {
        return { ok: false, path, bytes: 0, error: 'nothing to store — the file was empty' }
      }
      objects.set(path, { bytes: new Uint8Array(bytes), mime })
      return { ok: true, path, bytes: bytes.byteLength, error: null }
    },
    async read(path) {
      assertSafePath(path)
      const found = objects.get(path)
      if (!found) return null
      return { bytes: new Uint8Array(found.bytes), mime: found.mime }
    },
    async link(path, seconds) {
      assertSafePath(path)
      if (!objects.has(path)) return null
      return `memory://${encodeURI(path)}?expires=${String(now() + seconds * 1000)}`
    },
    async remove(path) {
      assertSafePath(path)
      objects.delete(path)
      return true
    },
  }
}

/**
 * Putting bytes in the office's own storage, and getting a link back out.
 *
 * Issue #96. This was a private `store()` inside `src/handlers/collect.ts` and
 * a `fetch` written inline in the edge function — one writer, one reader, no
 * shared idea of where files live. A second writer (a PDF read out of Drive)
 * made that a problem rather than a tidiness complaint: two places deciding
 * the bucket, the upsert behaviour and the path convention is two places for
 * them to disagree, and a file written to the wrong path is a file the reader
 * cannot find.
 *
 * ## The bucket is private, and that is the whole design
 *
 * `files` (0205) is private with a 100 MiB limit. Nothing with a browser can
 * read it, which is why the storage path is useless to the page and why
 * `hq-api` swaps it for a short-lived signed URL and drops the path from the
 * response — the studio gets something it can follow and learns nothing about
 * how storage is laid out.
 *
 * Making the bucket public would be one line and would put every document
 * Grant has ever imported on the open internet at a guessable URL. It is
 * private on purpose.
 *
 * ## The service key never leaves the server
 *
 * Signing needs it, so signing happens in the edge function or in a script,
 * never in the page. Every function here takes the key as an argument rather
 * than reading it from anywhere, so a caller cannot accidentally acquire the
 * ability to sign by importing this module.
 */

/** Where a document's bytes live. Private, 100 MiB per object (0205). */
export const BUCKET = 'files'

const base = (projectRef: string): string => `https://${projectRef}.supabase.co/storage/v1`

/**
 * Where a file belongs, given the connector it came from.
 *
 * `<project uuid>/<connector>/<remote id>.<ext>` — the project first so a
 * project's files are one prefix and removing a project is one delete, the
 * connector second so two systems cannot collide on an id, and the REMOTE id
 * as the filename so a re-read of the same file lands on the same object
 * rather than accumulating copies in a 1 GB allowance.
 *
 * Deliberately not the document's own uuid: the same Drive file re-read after
 * a document row was deleted and recreated should still be one object.
 *
 * Every segment is scrubbed. A Drive file id is safe, but this takes ids from
 * whatever connector calls it, and a `..` reaching the storage API is a
 * traversal.
 */
export function filePath(
  projectId: string,
  connector: string,
  remoteId: string,
  extension: string,
): string {
  const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '')
  const ext = extension.replace(/^\.+/, '').toLowerCase()
  return `${safe(projectId)}/${safe(connector)}/${safe(remoteId)}${ext === '' ? '' : `.${ext}`}`
}

/** The usual extension for a mime type, for `filePath`. Coarse on purpose. */
export function extensionFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'text/plain') return 'txt'
  if (mime === 'text/markdown') return 'md'
  if (mime === 'audio/mpeg') return 'mp3'
  if (mime.startsWith('image/')) return mime.slice('image/'.length).replace('jpeg', 'jpg')
  if (mime.includes('wordprocessingml')) return 'docx'
  if (mime.includes('spreadsheetml')) return 'xlsx'
  if (mime.includes('presentationml')) return 'pptx'
  return 'bin'
}

export interface Stored {
  readonly ok: boolean
  /** The path inside the bucket. Meaningful even on failure, for the message. */
  readonly path: string
  readonly bytes: number
  readonly error: string | null
}

/**
 * Write bytes to the bucket, replacing whatever was there.
 *
 * `x-upsert`, because a retried read of the same file must land on the same
 * object. Without it the second attempt fails with a duplicate and the caller
 * has to decide whether that is success — and it is, which is exactly the
 * decision not worth making twice.
 *
 * Reports the server's own words on failure. "Storing it failed" sends
 * somebody to read this file; `413 Payload too large` sends them to the 100
 * MiB limit, which is where the answer is.
 */
export async function putFile(
  projectRef: string,
  serviceKey: string,
  path: string,
  bytes: Uint8Array,
  mime: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Stored> {
  if (serviceKey === '') {
    return { ok: false, path, bytes: bytes.byteLength, error: 'no service key' }
  }
  if (bytes.byteLength === 0) {
    // The constraint on `documents` refuses a zero-length file, so storing one
    // would leave an object nothing can ever point at.
    return { ok: false, path, bytes: 0, error: 'nothing to store — the file was empty' }
  }
  const r = await fetchImpl(`${base(projectRef)}/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    // `as unknown as string` rather than BodyInit: this project's tsconfig has
    // no `dom` lib, so BodyInit is not a name here. Same cast collect.ts used.
    body: bytes as unknown as string,
  })
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 200)
    return {
      ok: false,
      path,
      bytes: bytes.byteLength,
      error: `storage ${String(r.status)}: ${detail}`,
    }
  }
  return { ok: true, path, bytes: bytes.byteLength, error: null }
}

/**
 * A link a browser can follow, for a little while.
 *
 * Ten minutes by default, matching what `hq-api` already mints. These URLs get
 * caught in build-step screenshots, and the page asks for a fresh one every
 * time a document is opened — so a longer life buys nothing and costs a leak
 * with a longer fuse.
 */
export async function signedUrl(
  projectRef: string,
  serviceKey: string,
  path: string,
  seconds = 600,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (serviceKey === '' || path === '') return null
  const r = await fetchImpl(`${base(projectRef)}/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: seconds }),
  })
  if (!r.ok) return null
  const body = (await r.json().catch(() => ({}))) as { signedURL?: string }
  return body.signedURL === undefined ? null : `${base(projectRef)}${body.signedURL}`
}

/**
 * Take an object out of a NAMED bucket (#21).
 *
 * `removeFile` below is this with `files` filled in, and it stays as the name
 * every caller already uses. The build diary's screenshots live in a different
 * bucket and needed deleting from a duty, and the alternative to a parameter
 * was a second copy of four lines that would eventually disagree with this one
 * about what a 404 means.
 *
 * A missing object counts as gone, in both. A retention pass that fails
 * because something was already deleted is a retention pass that stops.
 */
export async function removeFrom(
  bucket: string,
  projectRef: string,
  serviceKey: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (serviceKey === '' || path === '' || bucket === '') return false
  const r = await fetchImpl(`${base(projectRef)}/object/${bucket}/${encodeURI(path)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${serviceKey}` },
  })
  return r.ok || r.status === 404
}

/** Take an object away. Used by teardown; a missing object counts as gone. */
export async function removeFile(
  projectRef: string,
  serviceKey: string,
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  return await removeFrom(BUCKET, projectRef, serviceKey, path, fetchImpl)
}

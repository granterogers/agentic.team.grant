/**
 * The rules a stored file must pass, and the rule for who may read one (#469, B2).
 *
 * Pure: no provider, no network, no database. Each rule is checked by the caller before a byte is stored or a link is
 * issued, and tests/files/policy.test.ts proves each one refuses what it should and accepts what it should.
 *
 *   - Size: no object is stored above 100 MiB, the bucket limit recorded in migration 0205. An empty file is refused.
 *   - Type: any type is accepted. The owner decided this on 15 October 2026 ("people can upload whatever they want"). The
 *     declared type and the name are stored as the browser sent them, and nothing refuses a file by what it is. Opening a
 *     file from a signed link in a browser is a risk the owner has accepted; it is not something this module prevents.
 *   - Checksum: SHA-256 over the stored bytes, recorded with the object and checked on every read-back.
 *   - Link lifetime: a signed link lives between one minute and ten, and ten by default.
 *   - Read rule: an object is readable only by a person who is a member of its own office AND of its own project. Being in
 *     the office is not enough, because projects are the unit a person is given.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */

export const MAX_OBJECT_BYTES = 100 * 1024 * 1024
export const LINK_TTL_MIN_SECONDS = 60
export const LINK_TTL_MAX_SECONDS = 600

export type UploadVerdict = { ok: true } | { ok: false; reason: string }

/**
 * Check a file before it is stored. Returns the first reason it is refused, named, or ok. The only refusals are an empty file
 * and one above the object limit: the file is otherwise stored as it arrived, whatever its type or contents.
 */
export function checkUpload(file: {
  name: string
  mime: string
  bytes: Uint8Array
}): UploadVerdict {
  if (file.bytes.byteLength === 0) return { ok: false, reason: 'empty' }
  if (file.bytes.byteLength > MAX_OBJECT_BYTES) return { ok: false, reason: 'too large' }
  return { ok: true }
}

/** SHA-256 of the bytes, lower-case hex. Uses the platform's Web Crypto in both Deno and Node. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The lifetime of a signed link: clamped to the allowed range, and ten minutes when not asked for. */
export function linkTtlSeconds(requested: number | null | undefined): number {
  if (requested === undefined || requested === null || !Number.isFinite(requested))
    return LINK_TTL_MAX_SECONDS
  return Math.min(LINK_TTL_MAX_SECONDS, Math.max(LINK_TTL_MIN_SECONDS, Math.floor(requested)))
}

/**
 * May this person read this object? Both the office and the project must match. An object with no office or no project
 * is refused rather than shared, because a missing owner is the failure to prevent.
 */
export function canReadObject(
  object: { office: string | null; project: string | null },
  person: { office: string | null; projects: Iterable<string> },
): boolean {
  if (!object.office || !object.project || !person.office) return false
  if (object.office !== person.office) return false
  return new Set(person.projects).has(object.project)
}

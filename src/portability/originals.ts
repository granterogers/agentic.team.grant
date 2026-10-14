/**
 * The original files of a project's documents, carried through the archive (issue #471, migration 1072).
 *
 * A document the office holds as a file (a PDF, an image, a spreadsheet) has a stored file and a MIME type and a size.
 * The archive used to carry only its extracted text. This module moves the file itself, in both directions:
 *
 *   export  gatherOriginals: read each stored file, check its length, name it by its SHA-256 under files/, and record
 *           the checksum on the document. A file that cannot be read refuses the whole archive: a backup that quietly
 *           lacks a document is worse than none, because it looks complete.
 *   restore planOriginals: check every file the package names against the archive's own manifest and its SHA-256, and
 *           choose where it will live. The path is built here, under this office and this archive's key. A path the
 *           package names is never trusted.
 *           writeOriginals: write each file, read it back and compare, and remove what this run wrote if anything fails.
 *           A file already at its path with the same bytes is left alone, so a repeat restore never deletes data.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { type ArchiveFile, sha256Hex } from './archive.ts'

/** The part of the object store these functions use. Structurally the same as src/files/object-store.ts. */
export interface OriginalStore {
  read(path: string): Promise<{ bytes: Uint8Array; mime: string } | null>
  put(path: string, bytes: Uint8Array, mime: string): Promise<{ ok: boolean }>
  remove(path: string): Promise<boolean>
}

/** The usual extension for a MIME type. Passed in, so there is one definition (src/files/store.ts extensionFor). */
export type ExtensionFor = (mime: string) => string

type Doc = { title?: unknown; original?: unknown } & Record<string, unknown>
type Original = {
  mime_type?: unknown
  bytes?: unknown
  storage_path?: unknown
  sha256?: unknown
  archive_name?: unknown
} & Record<string, unknown>

function documentsOf(pkg: unknown): Doc[] {
  const docs = (pkg as { documents?: unknown } | null)?.documents
  return Array.isArray(docs) ? (docs as Doc[]) : []
}

/** The original of a document, or null when it has none (text only). */
function originalOf(doc: Doc): Original | null {
  const o = doc.original
  if (o === null || o === undefined || typeof o !== 'object') return null
  return o as Original
}

function titleOf(doc: Doc): string {
  return typeof doc.title === 'string' && doc.title !== '' ? doc.title : 'untitled'
}

/** A readable name for the file: its extension, from the MIME type. Only letters and digits, so it is safe in a path. */
function extensionOf(mime: string, extension: ExtensionFor): string {
  const ext = extension(mime)
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'
}

export type GatherResult =
  | { ok: true; pkg: unknown; files: ArchiveFile[] }
  | { ok: false; status: 409 | 413; error: string }

/**
 * Export: read every stored original the package names. Returns the package with each file's checksum and archive name
 * recorded on its document, and the files to carry beside it. Refuses if any file is missing or the wrong size, or if
 * the files together would not fit in one archive.
 */
export async function gatherOriginals(input: {
  pkg: unknown
  store: OriginalStore
  extension: ExtensionFor
  maxBytes: number
}): Promise<GatherResult> {
  /*
    THE CAP IS CHECKED BEFORE ANY FILE IS READ. Each original's size is recorded on its document row, so the total the
    archive would hold is known without loading anything. Checking after the reads (as this did until 14 October 2026)
    loaded every stored file into memory first and only then refused, so the memory a refusal cost was the project's
    size rather than the cap's. The sum is the naive total, which can only overstate what the archive would hold, so a
    project refused here is refused for a reason that is true.
  */
  let declared = 0
  for (const doc of documentsOf(input.pkg)) {
    const orig = originalOf(doc)
    if (orig === null) continue
    if (!Number.isInteger(orig.bytes) || (orig.bytes as number) < 0) {
      return {
        ok: false,
        status: 409,
        error: `the original of "${titleOf(doc)}" has no recorded size`,
      }
    }
    declared += orig.bytes as number
  }
  if (declared > input.maxBytes) {
    return {
      ok: false,
      status: 413,
      error: 'the original files of this project are larger than the 8 MB one archive can hold',
    }
  }
  const pkg = structuredClone(input.pkg)
  const files = new Map<string, ArchiveFile>()
  const missing: string[] = []
  let total = 0
  for (const doc of documentsOf(pkg)) {
    const orig = originalOf(doc)
    if (orig === null) continue
    const stored =
      typeof orig.storage_path === 'string' ? await input.store.read(orig.storage_path) : null
    if (stored === null || stored.bytes.length !== orig.bytes) {
      missing.push(titleOf(doc))
      continue
    }
    const sha = await sha256Hex(stored.bytes)
    const name = `files/${sha}.${extensionOf(String(orig.mime_type), input.extension)}`
    if (!files.has(name)) {
      files.set(name, { name, data: stored.bytes })
      total += stored.bytes.length
    }
    orig.sha256 = sha
    orig.archive_name = name
  }
  if (missing.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `the stored file for ${missing.map((t) => `"${t}"`).join(', ')} could not be read, so a complete archive cannot be made`,
    }
  }
  if (total > input.maxBytes) {
    return {
      ok: false,
      status: 413,
      error: 'the original files of this project are larger than the 8 MB one archive can hold',
    }
  }
  return { ok: true, pkg, files: [...files.values()] }
}

export interface RestoreWrite {
  readonly path: string
  readonly bytes: Uint8Array
  readonly mime: string
  readonly sha256: string
}

export type PlanResult =
  | { ok: true; pkg: unknown; writes: RestoreWrite[] }
  | { ok: false; reason: string }

/**
 * Restore, before anything is written: every document with an original must name a file the archive holds, of the size
 * and SHA-256 the document records. The stored path is built here, under this office and this archive's key, and it
 * replaces whatever the package said. The returned package carries only the three fields the database accepts.
 */
export async function planOriginals(input: {
  pkg: unknown
  files: ReadonlyMap<string, Uint8Array>
  key: string
  office: string
  extension: ExtensionFor
}): Promise<PlanResult> {
  const pkg = structuredClone(input.pkg) as { documents?: unknown }
  const writes = new Map<string, RestoreWrite>()
  for (const doc of documentsOf(pkg)) {
    const orig = originalOf(doc)
    if (orig === null) continue
    const title = titleOf(doc)
    if (typeof orig.mime_type !== 'string' || orig.mime_type === '') {
      return { ok: false, reason: `the original of "${title}" has no content type` }
    }
    if (!Number.isInteger(orig.bytes) || (orig.bytes as number) < 0) {
      return { ok: false, reason: `the original of "${title}" has no size` }
    }
    if (typeof orig.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(orig.sha256)) {
      return { ok: false, reason: `the original of "${title}" has no checksum` }
    }
    const name = typeof orig.archive_name === 'string' ? orig.archive_name : ''
    const data = input.files.get(name)
    if (data === undefined) {
      return { ok: false, reason: `the archive names a file for "${title}" that it does not hold` }
    }
    if (data.length !== orig.bytes) {
      return { ok: false, reason: `the file for "${title}" is not the size its document records` }
    }
    if ((await sha256Hex(data)) !== orig.sha256) {
      return { ok: false, reason: `the file for "${title}" does not match its recorded checksum` }
    }
    const path = `restores/${input.office}/${input.key}/${orig.sha256}.${extensionOf(orig.mime_type, input.extension)}`
    writes.set(path, { path, bytes: data, mime: orig.mime_type, sha256: orig.sha256 })
    doc.original = { mime_type: orig.mime_type, bytes: orig.bytes, storage_path: path }
  }
  return { ok: true, pkg, writes: [...writes.values()] }
}

export type WriteResult =
  | { ok: true; written: string[] }
  | { ok: false; reason: string; written: string[] }

/**
 * Write the planned files. Each is read back and compared with its checksum. A file already at its path with the same
 * bytes is skipped and is not counted as written, so discarding after a failed restore never removes it. On any failure
 * the files this run wrote are removed before the result is returned.
 */
export async function writeOriginals(input: {
  writes: readonly RestoreWrite[]
  store: OriginalStore
}): Promise<WriteResult> {
  const written: string[] = []
  const fail = async (reason: string): Promise<WriteResult> => {
    await discardOriginals({ store: input.store, written })
    return { ok: false, reason, written: [] }
  }
  for (const w of input.writes) {
    const existing = await input.store.read(w.path)
    if (existing !== null) {
      if ((await sha256Hex(existing.bytes)) === w.sha256) continue
      return fail('a different file is already at its restore path, so nothing was written')
    }
    // Recorded before the write: a put that fails part way may still have left the object, and a rollback must find it.
    written.push(w.path)
    let stored: { ok: boolean }
    try {
      stored = await input.store.put(w.path, w.bytes, w.mime)
    } catch {
      return fail('the file could not be written to storage')
    }
    // A provider reports a refused write as a result rather than a throw (the Supabase helper does).
    if (!stored.ok) return fail('the file could not be written to storage')
    const back = await input.store.read(w.path)
    if (back === null || (await sha256Hex(back.bytes)) !== w.sha256) {
      return fail('the file did not read back the same as it was written')
    }
  }
  return { ok: true, written }
}

/** Remove what a run wrote. Called when the restore fails after the files were written. */
export async function discardOriginals(input: {
  store: OriginalStore
  written: readonly string[]
}): Promise<void> {
  for (const path of input.written) {
    try {
      await input.store.remove(path)
    } catch {
      // A file that cannot be removed is reported by the caller's own error; the rest are still removed.
    }
  }
}

/**
 * A project too large for one archive is carried as a SET of parts (#471, item 5, the design in
 * docs/release/ARCHIVE-SIZE-DESIGN-2026-10-14.md). Pure: no storage, no database. The gateway supplies the bytes.
 *
 *   index   One JSON document, the set's identity. It names every stored original of the project, the part that carries
 *           each one, its SHA-256, size and content type, and the SHA-256 of the project's package. Its own SHA-256 is the
 *           set key. It is built once, by reading each original in turn and keeping only its checksum, so building it
 *           costs one file's memory at a time.
 *   part    An ordinary ZIP of at most 8 MB: the index (set.json), the part's number (part.json), the part's files, and,
 *           on part 1 only, the project's package (project.json). A part is built and read one at a time, so no request
 *           holds more than one part.
 *
 * Every limit is named here and asserted by tests: one file, one part, the number of parts, the whole set, and the package.
 * A refusal names what was too large. Plain words in this file's comments; no backticks, because the template check reads it.
 */
import { ARCHIVE_LIMITS, ArchiveError, buildZip, readZip, sha256Hex } from './archive.ts'

export const SET_FORMAT = 'agentic-team.archive-set'
export const SET_VERSION = 1
export const INDEX_FILE = 'set.json'
export const PART_FILE = 'part.json'
export const PACKAGE_IN_PART = 'project.json'

/** Bytes a part may hold, in total. The 8 MB the office takes for one archive. */
const PART_BYTES = ARCHIVE_LIMITS.maxBytes
/** Reserved in every part for the index, the part marker and the ZIP's own overhead. */
const OVERHEAD_BYTES = 512 * 1024
/** The largest package (the project's text, documents and tasks, without the files) a set may carry. */
const PACKAGE_BYTES = 2 * 1024 * 1024

export const SET_LIMITS = {
  /** File bytes one part can carry: the part, less the room the package and the overhead need. */
  fileBytesPerPart: PART_BYTES - OVERHEAD_BYTES - PACKAGE_BYTES,
  /** Parts one set may hold. Each part is one request, so this also bounds how many requests a restore makes. */
  maxParts: 32,
  /** The package a set may carry, read into memory whole. */
  packageBytes: PACKAGE_BYTES,
} as const

/** The whole set a project may be carried in: the parts at their file budget. Checked before any file is read. */
export const SET_MAX_FILE_BYTES = SET_LIMITS.fileBytesPerPart * SET_LIMITS.maxParts

export interface SetEntry {
  /** The document's position in the package's documents list. The commit uses it to put the original back. */
  readonly doc: number
  readonly sha256: string
  readonly bytes: number
  readonly mime: string
  /** `files/<sha256>.<ext>`, the name the file has inside its part. Two documents with one file share one name. */
  readonly archive_name: string
  /** The part that carries the file. */
  readonly part: number
}

export interface SetIndex {
  readonly format: typeof SET_FORMAT
  readonly version: typeof SET_VERSION
  readonly slug: string
  readonly package_sha256: string
  readonly part_count: number
  readonly entries: readonly SetEntry[]
}

export type PlanResult =
  | { ok: true; parts: number[][] }
  | { ok: false; status: 413; reason: string }

/**
 * Group the files into parts, in order, first-fit. A file larger than one part's budget is refused by name, and so is a set
 * that would need more parts than the limit or hold more bytes than the set limit. Sizes are the recorded sizes, so a refusal
 * happens before any file is read.
 */
export function planParts(files: readonly { title: string; bytes: number }[]): PlanResult {
  let total = 0
  for (const f of files) {
    if (f.bytes > SET_LIMITS.fileBytesPerPart) {
      return {
        ok: false,
        status: 413,
        reason: `the original of "${f.title}" is larger than one part can carry (${String(Math.round((SET_LIMITS.fileBytesPerPart / 1024 / 1024) * 10) / 10)} MB), so this project cannot be backed up as a set yet`,
      }
    }
    total += f.bytes
  }
  if (total > SET_MAX_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      reason: `the original files of this project are larger than the ${String(Math.round(SET_MAX_FILE_BYTES / 1024 / 1024))} MB a set can hold`,
    }
  }
  const parts: number[][] = []
  let current: number[] = []
  let used = 0
  files.forEach((f, i) => {
    if (current.length > 0 && used + f.bytes > SET_LIMITS.fileBytesPerPart) {
      parts.push(current)
      current = []
      used = 0
    }
    current.push(i)
    used += f.bytes
  })
  if (current.length > 0) parts.push(current)
  if (parts.length > SET_LIMITS.maxParts) {
    return {
      ok: false,
      status: 413,
      reason: `this project would need ${String(parts.length)} parts, and a set holds at most ${String(SET_LIMITS.maxParts)}`,
    }
  }
  return { ok: true, parts }
}

/** The index as the bytes that are hashed and stored. Built in one fixed key order, so one index has one set of bytes. */
export function indexBytes(index: SetIndex): Uint8Array {
  const canonical = {
    format: index.format,
    version: index.version,
    slug: index.slug,
    package_sha256: index.package_sha256,
    part_count: index.part_count,
    entries: index.entries.map((e) => ({
      doc: e.doc,
      sha256: e.sha256,
      bytes: e.bytes,
      mime: e.mime,
      archive_name: e.archive_name,
      part: e.part,
    })),
  }
  return new TextEncoder().encode(JSON.stringify(canonical))
}

/** The set key: the SHA-256 of the index bytes. A restore is idempotent on it, as a single archive is on its own. */
export const setKeyOf = (bytes: Uint8Array): Promise<string> => sha256Hex(bytes)

/** One part as a ZIP. Part 1 alone carries the package. */
export function buildPart(input: {
  index: Uint8Array
  number: number
  files: readonly { name: string; data: Uint8Array }[]
  pkg: Uint8Array | null
  exportedAt: string
}): Uint8Array {
  if (input.number === 1 && input.pkg === null) {
    throw new ArchiveError('part 1 carries the project package, and none was given')
  }
  if (input.number !== 1 && input.pkg !== null) {
    throw new ArchiveError('only part 1 carries the project package')
  }
  const entries = [
    { name: INDEX_FILE, data: input.index },
    { name: PART_FILE, data: new TextEncoder().encode(JSON.stringify({ number: input.number })) },
    ...(input.pkg === null ? [] : [{ name: PACKAGE_IN_PART, data: input.pkg }]),
    ...input.files,
  ]
  return buildZip(entries, input.exportedAt)
}

/** A part, read and checked against the index it names. */
export interface OpenedPart {
  readonly index: SetIndex
  readonly indexBytes: Uint8Array
  readonly number: number
  /** Part 1 only: the project's package bytes. */
  readonly pkg: Uint8Array | null
  /** The part's files, by archive name. Each is checked against its index entry. */
  readonly files: ReadonlyMap<string, Uint8Array>
}

/**
 * Open one part. It must carry the index, its own number, exactly the files the index assigns to it, each with the checksum
 * and size the index records, and the package only if it is part 1. Anything else is refused by name.
 */
export async function openPart(bytes: Uint8Array): Promise<OpenedPart> {
  const zip = readZip(bytes)
  const rawIndex = zip.get(INDEX_FILE)
  if (rawIndex === undefined)
    throw new ArchiveError('this is not part of a project set: no index is in it')
  let index: SetIndex
  try {
    index = JSON.parse(new TextDecoder().decode(rawIndex)) as SetIndex
  } catch {
    throw new ArchiveError('the index of this set could not be read')
  }
  if (index.format !== SET_FORMAT || index.version !== SET_VERSION) {
    throw new ArchiveError('this set is in a format this office does not read')
  }
  const rawPart = zip.get(PART_FILE)
  const number =
    rawPart === undefined
      ? NaN
      : Number((JSON.parse(new TextDecoder().decode(rawPart)) as { number?: unknown }).number)
  if (!Number.isInteger(number) || number < 1 || number > index.part_count) {
    throw new ArchiveError('this part does not name a part number the set has')
  }
  const pkg = zip.get(PACKAGE_IN_PART) ?? null
  if (number === 1 && pkg === null)
    throw new ArchiveError('part 1 does not carry the project package')
  if (number !== 1 && pkg !== null)
    throw new ArchiveError('only part 1 may carry the project package')
  if (pkg !== null && pkg.length > SET_LIMITS.packageBytes) {
    throw new ArchiveError('the project package is larger than a set may carry')
  }
  const expected = index.entries.filter((e) => e.part === number)
  const names = new Set(expected.map((e) => e.archive_name))
  const files = new Map<string, Uint8Array>()
  for (const [name, data] of zip) {
    if (name === INDEX_FILE || name === PART_FILE || name === PACKAGE_IN_PART) continue
    if (!names.has(name))
      throw new ArchiveError(`this part holds a file the set does not assign to it: ${name}`)
    files.set(name, data)
  }
  for (const e of expected) {
    const data = files.get(e.archive_name)
    if (data === undefined)
      throw new ArchiveError(`this part is missing a file the set names: ${e.archive_name}`)
    if (data.length !== e.bytes)
      throw new ArchiveError(`a file in this part is not the size the set records`)
    if ((await sha256Hex(data)) !== e.sha256)
      throw new ArchiveError(`a file in this part does not match its recorded checksum`)
  }
  return { index, indexBytes: rawIndex, number, pkg, files }
}

/**
 * Put each restored original back on its document, from the index. `pathFor` builds the stored path (the gateway owns it, so
 * the path is under this office and this set and never one the package names). A document the index names must have an
 * original in the package, and the package must not gain an original the index does not name.
 */
export function attachOriginals(
  pkg: { documents?: unknown },
  index: SetIndex,
  pathFor: (e: SetEntry) => string,
): { ok: true; pkg: unknown } | { ok: false; reason: string } {
  const docs = Array.isArray(pkg.documents) ? (pkg.documents as Record<string, unknown>[]) : []
  const named = new Set<number>()
  for (const e of index.entries) {
    const doc = docs[e.doc]
    if (doc === undefined)
      return { ok: false, reason: 'the set names a document the package does not hold' }
    if (named.has(e.doc)) return { ok: false, reason: 'the set names one document twice' }
    named.add(e.doc)
    doc.original = { mime_type: e.mime, bytes: e.bytes, storage_path: pathFor(e) }
  }
  for (let i = 0; i < docs.length; i++) {
    if (docs[i]?.original && !named.has(i)) {
      return { ok: false, reason: 'the package holds an original the set does not name' }
    }
  }
  return { ok: true, pkg }
}

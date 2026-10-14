/**
 * The project archive: a ZIP holding a project package, a manifest of checksums, and a plain-text README (Workstream
 * C2, issue #471). Pure: bytes in, bytes out. No database, no clock except the one the caller passes.
 *
 * ## What is in an archive
 *
 *   project.json   the package `app.project_export` writes (format 'ai-team-hq/project-package', version 1)
 *   manifest.json  format, version, export time, and for each file its size and SHA-256
 *   README.txt     what the archive is, and what it does not carry
 *
 * ## Why store-only
 *
 * The package is JSON text; compression would be a second decoder to trust in a restore path. Store-only ZIP (method 0)
 * is the simplest format a reader anywhere can open, and `unzip -t` checks it (the test does, when unzip is installed).
 *
 * ## Refusals, all by name
 *
 * The reader refuses: an archive over the byte limit; more entries than the limit; a total uncompressed size over the
 * limit; a name that is absolute, has a backslash, a drive letter, a `..` segment, a NUL, or any character outside a
 * small set (ZIP-slip); a duplicate name; an entry compressed with anything but store; an encrypted entry; a ZIP64
 * archive; a central directory that points outside the file; a local header that disagrees with its central entry; a CRC
 * that does not match; an entry the manifest does not list; a manifest entry the archive does not hold; a size or
 * SHA-256 that does not match the manifest.
 *
 * ## The restore key
 *
 * `archiveKey` is the SHA-256 of the whole archive. The restore records it, so the same archive restored twice is one
 * project, and a changed byte anywhere is a different key.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export const ARCHIVE_FORMAT = 'agentic-team.archive'
export const ARCHIVE_VERSION = 1
export const PACKAGE_FILE = 'project.json'
export const MANIFEST_FILE = 'manifest.json'
export const README_FILE = 'README.txt'

export const ARCHIVE_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxEntries: 16,
  maxTotalBytes: 32 * 1024 * 1024,
} as const

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveError'
  }
}

export interface ZipEntry {
  readonly name: string
  readonly data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32 as ZIP uses it (IEEE polynomial, initial and final XOR of 0xFFFFFFFF). */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++)
    c = (CRC_TABLE[(c ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const exact = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', exact)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A name a reader anywhere can extract: lower-case-safe characters, no path tricks. */
export function isSafeName(name: string): boolean {
  if (name === '' || name.length > 200) return false
  if (name.startsWith('/') || name.includes('\\') || name.includes(':') || name.includes('\0'))
    return false
  const segments = name.split('/')
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..') return false
  }
  return /^[A-Za-z0-9._\-/]+$/.test(name)
}

function dosDateTime(iso: string): { time: number; date: number } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new ArchiveError('the export time is not a timestamp')
  const year = Math.max(1980, d.getUTCFullYear())
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  }
}

/** Write a store-only ZIP. Names are checked here too, so a writer cannot produce what the reader would refuse. */
export function buildZip(entries: readonly ZipEntry[], exportedAt: string): Uint8Array {
  if (entries.length > ARCHIVE_LIMITS.maxEntries)
    throw new ArchiveError('too many entries for one archive')
  const { time, date } = dosDateTime(exportedAt)
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!isSafeName(entry.name))
      throw new ArchiveError(`an archive name is not allowed: ${entry.name}`)
    if (seen.has(entry.name))
      throw new ArchiveError(`a name is in the archive twice: ${entry.name}`)
    seen.add(entry.name)
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // names are UTF-8
    local.setUint16(8, 0, true) // store
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, size, true)
    local.setUint32(22, size, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    parts.push(new Uint8Array(local.buffer), name, entry.data)

    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(8, 0x0800, true)
    cd.setUint16(10, 0, true)
    cd.setUint16(12, time, true)
    cd.setUint16(14, date, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, size, true)
    cd.setUint32(24, size, true)
    cd.setUint16(28, name.length, true)
    cd.setUint16(30, 0, true)
    cd.setUint16(32, 0, true)
    cd.setUint16(34, 0, true)
    cd.setUint16(36, 0, true)
    cd.setUint32(38, 0, true)
    cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), name)

    offset += 30 + name.length + size
  }

  const cdSize = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(4, 0, true)
  end.setUint16(6, 0, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  end.setUint16(20, 0, true)

  const out = new Uint8Array(offset + cdSize + 22)
  let at = 0
  for (const p of [...parts, ...central, new Uint8Array(end.buffer)]) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** Read a store-only ZIP, refusing everything listed in the header comment. */
export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length > ARCHIVE_LIMITS.maxBytes)
    throw new ArchiveError('the archive is larger than the 8 MB this office takes')
  if (bytes.length < 22) throw new ArchiveError('the file is too short to be a ZIP archive')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // The end-of-central-directory record sits in the last 22 bytes, or before a comment of up to 65535 bytes.
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0)
    throw new ArchiveError('the file has no ZIP directory, so it is not a complete archive')
  const count = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ArchiveError('this is a ZIP64 archive, which this office does not read')
  }
  if (count > ARCHIVE_LIMITS.maxEntries)
    throw new ArchiveError('the archive holds more files than this office takes')
  if (cdOffset + cdSize > eocd) throw new ArchiveError('the ZIP directory points outside the file')

  const files = new Map<string, Uint8Array>()
  let total = 0
  let p = cdOffset
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== 0x02014b50) {
      throw new ArchiveError('the ZIP directory is damaged')
    }
    const flags = view.getUint16(p + 8, true)
    const method = view.getUint16(p + 10, true)
    const crc = view.getUint32(p + 16, true)
    const csize = view.getUint32(p + 20, true)
    const usize = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOffset = view.getUint32(p + 42, true)
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ArchiveError('this is a ZIP64 archive, which this office does not read')
    }
    if (flags & 0x0001) throw new ArchiveError('an encrypted file is not accepted')
    if (method !== 0)
      throw new ArchiveError(
        'a compressed file is not accepted: archives are stored, not compressed',
      )
    if (csize !== usize) throw new ArchiveError('a stored file has two different sizes')

    const nameStart = p + 46
    if (nameStart + nameLen > eocd) throw new ArchiveError('the ZIP directory is damaged')
    let name: string
    try {
      name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen))
    } catch {
      throw new ArchiveError('a file name is not valid UTF-8')
    }
    if (!isSafeName(name))
      throw new ArchiveError(`a file name is not allowed: ${JSON.stringify(name).slice(0, 80)}`)
    if (files.has(name)) throw new ArchiveError(`a file name is in the archive twice: ${name}`)

    if (localOffset + 30 > cdOffset || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new ArchiveError(`the local header for ${name} is missing`)
    }
    const localNameLen = view.getUint16(localOffset + 26, true)
    const localExtraLen = view.getUint16(localOffset + 28, true)
    if (localNameLen !== nameLen)
      throw new ArchiveError(`the local header for ${name} disagrees with its directory entry`)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    if (dataStart + usize > cdOffset)
      throw new ArchiveError(`${name} runs past the end of the file data`)

    total += usize
    if (total > ARCHIVE_LIMITS.maxTotalBytes)
      throw new ArchiveError('the files together are larger than this office takes')

    const data = bytes.slice(dataStart, dataStart + usize)
    if (crc32(data) !== crc)
      throw new ArchiveError(`${name} does not match its checksum in the archive`)
    files.set(name, data)
    p += 46 + nameLen + extraLen + commentLen
  }
  if (p !== cdOffset + cdSize)
    throw new ArchiveError('the ZIP directory has bytes the count does not account for')
  return files
}

interface ManifestFile {
  readonly name: string
  readonly bytes: number
  readonly sha256: string
}

interface Manifest {
  readonly format: string
  readonly format_version: number
  readonly exported_at: string
  readonly project: string
  readonly files: readonly ManifestFile[]
}

/** The README is for a person opening the file, and says what the archive does not carry. */
export function readmeText(slug: string, exportedAt: string): string {
  return [
    `Agentic Team project archive: ${slug}`,
    `Exported ${exportedAt} (UTC).`,
    '',
    `${PACKAGE_FILE} holds the project as JSON: its brief, documents (with their text), collections, tasks, contacts and`,
    'the team and automation settings. It holds no database identifiers, so it can be read anywhere.',
    `${MANIFEST_FILE} lists every other file here with its size and SHA-256. Check a file with: sha256sum ${PACKAGE_FILE}`,
    '',
    'NOT in this archive:',
    '- the original binary files (PDFs, images, spreadsheets). The office holds the text of a document, not always the file.',
    '- answers the team wrote, the team roster, automations and sources: they are listed in the restore report, not restored.',
    '- credentials of any kind. Connections are re-made by the person restoring the archive.',
    '',
  ].join('\n')
}

/** Build the archive for one project package. The key is the SHA-256 of the whole archive. */
export async function buildArchive(
  pkg: unknown,
  opts: { slug: string; exportedAt: string },
): Promise<{ bytes: Uint8Array; key: string }> {
  const packageBytes = encoder.encode(`${JSON.stringify(pkg, null, 2)}\n`)
  const readme = encoder.encode(readmeText(opts.slug, opts.exportedAt))
  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    format_version: ARCHIVE_VERSION,
    exported_at: opts.exportedAt,
    project: opts.slug,
    files: [
      { name: PACKAGE_FILE, bytes: packageBytes.length, sha256: await sha256Hex(packageBytes) },
      { name: README_FILE, bytes: readme.length, sha256: await sha256Hex(readme) },
    ],
  }
  const manifestBytes = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`)
  const bytes = buildZip(
    [
      { name: PACKAGE_FILE, data: packageBytes },
      { name: MANIFEST_FILE, data: manifestBytes },
      { name: README_FILE, data: readme },
    ],
    opts.exportedAt,
  )
  return { bytes, key: await sha256Hex(bytes) }
}

/**
 * Open an archive for restore: check it is an archive, that every file it holds is listed in the manifest with the
 * right size and SHA-256, and that nothing is listed that it does not hold. Returns the package and the key.
 */
export async function openArchive(
  bytes: Uint8Array,
): Promise<{ pkg: unknown; key: string; manifest: Manifest }> {
  const files = readZip(bytes)
  const manifestBytes = files.get(MANIFEST_FILE)
  if (manifestBytes === undefined)
    throw new ArchiveError('the archive has no manifest, so nothing in it can be checked')
  let manifest: Manifest
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes)) as Manifest
  } catch {
    throw new ArchiveError('the manifest is not readable JSON')
  }
  if (manifest.format !== ARCHIVE_FORMAT)
    throw new ArchiveError('the archive is not an Agentic Team archive')
  if (manifest.format_version !== ARCHIVE_VERSION) {
    throw new ArchiveError(
      `this archive version (${String(manifest.format_version)}) is not supported`,
    )
  }
  if (!Array.isArray(manifest.files)) throw new ArchiveError('the manifest lists no files')

  const listed = new Map(manifest.files.map((f) => [f.name, f]))
  for (const name of files.keys()) {
    if (name !== MANIFEST_FILE && !listed.has(name)) {
      throw new ArchiveError(`${name} is in the archive but not in its manifest`)
    }
  }
  for (const f of manifest.files) {
    const data = files.get(f.name)
    if (data === undefined)
      throw new ArchiveError(`${f.name} is in the manifest but missing from the archive`)
    if (data.length !== f.bytes)
      throw new ArchiveError(`${f.name} is not the size its manifest records`)
    if ((await sha256Hex(data)) !== f.sha256)
      throw new ArchiveError(`${f.name} does not match its SHA-256 in the manifest`)
  }
  const packageBytes = files.get(PACKAGE_FILE)
  if (packageBytes === undefined || !listed.has(PACKAGE_FILE)) {
    throw new ArchiveError('the archive holds no project.json')
  }
  let pkg: unknown
  try {
    pkg = JSON.parse(decoder.decode(packageBytes))
  } catch {
    throw new ArchiveError('project.json is not readable JSON')
  }
  return { pkg, key: await sha256Hex(bytes), manifest }
}

/**
 * The rules a stored file must pass, and the rule for who may read one (#469, B2).
 *
 * Pure: no provider, no network, no database. Each rule is checked by the caller before a byte is stored or a link is
 * issued, and tests/files/policy.test.ts proves each one refuses what it should and accepts what it should.
 *
 *   - Size: no object is stored above 100 MiB, the bucket limit recorded in migration 0205.
 *   - Type: the declared type must be on the allowlist, the file name's extension must agree with it, and the first bytes
 *     must look like that type. A file called report.pdf that starts with HTML is refused. The declared type alone is not
 *     trusted, because a browser would serve it back under that type.
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

type Magic = (bytes: Uint8Array) => boolean
interface FileType {
  ext: string[]
  magic: Magic
  /**
   * The declared types a browser or an operating system sends for this kind of file. Windows sends a CSV as Excel's type,
   * and some sends a plain-text file as text/plain, so one kind can arrive under more than one declared type.
   */
  declared: string[]
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.byteLength < prefix.length) return false
  return prefix.every((v, i) => bytes[i] === v)
}

function zipLike(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
}

/** Plain text: no NUL byte, and valid UTF-8 when decoded strictly. */
function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

const OFFICE_OPEN_XML = 'application/vnd.openxmlformats-officedocument'
/** An OLE2 compound file: the binary format of Word, Excel and PowerPoint before 2007. */
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const ole2 = (b: Uint8Array) => startsWith(b, OLE2)
const OPEN_DOCUMENT = 'application/vnd.oasis.opendocument'

/*
  THE ALLOWLIST. Each type: the extensions it may carry, a test of the first bytes, and the declared types it arrives under.
  A file is accepted when its declared type, its extension and its contents agree with one entry. Anything not listed is
  refused by name.

  REFUSED ON PURPOSE, and why. A file the office stores is later opened from a signed link in a browser tab, so a type
  that runs script when opened there is a risk the product creates, not one a reader brings:
    text/html, application/xhtml+xml, image/svg+xml, and any script or executable (js, exe, sh, bat, php).
  The reader does read HTML (src/text/file-text.ts) for pages a person imports from the web; an uploaded HTML file is
  still refused, and that is the one format this list is narrower than the reader.

  Formats the product accepted before this list (CSV, JSON, the pre-2007 Office formats, OpenDocument and RTF) are allowed,
  because none of them runs anything when opened from a link.
*/
const TYPES: Record<string, FileType> = {
  'application/pdf': {
    ext: ['pdf'],
    magic: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]),
    declared: ['application/pdf'],
  },
  'image/png': {
    ext: ['png'],
    magic: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]),
    declared: ['image/png'],
  },
  'image/jpeg': {
    ext: ['jpg', 'jpeg'],
    magic: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
    declared: ['image/jpeg', 'image/pjpeg'],
  },
  'image/webp': {
    ext: ['webp'],
    magic: (b) =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
    declared: ['image/webp'],
  },
  'image/gif': {
    ext: ['gif'],
    magic: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]),
    declared: ['image/gif'],
  },
  'audio/mpeg': {
    ext: ['mp3'],
    magic: (b) =>
      startsWith(b, [0x49, 0x44, 0x33]) || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0),
    declared: ['audio/mpeg', 'audio/mp3'],
  },
  'text/plain': { ext: ['txt'], magic: isText, declared: ['text/plain'] },
  'text/markdown': {
    ext: ['md', 'markdown'],
    magic: isText,
    declared: ['text/markdown', 'text/x-markdown'],
  },
  'text/csv': {
    ext: ['csv'],
    magic: isText,
    // Windows sends a CSV as Excel's type; a CSV some tools send as plain text. Both are text, so both are accepted.
    declared: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  },
  'text/tab-separated-values': {
    ext: ['tsv'],
    magic: isText,
    declared: ['text/tab-separated-values', 'text/plain'],
  },
  'application/json': {
    ext: ['json'],
    magic: isText,
    declared: ['application/json', 'text/json'],
  },
  'application/rtf': {
    ext: ['rtf'],
    magic: (b) => startsWith(b, [0x7b, 0x5c, 0x72, 0x74, 0x66]),
    declared: ['application/rtf', 'text/rtf'],
  },
  'application/msword': { ext: ['doc'], magic: ole2, declared: ['application/msword'] },
  'application/vnd.ms-excel': { ext: ['xls'], magic: ole2, declared: ['application/vnd.ms-excel'] },
  'application/vnd.ms-powerpoint': {
    ext: ['ppt'],
    magic: ole2,
    declared: ['application/vnd.ms-powerpoint'],
  },
  [`${OPEN_DOCUMENT}.text`]: {
    ext: ['odt'],
    magic: zipLike,
    declared: [`${OPEN_DOCUMENT}.text`],
  },
  [`${OPEN_DOCUMENT}.spreadsheet`]: {
    ext: ['ods'],
    magic: zipLike,
    declared: [`${OPEN_DOCUMENT}.spreadsheet`],
  },
  [`${OPEN_DOCUMENT}.presentation`]: {
    ext: ['odp'],
    magic: zipLike,
    declared: [`${OPEN_DOCUMENT}.presentation`],
  },
  [`${OFFICE_OPEN_XML}.wordprocessingml.document`]: {
    ext: ['docx'],
    magic: zipLike,
    declared: [`${OFFICE_OPEN_XML}.wordprocessingml.document`],
  },
  [`${OFFICE_OPEN_XML}.spreadsheetml.sheet`]: {
    ext: ['xlsx'],
    magic: zipLike,
    declared: [`${OFFICE_OPEN_XML}.spreadsheetml.sheet`],
  },
  [`${OFFICE_OPEN_XML}.presentationml.presentation`]: {
    ext: ['pptx'],
    magic: zipLike,
    declared: [`${OFFICE_OPEN_XML}.presentationml.presentation`],
  },
}

export type UploadVerdict = { ok: true } | { ok: false; reason: string }

export function allowedTypes(): string[] {
  return Object.keys(TYPES)
}

/**
 * Check a file before it is stored. Returns the first reason it is refused, named, or ok.
 *
 * The declared type selects the candidate kinds; the name's extension must belong to one of them; and that kind's test of
 * the first bytes must pass. A declared type shared by two kinds (Excel's type is sent for a CSV and for an XLS) is
 * resolved by the extension, so a CSV named as Excel is judged as a CSV, and an XLS named as Excel as an XLS.
 */
export function checkUpload(file: {
  name: string
  mime: string
  bytes: Uint8Array
}): UploadVerdict {
  if (file.bytes.byteLength === 0) return { ok: false, reason: 'empty' }
  if (file.bytes.byteLength > MAX_OBJECT_BYTES) return { ok: false, reason: 'too large' }
  const candidates = Object.values(TYPES).filter((t) => t.declared.includes(file.mime))
  if (candidates.length === 0) return { ok: false, reason: 'type not allowed' }
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  const kind = candidates.find((t) => t.ext.includes(ext))
  if (kind === undefined) return { ok: false, reason: 'extension does not match the declared type' }
  if (!kind.magic(file.bytes))
    return { ok: false, reason: 'contents do not match the declared type' }
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

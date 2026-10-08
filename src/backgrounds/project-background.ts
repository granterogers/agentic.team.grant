/*
  A PROJECT'S BACKGROUND PICTURE, SERVER SIDE (#445, migration 1024). Pure functions, so they are tested without a network.

  Nothing in a request is trusted: the type comes from the bytes' own header (never the declared MIME type or a file name), the
  size from the header (so a file claiming to be enormous is refused before anything stores it), and the object key is built from
  the office the session proved and the project the DATABASE resolved, never from the request.

  Comments here avoid backticks and a slash followed by a star: the tests read this source.
*/

export const BG_LIMITS = {
  bytes: 3 * 1024 * 1024,
  edge: 4096,
  pixels: 16_000_000,
  /** Pictures an office may hold, one per project. Replacing one is not a new picture. */
  perOffice: 12,
  /** How long a signed link lives. A background stays on screen, so longer than a photograph's ten minutes. */
  linkSeconds: 3600,
} as const

export type Sniffed = {
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'
  ext: string
  w: number
  h: number
}

const u16 = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)
const u32 = (b: Uint8Array, i: number): number =>
  (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0
const le24 = (b: Uint8Array, i: number): number =>
  (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16)
const ascii = (b: Uint8Array, i: number, n: number): string =>
  String.fromCharCode(...b.slice(i, i + n))

/** The type and pixel size from the bytes' header, or a sentence for a person. SVG and anything else is refused. */
export const sniffImage = (b: Uint8Array): Sniffed | { error: string } => {
  const head = ascii(b, 0, Math.min(b.length, 256)).toLowerCase()
  if (
    head.includes('<svg') ||
    head.startsWith('<?xml') ||
    head.includes('<!doctype') ||
    head.includes('<html')
  ) {
    return { error: 'that is not a picture the office accepts (no SVG or web pages)' }
  }
  if (b.length < 24) return { error: 'that file is too small to be a picture' }
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
    if (ascii(b, 12, 4) !== 'IHDR') return { error: 'that PNG is damaged' }
    return { mime: 'image/png', ext: 'png', w: u32(b, 16), h: u32(b, 20) }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1
        continue
      }
      const m = b[i + 1] ?? 0
      if (m === 0xff) {
        i += 1
        continue
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { mime: 'image/jpeg', ext: 'jpg', h: u16(b, i + 5), w: u16(b, i + 7) }
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2
        continue
      }
      i += 2 + u16(b, i + 2)
    }
    return { error: 'that JPEG is damaged' }
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const kind = ascii(b, 12, 4)
    if (kind === 'VP8X')
      return { mime: 'image/webp', ext: 'webp', w: le24(b, 24) + 1, h: le24(b, 27) + 1 }
    if (kind === 'VP8L') {
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24)
      return {
        mime: 'image/webp',
        ext: 'webp',
        w: (bits & 0x3fff) + 1,
        h: ((bits >> 14) & 0x3fff) + 1,
      }
    }
    if (kind === 'VP8 ') {
      return {
        mime: 'image/webp',
        ext: 'webp',
        w: ((b[26] ?? 0) | ((b[27] ?? 0) << 8)) & 0x3fff,
        h: ((b[28] ?? 0) | ((b[29] ?? 0) << 8)) & 0x3fff,
      }
    }
    return { error: 'that WebP is damaged' }
  }
  if (ascii(b, 4, 4) === 'ftyp' && /avi[fs]/.test(ascii(b, 8, 12))) {
    for (let i = 12; i + 20 < Math.min(b.length, 4096); i += 1) {
      if (ascii(b, i, 4) === 'ispe')
        return { mime: 'image/avif', ext: 'avif', w: u32(b, i + 8), h: u32(b, i + 12) }
    }
    return { error: 'that AVIF could not be read' }
  }
  return { error: 'that is not a JPEG, PNG, WebP or AVIF picture' }
}

/** Whether these bytes may be stored as a project background. */
export const vetBackground = (b: Uint8Array): Sniffed | { error: string } => {
  if (b.byteLength === 0) return { error: 'that picture is empty' }
  if (b.byteLength > BG_LIMITS.bytes)
    return { error: 'that picture is over 3 MB - a smaller one will do' }
  const s = sniffImage(b)
  if ('error' in s) return s
  if (!(s.w > 0 && s.h > 0)) return { error: 'that picture reports no size' }
  if (s.w > BG_LIMITS.edge || s.h > BG_LIMITS.edge || s.w * s.h > BG_LIMITS.pixels) {
    return {
      error: 'that picture is too large to store (at most 4096 pixels a side and 16 megapixels)',
    }
  }
  return s
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The prefix an office's pictures live under. Null unless the office id is a real uuid. */
export const backgroundPrefix = (office: string): string | null =>
  UUID.test(office) ? `${office.toLowerCase()}/backgrounds/` : null

/** The object key, from the verified office and the project the database resolved. Null unless both are uuids and the ext is known. */
export const backgroundKey = (office: string, projectId: string, ext: string): string | null => {
  const prefix = backgroundPrefix(office)
  if (prefix === null || !UUID.test(projectId) || !/^(jpg|png|webp|avif)$/.test(ext)) return null
  return `${prefix}${projectId.toLowerCase()}.${ext}`
}

/** The project id a stored key belongs to, or null for a name this module did not write. */
export const projectOfKey = (office: string, name: string): string | null => {
  const prefix = backgroundPrefix(office)
  const bare = prefix !== null && name.startsWith(prefix) ? name.slice(prefix.length) : name
  const m = /^([0-9a-f-]{36})\.(jpg|png|webp|avif)$/i.exec(bare)
  return m !== null && UUID.test(m[1] ?? '') ? (m[1] ?? '').toLowerCase() : null
}

/**
 * The revision of a stored picture: the time storage last wrote the object, in base 36. A replacement changes it and an
 * unchanged picture keeps it, so a device that already holds this revision need not download the picture again. Null when
 * storage gave no usable time (the picture is then treated as having no revision and is fetched).
 */
export const revisionFromStamp = (stamp: unknown): string | null => {
  const ms = typeof stamp === 'string' ? Date.parse(stamp) : Number.NaN
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms).toString(36) : null
}

/** Decode a base64 body (a data URL is allowed) into bytes, or null when it is not base64. */
export const decodeBase64 = (b64: string): Uint8Array | null => {
  try {
    const raw = atob(b64.includes(',') ? (b64.split(',')[1] ?? '') : b64)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

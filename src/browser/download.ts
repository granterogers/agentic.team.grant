/**
 * Safe downloads (web research).
 *
 * A download is a GET that keeps the bytes. It is autonomous, which is only safe because of what it refuses:
 *
 *   - a type that is not on the allow-list (a document a person reads; never HTML, SVG, an archive, an executable or a
 *     macro format). Anything unnamed is refused, so a type nobody thought of fails closed;
 *   - a file over the cap, refused from the announced length BEFORE reading and again while reading, because a
 *     server may lie about or omit the length;
 *   - bytes that are not what the type claims (a "PDF" that is HTML; a "PNG" that is a script), by magic number;
 *   - a private address, on every hop of a redirect chain (`whyRefused`, the same predicate the page reader uses).
 *
 * Nothing is executed or opened: the bytes go to storage under a name this module chooses from the TYPE, never from the
 * URL, with the type recorded. No cookie is ever sent: authenticated material is the page reader's business, through the
 * session tier, and a download of a public file has no business carrying one.
 *
 * `app.web_file_refusal` (migration 0930) is the same allow-list in the database, because a writer that trusts its caller
 * is how a rule gets bypassed by the next caller. `tests/browser/download.test.ts` reads the migration and asserts the
 * two lists agree.
 */

import { MAX_HOPS, whyRefused } from './fetched.ts'

export const DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024

const startsWith = (b: Uint8Array, ...sig: number[]): boolean => sig.every((v, i) => b[i] === v)
const ascii = (b: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...b.slice(from, to))

const textual = (b: Uint8Array): boolean => {
  const head = b.slice(0, 2048)
  if (head.includes(0)) return false
  const s = ascii(head, 0, Math.min(head.length, 200)).trimStart().toLowerCase()
  // A "text file" that is really a page or a script is refused: a page is READ, not stored as a file.
  return !/^(<!doctype|<html|<head|<body|<script|<\?xml|<svg)/.test(s)
}

/** The allow-list: type, the extension it is stored under, and the check that the bytes are what the type claims. */
export const ALLOWED_TYPES: Readonly<
  Record<string, { readonly ext: string; readonly is: (b: Uint8Array) => boolean }>
> = {
  'application/json': { ext: 'json', is: textual },
  'application/pdf': { ext: 'pdf', is: (b) => startsWith(b, 0x25, 0x50, 0x44, 0x46) },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    ext: 'pptx',
    is: (b) => startsWith(b, 0x50, 0x4b, 0x03, 0x04),
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: 'xlsx',
    is: (b) => startsWith(b, 0x50, 0x4b, 0x03, 0x04),
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    is: (b) => startsWith(b, 0x50, 0x4b, 0x03, 0x04),
  },
  'image/gif': { ext: 'gif', is: (b) => ascii(b, 0, 4) === 'GIF8' },
  'image/jpeg': { ext: 'jpg', is: (b) => startsWith(b, 0xff, 0xd8, 0xff) },
  'image/png': { ext: 'png', is: (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47) },
  'image/webp': { ext: 'webp', is: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP' },
  'text/csv': { ext: 'csv', is: textual },
  'text/markdown': { ext: 'md', is: textual },
  'text/plain': { ext: 'txt', is: textual },
}

/** The bare media type of a Content-Type header: lower-case, no parameters. */
export const mediaType = (header: string | null): string =>
  (header ?? '').split(';')[0]?.trim().toLowerCase() ?? ''

/** Why a file of this type and size is refused before a byte is read, or null when it may be fetched. */
export function refusalFor(mime: string, bytes: number | null): string | null {
  const type = mediaType(mime)
  if (type === '') return 'the server did not say what type the file is'
  if (ALLOWED_TYPES[type] === undefined)
    return `${type} is not a type the office keeps from the web`
  if (bytes !== null && bytes <= 0) return 'the file was empty'
  if (bytes !== null && bytes > DOWNLOAD_MAX_BYTES) {
    return `the file is ${String(Math.round(bytes / 1024 / 1024))} MB, over the ${String(DOWNLOAD_MAX_BYTES / 1024 / 1024)} MB cap`
  }
  return null
}

/** Whether a link looks like a file worth downloading rather than a page worth reading, by its path. */
export function looksLikeAFile(url: string): boolean {
  try {
    return /\.(pdf|csv|docx|xlsx|pptx|json|txt|md|png|jpe?g|gif|webp)$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

export type DownloadOutcome =
  | {
      readonly ok: true
      readonly bytes: Uint8Array
      readonly mime: string
      readonly ext: string
      readonly finalUrl: string
      readonly ms: number
    }
  | { readonly ok: false; readonly detail: string; readonly ms: number }

export interface DownloadDeps {
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
}

export async function downloadFile(url: string, deps: DownloadDeps = {}): Promise<DownloadOutcome> {
  const began = Date.now()
  const fail = (detail: string): DownloadOutcome => ({ detail, ms: Date.now() - began, ok: false })
  const fetchImpl = deps.fetchImpl ?? fetch
  let hop: URL
  try {
    hop = new URL(url)
  } catch {
    return fail('that is not a url')
  }
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), deps.timeoutMs ?? 30_000)
  try {
    for (let n = 0; ; n++) {
      if (n > MAX_HOPS) return fail(`refused: more than ${String(MAX_HOPS)} redirects`)
      const why = whyRefused(hop)
      if (why !== null) return fail(`refused: ${why}`)
      const response = await fetchImpl(hop.toString(), {
        // No cookie, ever.
        headers: {
          accept: '*/*',
          'user-agent': 'AgenticTeam/1.0 (+https://ai-team-hq.vercel.app)',
        },
        redirect: 'manual',
        signal: control.signal,
      })
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location !== null) {
        try {
          hop = new URL(location, hop)
        } catch {
          return fail('the redirect pointed at something that is not a url')
        }
        continue
      }
      if (!response.ok) return fail(`http ${String(response.status)}`)

      const type = mediaType(response.headers.get('content-type'))
      const lengthHeader = response.headers.get('content-length')
      const announced = lengthHeader === null || lengthHeader === '' ? null : Number(lengthHeader)
      const early = refusalFor(type, Number.isFinite(announced) ? announced : null)
      if (early !== null) return fail(early)

      // Read under the cap rather than trusting the announced length.
      const reader = response.body?.getReader()
      if (reader === undefined) return fail('the response had no body')
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > DOWNLOAD_MAX_BYTES) {
          await reader.cancel().catch(() => undefined)
          return fail(`the file is over the ${String(DOWNLOAD_MAX_BYTES / 1024 / 1024)} MB cap`)
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(total)
      let at = 0
      for (const c of chunks) {
        bytes.set(c, at)
        at += c.byteLength
      }
      if (total === 0) return fail('the file was empty')
      const spec = ALLOWED_TYPES[type]
      if (spec === undefined) return fail(`${type} is not a type the office keeps from the web`)
      if (!spec.is(bytes)) return fail(`the bytes are not ${type}, whatever the server called it`)
      return {
        bytes,
        ext: spec.ext,
        finalUrl: hop.toString(),
        mime: type,
        ms: Date.now() - began,
        ok: true,
      }
    }
  } catch (error) {
    return fail(
      (error as Error)?.name === 'AbortError'
        ? 'the download timed out'
        : `the download failed: ${String((error as Error).message).slice(0, 120)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Previewing an external document on demand, without importing it.
 *
 * Grant, intent: an external document does not need to be imported to be useful. A connected document can be read,
 * searched, indexed and previewed on demand while its source stays connected. IMPORT is a different act: it makes a
 * durable Team HQ copy that survives the source disappearing. This file is the PREVIEW half, and it must never be
 * mistaken for the import half.
 *
 * ## The contract (UI, gateway, provider)
 *
 * A preview request for a document id answers with one of five states:
 *
 *   ready        a kind and a payload the page can render now
 *   loading      the page's own state while the gateway works (a provider that queued slow work may also answer it)
 *   failed       why, and whether pressing Retry could help
 *   unsupported  a format Team HQ cannot render, or a source that may not be read; with the honest alternatives
 *   stale        derived content that is known (or could not be ruled out) to be older than the source, shown with
 *                the reason, never silently
 *
 * ## What is persisted, and what is not
 *
 * Only DERIVED data: the extracted text (into `documents.content`, so the existing chunk index makes it searchable),
 * a fingerprint and a fetched time (the same columns a real read writes), and the source's modified time / checksum /
 * size in `document_previews`. The ORIGINAL BINARY IS NEVER STORED: a PDF or an image is fetched into memory, its text
 * is read, and the bytes go to the browser in the response. Nothing here has a Storage dependency, which is asserted in
 * the tests by giving the provider a fetch that fails on any other host.
 *
 * ## Stale rule
 *
 * The source's `modifiedTime` (and `md5Checksum` where Drive has one) is compared with what the cache recorded. Content
 * is fetched again only when they differ. A request inside `LIMITS.freshSeconds` of the last check asks Drive nothing
 * at all, so opening a document twice is not two reads.
 *
 * ## Why this file imports nothing
 *
 * It runs in the gateway (Deno) and in vitest (Node) from one source, uploaded beside the entrypoint like
 * `file-text.ts`, so it uses web-standard APIs only and takes the text extractor and the recorder as arguments.
 */

export type PreviewState = 'ready' | 'loading' | 'failed' | 'unsupported' | 'stale'
export type PreviewKind = 'text' | 'pdf' | 'image' | 'held'

/** What a person can do instead of previewing, named so the page can draw a press for each. */
export type Alternative = 'open_source' | 'import' | 'retry' | 'reconnect'

export const LIMITS = {
  /** A text export or a text file. Drive refuses to export more than 10 MB anyway. */
  textBytes: 5 * 1024 * 1024,
  /** A PDF or an image held in memory for one response. */
  binaryBytes: 25 * 1024 * 1024,
  /** Derived text kept in the index. A longer one is cut and says so. */
  derivedChars: 400_000,
  /** Inside this window of the last check, Drive is not asked again. */
  freshSeconds: 60,
} as const

export interface SourceMeta {
  readonly name: string
  readonly mime: string
  /** RFC 3339, as the source reports it. */
  readonly modifiedTime: string | null
  /** A content checksum where the source has one (Drive does for binaries, not for Google-native files). */
  readonly version: string | null
  readonly size: number | null
  readonly webViewLink: string | null
  readonly trashed: boolean
}

export type FailureCode =
  | 'not_found'
  | 'forbidden'
  | 'unauthorised'
  | 'rate_limited'
  | 'quota'
  | 'unavailable'
  | 'unreachable'
  | 'too_large'
  | 'empty'
  | 'bad_content'
  | 'operator_required'
  | 'not_connected'

export interface Failure {
  readonly code: FailureCode
  /** In words a person can read. Never a credential, never a raw body. */
  readonly message: string
  /** Whether pressing Retry could change the outcome. */
  readonly retryable: boolean
  readonly status?: number
}

/** What a provider decided it would do with one file. */
export type HowToShow =
  | {
      readonly kind: 'text'
      readonly via: 'export' | 'download' | 'extract'
      readonly exportMime?: string
      readonly format: 'plain' | 'csv'
    }
  | { readonly kind: 'pdf' }
  | { readonly kind: 'image' }
  | { readonly kind: 'unsupported'; readonly reason: string }

type Ok<T> = { readonly ok: true } & T
type Bad = { readonly ok: false; readonly failure: Failure }

/** The adapter a source implements. Drive does; a source with nothing real behind it does not get one. */
export interface PreviewProvider {
  readonly connector: string
  describe(ref: string): Promise<Ok<{ meta: SourceMeta }> | Bad>
  howToShow(meta: SourceMeta): HowToShow
  fetchText(ref: string, meta: SourceMeta, how: HowToShow): Promise<Ok<{ text: string }> | Bad>
  fetchBytes(ref: string, meta: SourceMeta): Promise<Ok<{ bytes: Uint8Array; mime: string }> | Bad>
}

export type ExtractText = (
  bytes: Uint8Array,
  mime: string,
  name: string,
) => Promise<{ readonly text: string | null; readonly why?: string }>

// ---------------------------------------------------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------------------------------------------------

const DRIVE = 'https://www.googleapis.com/drive/v3'
const META_FIELDS = 'id,name,mimeType,modifiedTime,md5Checksum,size,webViewLink,trashed'

const GOOGLE_EXPORTS: Readonly<Record<string, { mime: string; format: 'plain' | 'csv' }>> = {
  'application/vnd.google-apps.document': { mime: 'text/plain', format: 'plain' },
  'application/vnd.google-apps.spreadsheet': { mime: 'text/csv', format: 'csv' },
  'application/vnd.google-apps.presentation': { mime: 'text/plain', format: 'plain' },
}
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/** SVG is deliberately absent: an image that can carry script is not served inline from the gateway. */
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const PLAIN_TEXT = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
])

/*
  A PDF or a picture is shown as itself, never as the text indexed from it. That text is the source's own reading of the
  file, with its layout gone, so a deck read back as words came out garbled (the Illumina deck, October 2026). The media type
  decides this before any cached text is looked at.
*/
const drawableKind = (mime: string | null | undefined): 'pdf' | 'image' | null => {
  if (mime === 'application/pdf') return 'pdf'
  if (mime !== undefined && mime !== null && IMAGES.has(mime)) return 'image'
  return null
}

const kindOfMime = (mime: string): string => {
  if (mime === 'application/vnd.google-apps.folder') return 'folder'
  if (mime === 'application/vnd.google-apps.form') return 'Google Form'
  if (mime === 'application/vnd.google-apps.drawing') return 'Google Drawing'
  if (mime.startsWith('application/vnd.google-apps.')) return 'Google file'
  if (mime === 'application/zip' || mime.includes('zip')) return 'archive'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio file'
  if (mime.includes('spreadsheetml') || mime.includes('excel')) return 'Excel workbook'
  if (mime.includes('presentationml') || mime.includes('powerpoint')) return 'PowerPoint file'
  if (mime === 'image/svg+xml') return 'SVG image'
  if (mime.startsWith('image/')) return 'image'
  return 'file'
}

/** What a Drive HTTP failure means to a person, and whether trying again could help. */
export function driveFailure(status: number, body: string): Failure {
  let reason = ''
  try {
    const parsed = JSON.parse(body) as {
      error?: { errors?: { reason?: string }[]; status?: string }
    }
    reason = String(parsed.error?.errors?.[0]?.reason ?? parsed.error?.status ?? '')
  } catch {
    // A body that is not JSON carries no reason; the status alone decides.
  }
  if (status === 404) {
    return {
      code: 'not_found',
      status,
      retryable: false,
      message:
        'Drive no longer has this file, or it is not shared with the connected Google account.',
    }
  }
  if (status === 401) {
    return {
      code: 'unauthorised',
      status,
      retryable: false,
      message: 'Google would not accept the connection. Reconnect Google in Settings.',
    }
  }
  if (status === 429 || /ratelimit/i.test(reason)) {
    return {
      code: 'rate_limited',
      status,
      retryable: true,
      message: 'Drive is asking Team HQ to slow down. Try again in a minute.',
    }
  }
  if (status === 403) {
    if (/downloadquota/i.test(reason)) {
      return {
        code: 'quota',
        status,
        retryable: false,
        message:
          'Drive has stopped downloads of this file for now (its download quota is used up).',
      }
    }
    if (/exportsizelimit|toolarge/i.test(reason)) {
      return {
        code: 'too_large',
        status,
        retryable: false,
        message: 'This file is too large for Drive to export for a preview.',
      }
    }
    return {
      code: 'forbidden',
      status,
      retryable: false,
      message: 'Drive will not let the connected Google account read this file.',
    }
  }
  if (status >= 500) {
    return {
      code: 'unavailable',
      status,
      retryable: true,
      message: `Drive had a problem answering (${String(status)}). Try again shortly.`,
    }
  }
  return {
    code: 'unavailable',
    status,
    retryable: status === 408,
    message: `Drive answered ${String(status)}, which Team HQ does not know how to use.`,
  }
}

const unreachable = (): Failure => ({
  code: 'unreachable',
  retryable: true,
  message: 'Team HQ could not reach Drive just now. Try again shortly.',
})

/** The Drive implementation. `fetchImpl` is injected so every failure can be driven without a Google account. */
export function driveProvider(token: string, fetchImpl: typeof fetch = fetch): PreviewProvider {
  const headers = { Authorization: `Bearer ${token}` }
  const get = async (url: string): Promise<Response | Failure> => {
    try {
      return await fetchImpl(url, { headers })
    } catch {
      return unreachable()
    }
  }
  const failed = async (r: Response): Promise<Bad> => ({
    ok: false,
    failure: driveFailure(r.status, (await r.text().catch(() => '')).slice(0, 400)),
  })
  const read = async (r: Response, max: number): Promise<Ok<{ buffer: ArrayBuffer }> | Bad> => {
    const claimed = Number(r.headers.get('content-length') ?? '0')
    const tooBig: Bad = {
      ok: false,
      failure: {
        code: 'too_large',
        retryable: false,
        message: `This file is larger than the ${String(Math.round(max / 1024 / 1024))} MB Team HQ will open for a preview. Open the source instead.`,
      },
    }
    if (claimed > max) return tooBig
    let buffer: ArrayBuffer
    try {
      buffer = await r.arrayBuffer()
    } catch {
      return { ok: false, failure: unreachable() }
    }
    if (buffer.byteLength > max) return tooBig
    if (buffer.byteLength === 0) {
      return {
        ok: false,
        failure: { code: 'empty', retryable: false, message: 'Drive returned an empty file.' },
      }
    }
    return { ok: true, buffer }
  }

  return {
    connector: 'drive',

    async describe(ref) {
      const r = await get(
        `${DRIVE}/files/${encodeURIComponent(ref)}?fields=${encodeURIComponent(META_FIELDS)}&supportsAllDrives=true`,
      )
      if (!(r instanceof Response)) return { ok: false, failure: r }
      if (!r.ok) return await failed(r)
      const b = (await r.json().catch(() => ({}))) as Record<string, unknown>
      return {
        ok: true,
        meta: {
          name: String(b.name ?? ''),
          mime: String(b.mimeType ?? ''),
          modifiedTime: typeof b.modifiedTime === 'string' ? b.modifiedTime : null,
          version: typeof b.md5Checksum === 'string' ? b.md5Checksum : null,
          size: b.size === undefined ? null : Number(b.size),
          webViewLink: typeof b.webViewLink === 'string' ? b.webViewLink : null,
          trashed: b.trashed === true,
        },
      }
    },

    howToShow(meta) {
      const mime = meta.mime
      const google = GOOGLE_EXPORTS[mime]
      if (google !== undefined)
        return { kind: 'text', via: 'export', exportMime: google.mime, format: google.format }
      if (mime === 'application/pdf') return { kind: 'pdf' }
      if (IMAGES.has(mime)) return { kind: 'image' }
      if (PLAIN_TEXT.has(mime))
        return { kind: 'text', via: 'download', format: mime === 'text/csv' ? 'csv' : 'plain' }
      if (mime === DOCX) return { kind: 'text', via: 'extract', format: 'plain' }
      const what = kindOfMime(mime)
      return {
        kind: 'unsupported',
        reason:
          what === 'folder'
            ? 'This is a folder, not a document.'
            : `Team HQ cannot show ${/^[aeiou]/i.test(what) ? 'an' : 'a'} ${what} here. Open it in Drive, or import it to keep a copy.`,
      }
    },

    async fetchText(ref, meta, how) {
      if (how.kind !== 'text')
        return {
          ok: false,
          failure: { code: 'bad_content', retryable: false, message: 'Not a text file.' },
        }
      const id = encodeURIComponent(ref)
      const url =
        how.via === 'export'
          ? `${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(how.exportMime ?? 'text/plain')}`
          : `${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`
      if (meta.size !== null && meta.size > LIMITS.binaryBytes) {
        return {
          ok: false,
          failure: {
            code: 'too_large',
            retryable: false,
            message: 'This file is too large to read for a preview. Open the source instead.',
          },
        }
      }
      const r = await get(url)
      if (!(r instanceof Response)) return { ok: false, failure: r }
      if (!r.ok) return await failed(r)
      const got = await read(r, how.via === 'extract' ? LIMITS.binaryBytes : LIMITS.textBytes)
      if (!got.ok) return got
      const bytes = new Uint8Array(got.buffer)
      // A "text" file that is really bytes would be indexed as noise.
      if (how.via !== 'extract' && bytes.subarray(0, 4096).includes(0)) {
        return {
          ok: false,
          failure: {
            code: 'bad_content',
            retryable: false,
            message: 'This file says it is text but holds binary data.',
          },
        }
      }
      return { ok: true, text: new TextDecoder('utf-8', { fatal: false }).decode(bytes) }
    },

    async fetchBytes(ref, meta) {
      if (meta.size !== null && meta.size > LIMITS.binaryBytes) {
        return {
          ok: false,
          failure: {
            code: 'too_large',
            retryable: false,
            message: `This file is ${String(Math.round(meta.size / 1024 / 1024))} MB, over the ${String(Math.round(LIMITS.binaryBytes / 1024 / 1024))} MB Team HQ will open for a preview. Open the source instead.`,
          },
        }
      }
      const r = await get(
        `${DRIVE}/files/${encodeURIComponent(ref)}?alt=media&supportsAllDrives=true`,
      )
      if (!(r instanceof Response)) return { ok: false, failure: r }
      if (!r.ok) return await failed(r)
      const got = await read(r, LIMITS.binaryBytes)
      if (!got.ok) return got
      return { ok: true, bytes: new Uint8Array(got.buffer), mime: meta.mime }
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// What the database knows (the plan), and how a cache is judged
// ---------------------------------------------------------------------------------------------------------------------

export interface CacheRow {
  readonly kind: string
  readonly source_mime: string | null
  readonly source_modified_time: string | null
  readonly source_version: string | null
  readonly fetched_at: string | null
  readonly last_checked_at: string | null
  readonly derived_chars: number | null
  readonly truncated: boolean
}

export interface PreviewPlan {
  readonly ok: boolean
  readonly error?: string
  readonly document?: {
    readonly id: string
    readonly title: string
    readonly connector: string | null
    readonly origin: string
    readonly state: string
    readonly external_ref: string | null
    readonly mime_type: string | null
    readonly has_file: boolean
    readonly project_slug: string | null
  }
  /** `held` is something Team HQ itself holds (uploaded, made, imported); `external` is a connector's document. */
  readonly mode?: 'held' | 'external'
  readonly connected?: boolean
  /** A durable Team HQ copy of this external document exists. */
  readonly imported?: boolean
  readonly cache?: CacheRow | null
  /** The text held for it, present only when the source is connected. */
  readonly text?: string | null
}

export interface CacheInfo {
  readonly fetched_at: string | null
  readonly source_modified_time: string | null
  /** Content was read again in this request because the source changed (or there was none). */
  readonly refetched: boolean
  /** There had been a cache and the source had moved on from it. */
  readonly was_stale: boolean
}

export interface PreviewResult {
  readonly state: PreviewState
  readonly kind?: PreviewKind
  readonly payload?: PreviewPayload
  /** failed / unsupported / stale: why, in words. */
  readonly reason?: string
  readonly reason_code?: string
  readonly retryable?: boolean
  readonly alternatives: readonly Alternative[]
  readonly document?: { readonly id: string; readonly title: string }
  /** How this was obtained, for the one quiet line on the viewer. */
  readonly mode?: 'on_demand' | 'indexed' | 'held'
  readonly imported?: boolean
  readonly source?: {
    readonly connector: string | null
    readonly url: string | null
    readonly modified: string | null
  }
  readonly cache?: CacheInfo
  /** A sentence for the page to show above the content, or none. */
  readonly notice?: string
}

export type PreviewPayload =
  | {
      readonly type: 'text'
      readonly text: string
      readonly format: 'plain' | 'csv'
      readonly truncated: boolean
      readonly chars: number
      readonly note?: string
    }
  | {
      readonly type: 'stream'
      readonly mime: string
      readonly size: number | null
      readonly name: string
    }
  | { readonly type: 'held' }

export interface Recorder {
  /** Persists derived data. Never bytes. */
  (args: {
    readonly meta: SourceMeta
    readonly kind: 'text' | 'pdf' | 'image'
    readonly text: string | null
    readonly truncated: boolean
  }): Promise<boolean>
}

const ms = (iso: string | null | undefined): number | null => {
  if (iso === null || iso === undefined || iso === '') return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** Has the source moved on from what the cache recorded? An absent cache is changed, by definition. */
export function sourceChanged(cache: CacheRow | null | undefined, meta: SourceMeta): boolean {
  if (cache === null || cache === undefined) return true
  if (
    meta.version !== null &&
    cache.source_version !== null &&
    meta.version !== cache.source_version
  )
    return true
  const a = ms(meta.modifiedTime)
  const b = ms(cache.source_modified_time)
  if (a === null || b === null) return a !== b
  return a !== b
}

/** Cut derived text to the index limit at a line or word, saying so. */
export function capText(text: string): { readonly text: string; readonly truncated: boolean } {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (clean.length <= LIMITS.derivedChars) return { text: clean, truncated: false }
  const cut = clean.slice(0, LIMITS.derivedChars)
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '))
  return { text: at > LIMITS.derivedChars * 0.9 ? cut.slice(0, at) : cut, truncated: true }
}

/** The leading bytes must be what the label claims, or the response is not served. */
export function sniff(bytes: Uint8Array, mime: string): boolean {
  const at = (i: number, s: string): boolean =>
    [...s].every((c, k) => bytes[i + k] === c.charCodeAt(0))
  if (mime === 'application/pdf') return at(0, '%PDF-')
  if (mime === 'image/png') return bytes[0] === 0x89 && at(1, 'PNG')
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/gif') return at(0, 'GIF8')
  if (mime === 'image/webp') return at(0, 'RIFF') && at(8, 'WEBP')
  return false
}

const ALTS_BASE: readonly Alternative[] = ['open_source', 'import']

const disconnected = (doc: { id: string; title: string }): PreviewResult => ({
  state: 'unsupported',
  reason_code: 'source_disconnected',
  reason:
    'This source is switched off for the project, so Team HQ does not read it or show what it had read. Switch the source back on, open it in Drive, or use an imported copy.',
  alternatives: ['open_source', 'reconnect'],
  document: doc,
})

export interface PreviewInput {
  readonly plan: PreviewPlan
  /**
   * Asked for only when the source must be contacted, so a request answered from a fresh cache never mints a token.
   * A Failure (not connected, not the operator, refused by Google) is an answer, not an exception.
   */
  readonly provider: () => Promise<PreviewProvider | Failure>
  readonly extractText: ExtractText
  readonly record: Recorder
  readonly now: number
}

/**
 * Answer a preview request from the plan, the cache and (only when needed) the source.
 *
 * The decision order is the safety order: does the document exist for this office and project; is it Team HQ's own;
 * is its source connected; can anything real read it; is the cache still the source's; and only then is content fetched.
 */
export async function previewDocument(input: PreviewInput): Promise<PreviewResult> {
  const { plan } = input
  if (!plan.ok || plan.document === undefined) {
    return {
      state: 'failed',
      reason_code: 'not_found',
      reason: plan.error ?? 'There is no document with that id in this project.',
      retryable: false,
      alternatives: [],
    }
  }
  const doc = { id: plan.document.id, title: plan.document.title }
  const base = { document: doc, imported: plan.imported === true }

  // Team HQ's own: nothing to fetch. The page draws it from the file or text it already holds.
  if (plan.mode === 'held') {
    return {
      ...base,
      state: 'ready',
      kind: 'held',
      payload: { type: 'held' },
      mode: 'held',
      alternatives: [],
      source: { connector: null, url: null, modified: null },
    }
  }

  if (plan.document.state === 'archived') {
    return {
      ...base,
      state: 'unsupported',
      reason_code: 'archived',
      reason: 'This document is archived, so it is not read or shown from its source.',
      alternatives: ['open_source'],
    }
  }
  // 0896: a disconnected source's content has left active retrieval. It is neither fetched nor shown from the cache.
  if (plan.connected === false) return { ...base, ...disconnected(doc) }

  const connector = plan.document.connector
  const cache = plan.cache ?? null
  const cached = cache !== null
  const checkedAgo = cache?.last_checked_at
    ? (input.now - (ms(cache.last_checked_at) ?? 0)) / 1000
    : Infinity

  // Anything but Drive: Team HQ reads only what the source's own sync already indexed. No on-demand read exists for it.
  if (connector !== 'drive') {
    const picture = drawableKind(plan.document.mime_type)
    if (picture !== null) {
      return {
        ...base,
        state: 'unsupported',
        reason_code: 'no_on_demand_reader',
        reason: `Team HQ cannot draw this ${picture === 'pdf' ? 'PDF' : 'picture'} from ${connector === null ? 'its source' : `a ${connector}`} here. Open the source to see its pages. The text Team HQ indexed from it is kept for search, not shown as the document.`,
        alternatives: ALTS_BASE,
      }
    }
    const text = (plan.text ?? '').trim()
    if (text !== '') {
      const capped = capText(text)
      return {
        ...base,
        state: 'ready',
        kind: 'text',
        mode: 'indexed',
        alternatives: ALTS_BASE,
        payload: {
          type: 'text',
          text: capped.text,
          format: 'plain',
          truncated: capped.truncated,
          chars: capped.text.length,
        },
        source: { connector, url: null, modified: cache?.source_modified_time ?? null },
        cache: {
          fetched_at: cache?.fetched_at ?? null,
          source_modified_time: null,
          refetched: false,
          was_stale: false,
        },
        notice: `This is the text Team HQ indexed from ${connector ?? 'the source'} earlier. It is not read live.`,
      }
    }
    return {
      ...base,
      state: 'unsupported',
      reason_code: 'no_on_demand_reader',
      reason: `Team HQ cannot read ${connector === null ? 'this' : `a ${connector}`} document on demand yet, and has not indexed any of its text. Open the source, or import it.`,
      alternatives: ALTS_BASE,
    }
  }

  // From here: a Drive document with a connected source.
  const ref = plan.document.external_ref ?? ''
  const cachedText = (plan.text ?? '').trim()
  const shape = (c: CacheRow | null): CacheInfo => ({
    fetched_at: c?.fetched_at ?? null,
    source_modified_time: c?.source_modified_time ?? null,
    refetched: false,
    was_stale: false,
  })
  const fromCache = (stale?: {
    reason: string
    code: string
    retryable: boolean
  }): PreviewResult | null => {
    if (cache === null) return null
    const picture = drawableKind(cache.source_mime ?? plan.document?.mime_type)
    if (cache.kind === 'text' && cachedText !== '' && picture === null) {
      const capped = capText(cachedText)
      return {
        ...base,
        state: stale === undefined ? 'ready' : 'stale',
        kind: 'text',
        mode: 'on_demand',
        alternatives: stale?.retryable === true ? (['retry', ...ALTS_BASE] as const) : ALTS_BASE,
        payload: {
          type: 'text',
          text: capped.text,
          format:
            cache.source_mime === 'text/csv' ||
            cache.source_mime === 'application/vnd.google-apps.spreadsheet'
              ? 'csv'
              : 'plain',
          truncated: cache.truncated || capped.truncated,
          chars: capped.text.length,
        },
        ...(stale === undefined
          ? {}
          : { reason: stale.reason, reason_code: stale.code, retryable: stale.retryable }),
        cache: shape(cache),
        source: { connector: 'drive', url: null, modified: cache.source_modified_time },
      }
    }
    if (cache.kind === 'pdf' || cache.kind === 'image' || picture !== null) {
      return {
        ...base,
        state: stale === undefined ? 'ready' : 'stale',
        kind: picture ?? (cache.kind === 'image' ? 'image' : 'pdf'),
        mode: 'on_demand',
        alternatives: stale?.retryable === true ? (['retry', ...ALTS_BASE] as const) : ALTS_BASE,
        payload: { type: 'stream', mime: cache.source_mime ?? '', size: null, name: doc.title },
        ...(stale === undefined
          ? {}
          : { reason: stale.reason, reason_code: stale.code, retryable: stale.retryable }),
        cache: shape(cache),
        source: { connector: 'drive', url: null, modified: cache.source_modified_time },
      }
    }
    return null
  }

  // Inside the freshness window nothing is asked of Drive.
  if (cache !== null && checkedAgo < LIMITS.freshSeconds) {
    const hit = fromCache()
    if (hit !== null) return hit
  }

  const got = await input.provider()
  if (!('describe' in got)) {
    const why = got
    const stale = fromCache({
      reason: `Team HQ could not check Drive: ${why.message} Showing what it read last time.`,
      code: why.code,
      retryable: why.retryable,
    })
    if (stale !== null) return stale
    return {
      ...base,
      state: 'failed',
      reason_code: why.code,
      reason: why.message,
      retryable: why.retryable,
      alternatives: why.retryable ? ['retry', 'open_source', 'import'] : ['open_source', 'import'],
    }
  }
  const provider: PreviewProvider = got

  const described = await provider.describe(ref)
  if (!described.ok) {
    const f = described.failure
    // A file that is gone is not served from the cache as if it were not: that would hide it.
    if (f.code !== 'not_found') {
      const stale = fromCache({
        reason: `${f.message} Showing what Team HQ read last time.`,
        code: f.code,
        retryable: f.retryable,
      })
      if (stale !== null) return stale
    }
    return {
      ...base,
      state: 'failed',
      reason_code: f.code,
      reason: f.message,
      retryable: f.retryable,
      alternatives: f.retryable ? ['retry', 'open_source', 'import'] : ['open_source', 'import'],
    }
  }
  const meta = described.meta
  const source = { connector: 'drive', url: meta.webViewLink, modified: meta.modifiedTime }
  if (meta.trashed) {
    return {
      ...base,
      state: 'failed',
      reason_code: 'not_found',
      reason: 'This file is in the Drive bin, so it is not shown.',
      retryable: false,
      alternatives: ['import'],
      source,
    }
  }

  const how = provider.howToShow(meta)
  if (how.kind === 'unsupported') {
    return {
      ...base,
      state: 'unsupported',
      reason_code: 'unsupported_format',
      reason: how.reason,
      alternatives: ALTS_BASE,
      source,
    }
  }

  const changed = sourceChanged(cache, meta)
  const wasStale = cached && changed

  // PDF and image: the bytes are streamed by the next request and are never kept. The text, thumbnail-free, is derived
  // there, where the bytes are in hand. Here only the verdict and the notice are decided.
  if (how.kind === 'pdf' || how.kind === 'image') {
    return {
      ...base,
      state: 'ready',
      kind: how.kind,
      mode: 'on_demand',
      alternatives: ALTS_BASE,
      payload: { type: 'stream', mime: meta.mime, size: meta.size, name: meta.name || doc.title },
      source,
      cache: {
        fetched_at: cache?.fetched_at ?? null,
        source_modified_time: meta.modifiedTime,
        refetched: false,
        was_stale: wasStale,
      },
      ...(wasStale
        ? {
            notice:
              'Drive has a newer version of this file than the one Team HQ last read. This is the current one.',
          }
        : {}),
    }
  }

  // Text. Unchanged and held: nothing is fetched; only the check is remembered.
  if (!changed && cachedText !== '' && cache !== null) {
    await input
      .record({ meta, kind: 'text', text: null, truncated: cache.truncated })
      .catch(() => false)
    const capped = capText(cachedText)
    return {
      ...base,
      state: 'ready',
      kind: 'text',
      mode: 'on_demand',
      alternatives: ALTS_BASE,
      payload: {
        type: 'text',
        text: capped.text,
        format: how.format,
        truncated: cache.truncated || capped.truncated,
        chars: capped.text.length,
      },
      source,
      cache: {
        fetched_at: cache.fetched_at,
        source_modified_time: cache.source_modified_time,
        refetched: false,
        was_stale: false,
      },
    }
  }

  const failedFrom = (f: Failure): PreviewResult => {
    const stale =
      f.code === 'not_found'
        ? null
        : fromCache({
            reason: `${f.message} Showing what Team HQ read last time.`,
            code: f.code,
            retryable: f.retryable,
          })
    if (stale !== null) return { ...stale, source }
    return {
      ...base,
      state: 'failed',
      reason_code: f.code,
      reason: f.message,
      retryable: f.retryable,
      alternatives: f.retryable ? ['retry', 'open_source', 'import'] : ['open_source', 'import'],
      source,
    }
  }
  let text = ''
  if (how.via === 'extract') {
    // A Word file is bytes: read them once, take the text out in passing, keep neither the file nor its bytes.
    const raw = await provider.fetchBytes(ref, meta)
    if (!raw.ok) return failedFrom(raw.failure)
    const read = await input.extractText(raw.bytes, meta.mime, meta.name)
    if (read.text === null || read.text.trim() === '') {
      return {
        ...base,
        state: 'unsupported',
        reason_code: 'no_text',
        reason: `Team HQ could not read any text from this file${read.why === undefined ? '' : ` (${read.why})`}. Open it in Drive, or import it to keep a copy.`,
        alternatives: ALTS_BASE,
        source,
      }
    }
    text = read.text
  } else {
    const fetched = await provider.fetchText(ref, meta, how)
    if (!fetched.ok) return failedFrom(fetched.failure)
    text = fetched.text
  }
  if (text.trim() === '') {
    return {
      ...base,
      state: 'unsupported',
      reason_code: 'no_text',
      reason: 'This file has no text in it.',
      alternatives: ALTS_BASE,
      source,
    }
  }
  const capped = capText(text)
  const recorded = await input
    .record({ meta, kind: 'text', text: capped.text, truncated: capped.truncated })
    .catch(() => false)
  return {
    ...base,
    state: 'ready',
    kind: 'text',
    mode: 'on_demand',
    alternatives: ALTS_BASE,
    payload: {
      type: 'text',
      text: capped.text,
      format: how.format,
      truncated: capped.truncated,
      chars: capped.text.length,
      ...(how.format === 'csv' && meta.mime === 'application/vnd.google-apps.spreadsheet'
        ? { note: 'First sheet only. Open the source for the others.' }
        : {}),
    },
    source,
    cache: {
      fetched_at: recorded ? new Date(input.now).toISOString() : null,
      source_modified_time: meta.modifiedTime,
      refetched: true,
      was_stale: wasStale,
    },
    ...(wasStale
      ? { notice: 'Drive changed this file since Team HQ last read it, so it was read again.' }
      : {}),
  }
}

/**
 * The bytes for the viewer, from the source and into the response. Returns a refusal as a result, never throws.
 * Nothing is stored; the text is read in passing and handed to `record` so agents can search it.
 */
export async function streamDocument(input: {
  readonly plan: PreviewPlan
  readonly provider: PreviewProvider
  readonly extractText: ExtractText
  readonly record: Recorder
}): Promise<
  | { readonly ok: true; readonly bytes: Uint8Array; readonly mime: string; readonly name: string }
  | { readonly ok: false; readonly status: number; readonly failure: Failure }
> {
  const { plan, provider } = input
  if (
    !plan.ok ||
    plan.document === undefined ||
    plan.mode !== 'external' ||
    plan.document.connector !== 'drive'
  ) {
    return {
      ok: false,
      status: 404,
      failure: {
        code: 'not_found',
        retryable: false,
        message: 'There is no document with that id in this project.',
      },
    }
  }
  if (plan.connected === false) {
    return {
      ok: false,
      status: 409,
      failure: {
        code: 'forbidden',
        retryable: false,
        message: 'This source is switched off for the project.',
      },
    }
  }
  if (plan.document.state === 'archived') {
    return {
      ok: false,
      status: 409,
      failure: { code: 'forbidden', retryable: false, message: 'This document is archived.' },
    }
  }
  const ref = plan.document.external_ref ?? ''
  const described = await provider.describe(ref)
  if (!described.ok)
    return {
      ok: false,
      status: described.failure.code === 'not_found' ? 404 : 502,
      failure: described.failure,
    }
  const meta = described.meta
  if (meta.trashed)
    return {
      ok: false,
      status: 404,
      failure: { code: 'not_found', retryable: false, message: 'This file is in the Drive bin.' },
    }
  const how = provider.howToShow(meta)
  if (how.kind !== 'pdf' && how.kind !== 'image') {
    return {
      ok: false,
      status: 415,
      failure: {
        code: 'bad_content',
        retryable: false,
        message: 'Only a PDF or an image is streamed.',
      },
    }
  }
  const got = await provider.fetchBytes(ref, meta)
  if (!got.ok)
    return {
      ok: false,
      status: got.failure.code === 'too_large' ? 413 : got.failure.code === 'not_found' ? 404 : 502,
      failure: got.failure,
    }
  // The label is Drive's; the bytes must agree with it before they are served inline.
  if (!sniff(got.bytes, meta.mime)) {
    return {
      ok: false,
      status: 415,
      failure: {
        code: 'bad_content',
        retryable: false,
        message: 'The file is not what Drive says it is, so it is not shown.',
      },
    }
  }
  // Derive the text in passing (PDF only); the bytes themselves go nowhere but the response.
  let text: string | null = null
  let truncated = false
  if (how.kind === 'pdf' && sourceChanged(plan.cache ?? null, meta)) {
    const read = await input
      .extractText(got.bytes, meta.mime, meta.name)
      .catch(() => ({ text: null }))
    if (read.text !== null && read.text.trim() !== '') {
      const capped = capText(read.text)
      text = capped.text
      truncated = capped.truncated
    }
  }
  await input.record({ meta, kind: how.kind, text, truncated }).catch(() => false)
  return { ok: true, bytes: got.bytes, mime: meta.mime, name: meta.name }
}

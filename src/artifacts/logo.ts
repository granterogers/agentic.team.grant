/**
 * Getting a project style's logo into the renderer as bytes, and failing OPEN.
 *
 * `StyleProfile.logo_document_id` is a reference to a document the project holds (an uploaded PNG or JPEG). The
 * renderer never fetches: it is handed bytes (`ReportAssets.logo`). This is the one place that turns the reference
 * into bytes, and the way to get them is INJECTED so a test supplies a fixture and never touches the network.
 *
 * A logo that cannot be had (no such document, not an image, too large, unsupported, storage unreachable) is never an
 * error: the report is made without it and the reason comes back as a sentence the caller says to the person.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { signedUrl } from '../files/store.ts'
import { MAX_IMAGE_BYTES, type PdfImage, readImage } from './image.ts'
import type { StyleProfile } from './style.ts'

export type FetchLogoBytes = (storagePath: string) => Promise<Uint8Array | null>

export interface LoadedLogo {
  readonly logo: PdfImage | null
  /** Set when the style asked for a logo and it could not be drawn. */
  readonly logoProblem?: string
}

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The production fetcher: a short-lived signed link, then the bytes, refusing anything over the size limit. */
export function storageFetcher(
  projectRef: string,
  serviceKey: string,
  fetchImpl: typeof fetch = fetch,
): FetchLogoBytes {
  return async (path) => {
    const url = await signedUrl(projectRef, serviceKey, path, 60, fetchImpl)
    if (url === null) return null
    const r = await fetchImpl(url)
    if (!r.ok) return null
    const declared = Number(r.headers.get('content-length') ?? 0)
    if (declared > MAX_IMAGE_BYTES) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    return buf
  }
}

export async function loadLogo(
  db: SqlExecutor,
  where: { readonly office: string },
  style: StyleProfile | null,
  fetchBytes: FetchLogoBytes,
): Promise<LoadedLogo> {
  const id = style?.logo_document_id
  if (id === undefined) return { logo: null }
  const problem = (why: string): LoadedLogo => ({ logo: null, logoProblem: why })
  try {
    if (!UUID.test(id)) return problem('the style names a logo that is not a document id')
    const { rows } = await db.execute(
      `select storage_path, mime_type, byte_size from public.documents
        where document_id = ${lit(id)}::uuid and office_id = ${lit(where.office)}::uuid`,
    )
    const row = rows[0] as
      | { storage_path?: unknown; mime_type?: unknown; byte_size?: unknown }
      | undefined
    if (row === undefined) return problem('the logo document is not held by this office any more')
    const path = typeof row.storage_path === 'string' ? row.storage_path : ''
    if (path === '') return problem('the logo document holds no file')
    if (Number(row.byte_size ?? 0) > MAX_IMAGE_BYTES)
      return problem(
        `the logo file is ${String(Math.round(Number(row.byte_size) / 1024))} kB, over the ${String(MAX_IMAGE_BYTES / 1024)} kB limit`,
      )
    const bytes = await fetchBytes(path)
    if (bytes === null) return problem('the logo file could not be fetched from storage')
    const read = readImage(bytes)
    return read.ok ? { logo: read.image } : problem(read.reason)
  } catch (e) {
    return problem(`the logo could not be loaded (${(e as Error).message})`)
  }
}

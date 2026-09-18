/**
 * Watching a Drive folder, and asking rather than acting.
 *
 * Issue #62. Grant: *"anytime I drop a document in there, chief of staff is
 * like, oh, we see that a file has been dropped in Google Drive. What would you
 * like me to do with that?"*
 *
 * ## The changes feed, not a folder listing
 *
 * Drive hands out a start token and then tells you what changed since it. The
 * obvious alternative is to list the folder every pass and diff it, and it is
 * wrong in a way that only shows up later: a renamed file reads as one deletion
 * and one arrival, so Grant is asked about a document he already answered
 * about. Worse, a folder of two hundred files costs two hundred rows of listing
 * every ten minutes to notice nothing.
 *
 * ## Read-only, and the scope says so
 *
 * `drive.readonly`, per `google_services`. Nothing in this file writes to
 * Grant's Drive, and a caller that wanted to would have to widen the scope,
 * reconnect, and add a function whose name admits it — the same rule
 * `calendar.ts` states for events.
 *
 * ## Why the folder filter is ours and not Google's
 *
 * The changes feed is account-wide. There is no "changes in this folder"
 * endpoint, so every change comes back and this file decides which folder it
 * belongs to by reading `parents`. That is a real cost — a busy Drive produces
 * changes we discard — and it is the only way the API offers. Filtering here
 * rather than asking for less is a limitation of Drive, not a shortcut.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { type GoogleAccess, googleAccess } from './auth.ts'

export interface DriveFile {
  readonly id: string
  readonly name: string
  readonly mimeType: string
  readonly webViewLink: string | null
  readonly modifiedTime: string | null
  readonly trashed: boolean
  readonly parents: readonly string[]
}

export interface DriveChanges {
  readonly files: readonly DriveFile[]
  /** The token to use next time. Null means the call failed. */
  readonly nextToken: string | null
  readonly error: string | null
}

const API = 'https://www.googleapis.com/drive/v3'

/** Everything the changes feed returns for a file, in one place. */
const FIELDS =
  'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,' +
  'webViewLink,modifiedTime,trashed,parents))'

/**
 * A fresh cursor, for a folder that has just been attached.
 *
 * Taken and stored WITHOUT reporting anything. A folder attached today may hold
 * hundreds of files put there last year, and a watcher that treats its first
 * listing as arrivals would open with two hundred questions. See
 * `drive_watch.primed`.
 */
export async function startToken(
  access: GoogleAccess,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const r = await fetchImpl(`${API}/changes/startPageToken`, {
    headers: { Authorization: `Bearer ${access.accessToken}` },
  })
  if (!r.ok) return null
  const body = (await r.json()) as { startPageToken?: string }
  return body.startPageToken ?? null
}

/**
 * What has changed in one folder since its token.
 *
 * Paginates, because a token untouched for a week can have more changes behind
 * it than one page holds — and stopping at the first page would advance the
 * cursor past changes nobody looked at, losing them silently. That is the worst
 * possible failure for a watcher: it would keep working, and quietly miss
 * things.
 */
export async function changesIn(
  access: GoogleAccess,
  folderId: string,
  pageToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DriveChanges> {
  const seen = new Map<string, DriveFile>()
  let token: string | null = pageToken
  let next: string | null = null

  // A bound, because a page loop against a remote API is an infinite loop
  // waiting for a bug at the other end.
  for (let page = 0; page < 20 && token !== null; page++) {
    const url =
      `${API}/changes?pageToken=${encodeURIComponent(token)}` +
      `&fields=${encodeURIComponent(FIELDS)}&pageSize=200&includeRemoved=true`
    const r: Response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${access.accessToken}` },
    })
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200)
      return { files: [], nextToken: null, error: `drive ${String(r.status)}: ${detail}` }
    }
    const body = (await r.json()) as {
      changes?: {
        fileId?: string
        removed?: boolean
        file?: {
          id?: string
          name?: string
          mimeType?: string
          webViewLink?: string
          modifiedTime?: string
          trashed?: boolean
          parents?: string[]
        }
      }[]
      nextPageToken?: string
      newStartPageToken?: string
    }

    for (const change of body.changes ?? []) {
      const f = change.file
      // A removal carries no file object, so there is nothing to attribute to a
      // folder — and a file leaving is not something to ask Grant about anyway.
      if (change.removed === true || f === undefined) continue
      if (f.trashed === true) continue
      if (!(f.parents ?? []).includes(folderId)) continue
      // Keyed by id, so a file changed three times in one window is one
      // arrival rather than three questions.
      seen.set(String(f.id ?? change.fileId ?? ''), {
        id: String(f.id ?? ''),
        name: String(f.name ?? 'untitled'),
        mimeType: String(f.mimeType ?? ''),
        webViewLink: f.webViewLink ?? null,
        modifiedTime: f.modifiedTime ?? null,
        trashed: false,
        parents: f.parents ?? [],
      })
    }

    token = body.nextPageToken ?? null
    if (body.newStartPageToken !== undefined) next = body.newStartPageToken
  }

  return { files: [...seen.values()], nextToken: next ?? pageToken, error: null }
}

/** Whether Drive is reachable at all, with the scope this needs. */
export async function driveAccess(
  db: SqlExecutor,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleAccess | { ok: false; reason: string }> {
  const access = await googleAccess(db, fetchImpl)
  if (!access.ok) return access
  const has = access.scopes.some((s) => s.includes('drive'))
  if (!has) {
    /*
      Named as a scope problem, not a failure.

      The remedy is a reconnect. Reporting "Drive did not work" would send him
      to look at the folder, which is fine — the missing thing is a permission
      he never granted, and only the message can say so.

      `recordGoogleHealth` writes one row for the whole Google connection, so
      it is NOT called here: overwriting the shared health row with a
      Drive-specific complaint would make Calendar and Mail look broken too.
    */
    return { ok: false, reason: 'Google is connected but Drive access was not granted' }
  }
  return access
}

/**
 * What Drive gives back when you ask for a file itself.
 *
 * `bytes` for anything with a real file behind it; `text` for a Google Doc,
 * which has no bytes to download and must be EXPORTED into a format that does.
 * Never both — the caller stores one or reads the other.
 */
export interface DriveContent {
  readonly bytes: Uint8Array | null
  readonly text: string | null
  /** The mime type of what came back, which for an export is not the file's. */
  readonly mime: string
  readonly error: string | null
}

/**
 * Google's own formats have no bytes, so they are exported instead.
 *
 * A Doc, Sheet or Slides file is a server-side object; `alt=media` on one
 * answers 403 with "Only files with binary content can be downloaded". The
 * export target is chosen for what the office does with it — plain text for a
 * Doc, because the corpus is text and a .docx would have to be parsed by
 * something that does not exist here; CSV for a Sheet for the same reason.
 * PDF for Slides, because slides as plain text are meaningless and a PDF is at
 * least readable in the studio's own viewer (#96).
 */
const EXPORT_AS: Readonly<Record<string, string>> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'application/pdf',
}

/** Whether this mime type is one of Google's own server-side formats. */
export const isGoogleFormat = (mime: string): boolean =>
  mime.startsWith('application/vnd.google-apps.')

/**
 * Read one file out of Drive.
 *
 * `drive.readonly` already permits this — readonly restricts WRITES, not
 * downloads — so this needs no new scope, no reconnect and no credential
 * Grant has not already granted. That matters, because
 * `connector_capabilities` has claimed since 0300 that the office can
 * *"read a file's text"* through Drive, marked `verified_by: 'suite'`, with
 * nothing in the repository implementing it. Every agent's connector sheet has
 * been telling them so. This is the function that makes the claim true; the
 * alternative was disabling the row, and a capability the credential already
 * covers is worth ten minutes rather than a retraction.
 *
 * A folder is refused rather than downloaded, because `alt=media` on one
 * returns a confusing 403 rather than saying what is wrong.
 *
 * The size ceiling is the bucket's (0205), checked BEFORE the download rather
 * than after: fetching ninety megabytes to discover it cannot be stored spends
 * the bandwidth and the time for nothing.
 */
export async function readFile(
  access: GoogleAccess,
  fileId: string,
  mimeType: string,
  fetchImpl: typeof fetch = fetch,
  maxBytes = 100 * 1024 * 1024,
): Promise<DriveContent> {
  const fail = (error: string): DriveContent => ({ bytes: null, text: null, mime: '', error })

  if (mimeType === 'application/vnd.google-apps.folder') {
    return fail('that is a folder, not a file')
  }

  const exportAs = EXPORT_AS[mimeType]
  if (isGoogleFormat(mimeType) && exportAs === undefined) {
    return fail(`Drive cannot export a ${describeKind(mimeType)}`)
  }

  const url =
    exportAs === undefined
      ? `${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
      : `${API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportAs)}`

  const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${access.accessToken}` } })
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 200)
    return fail(`drive ${String(r.status)}: ${detail}`)
  }

  /*
    The header is a hint, not a promise — Drive omits it on some exports — so
    it is checked when present and the real length is checked after. Both, not
    either: the header saves a pointless download and only the real length is
    true.
  */
  const claimed = Number(r.headers.get('content-length') ?? '0')
  if (claimed > maxBytes) {
    return fail(`that file is ${String(Math.round(claimed / 1024 / 1024))} MB, over the limit`)
  }

  const buffer = await r.arrayBuffer()
  if (buffer.byteLength > maxBytes) {
    return fail(
      `that file is ${String(Math.round(buffer.byteLength / 1024 / 1024))} MB, over the limit`,
    )
  }
  if (buffer.byteLength === 0) return fail('Drive returned an empty file')

  /*
    An export comes back as TEXT and is stored as text; a download comes back
    as BYTES and is stored in the bucket. Returning both for either would make
    every caller decide which one it meant, which is the decision this
    function exists to make once.

    A PDF export (Slides) is the exception the shape already covers: it is a
    binary export, so it takes the bytes branch by its target mime type rather
    than by whether it was exported.
  */
  const outMime = exportAs ?? mimeType
  const isText = outMime.startsWith('text/') || outMime === 'application/json'
  if (isText) {
    return { bytes: null, text: new TextDecoder().decode(buffer), mime: outMime, error: null }
  }
  return { bytes: new Uint8Array(buffer), text: null, mime: outMime, error: null }
}

/** A person's description of a Drive mime type. */
export function describeKind(mime: string): string {
  if (mime === 'application/vnd.google-apps.folder') return 'folder'
  if (mime === 'application/vnd.google-apps.document') return 'Google Doc'
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'Google Sheet'
  if (mime === 'application/vnd.google-apps.presentation') return 'Google Slides'
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('audio/')) return 'audio file'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'image'
  if (mime.includes('word')) return 'Word document'
  if (mime.includes('sheet') || mime.includes('excel')) return 'spreadsheet'
  return 'file'
}

/**
 * Everything in a folder, right now — the backstop the changes feed cannot be.
 *
 * ## Why this exists beside `changesIn`, which argues against listing
 *
 * The header of this file is emphatic that a folder LISTING is the wrong tool
 * for change detection, and it is right: a renamed file reads as one deletion
 * and one arrival, and two hundred files cost two hundred rows every ten
 * minutes to notice nothing. None of that is retracted.
 *
 * It is the wrong tool for a different question. **A changes feed cannot tell
 * you what is still there.** A `removed` change carries no file object at all,
 * so there is nothing to attribute to a folder; a page token that expires or a
 * pass that errors loses events permanently; and a file trashed while the
 * office was not watching never produces a change anybody sees. So the office
 * would go on answering from a document Grant deleted from Drive weeks ago,
 * with nothing anywhere able to notice — which is the false-presence twin of
 * the false-absence failure `verify:browse-live`'s text floor exists for.
 *
 * `app.reconcile_vanished` already solves the whole problem for NotebookLM,
 * connector-agnostically, with a blast-radius guard and a two-strike rule. It
 * needs one thing this file could not previously give it: the list of ids that
 * ARE there. That is all this function is.
 *
 * ## The cost, and how it is bounded
 *
 * It is paid at most once a day per folder, by the caller, and only for a
 * folder the office actually holds indexed documents for. The changes feed
 * keeps doing the fast work every pass; this answers the slow question that
 * the fast one structurally cannot.
 */
export async function listFolder(
  access: GoogleAccess,
  folderId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ readonly ids: readonly string[]; readonly error: string | null }> {
  const ids: string[] = []
  let token: string | null = null

  // The same bound as `changesIn`, for the same reason: a page loop against a
  // remote API is an infinite loop waiting for a bug at the other end. Twenty
  // pages of 200 is 4,000 files, which is a folder nobody should be watching.
  for (let page = 0; page < 20; page++) {
    const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`
    const url =
      `${API}/files?q=${encodeURIComponent(q)}` +
      `&fields=${encodeURIComponent('nextPageToken,files(id)')}&pageSize=200` +
      (token === null ? '' : `&pageToken=${encodeURIComponent(token)}`)

    const r: Response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${access.accessToken}` },
    })
    if (!r.ok) {
      /*
        A partial listing is worse than none.

        `reconcile_vanished` reads absence from this list, so half a folder
        would say half its files had been deleted — and the blast-radius guard
        would refuse it, which is the guard working and is still a pass spent
        reporting a failure as a refusal. The ids gathered so far are dropped
        deliberately.
      */
      return { error: `drive ${String(r.status)}: ${(await r.text()).slice(0, 200)}`, ids: [] }
    }
    const body = (await r.json()) as {
      files?: { id?: string }[]
      nextPageToken?: string
    }
    for (const f of body.files ?? []) if (f.id !== undefined) ids.push(f.id)
    token = body.nextPageToken ?? null
    if (token === null) return { error: null, ids }
  }
  /*
    Ran out of pages with more to come. Reported as an error rather than as a
    short list, because a truncated listing handed to `reconcile_vanished`
    would say every file past page twenty had been deleted.
  */
  return { error: 'the folder has more files than this can list in one pass', ids: [] }
}

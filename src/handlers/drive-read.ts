/**
 * Reading a file out of Drive and into the project.
 *
 * Issue #96. `drive.watch` has asked *"What would you like me to do with
 * them?"* since #62 and offered *"Add them to the project as source
 * documents"* as the first option — implemented by nothing. This is that
 * option.
 *
 * It is also the honesty fix for #51. `connector_capabilities` claimed the
 * office could read a Drive file's text, marked `verified_by: 'suite'`, with
 * no code behind it. 0332 corrects the row; this makes the corrected row true.
 *
 * ## No new permission
 *
 * `drive.readonly` already covers `files.get?alt=media` and `files.export` —
 * readonly restricts writes, not downloads. So this needed a function, not a
 * reconsent, which is why implementing it beat retracting the claim.
 *
 * ## What a file becomes
 *
 * A Google Doc exports to text and becomes a readable document. A PDF
 * downloads to bytes, lands in the private `files` bucket, and becomes a
 * document the studio's reader renders — the whole point of #96, which has
 * been unable to demonstrate its own headline feature because not one PDF in
 * the office has ever had a file behind it.
 *
 * Never both, and not because it would be hard: nothing here parses a PDF, so
 * claiming to have read a PDF's text would be the same class of lie this
 * handler exists to remove.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { extensionFor, filePath, putFile } from '../files/store.ts'
import { describeKind, driveAccess, readFile } from '../google/drive.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { fileText } from '../text/file-text.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface DriveReadDeps {
  readonly db: SqlExecutor
  readonly projectRef: string
  readonly serviceKey: string
  readonly fetchImpl?: typeof fetch
}

interface Payload {
  readonly file_id?: string
  readonly folder_id?: string
  readonly project_id?: string
  readonly mime_type?: string
  readonly title?: string
}

export function driveReadHandler(deps: DriveReadDeps): Handler {
  const fetchImpl = deps.fetchImpl ?? fetch

  return {
    kind: 'drive.read_file',
    handle: async (job: Job): Promise<HandlerOutput> => {
      /*
        Deterministic throughout. This fetches a named file and records it —
        there is no judgement anywhere in it, and #186's rule then keeps the
        confidence caption and the feedback buttons off the message, because
        there is nothing in "read one file" to thumb down.
      */
      const said = (body: string, ok: boolean): HandlerOutput => ({
        body,
        announce: ok,
        confidence: ok ? 'high' : 'low',
        evidence: ok ? 'verified' : 'inferred',
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
      })

      // raw-sql[2]: keyed by the claimed job; it reads the payload of the job the worker holds.
      const { rows } = await deps.db.execute(
        `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
      )
      const p = ((rows[0] as { pinned_config?: Payload } | undefined)?.pinned_config ??
        {}) as Payload

      const fileId = String(p.file_id ?? '').trim()
      const folderId = String(p.folder_id ?? '').trim()
      const projectId = String(p.project_id ?? job.projectId ?? '').trim()
      if (fileId === '' || folderId === '' || projectId === '') {
        return said(
          'I need a Drive file, the folder it is in, and a project to file it under.',
          false,
        )
      }

      const access = await driveAccess(deps.db, fetchImpl)
      if (!('accessToken' in access)) {
        // The scope story, in its own words. "Drive did not work" would send
        // him to look at the folder; the missing thing is a permission.
        return said(access.reason, false)
      }

      const mime = String(p.mime_type ?? 'application/octet-stream')
      const got = await readFile(access, fileId, mime, fetchImpl)
      if (got.error !== null) {
        return said(`I could not read that ${describeKind(mime)} — ${got.error}`, false)
      }

      const title = String(p.title ?? '').trim()

      // A PDF or Word file arrives as bytes (#419). Its text is read here, so a Drive file is searchable like an
      // uploaded one; a scan or an unreadable file leaves the text null, which is true, and the bytes are still kept.
      const readable = got.bytes === null ? null : await fileText(got.bytes, got.mime, title)
      const indexText =
        got.text ?? (readable !== null && readable.text !== null ? readable.text : null)

      /*
        The document row first, then the bytes.

        This order matters on a failure: a document with no file is a document
        that is merely thin, and the next read fills it in. A file in the
        bucket with no document pointing at it is an orphan nothing will ever
        find or delete, in a 1 GB allowance.
      */
      const recorded = (
        await deps.db.execute(`
          select app.record_drive_document(
            app.job_office(${lit(job.jobId)}::uuid), ${lit(projectId)}::uuid, ${lit(folderId)}, ${lit(fileId)}, ${lit(title)},
            ${indexText === null ? 'null' : lit(indexText)}, 'chief-of-staff') as r
        `)
      ).rows[0] as { r?: { ok?: boolean; document?: string; outcome?: string; error?: string } }
      const doc = recorded.r
      if (doc?.ok !== true || doc.document === undefined) {
        return said(`I read the file but could not record it — ${String(doc?.error)}`, false)
      }

      if (got.text !== null) {
        const chars = got.text.length
        return said(
          `Read “${title === '' ? fileId : title}” from Drive — ${String(chars)} characters, ` +
            `${doc.outcome === 'unchanged' ? 'unchanged since last time' : String(doc.outcome)}.`,
          doc.outcome !== 'unchanged',
        )
      }

      const bytes = got.bytes
      if (bytes === null) {
        return said('Drive returned neither text nor bytes, which should not happen.', false)
      }

      const path = filePath(projectId, 'drive', fileId, extensionFor(got.mime))
      const stored = await putFile(
        deps.projectRef,
        deps.serviceKey,
        path,
        bytes,
        got.mime,
        fetchImpl,
      )
      if (!stored.ok) {
        return said(
          `I read the file and recorded it, but storing the bytes failed — ${String(stored.error)}. ` +
            'The document is there; the file is not.',
          false,
        )
      }

      const attached = (
        await deps.db.execute(`
          select app.attach_file_to_document(
            app.job_office(${lit(job.jobId)}::uuid), ${lit(doc.document)}::uuid, ${lit(path)}, ${lit(got.mime)},
            ${String(bytes.byteLength)}::bigint) as r
        `)
      ).rows[0] as { r?: { ok?: boolean; error?: string; already_there?: boolean } }
      if (attached.r?.ok !== true) {
        return said(`Stored the file but could not attach it — ${String(attached.r?.error)}`, false)
      }

      const size = `${String(Math.max(1, Math.round(bytes.byteLength / 1024)))} KB`
      return said(
        `Brought “${title === '' ? fileId : title}” in from Drive — ${describeKind(mime)}, ` +
          `${size}. You can read it in the project.`,
        attached.r.already_there !== true,
      )
    },
  }
}

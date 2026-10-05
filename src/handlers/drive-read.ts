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
import { describeKind, driveAccess, fileMeta, readFile } from '../google/drive.ts'
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
  /** Set when an explicit Import press started this read (0960). */
  readonly document_id?: string
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

      /*
        A read that an Import press started says why it failed on the request itself (0960), so the page shows the reason
        and offers the press again instead of staying pending in silence. A read nobody asked to import annotates nothing:
        the function only touches a pending request. Never throws: a database without 0960 has nowhere to say it.
      */
      const importDoc = String(p.document_id ?? '').trim()
      const failed = async (body: string): Promise<HandlerOutput> => {
        if (importDoc !== '') {
          try {
            await deps.db.execute(
              `select app.document_import_note_failure(app.job_office(${lit(job.jobId)}::uuid), ${lit(importDoc)}::uuid, ${lit(body)})`,
            )
          } catch {
            // Said nowhere else: the job's own output already carries the reason.
          }
        }
        return said(body, false)
      }

      const fileId = String(p.file_id ?? '').trim()
      const folderId = String(p.folder_id ?? '').trim()
      const projectId = String(p.project_id ?? job.projectId ?? '').trim()
      if (fileId === '' || folderId === '' || projectId === '') {
        return failed('I need a Drive file, the folder it is in, and a project to file it under.')
      }

      const access = await driveAccess(deps.db, fetchImpl)
      if (!('accessToken' in access)) {
        // The scope story, in its own words. "Drive did not work" would send
        // him to look at the folder; the missing thing is a permission.
        return failed(access.reason)
      }

      /*
        A reference row has no mime type and a Google format is exported where a binary is downloaded, so an import
        started from one asks Drive what the file is first. Only then: a read that already knows (drive.watch) pays nothing.
      */
      let mime = String(p.mime_type ?? '').trim()
      let title = String(p.title ?? '').trim()
      if (mime === '') {
        const meta = await fileMeta(access, fileId, fetchImpl)
        if (meta.error !== null || meta.mimeType === null) {
          return failed(
            `I could not ask Drive what that file is — ${meta.error ?? 'no type was returned'}`,
          )
        }
        mime = meta.mimeType
        if (title === '' && meta.name !== null) title = meta.name
      }
      const got = await readFile(access, fileId, mime, fetchImpl)
      if (got.error !== null) {
        return failed(`I could not read that ${describeKind(mime)} — ${got.error}`)
      }

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
        return failed(`I read the file but could not record it — ${String(doc?.error)}`)
      }

      /*
        A real read replaces any text a PREVIEW derived on demand (0990): the material is now held, so an Import request
        can be completed from it. A database without 0990 has no preview to supersede; nothing else is lost by that.
      */
      try {
        await deps.db.execute(
          `select app.document_preview_mark_read(app.job_office(${lit(job.jobId)}::uuid), ${lit(doc.document)}::uuid)`,
        )
      } catch {
        // No preview cache on this database.
      }

      /*
        An explicit import request (0900, `app.hq_document_import`) waits for exactly this: the material to be held.
        `document_import_fulfil` does nothing unless a person's request is recorded for this very document, so reading
        a file never imports one that nobody asked for. A failure is said, not swallowed: the request stays pending.
      */
      const fulfil = async (document: string): Promise<string> => {
        try {
          const done = (
            await deps.db.execute(
              `select app.document_import_fulfil(app.job_office(${lit(job.jobId)}::uuid), ${lit(document)}::uuid) as r`,
            )
          ).rows[0] as { r?: { fulfilled?: boolean } } | undefined
          return done?.r?.fulfilled === true
            ? ' Your import request is done: a Team HQ copy now exists.'
            : ''
        } catch (e) {
          // A database that has not had 0900 yet has no request to complete: say nothing rather than alarm on every read.
          if (
            e instanceof Error &&
            /document_import_fulfil/.test(e.message) &&
            /does not exist/.test(e.message)
          )
            return ''
          return ` Your import request could not be completed yet (${e instanceof Error ? e.message : String(e)}).`
        }
      }

      if (got.text !== null) {
        const chars = got.text.length
        const imported = await fulfil(doc.document)
        return said(
          `Read “${title === '' ? fileId : title}” from Drive — ${String(chars)} characters, ` +
            `${doc.outcome === 'unchanged' ? 'unchanged since last time' : String(doc.outcome)}.${imported}`,
          doc.outcome !== 'unchanged',
        )
      }

      const bytes = got.bytes
      if (bytes === null) {
        return failed('Drive returned neither text nor bytes, which should not happen.')
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
        return failed(
          `I read the file and recorded it, but storing the bytes failed — ${String(stored.error)}. ` +
            'The document is there; the file is not.',
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
        return failed(`Stored the file but could not attach it — ${String(attached.r?.error)}`)
      }

      const size = `${String(Math.max(1, Math.round(bytes.byteLength / 1024)))} KB`
      const importedFile = await fulfil(doc.document)
      return said(
        `Brought “${title === '' ? fileId : title}” in from Drive — ${describeKind(mime)}, ` +
          `${size}. You can read it in the project.${importedFile}`,
        attached.r.already_there !== true,
      )
    },
  }
}

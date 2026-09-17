/**
 * Where a generated artifact lives, and how it gets there (#258).
 *
 * ## No new table, and that is the finding
 *
 * #258 lists what a durable project record must hold: an id, a project, a
 * title, a MIME type, a storage location, the originating job, who made it,
 * a timestamp, and the sources it was made from. Every one of those is already
 * a column on `public.documents` — #9 and #66 gave it `storage_path`,
 * `mime_type` and `byte_size`, 0284 gave it `origin` and `produced_by`, and
 * `produced_by_job` has been there since the office started making things.
 *
 * So a generated report is a DOCUMENT with `origin = 'made'`, which is also
 * what makes the Issue's other requirement free: it appears in the project's
 * Documents surface and is searchable and reusable, because the page and
 * `app.search_documents` already read that table. A parallel `generated_files`
 * table would have been a second place for the same facts and the copy is
 * always the one that rots (0310).
 *
 * `app.record_file_document` is the writer, and it already existed with
 * exactly the arguments this needs. Called with NAMED arguments: it takes
 * eleven, and CLAUDE.md records what passing the job in the wrong position
 * cost the last time a function of that size was called positionally.
 *
 * ## Storage before the row, never the other way round
 *
 * A row pointing at an object that does not exist is a document the portal
 * offers and cannot open. A file with no row is invisible and costs a few
 * kilobytes of a 1 GB allowance. Only one of those reaches Grant as a defect,
 * so the bytes go first and the row is written only once storage says yes.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { putFile } from '../files/store.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nullable = (v: string | null | undefined): string =>
  v === null || v === undefined || v === '' ? 'null' : lit(v)

export interface ArtifactToStore {
  readonly projectId: string
  readonly jobId: string
  readonly title: string
  readonly bytes: Uint8Array
  readonly mime: string
  readonly extension: string
  /** The agent that produced it, by slug — `documents.produced_by`. */
  readonly producedBy: string
}

export interface StoredArtifact {
  readonly ok: boolean
  readonly documentId: string | null
  readonly path: string | null
  readonly bytes: number
  /** The whole reason it failed, in the words of whatever refused it. */
  readonly error: string | null
}

/**
 * A filename a person would recognise in a chat app.
 *
 * `the-legacy-coaching-course-as-it-stands.pdf`, not a uuid. The storage PATH
 * is still keyed on the job so two runs cannot collide, but the name Telegram
 * shows is the title — a file card reading `a3f9c1b2.pdf` is one nobody opens.
 */
export function filenameFor(title: string, extension: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug === '' ? 'report' : slug}.${extension.replace(/^\.+/, '')}`
}

export async function storeArtifact(
  db: SqlExecutor,
  where: { readonly projectRef: string; readonly serviceKey: string },
  artifact: ArtifactToStore,
): Promise<StoredArtifact> {
  if (where.serviceKey === '') {
    return {
      bytes: artifact.bytes.byteLength,
      documentId: null,
      error: 'no service key, so nothing could be stored',
      ok: false,
      path: null,
    }
  }
  /*
    Keyed on the JOB, not the title.

    Two reports with the same title are two artifacts and must not overwrite
    each other; a retry of the same job is the same artifact and must. The job
    id is the only value with both properties.
  */
  const path = `${artifact.projectId}/made/${artifact.jobId}.${artifact.extension}`
  const stored = await putFile(
    where.projectRef,
    where.serviceKey,
    path,
    artifact.bytes,
    artifact.mime,
  )
  if (!stored.ok) {
    return {
      bytes: stored.bytes,
      documentId: null,
      error: stored.error ?? 'storage refused it and said nothing',
      ok: false,
      path,
    }
  }

  const { rows } = await db.execute(`
    select app.record_file_document(
      p_project_id => ${lit(artifact.projectId)}::uuid,
      p_title => ${lit(artifact.title)},
      p_storage_path => ${lit(path)},
      p_mime_type => ${lit(artifact.mime)},
      p_byte_size => ${String(artifact.bytes.byteLength)}::bigint,
      p_parent_ref => null,
      p_external_ref => ${lit(`made:${artifact.jobId}`)},
      p_duration_s => null,
      p_added_by => ${nullable(artifact.producedBy)},
      p_job_id => ${lit(artifact.jobId)}::uuid,
      p_origin => 'made'
    ) as r`)
  const raw = rows[0]?.r
  const result = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
    document_id?: unknown
    error?: unknown
  }
  if (typeof result?.error === 'string') {
    return {
      bytes: stored.bytes,
      documentId: null,
      error: result.error,
      ok: false,
      path,
    }
  }
  const id = result?.document_id
  if (typeof id !== 'string' || id === '') {
    /*
      A writer that returned no id is a writer that may or may not have
      written. Reported as a failure rather than guessed at, because the
      Issue's rule is that nothing claims an artifact exists unless the
      canonical record says so — and "probably" is not that record.
    */
    return {
      bytes: stored.bytes,
      documentId: null,
      error: 'the document was stored but the record came back without an id',
      ok: false,
      path,
    }
  }
  return { bytes: stored.bytes, documentId: id, error: null, ok: true, path }
}

/**
 * A made report's history: which style it was set in, and whether it is version 1 or version 3 of one document.
 * The SQL is migration 0940; this is the worker's side of it.
 *
 * Nothing here is approval-gated, deliberately: making a PDF, saving it to the project's Documents and making the next
 * version of it are the office's own work inside its own project. Sending it OUT is another matter and is not done
 * here (the handler hands the file to the channel that asked, and anything wider goes through the approval gate).
 */

import { createHash } from 'node:crypto'
import type { SqlExecutor } from '../db/executor.ts'
import type { StyleProfile } from './style.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** A short, stable fingerprint of the style a report was set in. The default look (no profile) is `default`. */
export function styleHash(profile: StyleProfile | null | undefined): string {
  if (profile === null || profile === undefined || Object.keys(profile).length === 0)
    return 'default'
  return createHash('sha256').update(canonical(profile)).digest('hex').slice(0, 12)
}

export interface MadeHead {
  readonly documentId: string
  readonly title: string
  readonly state: string
  readonly version: number
}

const parse = (raw: unknown): Record<string, unknown> | null => {
  const v = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

/** The office's latest made PDF in the project, which a revision would be a new version of. Null when there is none. */
export async function madeHead(
  db: SqlExecutor,
  where: { readonly office: string; readonly projectId: string },
): Promise<MadeHead | null> {
  const { rows } = await db.execute(
    `select app.made_head_for_revision(${lit(where.office)}::uuid, ${lit(where.projectId)}::uuid) as r`,
  )
  const r = parse(rows[0]?.r)
  if (r === null || typeof r.document_id !== 'string') return null
  return {
    documentId: r.document_id,
    state: String(r.state ?? ''),
    title: String(r.title ?? ''),
    version: Number(r.version ?? 1),
  }
}

/** When the style in force was last changed, or null (no style row, or the lookup is unavailable: it fails open). */
export async function styleUpdatedAt(
  db: SqlExecutor,
  where: { readonly office: string; readonly projectId: string },
): Promise<string | null> {
  try {
    const { rows } = await db.execute(
      `select app.style_stamp(${lit(where.office)}::uuid, ${lit(where.projectId)}::uuid) as r`,
    )
    const at = parse(rows[0]?.r)?.updated_at
    return typeof at === 'string' ? at : null
  } catch {
    return null
  }
}

export interface Provenance {
  readonly jobId: string
  readonly styleHash: string
  readonly styleUpdatedAt: string | null
  readonly design: Record<string, unknown>
  readonly sources: readonly { readonly label: string; readonly ref: string }[]
  /** The style the report was set in, so it can be adopted as the project's (0970). Absent: none is recorded. */
  readonly styleSnapshot?: Record<string, unknown>
}

/** Record how a made document was made. Idempotent (one row per document). Returns an error sentence, or null. */
export async function recordProvenance(
  db: SqlExecutor,
  where: { readonly office: string; readonly documentId: string },
  p: Provenance,
): Promise<string | null> {
  const { rows } = await db.execute(`
    select app.document_provenance_record(
      p_office => ${lit(where.office)}::uuid, p_document => ${lit(where.documentId)}::uuid,
      p_job => ${lit(p.jobId)}::uuid, p_style_hash => ${lit(p.styleHash)},
      p_style_updated_at => ${p.styleUpdatedAt === null ? 'null' : `${lit(p.styleUpdatedAt)}::timestamptz`},
      p_design => ${lit(JSON.stringify(p.design))}::jsonb, p_sources => ${lit(JSON.stringify(p.sources))}::jsonb${
        p.styleSnapshot === undefined
          ? ''
          : `,\n      p_style_snapshot => ${lit(JSON.stringify(p.styleSnapshot))}::jsonb`
      }
    ) as r`)
  const r = parse(rows[0]?.r)
  return r?.ok === true ? null : String(r?.error ?? 'provenance was not recorded')
}

/** What was recorded about a made document, or null. */
export async function provenanceOf(
  db: SqlExecutor,
  where: { readonly office: string; readonly documentId: string },
): Promise<{
  readonly jobId: string | null
  readonly styleHash: string | null
  readonly styleUpdatedAt: string | null
  readonly sources: readonly { readonly label: string; readonly ref: string }[]
} | null> {
  const { rows } = await db.execute(
    `select app.document_provenance_of(${lit(where.office)}::uuid, ${lit(where.documentId)}::uuid) as r`,
  )
  const r = parse(rows[0]?.r)
  if (r === null) return null
  const sources = Array.isArray(r.sources)
    ? (r.sources as Record<string, unknown>[])
        .filter((s) => typeof s.ref === 'string')
        .map((s) => ({ label: String(s.label ?? ''), ref: String(s.ref) }))
    : []
  return {
    jobId: typeof r.job_id === 'string' ? r.job_id : null,
    sources,
    styleHash: typeof r.style_hash === 'string' ? r.style_hash : null,
    styleUpdatedAt: typeof r.style_updated_at === 'string' ? r.style_updated_at : null,
  }
}

export interface Revised {
  readonly ok: boolean
  readonly version: number | null
  readonly already: boolean
  readonly error: string | null
  /** True when the new version is a DRAFT beside an approved one: approval belongs to a version, so it is not current yet. */
  readonly pending: boolean
}

/**
 * Make `newId` the next version of `headId`. A refusal is RETURNED, not thrown: the PDF is stored either way and the
 * caller says plainly that it is a separate document if the link could not be made.
 */
export async function reviseMade(
  db: SqlExecutor,
  where: { readonly office: string; readonly headId: string; readonly newId: string },
  note: string,
): Promise<Revised> {
  const { rows } = await db.execute(
    `select app.document_revise_made(${lit(where.office)}::uuid, ${lit(where.headId)}::uuid,
       ${lit(where.newId)}::uuid, ${lit(note.slice(0, 600))}) as r`,
  )
  const r = parse(rows[0]?.r)
  if (r?.ok === true) {
    return {
      already: r.already === true,
      error: null,
      ok: true,
      pending: typeof r.pending_id === 'string' && r.current_id !== r.pending_id,
      version: typeof r.version === 'number' ? r.version : null,
    }
  }
  return {
    already: false,
    error: String(r?.error ?? 'the version could not be made'),
    ok: false,
    pending: false,
    version: null,
  }
}

/** The note a version carries: the job, the style and the sources - what a person reading the history needs. */
export function versionNote(p: {
  readonly jobId: string
  readonly styleHash: string
  readonly sources: readonly { readonly label: string }[]
  readonly instruction: string
}): string {
  const from = p.sources
    .slice(0, 4)
    .map((s) => s.label)
    .join('; ')
  return (
    `Revised by job ${p.jobId.slice(0, 8)}, style ${p.styleHash}` +
    `${from === '' ? '' : `, from ${from}`}. Asked: ${p.instruction.replace(/\s+/g, ' ').slice(0, 160)}`
  )
}

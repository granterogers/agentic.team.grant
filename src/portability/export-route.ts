/**
 * What one standard-format download is: which records it reads, what it is called, and how it is encoded.
 *
 * The gateway (supabase/functions/hq-api) fetches the records with `public.project_records` and calls `renderStandardExport`
 * for the bytes. This file holds the choices, so the route itself is only plumbing and the choices can be proved in a unit
 * test without a database or a request.
 *
 * Formats a person may ask for, and what each one reads:
 *   vcard  contacts  -> text/vcard        <slug>-contacts.vcf
 *   ics    events    -> text/calendar     <slug>-calendar.ics
 *   csv    tasks     -> text/csv          <slug>-tasks.csv
 *   json   tasks     -> application/json  <slug>-tasks.json
 *
 * A format names its own kind, so a request cannot ask for tasks as vCard and get a malformed file.
 */

import {
  type CalendarRecord,
  type ContactRecord,
  contactsToVcard,
  eventsToIcal,
  type TaskRecord,
  tasksToCsv,
  toJsonExport,
} from './formats.ts'

export const STANDARD_FORMATS = ['vcard', 'ics', 'csv', 'json'] as const
export type StandardFormat = (typeof STANDARD_FORMATS)[number]
export type RecordKind = 'contacts' | 'events' | 'tasks'

interface FormatSpec {
  readonly kind: RecordKind
  readonly stem: string
  readonly extension: string
  readonly contentType: string
}

const SPEC: Readonly<Record<StandardFormat, FormatSpec>> = {
  vcard: {
    kind: 'contacts',
    stem: 'contacts',
    extension: 'vcf',
    contentType: 'text/vcard; charset=utf-8',
  },
  ics: {
    kind: 'events',
    stem: 'calendar',
    extension: 'ics',
    contentType: 'text/calendar; charset=utf-8',
  },
  csv: { kind: 'tasks', stem: 'tasks', extension: 'csv', contentType: 'text/csv; charset=utf-8' },
  json: {
    kind: 'tasks',
    stem: 'tasks',
    extension: 'json',
    contentType: 'application/json; charset=utf-8',
  },
}

/** The records a format reads, or null for a format this file does not know. */
export function kindFor(format: string): RecordKind | null {
  return isStandardFormat(format) ? SPEC[format].kind : null
}

export function isStandardFormat(format: string): format is StandardFormat {
  return (STANDARD_FORMATS as readonly string[]).includes(format)
}

/** What `public.project_records` returns for one kind. */
export interface ProjectRecordsPayload {
  readonly project: string
  readonly name: string
  readonly zone: string | null
  readonly records: readonly unknown[]
}

/** A file name a browser can save: the project slug and a fixed stem, never caller text. */
export function exportFilename(format: StandardFormat, projectSlug: string): string {
  const safe =
    projectSlug
      .replace(/[^a-z0-9-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'project'
  const { stem, extension } = SPEC[format]
  return `${safe}-${stem}.${extension}`
}

export interface RenderedExport {
  readonly body: string
  readonly contentType: string
  readonly filename: string
  readonly count: number
}

/**
 * The bytes of one download. Throws on an unknown format or a payload whose records are not an array, so a malformed
 * answer from the database is refused rather than written into a file that looks valid.
 */
export function renderStandardExport(
  format: string,
  payload: ProjectRecordsPayload,
  opts: { exportedAt: string },
): RenderedExport {
  if (!isStandardFormat(format)) throw new Error(`unknown export format: ${format}`)
  if (!Array.isArray(payload.records)) throw new Error('the export has no record list')
  const spec = SPEC[format]
  const filename = exportFilename(format, payload.project)
  const count = payload.records.length

  let body: string
  switch (format) {
    case 'vcard':
      body = contactsToVcard(payload.records as readonly ContactRecord[])
      break
    case 'ics':
      body = eventsToIcal(payload.records as readonly CalendarRecord[], {
        exportedAt: opts.exportedAt,
        zone: payload.zone ?? 'UTC',
      })
      break
    case 'csv':
      body = tasksToCsv(payload.records as readonly TaskRecord[])
      break
    case 'json':
      body = toJsonExport('tasks', payload.records, {
        exportedAt: opts.exportedAt,
        projectSlug: payload.project,
      })
      break
  }
  return { body, contentType: spec.contentType, filename, count }
}

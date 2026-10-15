/**
 * Standard-format serialisers for one project's records (Workstream C, individual exports).
 *
 * Pure functions: rows in, text out. No database, no network, no clock except the one the caller passes in, so every
 * format rule here can be proved in a unit test and the same bytes come out for the same rows.
 *
 *   contacts  → vCard 4.0 (RFC 6350)            contactsToVcard
 *   calendar  → iCalendar 2.0 (RFC 5545)        eventsToIcal
 *   tasks     → RFC 4180 CSV and a versioned JSON envelope  tasksToCsv, toJsonExport
 *
 * What is deliberately not represented, and why:
 *   - Calendar attendee NAMES (the table stores a count only, by design), so the iCalendar carries no ATTENDEE lines.
 *   - Recurrence (the cache holds Google's expanded instances, not the rule), so none is emitted.
 *   - Calendar all-day dates are cut in the OFFICE's time zone, passed by the caller. Cutting them in UTC moves a
 *     midnight-Athens event onto the previous day, which is the birthday-as-midnight defect the table comment warns of.
 */

const CRLF = '\r\n'
const encoder = new TextEncoder()

export interface ContactRecord {
  readonly contact_id: string
  readonly kind: string
  readonly name: string
  readonly role: string
  readonly org: string
  readonly stage: string
  readonly email: string
  readonly phone: string
  readonly instagram: string
  readonly website: string
  readonly where: string
  readonly note: string
  readonly next: string
  readonly next_due: string
  readonly last_at: string | null
  readonly updated_at: string
}

export interface CalendarRecord {
  readonly calendar_id: string
  readonly event_id: string
  readonly summary: string | null
  readonly excerpt: string | null
  readonly location: string | null
  readonly starts_at: string
  readonly ends_at: string
  readonly all_day: boolean
  readonly status: string
  readonly html_link: string | null
  readonly remote_updated_at: string | null
}

export interface TaskRecord {
  readonly task_id: string
  readonly title: string
  readonly detail: string
  readonly state: string
  readonly blocked_on: string
  readonly due_on: string | null
  readonly starts_on: string | null
  readonly priority: number
  readonly is_milestone: boolean
  readonly parent_task_id: string | null
  readonly assigned_to_human: boolean
  readonly added_by: string
  readonly created_at: string
  readonly updated_at: string
  readonly done_at: string | null
}

/**
 * RFC 5545 TEXT escaping, which RFC 6350 also uses for text values: backslash, semicolon, comma and line breaks. The
 * backslash goes first so the escapes this function adds are not themselves escaped. Without this a name containing a
 * newline followed by "END:VCARD" would close the record early.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * Fold a content line to 75 octets, RFC 5545 section 3.1. A continuation line starts with one space, which takes one of
 * its 75 octets, so continuations carry 74 characters. Folding never splits a multi-byte UTF-8 character.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let size = 0
  let limit = 75
  for (const ch of line) {
    const bytes = encoder.encode(ch).length
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
      limit = 74
    }
    current += ch
    size += bytes
  }
  parts.push(current)
  return parts.join(`${CRLF} `)
}

/** A UTC timestamp in the basic form both RFC 5545 and RFC 6350 use: 20261013T093000Z. */
export function utcBasic(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`not a timestamp: ${iso}`)
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

/** The calendar date of an instant in a named zone, as YYYYMMDD. All-day events are dates, not instants. */
export function dateBasicIn(iso: string, zone: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`not a timestamp: ${iso}`)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}`
}

function pushLines(out: string[], lines: readonly string[]): void {
  for (const line of lines) out.push(foldLine(line))
}

// ---------------------------------------------------------------------------------------------------------------------
// vCard 4.0
// ---------------------------------------------------------------------------------------------------------------------

/** The four kinds the table allows, mapped to the two KIND values RFC 6350 defines for a card. */
function vcardKind(kind: string): 'individual' | 'org' {
  return kind === 'company' || kind === 'supplier' ? 'org' : 'individual'
}

/** A website becomes a URI only when it is one; anything else stays text rather than being invented into a link. */
function websiteProperty(website: string): string | null {
  const trimmed = website.trim()
  if (trimmed === '') return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return /^https?:\/\/[^\s]+$/i.test(withScheme)
    ? `URL:${withScheme}`
    : `X-WEBSITE:${escapeText(trimmed)}`
}

function vcardOne(c: ContactRecord): string {
  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `UID:urn:uuid:${c.contact_id}`,
    `FN:${escapeText(c.name)}`,
    `KIND:${vcardKind(c.kind)}`,
  ]
  if (c.role.trim()) lines.push(`TITLE:${escapeText(c.role)}`)
  if (c.org.trim()) lines.push(`ORG:${escapeText(c.org)}`)
  if (c.email.trim()) lines.push(`EMAIL:${escapeText(c.email.trim())}`)
  if (c.phone.trim()) lines.push(`TEL;VALUE=text:${escapeText(c.phone.trim())}`)
  const website = websiteProperty(c.website)
  if (website) lines.push(website)
  if (c.instagram.trim()) lines.push(`X-INSTAGRAM:${escapeText(c.instagram.trim())}`)
  // Seven ADR components; the free-text place goes in the street slot, the only one that is not a guess.
  if (c.where.trim()) lines.push(`ADR;TYPE=work:;;${escapeText(c.where.trim())};;;;`)
  const note = [
    c.note.trim(),
    c.next.trim() ? `Next: ${c.next.trim()}` : '',
    c.next_due.trim() ? `Next due: ${c.next_due.trim()}` : '',
  ]
    .filter((s) => s !== '')
    .join('\n')
  if (note) lines.push(`NOTE:${escapeText(note)}`)
  lines.push(`X-STAGE:${escapeText(c.stage)}`)
  if (c.last_at) lines.push(`X-LAST-CONTACTED:${utcBasic(c.last_at)}`)
  lines.push(`REV:${utcBasic(c.updated_at)}`)
  lines.push('END:VCARD')
  const out: string[] = []
  pushLines(out, lines)
  return `${out.join(CRLF)}${CRLF}`
}

/** One vCard per contact, concatenated. Each card is complete and separately importable. */
export function contactsToVcard(contacts: readonly ContactRecord[]): string {
  return contacts.map(vcardOne).join('')
}

// ---------------------------------------------------------------------------------------------------------------------
// iCalendar 2.0
// ---------------------------------------------------------------------------------------------------------------------

const STATUS: Readonly<Record<string, string>> = {
  confirmed: 'CONFIRMED',
  tentative: 'TENTATIVE',
  cancelled: 'CANCELLED',
}

function icalEvent(e: CalendarRecord, exportedAt: string, zone: string): string[] {
  const lines: string[] = [
    'BEGIN:VEVENT',
    // A calendar id is an address and an event id is Google's; together they are unique across calendars.
    `UID:${escapeText(`${e.calendar_id}/${e.event_id}`)}@agentic-team`,
    `DTSTAMP:${utcBasic(exportedAt)}`,
  ]
  if (e.all_day) {
    lines.push(`DTSTART;VALUE=DATE:${dateBasicIn(e.starts_at, zone)}`)
    lines.push(`DTEND;VALUE=DATE:${dateBasicIn(e.ends_at, zone)}`)
  } else {
    lines.push(`DTSTART:${utcBasic(e.starts_at)}`)
    lines.push(`DTEND:${utcBasic(e.ends_at)}`)
  }
  if (e.summary?.trim()) lines.push(`SUMMARY:${escapeText(e.summary)}`)
  if (e.location?.trim()) lines.push(`LOCATION:${escapeText(e.location)}`)
  if (e.excerpt?.trim()) lines.push(`DESCRIPTION:${escapeText(e.excerpt)}`)
  if (e.html_link && /^https?:\/\/\S+$/i.test(e.html_link)) lines.push(`URL:${e.html_link}`)
  const status = STATUS[e.status]
  if (status) lines.push(`STATUS:${status}`)
  if (e.remote_updated_at) lines.push(`LAST-MODIFIED:${utcBasic(e.remote_updated_at)}`)
  lines.push('END:VEVENT')
  return lines
}

/**
 * A calendar file. `exportedAt` stamps DTSTAMP and `zone` is the IANA zone all-day events are cut in (the office's
 * `offices.timezone`), so the output is deterministic for a given set of rows.
 */
export function eventsToIcal(
  events: readonly CalendarRecord[],
  opts: { exportedAt: string; zone: string },
): string {
  const out: string[] = []
  pushLines(out, [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agentic Team//Project calendar export//EN',
    'CALSCALE:GREGORIAN',
  ])
  for (const e of events) pushLines(out, icalEvent(e, opts.exportedAt, opts.zone))
  pushLines(out, ['END:VCALENDAR'])
  return `${out.join(CRLF)}${CRLF}`
}

// ---------------------------------------------------------------------------------------------------------------------
// CSV (RFC 4180) and the JSON envelope
// ---------------------------------------------------------------------------------------------------------------------

/**
 * One CSV cell. A string that begins with a character a spreadsheet would run as a formula is prefixed with an
 * apostrophe, the OWASP spreadsheet-injection mitigation: a task titled "=HYPERLINK(...)" must not become a live formula
 * on the person's machine. Numbers and booleans are never prefixed, so a negative priority stays a number.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'string' ? value : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv<T extends object>(
  headers: readonly (keyof T & string)[],
  rows: readonly T[],
): string {
  const head = headers.map(csvCell).join(',')
  const body = rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))
  return [head, ...body].join(CRLF) + CRLF
}

export const TASK_CSV_COLUMNS: readonly (keyof TaskRecord & string)[] = [
  'task_id',
  'title',
  'detail',
  'state',
  'blocked_on',
  'due_on',
  'starts_on',
  'priority',
  'is_milestone',
  'parent_task_id',
  'assigned_to_human',
  'added_by',
  'created_at',
  'updated_at',
  'done_at',
] as const

export function tasksToCsv(tasks: readonly TaskRecord[]): string {
  return toCsv<TaskRecord>(TASK_CSV_COLUMNS, tasks)
}

/** The version every JSON export carries, so a future reader knows which shape it is holding. */
export const EXPORT_VERSION = 1

/** A versioned envelope: what kind of records, when, how many, and the records themselves. */
export function toJsonExport<T>(
  kind: string,
  records: readonly T[],
  meta: { exportedAt: string; projectSlug: string },
): string {
  return `${JSON.stringify(
    {
      format: `agentic-team.${kind}`,
      version: EXPORT_VERSION,
      exported_at: meta.exportedAt,
      project: meta.projectSlug,
      count: records.length,
      records,
    },
    null,
    2,
  )}\n`
}

/**
 * The correspondence summary (§19A, Artifact A): one section per relevant contact, with every field the spec names.
 *
 * ## Only what the records hold
 *
 * A field the database does not hold is written as "Not in the records yet", and a field that needs the message body
 * read and understood (the summary of the response, the quoted price, the currency, the included services, the
 * availability) is written as "Not extracted yet". Neither is ever filled with a guess. A reader of this document
 * can tell at a glance which numbers came from the records and which have not been read yet.
 *
 * ## Shape
 *
 * `buildCorrespondenceReport` is pure: facts in, a `Report` out, so the same facts always give the same document and
 * the layout is testable without a database. `loadCorrespondenceFacts` reads the facts for one project of one office.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { Block, Report } from './report.ts'

export const NOT_IN_RECORDS = 'Not in the records yet'
export const NOT_EXTRACTED = 'Not extracted yet'

/** The §19A fields, in the order the spec lists them. */
export const CORRESPONDENCE_FIELDS = [
  'Contact name',
  'Organisation',
  'Source email or thread',
  'Original inquiry date',
  'Reply date',
  'Summary of response',
  'Property or accommodation',
  'Island and location',
  'Quoted price',
  'Currency',
  'Price period',
  'Included services',
  'Availability dates',
  'Restrictions',
  'Missing information',
  'Follow-up requirements',
  'Current correspondence state',
] as const

export interface ContactFacts {
  readonly name: string
  readonly org: string | null
  readonly location: string | null
  /** How to reach them, as the records hold it. Null when the record has none. */
  readonly email: string | null
  readonly phone: string | null
  /** The thread the contact is most recently part of, if any. */
  readonly thread: { readonly id: string; readonly subject: string } | null
  readonly inquiryAt: string | null
  readonly replyAt: string | null
  /** From the awaiting reader: "you have not replied", "no reply to you", or null when no thread is quiet. */
  readonly waiting: string | null
}

const dateOf = (iso: string | null): string => (iso === null ? NOT_IN_RECORDS : iso.slice(0, 10))

/** The driver hands a timestamp back as a Date; the facts carry it as an ISO string. */
const isoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v)

export function sectionFor(c: ContactFacts): { heading: string; rows: string[][] } {
  const missing: string[] = []
  const org = c.org ?? null
  if (org === null) missing.push('Organisation')
  if (c.thread === null) missing.push('Source email or thread')
  if (c.inquiryAt === null) missing.push('Original inquiry date')
  if (c.location === null) missing.push('Island and location')
  missing.push(
    'Summary of response',
    'Quoted price',
    'Currency',
    'Price period',
    'Included services',
    'Availability dates',
    'Restrictions',
  )
  const followUp =
    c.waiting === 'you have not replied'
      ? `Reply to ${c.name}`
      : c.waiting === 'no reply to you'
        ? `Ask ${c.name} whether they have seen the last message`
        : 'None open'
  const state = c.waiting ?? 'No quiet thread in the records'
  const value = (field: string, v: string | null, unknown: string) => [field, v ?? unknown]
  return {
    heading: c.name,
    rows: [
      ['Contact name', c.name],
      value('Organisation', org, NOT_IN_RECORDS),
      value(
        'Source email or thread',
        c.thread === null ? null : `${c.thread.subject} (thread ${c.thread.id})`,
        NOT_IN_RECORDS,
      ),
      ['Original inquiry date', dateOf(c.inquiryAt)],
      ['Reply date', dateOf(c.replyAt)],
      ['Summary of response', NOT_EXTRACTED],
      ['Property or accommodation', NOT_IN_RECORDS],
      value('Island and location', c.location, NOT_IN_RECORDS),
      ['Quoted price', NOT_EXTRACTED],
      ['Currency', NOT_EXTRACTED],
      ['Price period', NOT_EXTRACTED],
      ['Included services', NOT_EXTRACTED],
      ['Availability dates', NOT_EXTRACTED],
      ['Restrictions', NOT_EXTRACTED],
      ['Missing information', missing.join(', ')],
      ['Follow-up requirements', followUp],
      ['Current correspondence state', state],
    ],
  }
}

/** The whole document. Every contact is a section; a project with none still says so. */
export function buildCorrespondenceReport(
  contacts: readonly ContactFacts[],
  project: { readonly name: string },
  created: Date,
): Report {
  const blocks: Block[] = [
    { kind: 'heading', level: 1, text: `Correspondence summary: ${project.name}` },
    {
      kind: 'paragraph',
      text:
        'One section per contact in this project. Where a field is marked "Not in the records yet" or "Not extracted yet", ' +
        'it has not been read from the mail or the documents, and nothing has been guessed in its place.',
    },
  ]
  if (contacts.length === 0) {
    blocks.push({ kind: 'paragraph', text: 'No contacts are recorded for this project yet.' })
  }
  for (const c of contacts) {
    const s = sectionFor(c)
    blocks.push({ kind: 'heading', level: 2, text: s.heading })
    blocks.push({ kind: 'table', columns: ['Field', 'Value'], rows: s.rows })
  }
  return {
    title: `Correspondence summary: ${project.name}`,
    subtitle: 'Generated from the records held for this project',
    author: 'Agentic Team',
    created,
    blocks,
    sources: contacts
      .filter((c) => c.thread !== null)
      .map((c) => ({ label: c.thread?.subject ?? c.name, ref: `mail:${c.thread?.id ?? ''}` })),
  }
}

/**
 * Read the facts for one project of one office: its contacts, and for each one the threads it is in.
 * A thread is linked to a contact by an address match on any message in it (the same rule the awaiting reader uses).
 */
export async function loadCorrespondenceFacts(
  db: SqlExecutor,
  jobId: string,
  project: string,
): Promise<{ contacts: ContactFacts[]; projectName: string }> {
  const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
  // The office is the job's, read in the database; the reader never takes an office from the caller.
  const officeRow = (await db.execute(`select app.job_office(${lit(jobId)}::uuid)::text as o`))
    .rows[0] as { o?: string } | undefined
  const office = String(officeRow?.o ?? '')
  if (office === '') throw new Error('the job has no office, so there is no correspondence to read')
  const name = String(
    (
      (
        await db.execute(
          `select name from public.projects where project_id = ${lit(project)}::uuid`,
        )
      ).rows[0] as { name?: string } | undefined
    )?.name ?? 'Project',
  )
  const rows = (
    await db.execute(`
      select c.name, c.org, c."where" as location, c.email, c.phone
        from public.contacts c
       where c.project_id = ${lit(project)}::uuid
         and c.archived_at is null
         and not c.is_fixture
       order by c.name`)
  ).rows as {
    name: string
    org: string | null
    location: string | null
    email: string
    phone: string | null
  }[]

  // One awaiting read for the project, shared by every contact.
  const awaiting = (
    await db.execute(
      `select app.mail_awaiting(app.job_office(${lit(jobId)}::uuid), ${lit(project)}::uuid, 7, 50)::text as r`,
    )
  ).rows[0] as { r?: unknown } | undefined
  const quiet = (
    typeof awaiting?.r === 'string' ? JSON.parse(awaiting.r) : (awaiting?.r ?? [])
  ) as { thread_id: string; waiting: string }[]

  const contacts: ContactFacts[] = []
  for (const r of rows) {
    const hit = (
      await db.execute(`
        select m.thread_id, m.subject, m.sent_at
          from public.mail_messages m
         where m.office_id = ${lit(office)}::uuid
           and m.vanished_at is null
           and lower(m.from_address) = lower(${lit(r.email)})
         order by m.sent_at asc nulls last`)
    ).rows as { thread_id: string; subject: string | null; sent_at: string | null }[]
    const first = hit[0]
    const last = hit[hit.length - 1]
    const thread =
      last === undefined ? null : { id: last.thread_id, subject: last.subject ?? '(no subject)' }
    const waiting =
      thread === null ? null : (quiet.find((w) => w.thread_id === thread.id)?.waiting ?? null)
    contacts.push({
      name: r.name,
      org: r.org === null || r.org.trim() === '' ? null : r.org,
      location: r.location === null || r.location.trim() === '' ? null : r.location,
      email: r.email.trim() === '' ? null : r.email,
      phone: r.phone === null || r.phone.trim() === '' ? null : r.phone,
      thread,
      inquiryAt: isoOrNull(first?.sent_at),
      // A reply is any later message from the contact in a thread: one message is the inquiry, a second is an answer.
      replyAt: hit.length > 1 ? isoOrNull(last?.sent_at) : null,
      waiting,
    })
  }
  return { contacts, projectName: name }
}

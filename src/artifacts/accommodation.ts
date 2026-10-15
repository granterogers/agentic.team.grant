/**
 * The accommodation comparison (§19B, Artifact B): one entry per supplier contact, with every field the spec names.
 *
 * ## Availability is classified from the records, never assumed
 *
 * The spec's classes are Confirmed available, Confirmed unavailable, Partially available, Unknown and Awaiting reply.
 * Only two of them can be read from the records this build has:
 *
 *   - Awaiting reply, when a thread with that contact is quiet and the ball is in the other court or in Grant's.
 *   - Unknown, for everything else.
 *
 * Confirmed available, Confirmed unavailable and Partially available need the message body read and understood, and
 * this build does not do that. So it never says a place is unavailable, and it never says it is available. "No reply
 * does not mean unavailable" is the rule the classifier is built on.
 */
import { type ContactFacts, NOT_EXTRACTED, NOT_IN_RECORDS } from './correspondence.ts'
import type { Block, Report } from './report.ts'

/** The §19B fields, in the order the spec lists them. */
export const ACCOMMODATION_FIELDS = [
  'Organisation',
  'Property',
  'Island',
  'Town',
  'Accommodation type',
  'Coworking facilities',
  'Accommodation price',
  'Billing period',
  'Minimum stay',
  'Included facilities and services',
  'Available dates',
  'Unavailable dates',
  'Availability status',
  'Booking/contact information',
  'Restrictions',
  'Source reference',
  'Verification or uncertainty status',
] as const

export type AvailabilityStatus = 'Awaiting reply' | 'Unknown'

/** From the records alone: a quiet thread is awaiting a reply; nothing else can be said without reading the mail. */
export function availabilityStatus(c: Pick<ContactFacts, 'waiting'>): AvailabilityStatus {
  return c.waiting === 'you have not replied' || c.waiting === 'no reply to you'
    ? 'Awaiting reply'
    : 'Unknown'
}

export function entryFor(c: ContactFacts): { heading: string; rows: string[][] } {
  const contact = [c.email, c.phone].filter((v): v is string => v !== null).join(' / ')
  const status = availabilityStatus(c)
  return {
    heading: c.org ?? c.name,
    rows: [
      ['Organisation', c.org ?? NOT_IN_RECORDS],
      ['Property', NOT_IN_RECORDS],
      ['Island', c.location ?? NOT_IN_RECORDS],
      ['Town', NOT_IN_RECORDS],
      ['Accommodation type', NOT_EXTRACTED],
      ['Coworking facilities', NOT_EXTRACTED],
      ['Accommodation price', NOT_EXTRACTED],
      ['Billing period', NOT_EXTRACTED],
      ['Minimum stay', NOT_EXTRACTED],
      ['Included facilities and services', NOT_EXTRACTED],
      ['Available dates', NOT_EXTRACTED],
      ['Unavailable dates', NOT_EXTRACTED],
      [
        'Availability status',
        status === 'Awaiting reply'
          ? `Awaiting reply (${c.waiting ?? ''}). No reply does not mean unavailable.`
          : 'Unknown. The message has not been read for availability.',
      ],
      ['Booking/contact information', contact === '' ? NOT_IN_RECORDS : contact],
      ['Restrictions', NOT_EXTRACTED],
      [
        'Source reference',
        c.thread === null ? NOT_IN_RECORDS : `${c.thread.subject} (thread ${c.thread.id})`,
      ],
      [
        'Verification or uncertainty status',
        'Unverified. The records are read for who wrote and when; no figure or date has been checked against the message.',
      ],
    ],
  }
}

export function buildAccommodationReport(
  contacts: readonly ContactFacts[],
  project: { readonly name: string },
  created: Date,
): Report {
  const blocks: Block[] = [
    { kind: 'heading', level: 1, text: `Accommodation comparison: ${project.name}` },
    {
      kind: 'paragraph',
      text:
        'One entry per supplier contact in this project. Availability is "Awaiting reply" or "Unknown" here: nothing is ' +
        'marked unavailable because no reply has come, and no figure is filled in that has not been read from the records.',
    },
  ]
  if (contacts.length === 0) {
    blocks.push({
      kind: 'paragraph',
      text: 'No supplier contacts are recorded for this project yet.',
    })
  }
  for (const c of contacts) {
    const e = entryFor(c)
    blocks.push({ kind: 'heading', level: 2, text: e.heading })
    blocks.push({ kind: 'table', columns: ['Field', 'Value'], rows: e.rows })
  }
  return {
    title: `Accommodation comparison: ${project.name}`,
    subtitle: 'Generated from the records held for this project',
    author: 'Agentic Team',
    created,
    blocks,
    sources: contacts
      .filter((c) => c.thread !== null)
      .map((c) => ({ label: c.thread?.subject ?? c.name, ref: `mail:${c.thread?.id ?? ''}` })),
  }
}

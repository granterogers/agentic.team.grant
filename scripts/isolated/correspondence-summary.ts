/**
 * §19A / COS-124 — the correspondence summary carries every field the spec names for every contact, takes its values
 * from the records, and says "not in the records" rather than inventing one.
 *
 *   npx tsx scripts/isolated/correspondence-summary.ts <replica-db>
 *
 * Drives the REAL `loadCorrespondenceFacts` over contacts and mail written inside one transaction that is rolled back,
 * then the real `buildCorrespondenceReport`, `renderReport` and `validatePdf`.
 *
 * Asserts:
 *   1. Every contact section carries all seventeen §19A fields, in the spec's order.
 *   2. Values from the records appear: an organisation, a location, the inquiry date, and a reply date where the
 *      contact has written again.
 *   3. A field the records do not hold reads "Not in the records yet" (Tom has no organisation and no reply).
 *   4. Fields that need the message body read are "Not extracted yet" (no price is ever filled in).
 *   5. The document renders and passes its own structural and layout checks.
 *
 * Replica only; the guard refuses anything else.
 */
import {
  buildCorrespondenceReport,
  CORRESPONDENCE_FIELDS,
  type ContactFacts,
  loadCorrespondenceFacts,
  NOT_EXTRACTED,
  NOT_IN_RECORDS,
  sectionFor,
} from '../../src/artifacts/correspondence.ts'
import { renderReport } from '../../src/artifacts/report.ts'
import { validatePdf } from '../../src/artifacts/validate.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

const tag = Date.now().toString(36)
const PRIYA = `priya-cs-${tag}@acme.test`
const TOM = `tom-cs-${tag}@acme.test`

await db.execute('begin')
try {
  const jobId = await realParent(db)
  const office = String((await one(`select app.job_office('${jobId}'::uuid)::text as o`)).o)
  const project = String(
    (await one(`select project_id::text as p from public.jobs where job_id = '${jobId}'::uuid`)).p,
  )

  await db.execute(`insert into public.contacts (project_id, kind, name, role, org, stage, email, phone, instagram, website, "where", note, "next", next_due, fields, labels_set)
    values (${lit(project)}::uuid, 'supplier', 'Priya Proof', '', 'Acme Villas', 'active', ${lit(PRIYA)}, '', '', '', 'Crete', '', '', '', '[]'::jsonb, false),
           (${lit(project)}::uuid, 'supplier', 'Tom Proof', '', '', 'active', ${lit(TOM)}, '', '', '', '', '', '', '', '[]'::jsonb, false)`)

  const msg = async (
    id: string,
    thread: string,
    from: string,
    name: string,
    labels: string[],
    days: number,
  ) =>
    db.execute(`insert into public.mail_messages
      (message_id, thread_id, subject, from_name, from_address, to_count, sent_at, labels, has_attachments, unread,
       first_seen_at, last_seen_at, office_id)
      values (${lit(id)}, ${lit(thread)}, ${lit(`Villa enquiry ${tag}`)}, ${lit(name)}, ${lit(from)}, 1,
              app.now_utc() - interval '${String(days)} days', array[${labels.map((l) => lit(l)).join(',')}]::text[],
              false, false, app.now_utc(), app.now_utc(), ${lit(office)}::uuid)`)
  const PRIYA_THREAD = `cs-priya-${tag}`
  const TOM_THREAD = `cs-tom-${tag}`
  await msg(`cs1-${tag}`, PRIYA_THREAD, PRIYA, 'Priya Proof', ['INBOX'], 12)
  await msg(`cs2-${tag}`, PRIYA_THREAD, PRIYA, 'Priya Proof', ['INBOX'], 9)
  await msg(`cs3-${tag}`, TOM_THREAD, TOM, 'Tom Proof', ['INBOX'], 10)

  const { contacts, projectName } = await loadCorrespondenceFacts(db, jobId, project)
  const priya = contacts.find((c) => c.name === 'Priya Proof')
  const tom = contacts.find((c) => c.name === 'Tom Proof')
  check(
    'every contact in the project has a section',
    priya !== undefined && tom !== undefined,
    `sections: ${contacts.map((c) => c.name).join(', ')}`,
  )

  const report = buildCorrespondenceReport(contacts, { name: projectName }, new Date())
  for (const c of contacts) {
    const labels = sectionFor(c).rows.map((r) => r[0])
    check(
      `${c.name}: the section carries all seventeen §19A fields in the spec's order`,
      JSON.stringify(labels) === JSON.stringify(CORRESPONDENCE_FIELDS),
      `${String(labels.length)} fields`,
    )
  }

  // The value of one field for one contact. A missing contact is a failed check, not a crash.
  const rowOf = (c: ContactFacts | undefined, field: string) =>
    c === undefined ? undefined : sectionFor(c).rows.find((r) => r[0] === field)?.[1]
  check(
    'a value the records hold is shown: Priya’s organisation and location',
    rowOf(priya, 'Organisation') === 'Acme Villas' &&
      rowOf(priya, 'Island and location') === 'Crete',
    `org=${String(rowOf(priya, 'Organisation'))} location=${String(rowOf(priya, 'Island and location'))}`,
  )
  check(
    'a reply date is shown where the contact has written again, and the inquiry date always is',
    rowOf(priya, 'Reply date') !== NOT_IN_RECORDS &&
      rowOf(priya, 'Original inquiry date') !== NOT_IN_RECORDS,
    `reply=${String(rowOf(priya, 'Reply date'))} inquiry=${String(rowOf(priya, 'Original inquiry date'))}`,
  )
  check(
    'a field the records do not hold reads "Not in the records yet" (Tom: no organisation, no reply)',
    rowOf(tom, 'Organisation') === NOT_IN_RECORDS && rowOf(tom, 'Reply date') === NOT_IN_RECORDS,
    `org=${String(rowOf(tom, 'Organisation'))} reply=${String(rowOf(tom, 'Reply date'))}`,
  )
  check(
    'a price is never filled in: quoted price and currency read "Not extracted yet"',
    rowOf(priya, 'Quoted price') === NOT_EXTRACTED &&
      rowOf(priya, 'Currency') === NOT_EXTRACTED &&
      rowOf(tom, 'Quoted price') === NOT_EXTRACTED,
    `priya price=${String(rowOf(priya, 'Quoted price'))}`,
  )

  const rendered = renderReport(report)
  const verdict = validatePdf(rendered.bytes, { layoutProblems: rendered.problems })
  check(
    'the document renders and passes its own structural and layout checks',
    verdict.ok && rendered.problems.length === 0,
    verdict.ok
      ? `${String(verdict.pages)} page(s), ${String(rendered.bytes.length)} bytes`
      : verdict.problems.join('; '),
  )
} finally {
  await db.execute('rollback')
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
process.exitCode = failed.length === 0 ? 0 : 1

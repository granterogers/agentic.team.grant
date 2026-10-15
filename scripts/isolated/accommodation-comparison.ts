/**
 * §19B / COS-125 — the accommodation comparison carries every §19B field, and never reads "no reply" as unavailable.
 *
 *   npx tsx scripts/isolated/accommodation-comparison.ts <replica-db>
 *
 * Drives the REAL `loadCorrespondenceFacts` (the same records the §19A summary reads) over a supplier who has not
 * replied and a supplier who has written, inside a rolled-back transaction. Then the real `buildAccommodationReport`,
 * `renderReport` and `validatePdf`.
 *
 * Asserts:
 *   1. Every entry carries all seventeen §19B fields, in the spec's order.
 *   2. A supplier whose thread is quiet, and who has been asked nothing back, is "Awaiting reply", not unavailable.
 *   3. CONTROL: a supplier with no quiet thread is "Unknown", never "Confirmed unavailable".
 *   4. Booking/contact information is the address and phone from the records.
 *   5. No price is filled in that the records do not hold, and no property is invented.
 *   6. The document renders and passes its own structural and layout checks.
 *
 * Replica only; the guard refuses anything else.
 */
import {
  ACCOMMODATION_FIELDS,
  availabilityStatus,
  buildAccommodationReport,
  entryFor,
} from '../../src/artifacts/accommodation.ts'
import {
  type ContactFacts,
  loadCorrespondenceFacts,
  NOT_EXTRACTED,
  NOT_IN_RECORDS,
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
const WAITING = `wait-${tag}@hotel.test`
const SILENT = `silent-${tag}@hotel.test`

await db.execute('begin')
try {
  const jobId = await realParent(db)
  const office = String((await one(`select app.job_office('${jobId}'::uuid)::text as o`)).o)
  const project = String(
    (await one(`select project_id::text as p from public.jobs where job_id = '${jobId}'::uuid`)).p,
  )

  await db.execute(`insert into public.contacts (project_id, kind, name, role, org, stage, email, phone, instagram, website, "where", note, "next", next_due, fields, labels_set)
    values (${lit(project)}::uuid, 'supplier', 'Maria Proof', '', 'Blue Bay Hotel', 'active', ${lit(WAITING)}, '+30 210 000 111', '', '', 'Naxos', '', '', '', '[]'::jsonb, false),
           (${lit(project)}::uuid, 'supplier', 'Nikos Proof', '', 'Sea View Rooms', 'active', ${lit(SILENT)}, '', '', '', 'Paros', '', '', '', '[]'::jsonb, false)`)
  // Maria was asked and has not answered: her thread is quiet, and the last word is Grant's.
  const insertMsg = (id: string, thread: string, from: string, labels: string[], days: number) =>
    db.execute(`insert into public.mail_messages
      (message_id, thread_id, subject, from_name, from_address, to_count, sent_at, labels, has_attachments, unread,
       first_seen_at, last_seen_at, office_id)
      values (${lit(id)}, ${lit(thread)}, ${lit(`Rooms for September ${tag}`)}, ${lit(from === WAITING ? 'Maria Proof' : 'Grant Rogers')},
              ${lit(from)}, 1, app.now_utc() - interval '${String(days)} days', array[${labels.map((l) => lit(l)).join(',')}]::text[],
              false, false, app.now_utc(), app.now_utc(), ${lit(office)}::uuid)`)
  const MARIA_THREAD = `acc-maria-${tag}`
  await insertMsg(`am1-${tag}`, MARIA_THREAD, WAITING, ['INBOX'], 12)
  await insertMsg(`am2-${tag}`, MARIA_THREAD, 'grant@proof.test', ['SENT'], 10)

  const { contacts } = await loadCorrespondenceFacts(db, jobId, project)
  const maria = contacts.find((c) => c.name === 'Maria Proof')
  const nikos = contacts.find((c) => c.name === 'Nikos Proof')
  if (maria === undefined || nikos === undefined) {
    check(
      'both suppliers are in the facts',
      false,
      `found: ${contacts.map((c) => c.name).join(', ')}`,
    )
  } else {
    for (const c of [maria, nikos]) {
      const labels = entryFor(c).rows.map((r) => r[0])
      check(
        `${c.name}: the entry carries all seventeen §19B fields in the spec's order`,
        JSON.stringify(labels) === JSON.stringify(ACCOMMODATION_FIELDS),
        `${String(labels.length)} fields`,
      )
    }
    const statusText = (c: ContactFacts) =>
      entryFor(c).rows.find((r) => r[0] === 'Availability status')?.[1] ?? ''
    const mariaStatusText = statusText(maria)
    check(
      'a supplier who has not answered is "Awaiting reply", not unavailable',
      availabilityStatus(maria) === 'Awaiting reply' &&
        mariaStatusText.startsWith('Awaiting reply') &&
        !/Confirmed unavailable/.test(mariaStatusText),
      `status=${availabilityStatus(maria)}; text="${mariaStatusText.slice(0, 60)}"`,
    )
    check(
      'CONTROL: a supplier with no quiet thread is "Unknown", never "Confirmed unavailable"',
      availabilityStatus(nikos) === 'Unknown' &&
        !/Confirmed unavailable/.test(JSON.stringify(entryFor(nikos).rows)),
      `status=${availabilityStatus(nikos)}`,
    )
    const contactRow = entryFor(maria).rows.find((r) => r[0] === 'Booking/contact information')?.[1]
    check(
      'booking and contact information is the address and phone from the records',
      contactRow === `${WAITING} / +30 210 000 111`,
      `value=${String(contactRow)}`,
    )
    const nikosRow = (field: string) => entryFor(nikos).rows.find((r) => r[0] === field)?.[1]
    check(
      'no property, price or date is filled in that the records do not hold',
      nikosRow('Accommodation price') === NOT_EXTRACTED && nikosRow('Property') === NOT_IN_RECORDS,
      'price reads "Not extracted yet"; property reads "Not in the records yet"',
    )
  }

  const report = buildAccommodationReport(contacts, { name: 'Greek islands' }, new Date())
  const rendered = renderReport(report)
  const verdict = validatePdf(rendered.bytes, { layoutProblems: rendered.problems })
  check(
    'the document renders and passes its own structural and layout checks',
    verdict.ok && rendered.problems.length === 0,
    verdict.ok ? `${String(verdict.pages)} page(s)` : verdict.problems.join('; '),
  )
} finally {
  await db.execute('rollback')
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
process.exitCode = failed.length === 0 ? 0 : 1

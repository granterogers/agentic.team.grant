/**
 * REG-023 / REG-028 — the mail a project is waiting on is read in both directions, and only for threads the project can
 * see and that have been quiet long enough.
 *
 *   npx tsx scripts/isolated/mail-awaiting.ts <replica-db>
 *
 * Drives the REAL `app.mail_awaiting` over mail rows written inside one transaction that is rolled back. A contact of
 * the project is the only thing that links a thread to it (ADR-0037), so each thread's counterpart is a contact.
 *
 * Asserts:
 *   1. A thread the counterpart wrote last, quiet for longer than the window, is listed as "you have not replied",
 *      and the counterpart is named (never Grant).
 *   2. A thread Grant wrote last, quiet for longer than the window, is listed as "no reply to you", and the counterpart
 *      is named (never Grant).
 *   3. CONTROL: a thread that is recent (inside the window) is not listed.
 *   4. CONTROL: a thread from somebody who is not a contact of the project is not listed, however old it is.
 *
 * Replica only; the guard refuses anything else.
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

const tag = Date.now().toString(36)
const GRANT = 'grant@proof.test'
const PRIYA = `priya-${tag}@acme.test`
const STRANGER = `stranger-${tag}@elsewhere.test`

await db.execute('begin')
try {
  const op = String((await one(`select app.operator_office()::text as o`)).o)
  const project = String((await one(`select app.unnamed_project(${lit(op)}::uuid)::text as p`)).p)

  // Priya is a contact of the project. The stranger is not, and has no alias either.
  await db.execute(`insert into public.contacts (project_id, kind, name, role, org, stage, email, phone, instagram, website, "where", note, "next", next_due, fields, labels_set)
    values (${lit(project)}::uuid, 'person', 'Priya Proof', '', '', 'active', ${lit(PRIYA)}, '', '', '', '', '', '', '', '[]'::jsonb, false)`)

  const ago = (days: number) => `app.now_utc() - interval '${days} days'`
  const msg = async (id: string, thread: string, from: string, labels: string[], when: string) => {
    await db.execute(`insert into public.mail_messages
      (message_id, thread_id, subject, from_name, from_address, to_count, sent_at, labels, has_attachments, unread,
       first_seen_at, last_seen_at, office_id)
      values (${lit(id)}, ${lit(thread)}, ${lit(`Subject ${thread} ${tag}`)}, ${lit(from === GRANT ? 'Grant Rogers' : 'Priya Proof')},
              ${lit(from)}, 1, ${when}, array[${labels.map((l) => lit(l)).join(',')}]::text[], false, false,
              app.now_utc(), app.now_utc(), ${lit(op)}::uuid)`)
  }

  const A = `thread-a-${tag}`
  const B = `thread-b-${tag}`
  const C = `thread-c-${tag}`
  const D = `thread-d-${tag}`
  // A: Priya wrote last, 10 days ago. You have not replied.
  await msg(`a1-${tag}`, A, PRIYA, ['INBOX'], ago(10))
  // B: Priya wrote 12 days ago, Grant replied 10 days ago. No reply to Grant since.
  await msg(`b1-${tag}`, B, PRIYA, ['INBOX'], ago(12))
  await msg(`b2-${tag}`, B, GRANT, ['SENT'], ago(10))
  // C: Priya wrote yesterday. Recent, inside the window.
  await msg(`c1-${tag}`, C, PRIYA, ['INBOX'], ago(1))
  // D: a stranger wrote 30 days ago. Not a contact, so this project cannot see the thread.
  await msg(`d1-${tag}`, D, STRANGER, ['INBOX'], ago(30))

  const raw = (
    await one(`select app.mail_awaiting(${lit(op)}::uuid, ${lit(project)}::uuid, 7, 50)::text as r`)
  ).r
  const listed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
    thread_id: string
    with: string
    waiting: string
  }[]
  const byThread = (t: string) => listed.find((r) => r.thread_id === t)

  const a = byThread(A)
  check(
    'a thread Priya wrote last, quiet for a week, is "you have not replied", named for Priya',
    a !== undefined && a.waiting === 'you have not replied' && /Priya/.test(a.with),
    a === undefined ? 'not listed' : `waiting="${a.waiting}" with="${a.with}"`,
  )
  const b = byThread(B)
  check(
    'a thread Grant wrote last, quiet for a week, is "no reply to you", named for Priya and never for Grant',
    b !== undefined &&
      b.waiting === 'no reply to you' &&
      /Priya/.test(b.with) &&
      !/Grant/.test(b.with),
    b === undefined ? 'not listed' : `waiting="${b.waiting}" with="${b.with}"`,
  )
  check(
    'CONTROL: a recent thread (yesterday) is not listed',
    byThread(C) === undefined,
    byThread(C) === undefined ? 'not listed' : 'listed',
  )
  check(
    'CONTROL: an old thread from a non-contact is not listed',
    byThread(D) === undefined,
    byThread(D) === undefined ? 'not listed' : 'listed',
  )
} finally {
  await db.execute('rollback')
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
process.exitCode = failed.length === 0 ? 0 : 1

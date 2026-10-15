/**
 * REG-029 / COS-127 — the follow-up duty puts ONE task per quiet thread on Grant's list, sends nothing, and does not
 * repeat itself on the next run.
 *
 *   npx tsx scripts/isolated/followup-duty.ts <replica-db>
 *
 * Drives the REAL `followupsHandler` (the code the daily duty runs) over mail rows and a contact written inside one
 * transaction that is rolled back. The handler reads `app.mail_awaiting` and writes through `app.task_add`.
 *
 * Asserts:
 *   1. A thread the counterpart wrote last, quiet for a week, gets one follow-up task, owned by the Chief of Staff,
 *      with no due date, naming the contact and the action, and marked with its thread.
 *   2. A thread Grant wrote last, quiet for a week, gets one follow-up task asking the counterpart whether they saw it.
 *   3. A second run adds NOTHING for those threads (once per thread, not once per run).
 *   4. CONTROL: a recent thread (one day) gets no task, and a thread from a stranger gets no task.
 *   5. The handler announces nothing (the task is the notification) and reports only tasks it made.
 *
 * Replica only; the guard refuses anything else.
 */
import { followupsHandler } from '../../src/handlers/followups.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

const tag = Date.now().toString(36)
const GRANT = 'grant@proof.test'
const PRIYA = `priya-fu-${tag}@acme.test`
const TOM = `tom-fu-${tag}@acme.test`
const STRANGER = `stranger-fu-${tag}@elsewhere.test`

await db.execute('begin')
try {
  const jobId = await realParent(db)
  const office = String((await one(`select app.job_office('${jobId}'::uuid)::text as o`)).o)
  const project = String(
    (await one(`select project_id::text as p from public.jobs where job_id = '${jobId}'::uuid`)).p,
  )

  // Two contacts of the project. The stranger is not one.
  for (const [name, email] of [
    ['Priya Proof', PRIYA],
    ['Tom Proof', TOM],
  ] as const) {
    await db.execute(`insert into public.contacts (project_id, kind, name, role, org, stage, email, phone, instagram, website, "where", note, "next", next_due, fields, labels_set)
      values (${lit(project)}::uuid, 'person', ${lit(name)}, '', '', 'active', ${lit(email)}, '', '', '', '', '', '', '', '[]'::jsonb, false)`)
  }

  const ago = (days: number) => `app.now_utc() - interval '${String(days)} days'`
  const msg = async (id: string, thread: string, from: string, labels: string[], when: string) => {
    await db.execute(`insert into public.mail_messages
      (message_id, thread_id, subject, from_name, from_address, to_count, sent_at, labels, has_attachments, unread,
       first_seen_at, last_seen_at, office_id)
      values (${lit(id)}, ${lit(thread)}, ${lit(`Subject ${thread} ${tag}`)}, ${lit(from === GRANT ? 'Grant Rogers' : from === PRIYA ? 'Priya Proof' : from === TOM ? 'Tom Proof' : 'Stranger')},
              ${lit(from)}, 1, ${when}, array[${labels.map((l) => lit(l)).join(',')}]::text[], false, false,
              app.now_utc(), app.now_utc(), ${lit(office)}::uuid)`)
  }
  const QUIET_THEY = `quiet-they-${tag}`
  const QUIET_GRANT = `quiet-grant-${tag}`
  const RECENT = `recent-${tag}`
  const STRANGE = `strange-${tag}`
  await msg(`qt-${tag}`, QUIET_THEY, PRIYA, ['INBOX'], ago(10))
  await msg(`qg1-${tag}`, QUIET_GRANT, TOM, ['INBOX'], ago(12))
  await msg(`qg2-${tag}`, QUIET_GRANT, GRANT, ['SENT'], ago(10))
  await msg(`rc-${tag}`, RECENT, TOM, ['INBOX'], ago(1))
  await msg(`st-${tag}`, STRANGE, STRANGER, ['INBOX'], ago(30))

  const job = {
    jobId,
    kind: 'office.followups',
    correlationId: String(
      (
        await one(
          `select correlation_id::text as c from public.jobs where job_id = '${jobId}'::uuid`,
        )
      ).c,
    ),
    projectId: project,
    idempotencyKey: `fu-${tag}`,
    attempt: 1,
    officeId: office,
  }
  const handler = followupsHandler(db)
  const first = await handler.handle(job, db)

  const tasksFor = async (thread: string) =>
    rows(`select t.task_id::text as id, t.detail, t.due_on::text as due, s.slug as owner
            from public.tasks t left join public.staff s on s.staff_id = t.assignee_staff
           where t.project_id = ${lit(project)}::uuid and t.detail like ${lit(`%[thread ${thread}]%`)}`)

  const theyTasks = await tasksFor(QUIET_THEY)
  const grantTasks = await tasksFor(QUIET_GRANT)
  const they = theyTasks[0] as { detail: string; due: string | null; owner: string } | undefined
  check(
    'a quiet thread the contact wrote last gets one follow-up, owned by the Chief of Staff, with no due date',
    theyTasks.length === 1 && they?.owner === 'chief-of-staff' && they?.due === null,
    `tasks=${String(theyTasks.length)} owner=${String(they?.owner)} due=${String(they?.due)}`,
  )
  check(
    'the follow-up names the contact and says to reply',
    /Priya Proof/.test(they?.detail ?? '') && /Reply to Priya Proof/.test(they?.detail ?? ''),
    (they?.detail ?? '').slice(0, 110),
  )
  check(
    'a quiet thread Grant wrote last gets one follow-up asking whether the contact has seen it',
    grantTasks.length === 1 &&
      /Ask Tom Proof whether they have seen your message/.test(
        String((grantTasks[0] as { detail: string } | undefined)?.detail ?? ''),
      ),
    `tasks=${String(grantTasks.length)}`,
  )

  const second = await handler.handle({ ...job, idempotencyKey: `fu2-${tag}` }, db)
  const theyAfter = await tasksFor(QUIET_THEY)
  const grantAfter = await tasksFor(QUIET_GRANT)
  check(
    'a second run adds nothing for those threads (once per thread, not once per run)',
    theyAfter.length === 1 && grantAfter.length === 1 && /already on the list/.test(second.body),
    `after second run: ${String(theyAfter.length)} and ${String(grantAfter.length)}; reply: ${second.body.slice(0, 100)}`,
  )

  check(
    "CONTROL: a recent thread (one day) and a stranger's thread get no follow-up",
    (await tasksFor(RECENT)).length === 0 && (await tasksFor(STRANGE)).length === 0,
    `recent=${String((await tasksFor(RECENT)).length)} stranger=${String((await tasksFor(STRANGE)).length)}`,
  )
  check(
    'the duty announces nothing: the task on the list is the notification',
    first.announce === false,
    `announce=${String(first.announce)}`,
  )
} finally {
  await db.execute('rollback')
  await db.end()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} ok`)
process.exitCode = failed.length === 0 ? 0 : 1

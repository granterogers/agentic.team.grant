/**
 * e2e-tasks (agent E1): the task system, driven through the real SQL writers and readers, the real gateway, the real
 * `tasks.remind` handler and the real Telegram door, on a throwaway clone of the replica.
 *
 *   npx tsx scripts/isolated/e2e-tasks.ts <replica-db>
 *
 * Hermetic: no model (the instruction handler runs with the model degraded to `{}`), no network, no provider. Prints
 * PROVEN / FAILED per property and OBSERVED for design facts that are neither (so they are in the evidence, not
 * silently decided). Every task this writes is in the operator's office on a clone; nothing is torn down because the
 * database is dropped by the caller.
 */
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { remindersHandler } from '../../src/handlers/reminders.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'
import { registerBot } from './real-telegram.ts'
import { startTelegramDoor } from './telegram-door.ts'

const db = await isolated(process.argv[2] ?? 'e1_tasks')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
let failed = 0
let total = 0
const check = (what: string, ok: boolean, detail: string) => {
  total += 1
  if (!ok) failed += 1
  console.log(`${ok ? 'PROVEN  ' : 'FAILED  '} ${what} - ${detail}`)
}
const observed = (what: string, detail: string) => console.log(`OBSERVED ${what} - ${detail}`)
const section = (s: string) => console.log(`\n== ${s} ==`)

const op = String((await one(`select app.operator_office()::text as o`)).o)
const O = `${lit(op)}::uuid`
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const mkProject = async (name: string) =>
  json((await one(`select app.hq_create_project(${O}, ${lit(name)}, 'upload', ${lit(`e1t-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${run}`)}, ${lit(name)}, true) as v`)).v)
const P1 = await mkProject(`Tasks Alpha ${run}`)
const P2 = await mkProject(`Tasks Beta ${run}`)
const p1 = String(P1.project_id)
const p1slug = String((await one(`select slug from public.projects where project_id = ${lit(p1)}::uuid`)).slug)
const p2slug = String((await one(`select slug from public.projects where project_id = ${lit(String(P2.project_id))}::uuid`)).slug)

// A real inbound turn (Telegram shape) to hang agent-made tasks on, as production does.
const turnJob = async (said: string, ctx: Record<string, unknown> = {}): Promise<string> => {
  const n = Math.floor(Math.random() * 9_000_000) + 1_000_000
  const c = await one(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context)
    values (${O}, ${lit(p1)}::uuid, 'teamhq', ${lit(`e1${run}:${n}`)}, 'grant', ${lit(said)}, ${lit(`teamhq:message:e1${run}${n}`)}, 'grant', ${lit(JSON.stringify(ctx))}::jsonb)
    returning command_id::text as id`)
  const v = json((await one(`select app.enqueue_inbound(${lit(String(c.id))}::uuid) as v`)).v)
  return String(v.job_id)
}
const jobObj = async (jobId: string): Promise<Job> => {
  const j = await one(`select job_id::text as id, kind, correlation_id::text as c, project_id::text as p, idempotency_key as k, office_id::text as o from public.jobs where job_id = ${lit(jobId)}::uuid`)
  return { jobId: String(j.id), kind: String(j.kind), correlationId: String(j.c), projectId: j.p === null ? null : String(j.p), idempotencyKey: String(j.k), attempt: 1, officeId: String(j.o) } as Job
}
const mine = async (args: string) => json((await one(`select app.my_task_add(${O}, ${args}) as v`)).v)
const list = async (bucket: string, extra = '') => ((await one(`select app.my_tasks(${O}, ${lit(bucket)}${extra}) as v`)).v as unknown as { id: string; title: string; subtasks: unknown[]; overdue: boolean }[])
const titles = (a: { title: string }[]) => a.map((t) => t.title)
const state = async (id: string) => (await one(`select state, done_at is not null as done, completed_by, repeat_every::text as rep from public.tasks where task_id = ${lit(id)}::uuid`)) as Record<string, unknown>

// ================================================================================================================
section('1 creation: team task, personal task, agent task')
const teamA = json((await one(`select app.hq_task_add(${O}, ${lit(p1slug)}, ${lit(`Team A ${run}`)}, 'detail', ${lit(day(3))}::date, 'finance-director') as v`)).v)
check('hq_task_add makes a TEAM task in the named project, assigned to a staff member', typeof teamA.id === 'string' && teamA.project === p1slug, JSON.stringify(teamA))
const teamRow = await one(`select assigned_to_human, assignee_staff is not null as has_staff, added_by, job_id from public.tasks where task_id = ${lit(String(teamA.id))}::uuid`)
check('team task is NOT assigned_to_human and carries the staff assignee', teamRow.assigned_to_human === false && teamRow.has_staff === true, JSON.stringify(teamRow))
const unknownAssignee = json((await one(`select app.hq_task_add(${O}, ${lit(p1slug)}, 'x', null, null, 'nobody-here') as v`)).v)
check('assigning to a person who does not exist is refused by name', typeof unknownAssignee.error === 'string', JSON.stringify(unknownAssignee))
const unknownProject = json((await one(`select app.hq_task_add(${O}, 'no-such-project', 'x') as v`)).v)
check('a task in an unknown project is refused, not silently filed elsewhere', typeof unknownProject.error === 'string', JSON.stringify(unknownProject))
const noTitle = json((await one(`select app.hq_task_add(${O}, ${lit(p1slug)}, '   ') as v`)).v)
check('a task with no title is refused', typeof noTitle.error === 'string', JSON.stringify(noTitle))
const mA = await mine(`${lit(`Mine A ${run}`)}, 'notes', ${lit(day(1))}::date, null, 100, ${lit(p1slug)}, array['Home','errand','home']`)
check('my_task_add makes a PERSONAL task', mA.ok === true, JSON.stringify(mA))
const mARow = await one(`select assigned_to_human, labels::text as labels, project_id::text as p, added_by from public.tasks where task_id = ${lit(String(mA.id))}::uuid`)
check('personal task: assigned_to_human, labels normalised (lower-cased, de-duplicated, sorted), in the project', mARow.assigned_to_human === true && mARow.labels === '{errand,home}' && mARow.p === p1, JSON.stringify(mARow))
const noProj = await mine(`${lit(`Inbox A ${run}`)}`)
check('a personal task with no project and no date is an inbox item', noProj.ok === true, JSON.stringify(noProj))
const badProj = await mine(`'x', '', null, null, 100, 'no-such-project'`)
check('personal task naming an unknown project is refused (not silently inboxed)', badProj.ok === false, JSON.stringify(badProj))

// ================================================================================================================
section('2 mine vs team boundary')
const mineAll = await list('all')
check('my_tasks lists personal tasks', titles(mineAll).includes(`Mine A ${run}`), `${mineAll.length} rows`)
check("my_tasks never lists the team's own work", !titles(mineAll).includes(`Team A ${run}`), '')
const studio = json(JSON.stringify((await one(`select app.studio_tasks(${lit(p1)}::uuid) as v`)).v)) as unknown as { title: string; mine: boolean }[]
const studioArr = (await one(`select app.studio_tasks(${lit(p1)}::uuid) as v`)).v as { title: string; mine: boolean }[]
void studio
check('the project view (studio_tasks) shows BOTH, marked mine/not mine', studioArr.some((t) => t.title === `Team A ${run}` && t.mine === false) && studioArr.some((t) => t.title === `Mine A ${run}` && t.mine === true), `${studioArr.length} rows`)
const tz = String((await one(`select app.grant_timezone() as z`)).z)
// 1027 (Z1): one clock. studio_tasks, my_tasks, my_tasks_counts and reminders_due all bucket in app.office_timezone(office);
// scripts/isolated/tk-reminders.ts proves that on two zones a day apart. grant_timezone() is now only the legacy setting.
observed('timezone', `office zone ${String((await one(`select app.office_timezone(${O}) as z`)).z)} (legacy app.grant_timezone()=${tz})`)
const delTeam = json((await one(`select app.my_task_delete(${O}, ${lit(String(teamA.id))}) as v`)).v)
check("the personal delete door refuses the team's task", delTeam.ok === false, JSON.stringify(delTeam))
const setTeam = json((await one(`select app.my_task_set(${O}, ${lit(String(teamA.id))}, null, null, null, null, null, ${lit(`Renamed by my_task_set ${run}`)}) as v`)).v)
check("the personal EDIT door (my_task_set) also refuses the team's task", setTeam.ok === false, `${JSON.stringify(setTeam).slice(0, 160)} (it did ${setTeam.ok === true ? 'edit it' : 'refuse'})`)

// ================================================================================================================
section('3 categories, priority, search, sort, buckets')
await mine(`${lit(`Sort Zeta ${run}`)}, 'pricing review notes', null, null, 10, null, array['pricing']`)
await mine(`${lit(`Sort Alpha ${run}`)}, '', ${lit(day(5))}::date, null, 50, null, array['ops']`)
await mine(`${lit(`Sort Mid ${run}`)}, '', ${lit(day(-2))}::date, null, 200, null, array['ops']`)
const q1 = await list('all', `, 200, 'pricing'`)
check('search narrows by title, notes AND label', titles(q1).includes(`Sort Zeta ${run}`) && !titles(q1).includes(`Sort Alpha ${run}`), JSON.stringify(titles(q1)))
const q2 = await list('all', `, 200, 'zzzz-nothing-${run}'`)
check('a search matching nothing returns nothing (control: the filter can fail)', q2.length === 0, String(q2.length))
const byPriority = await list('all', `, 200, ${lit(run)}, 'priority'`)
const prio = titles(byPriority).filter((t) => t.startsWith('Sort '))
check('sort=priority puts the lowest number (most important) first', prio[0] === `Sort Zeta ${run}`, JSON.stringify(prio))
const byTitle = titles(await list('all', `, 200, ${lit(`Sort `)}, 'title'`)).filter((t) => t.startsWith('Sort '))
check('sort=title is alphabetical', JSON.stringify(byTitle) === JSON.stringify([...byTitle].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))), JSON.stringify(byTitle))
const smart = titles(await list('all', `, 200, 'Sort '`)).filter((t) => t.startsWith('Sort '))
check('default (smart) sort: overdue first, then by date, undated last', smart[0] === `Sort Mid ${run}` && smart[smart.length - 1] === `Sort Zeta ${run}`, JSON.stringify(smart))
const overdue = await list('overdue')
check('overdue bucket holds the task due two days ago, flagged overdue', overdue.some((t) => t.title === `Sort Mid ${run}` && t.overdue === true), JSON.stringify(titles(overdue)))
check('overdue bucket does not hold a future task', !titles(overdue).includes(`Sort Alpha ${run}`), '')
const upcoming = await list('upcoming')
check('upcoming bucket holds a future-dated task', titles(upcoming).includes(`Sort Alpha ${run}`), '')
const inbox = await list('inbox')
check('inbox bucket = no date and no project', titles(inbox).includes(`Inbox A ${run}`) && !titles(inbox).includes(`Mine A ${run}`), '')
const counts = json(JSON.stringify((await one(`select app.my_tasks_counts(${O}) as v`)).v))
observed('my_tasks_counts', JSON.stringify(counts))
const lim = await list('all', `, 2`)
check('limit is honoured', lim.length === 2, String(lim.length))

// ================================================================================================================
section('4 subtasks')
const parent = await mine(`${lit(`Parent ${run}`)}, '', null, null, 100, ${lit(p1slug)}`)
const kid = await mine(`${lit(`Kid ${run}`)}, '', null, null, 100, null, null, ${lit(String(parent.id))}`)
check('a subtask can be made under a personal task', kid.ok === true, JSON.stringify(kid))
const kidRow = await one(`select project_id::text as p, parent_task_id::text as par from public.tasks where task_id = ${lit(String(kid.id))}::uuid`)
check("a subtask inherits its parent's project", kidRow.p === p1 && kidRow.par === String(parent.id), JSON.stringify(kidRow))
const grandkid = await mine(`${lit(`Grandkid ${run}`)}, '', null, null, 100, null, null, ${lit(String(kid.id))}`)
check('subtasks do not nest', grandkid.ok === false, JSON.stringify(grandkid))
const underTeam = await mine(`${lit(`Under team ${run}`)}, '', null, null, 100, null, null, ${lit(String(teamA.id))}`)
check("a subtask cannot be hung under the team's own task", underTeam.ok === false, JSON.stringify(underTeam))
const withKids = (await list('all', `, 200, ${lit(`Parent ${run}`)}`))[0] as unknown as { children: number; subtasks: { title: string }[] }
check('the parent reports its open children and lists them', withKids.children === 1 && withKids.subtasks[0]?.title === `Kid ${run}`, JSON.stringify({ c: withKids.children, s: withKids.subtasks.length }))
const del = json((await one(`select app.my_task_delete(${O}, ${lit(String(parent.id))}) as v`)).v)
check('deleting a parent takes its children AND says so', del.ok === true && Number(del.children_deleted) === 1, JSON.stringify(del))
check('...and they are actually gone', Number((await one(`select count(*)::int as c from public.tasks where task_id = ${lit(String(kid.id))}::uuid`)).c) === 0, '')
const delAgain = json((await one(`select app.my_task_delete(${O}, ${lit(String(parent.id))}) as v`)).v)
check('deleting a task twice says "already gone" rather than failing', delAgain.ok === false && delAgain.gone === true, JSON.stringify(delAgain))

// ================================================================================================================
section('5 completion, reopen, undo, blocked, repeat')
const doneId = String(mA.id)
const dn = json((await one(`select app.hq_task_state(${O}, ${lit(doneId)}, 'done', null, 'grant') as v`)).v)
const dnRow = await state(doneId)
check('marking done sets done_at and completed_by', dn.state === 'done' && dnRow.done === true && dnRow.completed_by === 'grant', JSON.stringify(dnRow))
check('marking done offers an undo', typeof dn.undo === 'string', String(dn.undo))
check('a done task leaves Today/Upcoming and appears in done', !titles(await list('upcoming')).includes(`Mine A ${run}`) && titles(await list('done')).includes(`Mine A ${run}`), '')
await one(`select app.hq_task_state(${O}, ${lit(doneId)}, 'todo', null, 'grant') as v`)
check('reopening clears done_at', (await state(doneId)).done === false, '')
const blk = json((await one(`select app.hq_task_state(${O}, ${lit(doneId)}, 'blocked', '', 'grant') as v`)).v)
check('blocked without a reason is refused', typeof blk.error === 'string', JSON.stringify(blk))
const badState = json((await one(`select app.hq_task_state(${O}, ${lit(doneId)}, 'finished', null, 'grant') as v`)).v)
check('an unknown state is refused naming the vocabulary', typeof badState.error === 'string', JSON.stringify(badState))
const undone = json((await one(`select app.hq_undo(${O}, ${lit(String(dn.undo))}) as v`)).v)
observed('hq_undo of the done press', JSON.stringify(undone).slice(0, 200))

const rep = await mine(`${lit(`Weekly ${run}`)}, '', ${lit(day(0))}::date, null, 100, null, array['chore']`)
await one(`select app.my_task_set(${O}, ${lit(String(rep.id))}, null, null, interval '7 days') as v`)
await one(`select app.hq_task_state(${O}, ${lit(String(rep.id))}, 'done', null, 'grant') as v`)
const next = (await rows(`select task_id::text as id, due_on::text as due, repeat_every::text as rep from public.tasks where title = ${lit(`Weekly ${run}`)} and state = 'todo'`))[0]
check('completing a repeating task makes the next occurrence, a period later, and the finished one stops repeating', next !== undefined && next.due === day(7) && (await state(String(rep.id))).rep === null, JSON.stringify(next))
// the reminder-only recurring task (no due date): "remind me every morning"
const remRep = await mine(`${lit(`Daily-reminder ${run}`)}, '', null, now() - interval '1 minute'`)
await one(`select app.my_task_set(${O}, ${lit(String(remRep.id))}, null, null, interval '1 day', 'done') as v`)
await one(`select app.hq_task_state(${O}, ${lit(String(remRep.id))}, 'done', null, 'grant') as v`)
const nextRem = (await rows(`select remind_at, due_on::text as due from public.tasks where title = ${lit(`Daily-reminder ${run}`)} and state = 'todo'`))[0]
// Decided (R3, 1027): a repeating task with ONLY a reminder time is a reminder SERIES. The delivery of its reminder moves it to
// the next time in place (scripts/isolated/tk-reminders.ts), and ticking it off ENDS it: the trigger makes no next row for it.
check(
  'a reminder SERIES (a reminder time and a repeat, no due date) ticked off ENDS: no next occurrence row',
  nextRem === undefined,
  `next occurrence: ${JSON.stringify(nextRem)}`,
)
const remRepDue = await mine(`${lit(`Daily-reminder-due ${run}`)}, '', ${lit(day(0))}::date, now() - interval '1 minute'`)
await one(`select app.my_task_set(${O}, ${lit(String(remRepDue.id))}, null, null, interval '1 day', 'due') as v`)
await one(`select app.hq_task_state(${O}, ${lit(String(remRepDue.id))}, 'done', null, 'grant') as v`)
const nextRemDue = (await rows(`select remind_at, due_on::text as due from public.tasks where title = ${lit(`Daily-reminder-due ${run}`)} and state = 'todo'`))[0]
check('control: a repeating task with a due date AND a reminder keeps the reminder', nextRemDue !== undefined && nextRemDue.remind_at !== null, JSON.stringify(nextRemDue))

// ================================================================================================================
section('6 reminders: what the duty needs')
const rDue = await mine(`${lit(`Remind due ${run}`)}, '', null, now() - interval '5 minutes'`)
const rFuture = await mine(`${lit(`Remind future ${run}`)}, '', null, now() + interval '2 hours'`)
const rOnlyDate = await mine(`${lit(`Date only ${run}`)}, '', ${lit(day(-1))}::date`)
const rStale = await mine(`${lit(`Remind stale ${run}`)}, '', null, now() - interval '20 days'`)
const rDone = await mine(`${lit(`Remind done ${run}`)}, '', null, now() - interval '5 minutes'`)
await one(`select app.hq_task_state(${O}, ${lit(String(rDone.id))}, 'done', null, 'grant') as v`)
const dueNow = (await one(`select app.reminders_due(${O}) as v`)).v as { title: string; overdue: boolean }[]
const dueTitles = titles(dueNow)
check('a reminder whose time has passed is due', dueTitles.includes(`Remind due ${run}`), JSON.stringify(dueTitles))
check('a reminder in the future is not due', !dueTitles.includes(`Remind future ${run}`), '')
check('a done task is not reminded', !dueTitles.includes(`Remind done ${run}`), '')
check('a reminder from before the 14-day grace is not announced as a wall of stale pings', !dueTitles.includes(`Remind stale ${run}`), '')
check(
  'a task that has ONLY a due date (and is already overdue) is NOT reminded - the duty reads remind_at alone',
  !dueTitles.includes(`Date only ${run}`),
  'this is the answer to "why does tasks.remind never say anything": nothing sets remind_at from a due date',
)
// does the creation path put a remind_at on a task given only a date? (the instruction handler, no model)
const fj = await turnJob(`Remind me to renew the licence ${run} on Friday.`)
await instructionHandler({ db, router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never }).handle(await jobObj(fj), db)
const fromSentence = (await rows(`select title, due_on::text as due, remind_at is not null as has_remind from public.tasks where job_id = ${lit(fj)}::uuid`))[0]
check('"Remind me to X on Friday" (typed) makes ONE task with a due date', fromSentence !== undefined && fromSentence.due !== null, JSON.stringify(fromSentence))
check(
  '...and gives it a remind_at, so the duty can actually fire',
  fromSentence?.has_remind === true,
  `has remind_at: ${String(fromSentence?.has_remind)} - a typed reminder that sets only a date is a reminder the duty never sends`,
)
// the duty end to end
const outJob = await jobObj(fj)
const handled = await remindersHandler(db).handle({ ...outJob, kind: 'tasks.remind' }, db)
check('tasks.remind announces when something is due, naming it', handled.announce === true && handled.body.includes(`Remind due ${run}`), handled.body.replace(/\n/g, ' | ').slice(0, 160))
// Decided (C3, 1027): said is not delivered. It is marked IN FLIGHT by the job that said it; a later tick, once the delivery layer
// says sent, marks it reminded (scripts/isolated/tk-reminders.ts drives that).
check('...and marks what it said as in flight, last (not reminded until delivered)', Number((await one(`select count(*)::int as c from public.tasks where title = ${lit(`Remind due ${run}`)} and reminded_at is null and remind_job_id = ${lit(outJob.jobId)}::uuid`)).c) === 1, '')
const handled2 = await remindersHandler(db).handle({ ...outJob, kind: 'tasks.remind' }, db)
check('the next tick says nothing and does not announce (no repeat, no 96-a-day noise)', handled2.announce === false && !handled2.body.includes(`Remind due ${run}`), handled2.body.slice(0, 80))
const resetRem = await one(`select app.my_task_set(${O}, ${lit(String(rDue.id))}, null, now() - interval '1 minute') as v`)
void resetRem
check('re-setting a reminder re-arms it (reminded_at cleared)', (await one(`select reminded_at is null as r from public.tasks where task_id = ${lit(String(rDue.id))}::uuid`)).r === true, '')
void rFuture
void rOnlyDate
void rStale

// ================================================================================================================
section('7 provenance and containment')
const t7 = await turnJob(`Ledger origin check ${run}`)
const ag = json((await one(`select app.task_add(${O}, ${lit(p1)}::uuid, ${lit(`Agent task ${run}`)}, null, null, null, false, 'chief-of-staff', ${lit(t7)}::uuid) as v`)).v)
const agRow = await one(`select added_by, job_id::text as j, assigned_to_human from public.tasks where task_id = ${lit(String(ag.id))}::uuid`)
check('an agent-made task records who (added_by) and which job (job_id)', agRow.added_by === 'chief-of-staff' && agRow.j === t7, JSON.stringify(agRow))
const agAgain = json((await one(`select app.task_add(${O}, ${lit(p1)}::uuid, ${lit(`  agent TASK ${run} `)}, null, null, null, false, 'chief-of-staff', ${lit(t7)}::uuid) as v`)).v)
check('retry of the same job writes the SAME task (0592): same id, existing', agAgain.id === ag.id && agAgain.existing === true, JSON.stringify(agAgain))
const agOther = json((await one(`select app.task_add(${O}, ${lit(p1)}::uuid, ${lit(`Agent task ${run}`)}, null, null, null, false, 'chief-of-staff', ${lit(await turnJob(`another ask ${run}`))}::uuid) as v`)).v)
check('a DIFFERENT job asking for the same title makes a second task (two requests are two tasks)', agOther.id !== ag.id, '')
const hqDouble1 = json((await one(`select app.hq_task_add(${O}, ${lit(p1slug)}, ${lit(`HQ double ${run}`)}) as v`)).v)
const hqDouble2 = json((await one(`select app.hq_task_add(${O}, ${lit(p1slug)}, ${lit(`HQ double ${run}`)}) as v`)).v)
observed('a re-sent Team HQ team-task add (no job, e.g. a network retry)', `${hqDouble1.id === hqDouble2.id ? 'one task' : 'TWO identical tasks'} (ids ${String(hqDouble1.id).slice(0, 8)} / ${String(hqDouble2.id).slice(0, 8)}); idempotency lives on job_id and the HQ writer passes none; the page only disables the button while a request is in flight (office.js attempt())`)
const myDouble1 = await mine(`${lit(`Mine double ${run}`)}`)
const myDouble2 = await mine(`${lit(`Mine double ${run}`)}`)
observed('a re-sent Team HQ personal add (no job)', `${myDouble1.id === myDouble2.id ? 'one task' : 'TWO identical tasks'} (ids ${String(myDouble1.id).slice(0, 8)} / ${String(myDouble2.id).slice(0, 8)})`)
const bad = json((await one(`select app.task_add(${O}, ${lit(p1)}::uuid, 'x', null, null, null, false, null, '00000000-0000-0000-0000-000000000000'::uuid) as v`)).v)
check('a task cannot be authored by a job that is not in this office', typeof bad.error === 'string', JSON.stringify(bad))

// harness traffic is named at creation and never reminded
const handlerFw = instructionHandler({ db, router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never })
const run2 = async (said: string, forwarded: boolean) => {
  const j = await turnJob(said, forwarded ? { forwarded: true } : {})
  await handlerFw.handle(await jobObj(j), db)
  return Number((await one(`select count(*)::int as c from public.tasks where job_id = ${lit(j)}::uuid`)).c)
}
const typedMade = await run2(`Remind me to wire the deposit typed ${run} tomorrow.`, false)
const fwdMade = await run2(`Remind me to wire the deposit forwarded ${run} tomorrow.`, true)
check('control: the same sentence TYPED makes a task', typedMade === 1, String(typedMade))
check('a FORWARDED message cannot create a task (content, not intent)', fwdMade === 0, String(fwdMade))
const typedAdd = await run2(`Add a task to chase the roofer typed ${run}`, false)
const fwdAdd = await run2(`Add a task to chase the roofer forwarded ${run}`, true)
check('control: "add a task to ..." typed makes one', typedAdd >= 1, String(typedAdd))
check('"add a task to ..." forwarded makes none', fwdAdd === 0, String(fwdAdd))

// ================================================================================================================
section('8 surfaces: one task table whichever door, same-message duplicates, cross-surface')
await registerBot(db)
const tg = await startTelegramDoor(db, '8967954396')
const GRANT_TG = 1386648496
const n = () => Math.floor(Math.random() * 9_000_000) + 1_000_000
const tgSend = (text: string, extra: Record<string, unknown> = {}) =>
  tg.post({ update_id: n(), message: { message_id: n(), date: Math.floor(Date.now() / 1000), text, chat: { id: GRANT_TG, type: 'private' }, from: { id: GRANT_TG }, ...extra } })
const handlerAll = instructionHandler({ db, router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never })
const drain = async (text: string) => {
  const c = (await rows(`select job_id::text as j from public.inbound_commands where instruction = ${lit(text)} order by received_at desc limit 1`))[0]
  if (c?.j === null || c === undefined) return null
  const job = await jobObj(String(c.j))
  await handlerAll.handle(job, db)
  return String(c.j)
}
const twice = `Add a task to ring the plumber about the boiler ${run}`
await tgSend(twice)
const j1 = await drain(twice)
await tgSend(twice)
const j2 = await drain(twice)
const sameMsg = Number((await one(`select count(*)::int as c from public.tasks where title ilike ${lit(`%ring the plumber about the boiler ${run}%`)} and state <> 'cancelled'`)).c)
observed('same sentence sent twice on Telegram (different messages)', `${String(sameMsg)} task(s); jobs ${String(j1).slice(0, 8)} / ${String(j2).slice(0, 8)}`)
check('the same instruction sent twice in one Telegram chat within 10 minutes is ONE task (ledger R18)', sameMsg === 1, String(sameMsg))
const cross = `Add a task to book the venue visit ${run}`
await tgSend(cross)
await drain(cross)
const crossHq = json((await one(`select app.my_task_add(${O}, ${lit(`Book the venue visit ${run}`)}) as v`)).v)
const crossCount = Number((await one(`select count(*)::int as c from public.tasks where title ilike ${lit(`%book the venue visit ${run}%`)}`)).c)
observed('same task from Telegram then Team HQ', `${String(crossCount)} rows (HQ add had no job, so only the exact-title/job rules apply; ${crossHq.existing === true ? 'HQ returned the existing row' : 'HQ made a second row'})`)
// finishing it from another surface hits the same row
const doneSentence = `Mark the plumber task done ${run}`
await tgSend(doneSentence)
await drain(doneSentence)
const plumber = (await rows(`select state from public.tasks where title ilike ${lit(`%ring the plumber about the boiler ${run}%`)}`))[0]
observed('"mark ... done" typed on Telegram', `state of the one row: ${String(plumber?.state)}`)
// the gateway sees the same row
const GRANT_SESSION = `aaa.bbb.${'g'.repeat(70)}`
const gw = await startEdge({
  db,
  edgeFile: 'supabase/functions/hq-api/index.ts',
  env: { HQ_API_TOKEN: 'isolated-hq-token', SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key', SUPABASE_ANON_KEY: 'isolated-anon', SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid' },
  authUsers: { [GRANT_SESSION]: 'grant.e.rogers@gmail.com' },
})
const act = async (action: string, args: Record<string, unknown>) => {
  const r = await gw.call(new Request('https://gw.invalid/functions/v1/hq-api', { method: 'POST', headers: { Authorization: `Bearer ${GRANT_SESSION}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, args }) }))
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
const viaGw = await act('my_task_add', { p_title: `Via gateway ${run}` })
check('Team HQ gateway my_task_add makes the same kind of row', viaGw.status === 200, JSON.stringify(viaGw.body).slice(0, 160))
const gwRow = await one(`select assigned_to_human, added_by, office_id::text as o from public.tasks where title = ${lit(`Via gateway ${run}`)}`)
check('...assigned_to_human, in the operator office, added_by the person', gwRow.assigned_to_human === true && gwRow.o === op, JSON.stringify(gwRow))
const readSection = await gw.call(
  new Request(`https://gw.invalid/functions/v1/hq-api?section=my_tasks&id=all&q=${encodeURIComponent(run)}`, {
    headers: { Authorization: `Bearer ${GRANT_SESSION}` },
  }),
)
const viaGwList = { status: readSection.status, body: (await readSection.json().catch(() => ({}))) as Record<string, unknown> }
const gwTitles = JSON.stringify(viaGwList.body)
check('the gateway reader shows tasks made by Telegram text and by the gateway', gwTitles.toLowerCase().includes('ring the plumber') && gwTitles.includes(`Via gateway ${run}`), `status ${String(viaGwList.status)}`)
const keyTry = await gw.call(new Request('https://gw.invalid/functions/v1/hq-api', { method: 'POST', headers: { Authorization: 'Bearer isolated-hq-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'task_state', args: { p_task_id: '00000000-0000-0000-0000-000000000000', p_state: 'done' } }) }))
check('the office machine key cannot complete a task (a person decides)', keyTry.status === 403, `http ${String(keyTry.status)}`)

// forwarded through the REAL Telegram door
const fwdText = `Add a task to pay the invoice door-forwarded ${run}`
await tgSend(fwdText, { forward_origin: { type: 'user', date: 1, sender_user: { id: 5, is_bot: false, first_name: 'X' } } })
await drain(fwdText)
const fwdDoor = Number((await one(`select count(*)::int as c from public.tasks where title ilike ${lit(`%pay the invoice door-forwarded ${run}%`)}`)).c)
check('a message forwarded to the Telegram bot creates NO task (through the real door and handler)', fwdDoor === 0, String(fwdDoor))
const fwdRow = await one(`select context::text as c from public.inbound_commands where instruction = ${lit(fwdText)}`)
check('...because the door recorded it as forwarded', String(fwdRow.c).includes('forwarded'), String(fwdRow.c))

// a state change by conversation must not ALSO create a task (the cheapest natural phrasing)
section('8b conversational completion: one sentence, one effect')
{
  const seed = `Add a task to ring the roofer about the gutters ${run}`
  await tgSend(seed)
  await drain(seed)
  const before = Number((await one(`select count(*)::int as c from public.tasks`)).c)
  const finish = `Mark the roofer task done ${run}x`
  await tgSend(finish)
  const jj = await drain(finish)
  const after = Number((await one(`select count(*)::int as c from public.tasks`)).c)
  const made = await rows(`select title, assigned_to_human as mine, added_by from public.tasks where job_id = ${lit(String(jj))}::uuid`)
  const target = (await rows(`select state from public.tasks where title ilike ${lit(`%ring the roofer about the gutters ${run}%`)}`))[0]
  check('"Mark the roofer task done" completes the roofer task', target?.state === 'done', String(target?.state))
  check(
    '...and creates NO new task out of the same words (junk title "the roofer task done")',
    after === before,
    `tasks ${String(before)} -> ${String(after)}; new rows: ${JSON.stringify(made)}`,
  )
  const cancelS = `Cancel the venue task ${run}y`
  const seed2 = `Add a task to book the venue ${run}`
  await tgSend(seed2)
  await drain(seed2)
  const b2 = Number((await one(`select count(*)::int as c from public.tasks`)).c)
  await tgSend(cancelS)
  const j3 = await drain(cancelS)
  const a2 = Number((await one(`select count(*)::int as c from public.tasks`)).c)
  check('"Cancel the venue task" creates no new task either', a2 === b2, `tasks ${String(b2)} -> ${String(a2)}; ${JSON.stringify(await rows(`select title, added_by from public.tasks where job_id = ${lit(String(j3))}::uuid`))}`)
  const every = `Remind me to ring the venue every Monday ${run}`
  await tgSend(every)
  const j4 = await drain(every)
  const rec = (await rows(`select title, due_on::text as due, repeat_every::text as rep from public.tasks where job_id = ${lit(String(j4))}::uuid`))[0]
  check('"Remind me to X every Monday" is recorded as a RECURRING task, with a clean title', rec?.rep !== null && rec?.rep !== undefined && !String(rec?.title).toLowerCase().includes('every'), JSON.stringify(rec))
}

// ================================================================================================================
section('9 Vikunja compatibility assumptions (what the local task model must satisfy)')
const tcols = (await rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'tasks'`)).map((r) => String(r.column_name))
for (const c of ['revision', 'seq', 'title', 'detail', 'state', 'due_on', 'priority', 'labels', 'repeat_every', 'parent_task_id', 'project_id', 'remind_at', 'done_at', 'office_id']) {
  check(`tasks has the column the provider mapping needs: ${c}`, tcols.includes(c), '')
}
const tpl = (await rows(`select table_name from information_schema.tables where table_schema = 'public' and table_name ~ 'task'`)).map((r) => String(r.table_name))
observed('task tables', JSON.stringify(tpl))
const fns = (await rows(`select proname from pg_proc where pronamespace = 'app'::regnamespace and proname ~ '^task_(pushed|pulled|push_failed|provider_forget)|tasks_to_push|task_delete_pushed'`)).map((r) => String(r.proname))
check('the sync seam (tasks_to_push, task_pushed, task_pulled, task_push_failed, task_delete_pushed) exists in the database', ['tasks_to_push', 'task_pushed', 'task_pulled', 'task_push_failed', 'task_delete_pushed'].every((f) => fns.includes(f)), JSON.stringify(fns))
const bumped = await one(`select revision as r0 from public.tasks where task_id = ${lit(String(next?.id ?? rep.id))}::uuid`)
await one(`select app.my_task_set(${O}, ${lit(String(next?.id ?? rep.id))}, null, null, null, null, null, ${lit(`Edited ${run}`)}) as v`)
const bumped2 = await one(`select revision as r1 from public.tasks where task_id = ${lit(String(next?.id ?? rep.id))}::uuid`)
check('an edit increments the revision (the push/pull conflict test depends on it)', Number(bumped2.r1) > Number(bumped.r0), `${String(bumped.r0)} -> ${String(bumped2.r1)}`)

console.log(`\n${String(total - failed)}/${String(total)} PROVEN (${String(failed)} FAILED)`)
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1

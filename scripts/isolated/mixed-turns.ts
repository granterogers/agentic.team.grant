/**
 * Run 1 (Phase 10): a turn that answers a question AND asks for something keeps
 * both, and a withdrawn action never runs.
 *
 *   npx tsx scripts/isolated/mixed-turns.ts <replica-db>
 *
 * The real `office.instruction` handler on an isolated replica, with the model
 * degraded to `{}` (every model path falls back to the deterministic cascade).
 * Effects are read from canonical state: the blocker's state, the tasks and the
 * lessons the turn wrote. Each mixed case has a NEGATIVE control (the same
 * words with nothing waiting) so the peel cannot buy recall with precision.
 */
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { raiseBlocker } from '../../src/inference/record.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'mixed')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const handler = instructionHandler({
  db,
  router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never,
})

let seq = 0
const say = async (chat: string, said: string): Promise<Job> => {
  seq += 1
  const cmd = await one(`insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values ('teamhq', ${lit(`${chat}:${String(seq)}`)}, 'grant', ${lit(said)},
            ${lit(`teamhq:mixed:${run}.${String(seq)}`)}, 'grant') returning command_id::text as id`)
  const enq = await one(`select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  const v = (typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id: string }
  const j = await one(`select job_id::text as id, kind, correlation_id::text as c,
    project_id::text as p, idempotency_key as k from public.jobs where job_id = ${lit(v.job_id)}::uuid`)
  return {
    jobId: String(j.id),
    kind: String(j.kind),
    correlationId: String(j.c),
    projectId: j.p === null ? null : String(j.p),
    idempotencyKey: String(j.k),
    attempt: 1,
  } as Job
}

/** A turn, optionally with one question waiting from the turn before. */
const attempt = async (said: string, waiting: boolean) => {
  const chat = `mx${run}${String(seq)}`
  const before = await say(chat, 'Draft the renewal note and send it to the venue.')
  let blocker: string | null = null
  if (waiting) {
    const child = String(
      (
        await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id, parent_job_id)
        select 'office.pursue', requested_by, project_id, 'mx-' || gen_random_uuid(), correlation_id, job_id
          from public.jobs where job_id = ${lit(before.jobId)}::uuid returning job_id::text as id`)
      ).id,
    )
    blocker = String(
      await raiseBlocker(db, {
        jobId: child,
        requestedAction: 'Send the renewal note to the venue',
        whyNeeded: 'isolated proof',
        consequencesOfDelay: 'nothing',
        approvalOptions: ['Yes, do it', 'No, leave it'],
        originatingAgent: 'chief-of-staff',
        workCanContinue: false,
      } as never),
    )
  }
  const job = await say(chat, said)
  const body = (await handler.handle(job, db)).body
  const state =
    blocker === null
      ? null
      : String(
          (
            await one(
              `select state::text as s from public.blockers where blocker_id = ${lit(blocker)}::uuid`,
            )
          ).s,
        )
  const tasks = (
    await rows(`select title from public.tasks where job_id = ${lit(job.jobId)}::uuid`)
  ).map((r) => String(r.title))
  const lessons = (
    await rows(`select body from public.lessons where from_job = ${lit(job.jobId)}::uuid`)
  ).map((r) => String(r.body))
  return { body, state, tasks, lessons }
}

/*
  A preference, a reminder and a question in ONE message (invariant 4, final audit). Two defects lived here with the
  model degraded: the rule's body was the FIRST sentence of the message, so "Remind me tomorrow to call Kevin. From now
  on give me the conclusion first." stored the reminder as a permanent standing rule; and a question mark at the END of
  the message was read as a question about the rule, so "From now on give me the conclusion first. And what is the
  status of the venue?" stored nothing and said nothing. The controls are the same words with no rule in them.
*/
{
  const r = await attempt(
    'Remind me tomorrow to call Kevin. From now on give me the conclusion first.',
    false,
  )
  check(
    'a reminder then a rule: the RULE is the sentence that carries the marker, the reminder is a task',
    r.lessons.length === 1 &&
      /conclusion first/i.test(r.lessons[0] ?? '') &&
      !/kevin/i.test(r.lessons[0] ?? '') &&
      r.tasks.some((t) => /call kevin/i.test(t)),
    `lessons ${JSON.stringify(r.lessons)}; tasks ${JSON.stringify(r.tasks)}`,
  )
}
{
  const r = await attempt(
    'From now on give me the conclusion first. Also remind me tomorrow to call Kevin. And what is the status of the venue?',
    false,
  )
  check(
    'a rule, a reminder and a question: the rule is stored as itself and the reminder is a task without the rule in its title',
    r.lessons.length === 1 &&
      /conclusion first/i.test(r.lessons[0] ?? '') &&
      r.tasks.some((t) => /call kevin/i.test(t) && !/from now on/i.test(t)),
    `lessons ${JSON.stringify(r.lessons)}; tasks ${JSON.stringify(r.tasks)}`,
  )
}
{
  const r = await attempt(
    'From now on give me the conclusion first. And what is the status of the venue?',
    false,
  )
  check(
    'a rule then a question: the question mark at the end of the message is not a question about the rule',
    r.lessons.length === 1 && /conclusion first/i.test(r.lessons[0] ?? ''),
    `lessons ${JSON.stringify(r.lessons)}`,
  )
}
{
  const r = await attempt(
    'Should you always use bullet points? Also remind me tomorrow to call Kevin.',
    false,
  )
  check(
    'CONTROL: a question ABOUT a rule is not stored as one, and the reminder still is a task',
    r.lessons.length === 0 && r.tasks.some((t) => /call kevin/i.test(t)),
    `lessons ${JSON.stringify(r.lessons)}; tasks ${JSON.stringify(r.tasks)}`,
  )
}

{
  const r = await attempt('Yes, and remind me tomorrow to call Kevin.', true)
  check(
    'yes + a reminder: the question is answered AND the reminder is kept',
    r.state === 'resolved' && r.tasks.some((t) => /call kevin/i.test(t)),
    `${String(r.state)}; tasks ${r.tasks.join('|')}`,
  )
  check(
    'and "yes" is not stored as anything',
    r.lessons.length === 0,
    `${String(r.lessons.length)} lessons`,
  )
}
{
  const r = await attempt('Yes - and remind me tomorrow.', true)
  check(
    'yes + a reminder with nothing to remind of: answered, and the office says the rest was not acted on',
    r.state === 'resolved' && /have not acted on that part/.test(r.body),
    r.body.slice(0, 160),
  )
}
{
  const r = await attempt('No, and remind me tomorrow to call the venue.', true)
  check(
    'no + a reminder: declined, reminder kept',
    r.state === 'resolved' && r.tasks.some((t) => /call the venue/i.test(t)),
    `${String(r.state)}; tasks ${r.tasks.join('|')}`,
  )
}
{
  const r = await attempt('Yes, do it. Also from now on give me the conclusion first.', true)
  check(
    'yes + a preference: answered, and only the preference is stored',
    r.state === 'resolved' &&
      r.lessons.length === 1 &&
      /conclusion first/.test(r.lessons[0] ?? '') &&
      !/yes/i.test(r.lessons[0] ?? ''),
    r.lessons.join('|'),
  )
}
{
  const r = await attempt('Do that, but dont send it.', true)
  check(
    'a qualified yes is not a yes: nothing is approved',
    r.state === 'open',
    `blocker ${String(r.state)}`,
  )
}
{
  const r = await attempt('Thats fine, but dont contact them yet.', true)
  check(
    'a qualified agreement does not approve the send',
    r.state === 'open',
    `blocker ${String(r.state)}`,
  )
}
// Negative controls: the same words with NOTHING waiting are not an answer.
{
  const r = await attempt('Yes, and remind me tomorrow to call Kevin.', false)
  check(
    'nothing waiting: the reminder is still made and no question is invented',
    r.tasks.some((t) => /call kevin/i.test(t)) && !/Taken as a yes/.test(r.body),
    r.body.slice(0, 120),
  )
}
{
  const r = await attempt('Yes, do it. Create the task to book the hall.', false)
  check(
    'nothing waiting: "Yes, do it. Create the task" stays a command',
    r.tasks.some((t) => /book the hall/i.test(t)),
    `tasks ${r.tasks.join('|')}`,
  )
}
// Withdrawals: what he took back does not run.
for (const said of [
  'Remind me tomorrow to call Kevin. Actually no, forget that.',
  'Add a task to ring the printers, no wait, scrap that.',
]) {
  const r = await attempt(said, false)
  check(
    `withdrawn in the same breath, so nothing is filed: ${said}`,
    r.tasks.length === 0,
    r.tasks.join('|') || 'no tasks',
  )
}
{
  const r = await attempt('No.', true)
  check(
    'a bare "No." with a question waiting declines that question',
    r.state === 'resolved' && /Taken as a no/.test(r.body),
    r.body.slice(0, 100),
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

/**
 * R45 — answering a plan step's question decides it, exactly once.
 *
 *   npx tsx scripts/isolated/approval-execution.ts <replica-db>
 *
 * The real `office.pursue` handler, the real worker, `app.hq_answer_blocker`,
 * `app.recover_stalled_jobs` and the real `task.create` executor, against an
 * isolated replica at `suggest` autonomy, where a level-1 step asks. Every
 * step's title carries a run token, so "the task exists" cannot be satisfied
 * by anything but this run's execution.
 */
import { DeliveryService, type Transport } from '../../src/channels/delivery.ts'
import { combinedNotifier } from '../../src/channels/notify.ts'
import { pursueHandler } from '../../src/handlers/pursue.ts'
import { deliveryKey } from '../../src/jobs/delivery-key.ts'
import {
  dequeue,
  type HandlerOutput,
  type Job,
  type Reviewer,
  runJob,
} from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'r45')
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const run = Date.now().toString(36)
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const sent: string[] = []
const transport: Transport = {
  channel: 'telegram',
  send: async (r) => {
    sent.push(r.dedupeKey)
    return { messageRef: `w${String(sent.length)}` }
  },
}
const service = new DeliveryService(db, transport)
const notify = combinedNotifier(
  [
    {
      name: 'witness',
      surface: 'telegram',
      notify: async (job: Job, output: HandlerOutput) => {
        const r = await service.deliver({
          dedupeKey: deliveryKey(job, output, 'reply'),
          accountRef: '8967954396',
          targetRef: '1386648496',
          purpose: 'result',
          correlationId: job.correlationId,
          jobId: job.jobId,
          body: { text: output.body },
        })
        return { delivered: r.outcome === 'sent', note: r.outcome }
      },
    },
  ],
  db,
)
const review: Reviewer = async () => ({ status: 'approved', notes: 'isolated proof' })
const handlers = [pursueHandler({ db } as never)]
let seq = 0
const actor = new Map<string, string>()

const plan = (titles: string[]) => ({
  goal: 'isolated proof',
  steps: titles.map((why, i) => ({
    id: `s${String(i + 1)}`,
    capability: 'task.create',
    why,
    needs: [],
    specialist: null,
    /*
      Outside on purpose (0612). Internal level-1 writes proceed at suggest now, so a task
      step would not ask; these suites are about what happens AROUND a question, so the step
      is one the floor still stops: its audience is somebody outside the office.
    */
    audience: 'outside',
  })),
  unreachable: [],
  refused: [],
  how: 'fallback',
})
const make = async (titles: string[]): Promise<string> => {
  seq += 1
  const BY = `telegram:grant${String(seq)}`
  const r = await one(`
    with j as (insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id, pinned_config, announce)
               values (app.test_office(), 'office.pursue', '${BY}', app.unnamed_project(app.test_office()), 'r45-' || gen_random_uuid(), gen_random_uuid(),
                       jsonb_build_object('plan', '${JSON.stringify(plan(titles)).replace(/'/g, "''")}'::jsonb, 'request', 'isolated proof'), true)
               returning job_id)
    select job_id::text as id from j`)
  actor.set(String(r.id), BY)
  return String(r.id)
}
const step = async (jobId: string): Promise<string> => {
  const got = await dequeue(
    db,
    `r45-${run}`,
    false,
    false,
    ['office.pursue'],
    actor.get(jobId) ?? '',
  )
  if (got === null) return 'nothing to dequeue'
  if (got.jobId !== jobId) throw new Error(`took ${got.jobId}, wanted ${jobId}`)
  return (await runJob(db, got, handlers, review, notify)).finalState
}
// Only what a STEP created: a question's own to-do carries satisfies_blocker.
const tasks = async (title: string) =>
  Number(
    (
      await one(
        `select count(*)::int as n from public.tasks where title = '${title}' and satisfies_blocker is null`,
      )
    ).n,
  )
const openBlockers = async (jobId: string) =>
  Number(
    (
      await one(
        `select count(*)::int as n from public.blockers where job_id = '${jobId}' and state = 'open'`,
      )
    ).n,
  )
const allBlockers = async (jobId: string) =>
  Number((await one(`select count(*)::int as n from public.blockers where job_id = '${jobId}'`)).n)
const blocker = async (jobId: string) =>
  String(
    (
      await one(
        `select blocker_id::text as id from public.blockers where job_id = '${jobId}' and state = 'open' order by created_at desc limit 1`,
      )
    ).id,
  )
const answer = (jobId: string, a: string, fn = 'app') =>
  blocker(jobId).then((b) =>
    db.execute(
      `select ${fn}.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = '${b}'::uuid), app.test_office()), '${b}'::uuid, '${a}', 'grant')`,
    ),
  )
const state = async (jobId: string) =>
  String((await one(`select state::text as s from public.jobs where job_id = '${jobId}'`)).s)

// YES
{
  const t = `YES task ${run}`
  const j = await make([t])
  const first = await step(j)
  check(
    'a level-1 step at suggest asks first',
    first === 'paused' && (await tasks(t)) === 0 && (await openBlockers(j)) === 1,
    `${first}, tasks ${String(await tasks(t))}`,
  )
  await answer(j, 'Yes, do it')
  const second = await step(j)
  check(
    'YES performs the step exactly once and the pursuit completes',
    second === 'complete' && (await tasks(t)) === 1,
    `${second}, tasks ${String(await tasks(t))}`,
  )
  check(
    'and nothing is asked again',
    (await allBlockers(j)) === 1 && (await openBlockers(j)) === 0,
    `${String(await allBlockers(j))} question(s) ever`,
  )
}
// NO
{
  const t = `NO task ${run}`
  const j = await make([t])
  await step(j)
  await answer(j, 'No, leave it')
  const second = await step(j)
  check(
    'NO does not perform the step and the pursuit ends',
    second === 'complete' && (await tasks(t)) === 0,
    `${second}, tasks ${String(await tasks(t))}`,
  )
  check(
    'and does not re-plan into asking again',
    (await allBlockers(j)) === 1 && (await openBlockers(j)) === 0,
    `${String(await allBlockers(j))} question(s) ever`,
  )
}
// Delayed YES / delayed NO
for (const [a, want] of [
  ['Yes, do it', 1],
  ['No, leave it', 0],
] as const) {
  const t = `delayed ${a.slice(0, 3)} ${run}`
  const j = await make([t])
  await step(j)
  await db.execute(`update public.job_pauses set at = at - interval '2 days' where job_id = '${j}';
                    update public.blockers set created_at = created_at - interval '2 days' where job_id = '${j}'`)
  await answer(j, a)
  await step(j)
  check(
    `delayed ${a}: decided the same two days later`,
    (await tasks(t)) === want && (await state(j)) === 'complete',
    `tasks ${String(await tasks(t))}`,
  )
}
// Duplicate YES / duplicate NO
for (const [a, want] of [
  ['Yes, do it', 1],
  ['No, leave it', 0],
] as const) {
  const t = `dup ${a.slice(0, 3)} ${run}`
  const j = await make([t])
  await step(j)
  const b = await blocker(j)
  await db.execute(
    `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = '${b}'::uuid), app.test_office()), '${b}'::uuid, '${a}', 'grant')`,
  )
  const second = await db
    .execute(
      `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = '${b}'::uuid), app.test_office()), '${b}'::uuid, '${a}', 'grant')::text as r`,
    )
    .then((r) => String((r.rows[0] as { r?: string }).r))
    .catch((e: unknown) => `refused: ${String((e as Error).message).slice(0, 60)}`)
  await step(j)
  const extra = await step(j)
  check(
    `duplicate ${a}: one execution`,
    (await tasks(t)) === want && extra === 'nothing to dequeue',
    `tasks ${String(await tasks(t))}, second answer: ${second.slice(0, 70)}`,
  )
}
// YES after the step changed: the approval does not cover different work
{
  const t = `before change ${run}`
  const t2 = `AFTER change ${run}`
  const j = await make([t])
  await step(j)
  await answer(j, 'Yes, do it')
  await db.execute(
    `update public.jobs set pinned_config = jsonb_set(pinned_config, '{plan}', '${JSON.stringify(plan([t2])).replace(/'/g, "''")}'::jsonb) where job_id = '${j}'`,
  )
  const after = await step(j)
  check(
    'YES given for one action does not authorise a changed one',
    (await tasks(t2)) === 0 &&
      (await tasks(t)) === 0 &&
      after === 'paused' &&
      (await openBlockers(j)) === 1,
    `${after}, changed-task ${String(await tasks(t2))}, new question ${String(await openBlockers(j))}`,
  )
}
// Restart between approval and continuation
{
  const t = `restart ${run}`
  const j = await make([t])
  await step(j)
  await answer(j, 'Yes, do it')
  // A worker takes it and dies before doing anything.
  const got = await dequeue(db, 'r45-dead', false, false, ['office.pursue'], actor.get(j) ?? '')
  await db.execute(
    `update public.jobs set leased_until = now() - interval '1 minute' where job_id = '${String(got?.jobId)}'`,
  )
  await db.execute('select * from app.recover_stalled_jobs(); select app.requeue_retrying();')
  const resumed = await step(j)
  check(
    'a worker dying after the answer: recovered, performed once',
    resumed === 'complete' && (await tasks(t)) === 1,
    `${resumed}, tasks ${String(await tasks(t))}`,
  )
}
// Two questions at once
{
  const ta = `two-A ${run}`
  const tb = `two-B ${run}`
  const ja = await make([ta])
  const jb = await make([tb])
  await step(ja)
  await step(jb)
  await answer(jb, 'Yes, do it')
  await answer(ja, 'No, leave it')
  await step(jb)
  await step(ja)
  check(
    'two open questions are answered independently',
    (await tasks(ta)) === 0 && (await tasks(tb)) === 1,
    `A ${String(await tasks(ta))}, B ${String(await tasks(tb))}`,
  )
}
// Two steps: each asks in turn, once
{
  const t1 = `chain-1 ${run}`
  const t2 = `chain-2 ${run}`
  const j = await make([t1, t2])
  await step(j)
  await answer(j, 'Yes, do it')
  const mid = await step(j)
  const midTasks = await tasks(t1)
  await answer(j, 'Yes, do it')
  const end = await step(j)
  check(
    'a two-step plan asks for each step once, in order, and performs each once',
    mid === 'paused' &&
      midTasks === 1 &&
      end === 'complete' &&
      (await tasks(t1)) === 1 &&
      (await tasks(t2)) === 1 &&
      (await allBlockers(j)) === 2,
    `${mid}->${end}, questions ${String(await allBlockers(j))}`,
  )
}
// Through the other door: the PostgREST wrapper the dashboard and bots call
{
  const t = `wrapper ${run}`
  const j = await make([t])
  await step(j)
  await answer(j, 'Yes, do it', 'public')
  await step(j)
  check(
    'an answer through public.hq_answer_blocker decides it the same way',
    (await tasks(t)) === 1,
    `tasks ${String(await tasks(t))}`,
  )
}
// And what he was told
check(
  'every question and every result was its own delivery, none repeated',
  new Set(sent).size === sent.length,
  `${String(sent.length)} deliveries, ${String(new Set(sent).size)} distinct`,
)

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

/**
 * B7 (architecture audit, run 1): a question that could not be raised is not a
 * question that was raised.
 *
 *   npx tsx scripts/isolated/blocker-failure.ts <replica-db>
 *
 * The real `office.pursue` handler and the real worker, against an isolated
 * replica at `suggest` autonomy, where a level-1 step asks. The write of the
 * question is made to FAIL (a trigger refuses the insert, as a constraint or an
 * outage would). The job used to pause `awaiting_approval` with no question
 * behind it - a wait for an answer nobody could give, recorded nowhere. Read
 * from canonical state: what the job did, what was recorded, and that recovery
 * still works once the write can succeed.
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

const db = await isolated(process.argv[2] ?? 'b7')
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
    with j as (insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id, pinned_config, announce)
               values ('office.pursue', '${BY}', app.unnamed_project(), 'b7-' || gen_random_uuid(), gen_random_uuid(),
                       jsonb_build_object('plan', '${JSON.stringify(plan(titles)).replace(/'/g, "''")}'::jsonb, 'request', 'isolated proof'), true)
               returning job_id)
    select job_id::text as id from j`)
  actor.set(String(r.id), BY)
  return String(r.id)
}
const step = async (jobId: string): Promise<string> => {
  const got = await dequeue(
    db,
    `b7-${run}`,
    false,
    false,
    ['office.pursue'],
    actor.get(jobId) ?? '',
  )
  if (got === null) return 'nothing to dequeue'
  if (got.jobId !== jobId) throw new Error(`took ${got.jobId}, wanted ${jobId}`)
  return (await runJob(db, got, handlers, review, notify)).finalState
}

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
const stateOf = async (jobId: string) =>
  (await one(`select state::text as s, attempt from public.jobs where job_id = '${jobId}'`)) as {
    s: string
    attempt: number
  }
const impediments = async (jobId: string) =>
  Number(
    (await one(`select count(*)::int as n from public.job_impediments where job_id = '${jobId}'`))
      .n,
  )
const pauses = async (jobId: string) =>
  Number(
    (
      await one(
        `select count(*)::int as n from public.job_pauses where job_id = '${jobId}' and reason = 'awaiting_approval' and resumed_at is null`,
      )
    ).n,
  )

// The question cannot be written.
await db.execute(`create or replace function public.isolated_refuse_blockers() returns trigger language plpgsql as $$
  begin raise exception 'isolated proof: the blockers table refused the insert'; end $$`)
await db.execute(`create trigger isolated_refuse_blockers before insert on public.blockers
  for each row execute function public.isolated_refuse_blockers()`)

const title = `Ask ${run}`
const job = await make([title])
const first = await step(job)
const s1 = await stateOf(job)
check(
  'the question could not be written: the job is NOT parked awaiting an answer nobody can give',
  (await pauses(job)) === 0 && (await openBlockers(job)) === 0 && s1.s !== 'paused',
  `state ${s1.s}, ${String(await pauses(job))} approval pause(s), ${String(await openBlockers(job))} open question(s); worker said ${first}`,
)
check(
  'the failure is recorded where Governance can read it, not swallowed',
  (await impediments(job)) >= 1,
  `${String(await impediments(job))} impediment(s)`,
)
check(
  'the step it could not ask about was not performed anyway',
  (await tasks(title)) === 0,
  `${String(await tasks(title))} task(s)`,
)
check(
  'and it is still recoverable: the job is retrying (or queued), with attempts left',
  ['retrying', 'queued'].includes(s1.s) && s1.attempt < 5,
  `state ${s1.s}, attempt ${String(s1.attempt)}`,
)

// A question that can NEVER be written does not loop for ever: attempts run out and the job ends failed.
{
  const doomed = await make([`Doomed ${run}`])
  let last = ''
  for (let i = 0; i < 7; i += 1) {
    await db.execute(`update public.jobs set not_before = null where job_id = '${doomed}'`)
    await db.execute(`select app.requeue_retrying()`).catch(() => undefined)
    last = await step(doomed)
    if ((await stateOf(doomed)).s === 'failed') break
  }
  const end = await stateOf(doomed)
  check(
    'control: a question that can never be written ends the job failed after its attempts, not parked',
    end.s === 'failed' && (await impediments(doomed)) >= 1 && (await pauses(doomed)) === 0,
    `state ${end.s} after ${String(end.attempt)} attempt(s); last worker verdict ${last}`,
  )
}

// The write can succeed again: recovery must raise the question and wait properly.
await db.execute(`drop trigger isolated_refuse_blockers on public.blockers`)
await db.execute(`update public.jobs set not_before = null where job_id = '${job}'`)
await db.execute(`select app.requeue_retrying()`).catch(() => undefined)
const again = await step(job)
const s2 = await stateOf(job)
check(
  'once the question can be written, the retry raises it and waits for the answer',
  (await openBlockers(job)) === 1 && s2.s === 'paused' && (await pauses(job)) === 1,
  `state ${s2.s}, ${String(await openBlockers(job))} open question(s); worker said ${again}`,
)
const b = String(
  (
    await one(
      `select blocker_id::text as id from public.blockers where job_id = '${job}' and state = 'open'`,
    )
  ).id,
)
await db.execute(`select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = '${b}'::uuid), app.test_office()), '${b}'::uuid, 'Yes, do it', 'grant')`)
await step(job)
check(
  'and answering it performs the step exactly once',
  (await tasks(title)) === 1,
  `${String(await tasks(title))} task(s)`,
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await db.end()
process.exit(failed.length === 0 ? 0 : 1)

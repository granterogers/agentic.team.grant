/**
 * #371 residual 2: askUnasked re-asked, every tick, a question whose notifier
 * found nowhere to send it and so wrote no delivery row.
 *
 *   npx tsx scripts/isolated/ask-unasked-loop.ts <replica-db>
 *
 * Runs the REAL worker (`runJob`, `askUnasked`), the real `DeliveryService` and
 * the real `app.claim_delivery` containment guard against an isolated replica.
 * The only stand-in is the transport: it records what it was asked to send and
 * sends nothing, so no message can leave this process whatever the guard says.
 * The channel uses the real `deliveryKey`, the expression every production
 * channel builds its dedupe key from.
 */
import { DeliveryService, type Transport } from '../../src/channels/delivery.ts'
import { combinedNotifier } from '../../src/channels/notify.ts'
import { raiseBlocker } from '../../src/inference/record.ts'
import { pauseJob } from '../../src/jobs/checkpoint.ts'
import { deliveryKey } from '../../src/jobs/delivery-key.ts'
import {
  askUnasked,
  dequeue,
  type Handler,
  type HandlerOutput,
  type Job,
  type Reviewer,
  runJob,
} from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'aunq')
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const sent: { key: string; target: string }[] = []
let failNext = false
const transport: Transport = {
  channel: 'telegram',
  send: async (r) => {
    if (failNext) {
      failNext = false
      throw new Error('witness transport refused on purpose')
    }
    sent.push({ key: r.dedupeKey, target: r.targetRef })
    return { messageRef: `witness-${String(sent.length)}` }
  },
}
const service = new DeliveryService(db, transport)
const witness = {
  name: 'witness',
  surface: 'telegram',
  notify: async (job: Job, output: HandlerOutput) => {
    const r = await service.deliver({
      dedupeKey: deliveryKey(job, output, 'reply'),
      accountRef: '8967954396',
      targetRef: '1386648496', // a production destination: the guard must decide
      purpose: 'result',
      correlationId: job.correlationId,
      jobId: job.jobId,
      body: { text: output.body },
    })
    return { delivered: r.outcome === 'sent', note: `witness: ${r.outcome}` }
  },
}
const notify = combinedNotifier([witness], db)
const review: Reviewer = async () => ({ status: 'approved', notes: 'isolated proof' })

// A stand-in for office.pursue: first run asks, a resumed run finishes.
const asked = new Set<string>()
const handler: Handler = {
  kind: 'verify.ask',
  handle: async (job: Job) => {
    const base = {
      confidence: 'medium',
      evidence: 'inferred',
      sources: [],
      contradictions: null,
      path: 'deterministic_retrieval',
      model: null,
      announce: true,
    } as const
    if (!asked.has(job.jobId)) {
      asked.add(job.jobId)
      await raiseBlocker(db, {
        jobId: job.jobId,
        requestedAction: `Approve step for ${job.jobId.slice(0, 8)}`,
        whyNeeded: 'isolated proof',
        consequencesOfDelay: 'none',
        approvalOptions: ['Yes, do it', 'No, leave it'],
        originatingAgent: 'chief-of-staff',
        workCanContinue: false,
      } as never)
      await pauseJob(db, job.jobId, {
        reason: 'awaiting_approval',
        detail: 'isolated proof',
        resumeWhen: 'an answer',
        resumable: false,
        binds: { step: 's1', job: job.jobId },
      })
      return {
        ...base,
        body: `I have stopped before step 1 because I need you to say (${job.jobId.slice(0, 8)}).`,
      } as never
    }
    return { ...base, body: `Done: step 1 performed (${job.jobId.slice(0, 8)}).` } as never
  },
}

const make = async (by: string): Promise<Job> => {
  const r = await one(`
    with j as (insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
               values ('verify.ask', '${by}', app.unnamed_project(), 'r46-' || gen_random_uuid(), gen_random_uuid())
               returning job_id)
    select job_id::text as id from j`)
  const got = await dequeue(db, 'r46', false, false, ['verify.ask'], by)
  if (got === null || got.jobId !== r.id) throw new Error('could not take the fixture job')
  return got
}
const blockerOf = async (jobId: string) =>
  String(
    (
      await one(
        `select blocker_id::text as id from public.blockers where job_id = '${jobId}' order by created_at desc limit 1`,
      )
    ).id,
  )
const age = (jobId: string) =>
  db.execute(
    `update public.blockers set created_at = created_at - interval '3 minutes' where job_id = '${jobId}'`,
  )

const tried: string[] = []
const nowhere = async (job: Job) => {
  tried.push(job.jobId)
  return { delivered: false, note: 'no slack destination for this job; nothing delivered' }
}
/* What combinedNotifier does when refuseToSend says no: an impediment, no row. */
const refusing = async (job: Job) => {
  tried.push(job.jobId)
  await db.execute(
    `select app.cannot('${job.jobId}'::uuid, 'missing_data', 'a sendable answer', 'the sending path', 'isolated refusal', 'not sent')`,
  )
  return { delivered: false, note: 'not sent: isolated refusal' }
}
const impediments = async (jobId: string) =>
  Number(
    (await one(`select count(*)::int as n from public.job_impediments where job_id = '${jobId}'`))
      .n,
  )
/** Sweep n times; how many attempts each tick made at THIS job's question. */
const ticks = async (n: number, via: unknown, jobId: string) => {
  const per: number[] = []
  const b = await blockerOf(jobId)
  const mine = () =>
    tried.filter((x) => x === jobId).length +
    sent.filter((x) => x.key.startsWith(`blocker:${b}:`)).length
  for (let t = 0; t < n; t += 1) {
    const before = mine()
    await askUnasked(db, via as never)
    per.push(mine() - before)
  }
  return per
}

// 1. Asked inline, and there was nowhere to send it: tried, so never re-asked.
{
  const j = await make('telegram:grant')
  await runJob(db, j, [handler], review, nowhere as never)
  await age(j.jobId)
  const b = await blockerOf(j.jobId)
  const stamped = await one(
    `select asked_at is not null as t from public.blockers where blocker_id = '${b}'`,
  )
  check(
    'an attempt that found nowhere to send is recorded as tried',
    stamped.t === true,
    String(stamped.t),
  )
  const per = await ticks(3, nowhere, j.jobId)
  check(
    'so the sweep does not re-ask it every tick',
    per.every((x) => x === 0),
    JSON.stringify(per),
  )
}

// 2. Refused by the sending gate: tried once, and the ledger grows once.
{
  const j = await make('telegram:grant')
  await runJob(db, j, [handler], review, refusing as never)
  await age(j.jobId)
  const before = await impediments(j.jobId)
  const per = await ticks(3, refusing, j.jobId)
  const after = await impediments(j.jobId)
  check(
    'a question the sending gate refused is not re-asked, and the ledger does not grow per tick',
    per.every((x) => x === 0) && after === before,
    `sweep ${JSON.stringify(per)}, impediments ${String(before)} -> ${String(after)}`,
  )
}

// 3. The recovery still works: a worker that died before asking.
{
  const j = await make('telegram:grant')
  await runJob(db, j, [handler], review, undefined)
  await age(j.jobId)
  const b = await blockerOf(j.jobId)
  const per = await ticks(3, notify, j.jobId)
  const toHim = sent.filter((x) => x.key.startsWith(`blocker:${b}:`)).length
  check(
    'a question never tried is asked by the sweep, exactly once over three ticks',
    toHim === 1 && JSON.stringify(per) === '[1,0,0]',
    `sent ${String(toHim)}, sweep ${JSON.stringify(per)}`,
  )
}

// 4. Stale: a question days old is not sprung on him by a deploy.
{
  const j = await make('telegram:grant')
  await runJob(db, j, [handler], review, undefined)
  await db.execute(
    `update public.blockers set created_at = created_at - interval '3 days' where job_id = '${j.jobId}'`,
  )
  const per = await ticks(1, notify, j.jobId)
  check('a question three days old is not swept', per[0] === 0, JSON.stringify(per))
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)

/**
 * Integration pass (finding 4): askUnasked re-asks, every tick, a question whose
 * notifier found nowhere to send it and so wrote no delivery row. Reproduction only.
 *
 *   npx tsx scripts/isolated/approval-delivery.ts <replica-db>
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
const answer = (blocker: string, a: string) =>
  db.execute(`select app.hq_answer_blocker('${blocker}'::uuid, '${a}')`)

let calls = 0
const nowhere = async () => {
  calls += 1
  return { delivered: false, note: 'no slack destination for this job; nothing delivered' }
}
const j = await make('telegram:grant')
await runJob(db, j, [handler], review, nowhere as never)
await age(j.jobId)
const perTick: number[] = []
for (let t = 0; t < 3; t += 1) {
  const before = calls
  await askUnasked(db, nowhere as never)
  perTick.push(calls - before)
}
const rows = await one(
  `select count(*)::int as n from public.deliveries where dedupe_key like 'blocker:' || '${await blockerOf(j.jobId)}' || ':%'`,
)
console.log(JSON.stringify({ inlineCalls: 1, sweepCallsPerTick: perTick, deliveryRows: rows.n }))
await db.end()

// Reproduction only: helpers shared with approval-delivery.ts that this file does not call.
void check
void notify
void answer

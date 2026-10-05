/**
 * R46 — an approval question reaches him, once, and only if he is real.
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
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'r46')
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
  reach: 'internal',
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
  /*
    Grant's own work is a child of a real adapter turn (#379): a root job with
    no turn behind it is an origin no production component creates. Harness
    work keeps its own name and needs no door.
  */
  const r =
    by === 'telegram:grant'
      ? {
          id: String(
            (
              await (async (parent: string) =>
                one(`select app.enqueue_child(p_office => app.job_office('${parent}'::uuid), p_parent => '${parent}'::uuid,
                p_kind => 'verify.ask', p_payload => '{}'::jsonb)::text as v`))(
                await realParent(db),
              )
            ).v,
          ).match(/[0-9a-f-]{36}/)?.[0],
        }
      : await one(`
    with j as (insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
               values ('verify.ask', '${by}', app.unnamed_project(app.test_office()), 'r46-' || gen_random_uuid(), gen_random_uuid())
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
  db.execute(
    `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = '${blocker}'::uuid), app.test_office()), '${blocker}'::uuid, '${a}', 'grant')`,
  )

// 1. A genuine question is delivered, once, under its blocker's scope.
const real = await make('telegram:grant')
await runJob(db, real, [handler], review, notify)
const b1 = await blockerOf(real.jobId)
const st1 = await one(`select state::text as s from public.jobs where job_id = '${real.jobId}'`)
check(
  'a real paused question reaches him once',
  sent.length === 1 && sent[0]?.key === `blocker:${b1}:reply`,
  `${String(sent.length)} sent, key ${sent[0]?.key ?? '-'}`,
)
check('and the job stays paused, the approval durable', st1.s === 'paused', String(st1.s))

// 2. The sweep does not ask it again.
await age(real.jobId)
const again = await askUnasked(db, notify)
check(
  'the recovery sweep does not repeat a question already asked',
  again === 0 && sent.length === 1,
  `${String(again)} re-asked`,
)

// 3. Answered, resumed and finished: the result is its own message.
await answer(b1, 'Yes, do it')
const resumed = await dequeue(db, 'r46', false, false, ['verify.ask'], 'telegram:grant')
if (resumed !== null) await runJob(db, resumed, [handler], review, notify)
const st3 = await one(`select state::text as s from public.jobs where job_id = '${real.jobId}'`)
check(
  'the answer after approval is delivered too, under the job, not swallowed by the question',
  st3.s === 'complete' && sent.length === 2 && sent[1]?.key === `job:${real.jobId}:reply`,
  `state ${String(st3.s)}, keys ${sent.map((s) => s.key.split(':')[0]).join(',')}`,
)

// 4. A harness question never reaches the transport.
const before4 = sent.length
const harness = await make('teamhq:verify-r46')
await runJob(db, harness, [handler], review, notify)
const d4 = await one(
  `select state::text as s from public.deliveries where dedupe_key like 'blocker:${await blockerOf(harness.jobId)}:%'`,
)
check(
  'a harness question is refused before the transport',
  sent.length === before4 && d4.s === 'suppressed',
  `sent +${String(sent.length - before4)}, delivery ${String(d4.s)}`,
)

// 5. The worker died between pausing and asking: the sweep asks, once.
const crashed = await make('telegram:grant')
await runJob(db, crashed, [handler], review, undefined)
await age(crashed.jobId)
const before5 = sent.length
const swept = await askUnasked(db, notify)
const swept2 = await askUnasked(db, notify)
check(
  'a question nobody sent is sent by the sweep, exactly once',
  swept === 1 && swept2 === 0 && sent.length === before5 + 1,
  `first ${String(swept)}, second ${String(swept2)}`,
)

// 6. A failed send leaves the approval intact and is not retried in a loop.
const failing = await make('telegram:grant')
failNext = true
await runJob(db, failing, [handler], review, notify)
const st6 = await one(
  `select j.state::text as s, (select state from public.blockers b where b.job_id = j.job_id order by created_at desc limit 1) as b from public.jobs j where job_id = '${failing.jobId}'`,
)
await age(failing.jobId)
const before6 = sent.length
const retried = await askUnasked(db, notify)
check(
  'a failed send leaves the job paused and the question open',
  st6.s === 'paused' && st6.b === 'open',
  `${String(st6.s)} / ${String(st6.b)}`,
)
check(
  'and is not retried every tick',
  retried === 0 && sent.length === before6,
  `${String(retried)} retried`,
)

// 7. Answered elsewhere before anything was sent: nothing is sent.
const elsewhere = await make('telegram:grant')
await runJob(db, elsewhere, [handler], review, undefined)
await answer(await blockerOf(elsewhere.jobId), 'No, leave it')
await age(elsewhere.jobId)
const before7 = sent.length
await askUnasked(db, notify)
check(
  'a question answered on another surface is not then asked',
  sent.length === before7,
  `sent +${String(sent.length - before7)}`,
)

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

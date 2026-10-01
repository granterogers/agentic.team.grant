/**
 * #371 residual 1: a PAUSED job whose question output the coherence gate
 * refuses. Same stand-ins as approval-delivery.ts.
 *
 *   npx tsx scripts/isolated/paused-incoherent.ts <replica-db>
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

const db = await isolated(process.argv[2] ?? 'pinc')
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
        body: `I checked the database and pulled the records. I have stopped before step 1 because I need you to say (${job.jobId.slice(0, 8)}).`,
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
  db.execute(`select app.hq_answer_blocker('${blocker}'::uuid, '${a}', 'grant')`)

const j = await make('telegram:grant')
let thrown = ''
try {
  await runJob(db, j, [handler], review, notify)
} catch (e) {
  thrown = String((e as Error).message).slice(0, 200)
}
const st = await one(`
  select state::text as s,
         (select count(*) from public.outputs o where o.job_id = '${j.jobId}')::int as outputs,
         (select state::text from public.blockers b where b.job_id = '${j.jobId}' limit 1) as blocker,
         (select count(*) from public.job_impediments i
           where i.job_id = '${j.jobId}' and i.noticed_by = 'the quality gate')::int as refusals
    from public.jobs where job_id = '${j.jobId}'`)
const b = await blockerOf(j.jobId)
check(
  'the worker does not throw on a paused job the gate refuses',
  thrown === '',
  thrown || 'no throw',
)
check(
  'the job keeps its pause and its question stays open',
  st.s === 'paused' && st.blocker === 'open',
  `${String(st.s)}, blocker ${String(st.blocker)}`,
)
check(
  'the refusal is still countable',
  Number(st.refusals) >= 1,
  `${String(st.refusals)} refusal(s)`,
)
const toHim = sent.filter((x) => x.key.startsWith(`blocker:${b}:`))
check(
  'the question reaches him once, under the blocker',
  toHim.length === 1,
  `${String(toHim.length)} sent`,
)
const words = String(
  (
    await one(
      `select string_agg(body, ' || ') as w from public.outputs where job_id = '${j.jobId}'`,
    )
  ).w ?? '',
)
check(
  "in words the gate never refused: the blocker's own, not the claimed read",
  !words.includes('I checked the database') &&
    words.includes(`Approve step for ${j.jobId.slice(0, 8)}`),
  words.slice(0, 160),
)
await age(j.jobId)
const before = sent.length
await askUnasked(db, notify)
check(
  'the sweep does not ask it again',
  sent.length === before,
  `${String(sent.length - before)} more`,
)

// And the answer still decides the step: yes resumes and finishes.
await answer(b, 'Yes, do it')
const resumed = await dequeue(db, 'r46', false, false, ['verify.ask'], 'telegram:grant')
if (resumed !== null) await runJob(db, resumed, [handler], review, notify)
const end = await one(`select state::text as s from public.jobs where job_id = '${j.jobId}'`)
check('answered yes, the job resumes and completes', end.s === 'complete', String(end.s))

// A pause that asks nothing (a wait on other work) whose wording is refused.
{
  const waiting: Handler = {
    kind: 'verify.ask',
    reach: 'internal',
    handle: async (job: Job) => {
      await pauseJob(db, job.jobId, {
        reason: 'dependency_wait',
        detail: 'isolated proof',
        resumeWhen: 'the branches finish',
        resumable: true,
      } as never)
      return {
        body: 'I checked the database and pulled the records.',
        confidence: 'high',
        evidence: 'verified',
        sources: [],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
        announce: false,
      } as never
    },
  }
  const w = await make('telegram:grant')
  let threw = ''
  try {
    await runJob(db, w, [waiting], review, notify)
  } catch (e) {
    threw = String((e as Error).message).slice(0, 160)
  }
  const ws = await one(`select state::text as s,
    (select count(*) from public.outputs o where o.job_id = '${w.jobId}')::int as outputs
    from public.jobs where job_id = '${w.jobId}'`)
  check(
    'a pause that asks nothing keeps its pause, and the refused sentence is not kept',
    threw === '' && ws.s === 'paused' && ws.outputs === 0,
    `${threw || 'no throw'}; ${String(ws.s)}, ${String(ws.outputs)} output(s)`,
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)

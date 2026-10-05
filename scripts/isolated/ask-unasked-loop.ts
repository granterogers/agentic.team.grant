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
import { DeliveryService, type Transport, TransportError } from '../../src/channels/delivery.ts'
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

const db = await isolated(process.argv[2] ?? 'aunq')
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const sent: { key: string; target: string }[] = []
/* Every call the transport received, sent or not, so a retry is countable. */
const calls: string[] = []
/* The next send fails once, in one of the ways a real transport can. */
let failNext: null | 'retryable' | 'terminal' | 'indeterminate' | 'plain' = null
const transport: Transport = {
  channel: 'telegram',
  send: async (r) => {
    calls.push(r.dedupeKey)
    if (failNext !== null) {
      const how = failNext
      failNext = null
      if (how === 'plain') throw new Error('witness transport died on purpose')
      throw new TransportError(`witness_${how}`, how)
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

/* --- attempted is not delivered: every way a send can end ----------------- */
const keyed = (b: string) => (x: string) => x.startsWith(`blocker:${b}:`)
const lapse = (b: string) =>
  db.execute(`update public.deliveries set lease_expires_at = app.now_utc() - interval '1 second'
               where dedupe_key like 'blocker:' || '${b}' || ':%' and state = 'claimed'`)
const later = (b: string, by: string) =>
  db.execute(
    `update public.blockers set asked_at = asked_at - interval '${by}' where blocker_id = '${b}'`,
  )

// 5. A retryable transport failure is re-driven once its backoff lapses, under the same key.
{
  const j = await make('telegram:grant')
  failNext = 'retryable'
  await runJob(db, j, [handler], review, notify)
  await age(j.jobId)
  const b = await blockerOf(j.jobId)
  const early = await ticks(1, notify, j.jobId)
  await lapse(b)
  await ticks(3, notify, j.jobId)
  check(
    'a retryable failure is sent once its backoff lapses, and only once',
    early[0] === 0 &&
      sent.filter((x) => keyed(b)(x.key)).length === 1 &&
      calls.filter(keyed(b)).length === 2,
    `before the lapse ${JSON.stringify(early)}; ${String(calls.filter(keyed(b)).length)} calls, ${String(sent.filter((x) => keyed(b)(x.key)).length)} sent`,
  )
}

// 6. A worker that died mid-send leaves a claim; its lease lapses and the sweep finishes it.
{
  const j = await make('telegram:grant')
  failNext = 'plain'
  await runJob(db, j, [handler], review, notify)
  await age(j.jobId)
  const b = await blockerOf(j.jobId)
  await lapse(b)
  await ticks(2, notify, j.jobId)
  check(
    'a send that died after its claim is finished by the sweep, once',
    sent.filter((x) => keyed(b)(x.key)).length === 1,
    `${String(calls.filter(keyed(b)).length)} calls, ${String(sent.filter((x) => keyed(b)(x.key)).length)} sent`,
  )
}

// 7. Terminal and indeterminate failures are never sent again: a second copy is the one harm.
for (const how of ['terminal', 'indeterminate'] as const) {
  const j = await make('telegram:grant')
  failNext = how
  await runJob(db, j, [handler], review, notify)
  await age(j.jobId)
  const b = await blockerOf(j.jobId)
  await lapse(b)
  await later(b, '1 day')
  await ticks(3, notify, j.jobId)
  check(
    `an ${how} failure is never sent again`,
    calls.filter(keyed(b)).length === 1 && sent.filter((x) => keyed(b)(x.key)).length === 0,
    `${String(calls.filter(keyed(b)).length)} call(s)`,
  )
}

// 8. Nowhere to send: retried with backoff, at most three tries in all, however long it waits.
{
  const j = await make('telegram:grant')
  await runJob(db, j, [handler], review, nowhere as never)
  await age(j.jobId)
  const b = await blockerOf(j.jobId)
  const per: number[] = []
  for (let t = 0; t < 6; t += 1) {
    await later(b, '1 day')
    per.push(...(await ticks(1, nowhere, j.jobId)))
  }
  const n = await one(
    `select coalesce(to_jsonb(b) ->> 'ask_attempts', 'no column') as n from public.blockers b where blocker_id = '${b}'`,
  )
  check(
    'a try that left no delivery is retried, but three tries is the end',
    tried.filter((x) => x === j.jobId).length === 3 && Number(n.n) === 3,
    `tries ${String(tried.filter((x) => x === j.jobId).length)}, per tick ${JSON.stringify(per)}, attempts ${String(n.n)}`,
  )
}

// 9. A notifier that threw before anything was recorded is retried, and gets through.
{
  const j = await make('telegram:grant')
  let explode = true
  const flaky = async (job: Job, output: HandlerOutput, outputId: string) => {
    if (explode) {
      explode = false
      throw new Error('the database blinked')
    }
    return notify(job, output, outputId)
  }
  await runJob(db, j, [handler], review, flaky as never)
  await age(j.jobId)
  const b = await blockerOf(j.jobId)
  await later(b, '1 day')
  await ticks(2, flaky, j.jobId)
  check(
    'a notifier that failed before recording anything is retried and delivers',
    sent.filter((x) => keyed(b)(x.key)).length === 1,
    `${String(sent.filter((x) => keyed(b)(x.key)).length)} sent`,
  )
}

// 10. Answered in the meantime: nothing more is sent, whatever its delivery says.
{
  const j = await make('telegram:grant')
  failNext = 'retryable'
  await runJob(db, j, [handler], review, notify)
  await age(j.jobId)
  const b = await blockerOf(j.jobId)
  await db.execute(
    `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = '${b}'::uuid), app.test_office()), '${b}'::uuid, 'No, leave it', 'grant')`,
  )
  await lapse(b)
  await ticks(2, notify, j.jobId)
  check(
    'a question answered elsewhere is not re-sent by its retry',
    sent.filter((x) => keyed(b)(x.key)).length === 0,
    `${String(sent.filter((x) => keyed(b)(x.key)).length)} sent`,
  )
  /* The answer resumed it to queued; settle it so the next case's dequeue takes its own job. */
  await db.execute(
    `update public.jobs set state = 'cancelled', finished_at = app.now_utc() where job_id = '${j.jobId}' and state = 'queued'`,
  )
}

// 12. A question withdrawn while its job stays paused (it waits on another) is not re-sent.
{
  const j = await make('telegram:grant')
  failNext = 'retryable'
  await runJob(db, j, [handler], review, notify)
  await age(j.jobId)
  const b = await blockerOf(j.jobId)
  await db.execute(`update public.blockers set state = 'withdrawn', resolved_at = app.now_utc(),
                      resolution = 'isolated: superseded' where blocker_id = '${b}'`)
  await lapse(b)
  await ticks(2, notify, j.jobId)
  const st = await one(`select state::text as s from public.jobs where job_id = '${j.jobId}'`)
  check(
    'a question withdrawn on a job still paused is not re-sent by its retry',
    st.s === 'paused' && sent.filter((x) => keyed(b)(x.key)).length === 0,
    `job ${String(st.s)}, ${String(sent.filter((x) => keyed(b)(x.key)).length)} sent`,
  )
  await db.execute(
    `update public.jobs set state = 'cancelled', finished_at = app.now_utc() where job_id = '${j.jobId}'`,
  )
}

// 11. Two channels: he has had it on one, so a lapsed claim on the other is left;
//     or the first failed for good, so the second is re-driven - and only it.
{
  const slackCalls: string[] = []
  const slackSent: string[] = []
  let slackFail: null | 'retryable' = null
  const slackTransport: Transport = {
    channel: 'slack',
    send: async (r) => {
      slackCalls.push(r.dedupeKey)
      if (slackFail !== null) {
        slackFail = null
        throw new TransportError('witness_slack_retryable', 'retryable')
      }
      slackSent.push(r.dedupeKey)
      return { messageRef: `slack-${String(slackSent.length)}` }
    },
  }
  const slackService = new DeliveryService(db, slackTransport)
  const channel = (name: 'telegram' | 'slack', svc: DeliveryService) => ({
    name,
    surface: name,
    notify: async (job: Job, output: HandlerOutput) => {
      const r = await svc.deliver({
        dedupeKey: deliveryKey(job, output, name),
        accountRef: '8967954396',
        // Each channel's own target shape: deliveries_target_shaped refuses a chat id on Slack.
        targetRef: name === 'slack' ? 'C0ISOLATED1' : '1386648496',
        purpose: 'result',
        correlationId: job.correlationId,
        jobId: job.jobId,
        body: { text: output.body },
      })
      return { delivered: r.outcome === 'sent', note: `${name}: ${r.outcome}` }
    },
  })
  const both = combinedNotifier([channel('telegram', service), channel('slack', slackService)], db)
  for (const [first, label] of [
    [null, 'sent on Telegram, so the lapsed Slack claim is not re-driven'],
    ['terminal', 'Telegram failed for good, so only the Slack claim is re-driven'],
  ] as const) {
    const j = await make('telegram:grant')
    failNext = first
    slackFail = 'retryable'
    await runJob(db, j, [handler], review, both)
    await age(j.jobId)
    const b = await blockerOf(j.jobId)
    await lapse(b)
    await ticks(2, both, j.jobId)
    const tg = calls.filter(keyed(b)).length
    const sl = slackCalls.filter(keyed(b)).length
    const slSent = slackSent.filter(keyed(b)).length
    const ok =
      first === null ? tg === 1 && sl === 1 && slSent === 0 : tg === 1 && sl === 2 && slSent === 1
    check(
      label,
      ok,
      `telegram calls ${String(tg)}, slack calls ${String(sl)}, slack sent ${String(slSent)}`,
    )
  }
}

// 13. Two workers sweep at once, each on its own connection: still sent once.
{
  const db2 = await isolated(process.argv[2] ?? 'aunq')
  const service2 = new DeliveryService(db2, transport)
  const witness2 = {
    ...witness,
    notify: async (job: Job, output: HandlerOutput) => {
      const r = await service2.deliver({
        dedupeKey: deliveryKey(job, output, 'reply'),
        accountRef: '8967954396',
        targetRef: '1386648496',
        purpose: 'result',
        correlationId: job.correlationId,
        jobId: job.jobId,
        body: { text: output.body },
      })
      return { delivered: r.outcome === 'sent', note: `witness2: ${r.outcome}` }
    },
  }
  const notify2 = combinedNotifier([witness2], db2)
  for (const shape of ['never tried', 'a lapsed claim'] as const) {
    const j = await make('telegram:grant')
    if (shape === 'a lapsed claim') failNext = 'retryable'
    await runJob(db, j, [handler], review, shape === 'never tried' ? undefined : notify)
    await age(j.jobId)
    const b = await blockerOf(j.jobId)
    if (shape === 'a lapsed claim') await lapse(b)
    /* A barrier: each worker's notifier waits until BOTH sweeps have chosen
       the question (or 2 s pass), so the two genuinely overlap between the
       select and the claim - otherwise one sweep simply sees the other's row. */
    let arrived = 0
    let open: () => void = () => undefined
    const gate = new Promise<void>((r) => {
      open = r
    })
    const barrier =
      (f: typeof notify) =>
      async (...a: Parameters<typeof notify>) => {
        arrived += 1
        if (arrived >= 2) open()
        await Promise.race([gate, new Promise((r) => setTimeout(r, 2000))])
        return f(...a)
      }
    await Promise.all([askUnasked(db, barrier(notify)), askUnasked(db2, barrier(notify2))])
    await Promise.all([askUnasked(db, notify), askUnasked(db2, notify2)])
    check(
      `(the two sweeps over ${shape} did overlap)`,
      arrived === 2,
      `${String(arrived)} arrived at the barrier`,
    )
    const n = sent.filter((x) => keyed(b)(x.key)).length
    check(`two concurrent sweeps over ${shape} send it exactly once`, n === 1, `${String(n)} sent`)
  }
  await db2.end()
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)

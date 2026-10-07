/**
 * N1 - a finished answer is redriven until it is sent or visibly given up; it is never left in `claimed`.
 *
 *   npx tsx scripts/isolated/dl-delivery-redrive.ts <replica-db>
 *
 * Drives the REAL worker (`runJob`, `drain`), the REAL `DeliveryService` and the REAL `app.claim_delivery`,
 * `app.begin_delivery_send`, `app.record_delivery_failure`, `app.settle_lapsed_deliveries` and
 * `app.deliveries_to_redrive` (migration 1029) against an isolated replica. The only stand-in is the transport: a
 * scripted fake that records every call and sends nothing, so no message can leave this process. Time is controlled by
 * rewinding the lease column of the rows under test (the database clock is `now()`), which is the same thing a wait
 * does to it.
 *
 * Every assertion reads the canonical rows (`deliveries`, `outputs`, `events`) and the transport's call log, never a
 * return value.
 */
import { DeliveryService, type Transport, TransportError } from '../../src/channels/delivery.ts'
import { combinedNotifier } from '../../src/channels/notify.ts'
import { deliveryKey } from '../../src/jobs/delivery-key.ts'
import {
  dequeue,
  drain,
  type Handler,
  type HandlerOutput,
  type Job,
  type Reviewer,
  runJob,
} from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { CHAT, realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'dl_x')
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

// ---- the scripted transport ----------------------------------------------------------------------------------
type Step = 'ok' | TransportError | Error
const script: Step[] = []
const calls: { key: string; target: string }[] = []
let accepted = 0
let reconcileAnswer: string | null = null
const transport: Transport = {
  channel: 'telegram',
  send: async (r) => {
    calls.push({ key: r.dedupeKey, target: r.targetRef })
    const step = script.shift() ?? 'ok'
    if (step !== 'ok') throw step
    accepted += 1
    return { messageRef: `m-${String(accepted)}` }
  },
  reconcile: async () => reconcileAnswer,
}
// A database wrapper that can die exactly once at "the provider accepted it, now record it".
let crashAtRecord = false
const flakyDb = {
  ...db,
  execute: async (sql: string) => {
    if (crashAtRecord && sql.includes('record_delivery_sent')) {
      crashAtRecord = false
      throw new Error('worker killed between provider acceptance and local acknowledgement')
    }
    return db.execute(sql)
  },
} as unknown as typeof db
const service = new DeliveryService(flakyDb, transport)

const witness = (surface: string, scope: string) => ({
  name: `witness-${scope}`,
  surface,
  notify: async (job: Job, output: HandlerOutput) => {
    const r = await service.deliver({
      dedupeKey: deliveryKey(job, output, scope),
      accountRef: '8967954396',
      targetRef: CHAT,
      purpose: 'result',
      correlationId: job.correlationId,
      jobId: job.jobId,
      body: { text: output.body },
    })
    return {
      delivered: r.outcome === 'sent' || r.outcome === 'already_sent',
      note: `${scope}: ${r.outcome}`,
    }
  },
})
const notify = combinedNotifier([witness('telegram', 'reply')], db)
const review: Reviewer = async () => ({ status: 'approved', notes: 'isolated proof' })

const handler = (kind: string): Handler => ({
  kind,
  reach: 'internal',
  handle: async (job: Job) =>
    ({
      confidence: 'medium',
      evidence: 'inferred',
      sources: [],
      contradictions: null,
      path: 'deterministic_retrieval',
      model: null,
      announce: true,
      body:
        kind === 'verify.dl_duty'
          ? 'Disk is at 91 percent.'
          : `Finished work ${job.jobId.slice(0, 8)}.`,
    }) as never,
})
const handlers = ['verify.dl', 'verify.dl_duty'].map(handler)

const make = async (kind = 'verify.dl'): Promise<Job> => {
  const parent = await realParent(db)
  const r = await one(
    `select app.enqueue_child(p_office => app.job_office('${parent}'::uuid), p_parent => '${parent}'::uuid, p_kind => '${kind}', p_payload => '{}'::jsonb)::text as v`,
  )
  const id = String(r.v).match(/[0-9a-f-]{36}/)?.[0]
  const got = await dequeue(db, 'dl', false, false, [kind], 'telegram:grant')
  if (got === null || got.jobId !== id) throw new Error('could not take the fixture job')
  return got
}
const rowsOf = async (jobId: string) =>
  (
    await db.execute(
      `select delivery_id::text as id, dedupe_key, state::text as state, attempt, error_code, message_ref,
              send_started_at is not null as intent, suppressed_reason,
              extract(epoch from (lease_expires_at - app.now_utc()))::int as lease_in
         from public.deliveries where job_id = '${jobId}' order by created_at`,
    )
  ).rows as {
    id: string
    dedupe_key: string
    state: string
    attempt: number
    error_code: string | null
    message_ref: string | null
    intent: boolean
    suppressed_reason: string | null
    lease_in: number
  }[]
const lapse = (jobId: string) =>
  db.execute(
    `update public.deliveries set lease_expires_at = app.now_utc() - interval '1 second' where job_id = '${jobId}' and state = 'claimed'`,
  )
const eventsOf = async (jobId: string, action: string) =>
  Number(
    (
      await one(
        `select count(*)::int as n from public.events where related_job_id = '${jobId}' and action_type = '${action}'`,
      )
    ).n,
  )
const undelivered = async (jobId: string) => {
  const v = (await one(`select app.undelivered(null, 200) as u`)).u
  const list = (typeof v === 'string' ? JSON.parse(v) : v) as { job: string; error_code: string }[]
  return list.filter((x) => x.job === jobId)
}
const tick = () => drain(db, 'dl', handlers, review, 25, { notify })
const outputsOf = async (jobId: string) =>
  Number((await one(`select count(*)::int as n from public.outputs where job_id = '${jobId}'`)).n)

// ---- 1. successful first delivery ------------------------------------------------------------------------------
{
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  const rows = await rowsOf(j.jobId)
  check(
    '1 first delivery: one send, one sent row with its message reference, nothing left claimed',
    calls.length === 1 &&
      rows.length === 1 &&
      rows[0]?.state === 'sent' &&
      rows[0]?.message_ref === 'm-1',
    `calls ${String(calls.length)}, rows ${rows.map((r) => r.state).join(',')}`,
  )
  const before = calls.length
  await tick()
  check(
    '1b a sent answer is never redriven',
    calls.length === before,
    `calls +${String(calls.length - before)}`,
  )
}

// ---- 2. 429 with Retry-After: waits at least what the provider said, then sends once -------------------------
{
  calls.length = 0
  script.push(new TransportError('rate_limited', 'retryable', 120))
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  const r1 = (await rowsOf(j.jobId))[0]
  check(
    '2 a 429 leaves the answer owed, backing off for at least the provider Retry-After (120s, base 30s)',
    r1?.state === 'claimed' &&
      r1.error_code === 'rate_limited' &&
      (r1.lease_in ?? 0) >= 115 &&
      !r1.intent,
    `${r1?.state} ${r1?.error_code} lease in ${String(r1?.lease_in)}s intent ${String(r1?.intent)}`,
  )
  await tick()
  check(
    '2b it is NOT resent while the backoff runs',
    calls.length === 1,
    `calls ${String(calls.length)}`,
  )
  await lapse(j.jobId)
  await tick()
  const r2 = (await rowsOf(j.jobId))[0]
  check(
    '2c once the backoff is over the redrive sends it: sent, attempt 2, exactly one accepted message, one output',
    r2?.state === 'sent' &&
      r2.attempt === 2 &&
      calls.length === 2 &&
      accepted >= 1 &&
      (await outputsOf(j.jobId)) === 1,
    `${r2?.state} attempt ${String(r2?.attempt)} calls ${String(calls.length)}`,
  )
  await tick()
  check('2d and the next tick does nothing', calls.length === 2, `calls ${String(calls.length)}`)
}

// ---- 3. retryable 5xx for ever: bounded, exponential, then a terminal failure that is surfaced ---------------
{
  calls.length = 0
  for (let i = 0; i < 8; i++) script.push(new TransportError('http_500', 'retryable'))
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  const waits: number[] = []
  waits.push((await rowsOf(j.jobId))[0]?.lease_in ?? -1)
  for (let i = 0; i < 8; i++) {
    const st = (await rowsOf(j.jobId))[0]
    if (st?.state !== 'claimed') break
    await lapse(j.jobId)
    await tick()
    const after = (await rowsOf(j.jobId))[0]
    if (after?.state === 'claimed') waits.push(after.lease_in)
  }
  const fin = (await rowsOf(j.jobId))[0]
  check(
    '3 a retryable failure is retried a bounded number of times (max_attempts 5), not for ever',
    calls.length === 5 &&
      fin?.state === 'failed' &&
      fin.error_code === 'http_500' &&
      fin.attempt === 5,
    `${String(calls.length)} calls, ${fin?.state} attempt ${String(fin?.attempt)}`,
  )
  const near = (a: number, b: number) => Math.abs(a - b) <= 3
  check(
    '3b the waits grow exponentially (30, 60, 120, 240s)',
    waits.length === 4 &&
      near(waits[0] ?? 0, 30) &&
      near(waits[1] ?? 0, 60) &&
      near(waits[2] ?? 0, 120) &&
      near(waits[3] ?? 0, 240),
    waits.join(','),
  )
  const before = calls.length
  await tick()
  await tick()
  check(
    '3c a terminally failed answer is not retried again by the sweep',
    calls.length === before,
    `calls +${String(calls.length - before)}`,
  )
  const listed = await undelivered(j.jobId)
  check(
    '3d the give-up is SURFACED: a delivery.gave_up event and a row on the undelivered list',
    (await eventsOf(j.jobId, 'delivery.gave_up')) === 1 && listed.length === 1,
    `events ${String(await eventsOf(j.jobId, 'delivery.gave_up'))}, listed ${String(listed.length)}`,
  )
}

script.length = 0 // the unused tail of section 3's scripted failures must not leak into the next section

// ---- 4. permanent failures: no retry, surfaced at once --------------------------------------------------------
for (const [label, err] of [
  ['400 chat not found', new TransportError('chat_not_found', 'terminal')],
  ['403 bot blocked by the user', new TransportError('blocked_by_user', 'needs_human')],
] as const) {
  calls.length = 0
  script.push(err)
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  await tick()
  const r = (await rowsOf(j.jobId))[0]
  check(
    `4 ${label}: one call, terminal at once, never retried, listed`,
    calls.length === 1 &&
      r?.state === 'failed' &&
      r.error_code === err.code &&
      (await undelivered(j.jobId)).length === 1,
    `${String(calls.length)} calls, ${r?.state} ${r?.error_code}`,
  )
}

// ---- 5. network interruption / timeout (indeterminate): parked, never auto-resent, resolvable ---------------
{
  calls.length = 0
  script.push(new TransportError('indeterminate:ETIMEDOUT', 'indeterminate'))
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  await tick()
  const r = (await rowsOf(j.jobId))[0]
  check(
    '5 a timeout on a send may have landed: parked failed(indeterminate), not resent, listed with the honest sentence',
    calls.length === 1 &&
      r?.state === 'failed' &&
      String(r.error_code).startsWith('indeterminate:') &&
      (await undelivered(j.jobId)).length === 1,
    `${String(calls.length)} calls, ${r?.state} ${r?.error_code}`,
  )
  // Looking at the provider and finding nothing makes it owed again, and the redrive sends it.
  reconcileAnswer = null
  await service.resolveIndeterminate({
    deliveryId: r?.id ?? '',
    targetRef: CHAT,
    dedupeKey: r?.dedupe_key ?? '',
  })
  await tick()
  const r2 = (await rowsOf(j.jobId))[0]
  check(
    '5b reconciled as absent, it is owed again and the redrive sends it once',
    r2?.state === 'sent' && calls.length === 2,
    `${r2?.state}, calls ${String(calls.length)}`,
  )
}

// ---- 6. worker crash BETWEEN provider acceptance and local acknowledgement --------------------------------
{
  calls.length = 0
  const acceptedBefore = accepted
  crashAtRecord = true
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  const r = (await rowsOf(j.jobId))[0]
  check(
    '6 the provider accepted it and the worker died before recording: the row says a send began',
    calls.length === 1 && accepted === acceptedBefore + 1 && r?.state === 'claimed' && r.intent,
    `${String(calls.length)} calls, ${r?.state}, intent ${String(r?.intent)}`,
  )
  await lapse(j.jobId)
  await tick()
  await tick()
  const r2 = (await rowsOf(j.jobId))[0]
  check(
    '6b recovery does NOT send a second copy: parked failed(indeterminate:lease_lapsed_mid_send), said, listed',
    calls.length === 1 &&
      r2?.state === 'failed' &&
      r2.error_code === 'indeterminate:lease_lapsed_mid_send' &&
      (await eventsOf(j.jobId, 'delivery.unconfirmed')) === 1 &&
      (await undelivered(j.jobId)).length === 1,
    `${String(calls.length)} calls, ${r2?.state} ${r2?.error_code}`,
  )
}

// ---- 6c. a crash BEFORE the send began is safe to retry ----------------------------------------------------
{
  calls.length = 0
  const j = await make()
  // The job finishes with no notifier, so it is complete with an output and nothing delivered...
  await runJob(db, j, handlers, review, undefined)
  // ...then the claim happened and the worker died before it called the provider.
  await db.execute(
    `select * from app.claim_delivery(app.job_office('${j.jobId}'::uuid), 'telegram', 'job:${j.jobId}:reply', '8967954396', '${CHAT}', 'result', null, null, '${j.correlationId}'::uuid, '${j.jobId}'::uuid)`,
  )
  await lapse(j.jobId)
  const state = String(
    (await one(`select state::text as s from public.jobs where job_id = '${j.jobId}'`)).s,
  )
  await tick()
  const r = (await rowsOf(j.jobId))[0]
  check(
    '6c a claim whose worker died before sending is resent once (no intent was recorded)',
    state === 'complete' && r?.state === 'sent' && calls.length === 1 && r.attempt === 2,
    `job ${state}, ${r?.state} attempt ${String(r?.attempt)}, calls ${String(calls.length)}`,
  )
}

// ---- 7. duplicate worker execution -----------------------------------------------------------------------------
{
  calls.length = 0
  const j = await make()
  const key = `job:${j.jobId}:race`
  const req = {
    dedupeKey: key,
    accountRef: '8967954396',
    targetRef: CHAT,
    purpose: 'result' as const,
    correlationId: j.correlationId,
    jobId: j.jobId,
    body: { text: 'race' },
  }
  const [a, b] = await Promise.all([service.deliver(req), service.deliver(req)])
  const rows = await rowsOf(j.jobId)
  check(
    '7 two workers racing on one key send ONE message',
    calls.length === 1 &&
      rows.filter((r) => r.dedupe_key === key).length === 1 &&
      [a.outcome, b.outcome].sort().join() !== 'sent,sent',
    `${String(calls.length)} calls, outcomes ${a.outcome}/${b.outcome}`,
  )
  // A second worker holding the SAME attempt is fenced from sending.
  const row = rows.find((r) => r.dedupe_key === key)
  const second = String(
    (
      await one(
        `select app.begin_delivery_send(app.job_office('${j.jobId}'::uuid), '${row?.id}'::uuid, ${String(row?.attempt)}) as r`,
      )
    ).r,
  )
  check(
    '7b a send after the message is recorded is refused by the fence',
    second === 'already_sent',
    second,
  )
}
{
  // A worker that claimed, began and then stalled past its lease: a second worker may not send.
  calls.length = 0
  const j = await make()
  const key = `job:${j.jobId}:stall`
  const claim = async () =>
    one(
      `select outcome, attempt from app.claim_delivery(app.job_office('${j.jobId}'::uuid), 'telegram', '${key}', '8967954396', '${CHAT}', 'result', null, null, '${j.correlationId}'::uuid, '${j.jobId}'::uuid)`,
    )
  const c1 = await claim()
  const did = String(
    (await one(`select delivery_id::text as d from public.deliveries where dedupe_key = '${key}'`))
      .d,
  )
  const g1 = String(
    (
      await one(
        `select app.begin_delivery_send(app.job_office('${j.jobId}'::uuid), '${did}'::uuid, ${String(c1.attempt)}) as r`,
      )
    ).r,
  )
  await lapse(j.jobId)
  const c2 = await claim()
  const stale = String(
    (
      await one(
        `select app.begin_delivery_send(app.job_office('${j.jobId}'::uuid), '${did}'::uuid, ${String(c1.attempt)}) as r`,
      )
    ).r,
  )
  check(
    '7c a stalled sender whose lease lapsed mid-send is not replaced by a second sender; the stale one is fenced',
    g1 === 'go' && c2.outcome === 'failed' && stale !== 'go',
    `begin ${g1}, reclaim ${String(c2.outcome)}, stale begin ${stale}`,
  )
}

// ---- 8. containment survives the redrive ----------------------------------------------------------------------
{
  calls.length = 0
  // A harness job whose delivery row is lapsed and claimed (a row found to be harness AFTER it was claimed).
  const hj = String(
    (
      await one(`with j as (insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id, state, finished_at)
        values (app.test_office(), 'verify.dl', 'teamhq:verify-dl', app.unnamed_project(app.test_office()), 'dl-' || gen_random_uuid(), gen_random_uuid(), 'complete', app.now_utc()) returning job_id)
        select job_id::text as id from j`)
    ).id,
  )
  await db.execute(
    `insert into public.outputs (job_id, body, confidence, evidence, deterministic) values ('${hj}', 'Harness answer.', 'medium', 'inferred', true)`,
  )
  await db.execute(
    `insert into public.deliveries (office_id, channel, dedupe_key, account_ref, target_ref, purpose, job_id, lease_expires_at)
     values (app.test_office(), 'telegram', 'job:${hj}:reply', '8967954396', '${CHAT}', 'result', '${hj}', app.now_utc() - interval '1 minute')`,
  )
  await tick()
  const r = (await rowsOf(hj))[0]
  check(
    '8 a lapsed claim of a harness job is suppressed by containment and never reaches the transport',
    calls.length === 0 && r?.state === 'suppressed',
    `${String(calls.length)} calls, ${r?.state} ${r?.suppressed_reason?.slice(0, 40) ?? ''}`,
  )
}
{
  // The answer already reached this chat on another delivery: the lapsed one is closed, not sent.
  calls.length = 0
  const j = await make()
  await runJob(db, j, handlers, review, notify) // sent as :reply
  await db.execute(
    `insert into public.deliveries (office_id, channel, dedupe_key, account_ref, target_ref, purpose, job_id, correlation_id, lease_expires_at)
     values (app.job_office('${j.jobId}'::uuid), 'telegram', 'job:${j.jobId}:pager', '8967954396', '${CHAT}', 'result', '${j.jobId}', '${j.correlationId}', app.now_utc() - interval '1 minute')`,
  )
  const before = calls.length
  await tick()
  const rows = await rowsOf(j.jobId)
  const sib = rows.find((x) => x.dedupe_key.endsWith(':pager'))
  check(
    '8b a sibling delivery to a chat the answer already reached is closed as superseded: no second message, not listed',
    calls.length === before &&
      sib?.error_code === 'superseded:sent_by_sibling' &&
      (await undelivered(j.jobId)).length === 0,
    `calls +${String(calls.length - before)}, ${sib?.state} ${sib?.error_code}`,
  )
}

// ---- 9. no completed answer is silently stranded in `claimed` -----------------------------------------------
{
  await tick()
  const n = Number(
    (
      await one(
        `select count(*)::int as n from public.deliveries d join public.jobs j on j.job_id = d.job_id
          where d.state = 'claimed' and d.lease_expires_at < app.now_utc() - interval '1 minute' and j.state = 'complete' and d.purpose = 'result'`,
      )
    ).n,
  )
  check(
    '9 after a tick no finished answer sits in claimed with a lapsed lease',
    n === 0,
    `${String(n)} stranded`,
  )
}

// ---- C2. a failed duty announcement does not silence the identical retry --------------------------------------
{
  const staff = String((await one(`select staff_id::text as s from public.staff limit 1`)).s)
  await db.execute(
    `insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes, office_id)
     values ('dl-duty-${Date.now().toString(36)}', '${staff}', 'A duty used only by the delivery redrive proof.', 'verify.dl_duty', 60, app.operator_office())
     on conflict do nothing`,
  )
  // The duty says the same sentence every run (its body is fixed). The worker's own say_once decides whether it speaks.
  calls.length = 0
  script.push(new TransportError('chat_not_found', 'terminal'))
  const j = await make('verify.dl_duty')
  await runJob(db, j, handlers, review, notify)
  const stateAfter = (await rowsOf(j.jobId))[0]
  const j2 = await make('verify.dl_duty')
  await runJob(db, j2, handlers, review, notify)
  const second = (await rowsOf(j2.jobId))[0]
  check(
    'C2 a duty whose announcement terminally failed says the identical thing on its next run (and it is delivered)',
    calls.length === 2 && stateAfter?.state === 'failed' && second?.state === 'sent',
    `first ${stateAfter?.state}, identical retry ${second?.state}, calls ${String(calls.length)}`,
  )
  // Control: the very next identical run, after a DELIVERED one, is still kept quiet.
  const j3 = await make('verify.dl_duty')
  await runJob(db, j3, handlers, review, notify)
  const third = (await rowsOf(j3.jobId))[0]
  check(
    'C2b control: a delivered duty message is not repeated by the next identical run',
    third === undefined && calls.length === 2,
    `third run delivery ${third?.state ?? 'none'}, calls ${String(calls.length)}`,
  )
}

// ---- C3 primitive: what became of a job's messages -------------------------------------------------------------
{
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  const s1 = String(
    (
      await one(
        `select app.job_delivery_state(app.job_office('${j.jobId}'::uuid), '${j.jobId}'::uuid) as s`,
      )
    ).s,
  )
  script.push(new TransportError('chat_not_found', 'terminal'))
  const k = await make()
  await runJob(db, k, handlers, review, notify)
  const s2 = String(
    (
      await one(
        `select app.job_delivery_state(app.job_office('${k.jobId}'::uuid), '${k.jobId}'::uuid) as s`,
      )
    ).s,
  )
  check(
    'C3 job_delivery_state reads sent / failed from the delivery rows',
    s1 === 'sent' && s2 === 'failed',
    `${s1} / ${s2}`,
  )
}

// ---- 10. network failures through the REAL Telegram client and transport, with a scripted fetch -----------------
{
  const fetchCalls: string[] = []
  let acceptedMessages = 0
  const plan: (() => Response | never)[] = []
  const okResponse = () => {
    acceptedMessages += 1
    return new Response(JSON.stringify({ ok: true, result: { message_id: acceptedMessages } }))
  }
  const fetchImpl = (async (url: string) => {
    fetchCalls.push(String(url))
    const step = plan.shift()
    return step === undefined ? okResponse() : step()
  }) as unknown as typeof fetch
  const failWith = (code: string) => () => {
    throw Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error(code), { code }),
    })
  }
  // The provider accepted it, then the connection died before the answer arrived.
  const acceptThenReset = () => {
    acceptedMessages += 1
    throw Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' }),
    })
  }
  const { TelegramClient } = await import('../../src/telegram/api.ts')
  const { TelegramTransport } = await import('../../src/telegram/transport.ts')
  const realService = new DeliveryService(
    db,
    new TelegramTransport(
      new TelegramClient('1:FAKE', { fetchImpl, sleep: async () => undefined }),
    ),
  )
  const realNotify = combinedNotifier(
    [
      {
        name: 'real-transport',
        surface: 'telegram',
        notify: async (job: Job, output: HandlerOutput) => {
          const r = await realService.deliver({
            dedupeKey: deliveryKey(job, output, 'reply'),
            accountRef: '8967954396',
            targetRef: CHAT,
            purpose: 'result',
            correlationId: job.correlationId,
            jobId: job.jobId,
            body: { text: output.body },
          })
          return { delivered: r.outcome === 'sent', note: `real: ${r.outcome}` }
        },
      },
    ],
    db,
  )
  const realTick = () => drain(db, 'dl', handlers, review, 25, { notify: realNotify })

  // 10a. Connect-phase failures: definitely not sent, retried once per backoff step, then delivered exactly once.
  plan.push(failWith('ECONNREFUSED'), failWith('ENOTFOUND'))
  const j = await make()
  await runJob(db, j, handlers, review, realNotify)
  const a1 = (await rowsOf(j.jobId))[0]
  check(
    '10a a connect-phase failure leaves the answer owed (retryable, no intent), not parked',
    a1?.state === 'claimed' &&
      String(a1.error_code).startsWith('network_before_send:') &&
      !a1.intent &&
      fetchCalls.length === 1,
    `${a1?.state} ${a1?.error_code} fetches ${String(fetchCalls.length)}`,
  )
  await realTick()
  check(
    '10b not retried while the backoff runs',
    fetchCalls.length === 1,
    `fetches ${String(fetchCalls.length)}`,
  )
  await lapse(j.jobId)
  await realTick()
  const a2 = (await rowsOf(j.jobId))[0]
  check(
    '10c one retry per backoff step: second failure, still owed, longer wait, exactly 2 fetches',
    a2?.state === 'claimed' && fetchCalls.length === 2 && a2.lease_in > 40,
    `${a2?.state} attempt ${String(a2?.attempt)} wait ${String(a2?.lease_in)}s fetches ${String(fetchCalls.length)}`,
  )
  await lapse(j.jobId)
  await realTick()
  await realTick()
  const a3 = (await rowsOf(j.jobId))[0]
  check(
    '10d then delivered exactly once: sent, 3 fetches, 1 accepted message, never duplicated',
    a3?.state === 'sent' && fetchCalls.length === 3 && acceptedMessages === 1,
    `${a3?.state} fetches ${String(fetchCalls.length)} accepted ${String(acceptedMessages)}`,
  )

  // 10e. The provider accepted it and the response was lost: stays indeterminate, never resent.
  fetchCalls.length = 0
  acceptedMessages = 0
  plan.push(acceptThenReset)
  const k = await make()
  await runJob(db, k, handlers, review, realNotify)
  await lapse(k.jobId)
  await realTick()
  await realTick()
  const e1 = (await rowsOf(k.jobId))[0]
  check(
    '10e a connection reset after the request was sent is parked indeterminate and NEVER resent (no duplicate)',
    e1?.state === 'failed' &&
      String(e1.error_code).startsWith('indeterminate:') &&
      fetchCalls.length === 1 &&
      acceptedMessages === 1 &&
      (await undelivered(k.jobId)).length === 1,
    `${e1?.state} ${e1?.error_code} fetches ${String(fetchCalls.length)} accepted ${String(acceptedMessages)}`,
  )

  // 10f. A read timeout (no code, or ETIMEDOUT) is not provable either.
  fetchCalls.length = 0
  plan.push(failWith('ETIMEDOUT'))
  const m = await make()
  await runJob(db, m, handlers, review, realNotify)
  await lapse(m.jobId)
  await realTick()
  const f1 = (await rowsOf(m.jobId))[0]
  check(
    '10f a timeout that may have followed the write is parked indeterminate, one fetch',
    f1?.state === 'failed' && fetchCalls.length === 1,
    `${f1?.state} ${f1?.error_code} fetches ${String(fetchCalls.length)}`,
  )
}

// ================================================================================================================
// 1032 - a failed or uncertain delivery of a finished answer puts ONE question on the person's list.
//
// What stands in for what: the transport is the scripted fake above (nothing leaves the process); the person pressing
// an answer is `app.hq_answer_blocker`, the function every door (gateway, Telegram, Slack) calls; time is the lease
// column. Everything else is the real worker, the real DeliveryService and the real SQL. Every assertion reads
// canonical rows (blockers, deliveries, outputs, tasks) or the UI-facing readers (needs_me_in, studio_waiting,
// conversation_history, undelivered), plus the transport's call log.
// ================================================================================================================
const db2 = await isolated(process.argv[2] ?? 'dl_x') // a second connection: real concurrency, not queued statements
const OFFICE = String((await one(`select app.operator_office()::text as o`)).o)
const jsonOf = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>
interface Item {
  id: string
  state: string
  requested_action: string
  why_needed: string
  options: string[]
  keeps_working: boolean
  answered: string | null
  resolution: string | null
  tasks: number
  project: string | null
}
const itemsOf = async (jobId: string): Promise<Item[]> =>
  (
    await db.execute(
      `select b.blocker_id::text as id, b.state::text as state, b.requested_action, b.why_needed,
              to_jsonb(b.approval_options) as options, b.work_can_continue as keeps_working,
              b.answered_option as answered, b.resolution,
              (select count(*)::int from public.tasks t where t.satisfies_blocker = b.blocker_id) as tasks,
              b.project_id::text as project
         from public.blockers b
        where b.on_answer ->> 'kind' = 'delivery.decide'
          and b.on_answer -> 'payloads' -> 0 ->> 'job_id' = '${jobId}'
        order by b.created_at`,
    )
  ).rows as unknown as Item[]
const openItems = async (jobId: string) => (await itemsOf(jobId)).filter((i) => i.state === 'open')
// A press that THROWS is reported as such (never as a refusal): a refusal is a sentence the function chose to say.
const press = async (id: string, option: string, office = OFFICE, via = db) => {
  try {
    return jsonOf(
      (
        await via.execute(
          `select app.hq_answer_blocker('${office}'::uuid, '${id}'::uuid, '${option.replace(/'/g, "''")}', 'grant') as r`,
        )
      ).rows[0]?.r,
    )
  } catch (error) {
    return { threw: String((error as Error).message).slice(0, 120) } as Record<string, unknown>
  }
}
const projectOf = async (jobId: string): Promise<string> =>
  String(
    (
      await one(
        `select coalesce(j.project_id, app.unnamed_project(j.office_id))::text as p from public.jobs j where j.job_id = '${jobId}'`,
      )
    ).p,
  )
const threadOf = async (jobId: string) => {
  const raw = (
    await one(
      `select app.conversation_history('${OFFICE}'::uuid, '${await projectOf(jobId)}'::uuid, 200) as h`,
    )
  ).h
  const list = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>[]
  return list.find((m) => m.job === jobId && m.kind === 'answered')
}
const onNeedsMe = async (id: string): Promise<boolean> =>
  Number(
    (
      await one(
        `select count(*)::int as n from app.needs_me_in('${OFFICE}'::uuid) where blocker_id = '${id}'::uuid`,
      )
    ).n,
  ) === 1
const inWaiting = async (
  jobId: string,
  id: string,
): Promise<Record<string, unknown> | undefined> => {
  const raw = (await one(`select app.studio_waiting('${await projectOf(jobId)}'::uuid) as w`)).w
  const list = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>[]
  return list.find((w) => w.id === id)
}
const answerOf = async (jobId: string): Promise<string> =>
  String(
    (
      await one(
        `select body from public.outputs where job_id = '${jobId}' order by created_at desc limit 1`,
      )
    ).body,
  )
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
const setTrigger = (on: boolean) =>
  db.execute(
    `alter table public.deliveries ${on ? 'enable' : 'disable'} trigger deliveries_attention`,
  )
const silent = async (jobId: string) => {
  // Ticks a person would be waiting through: lapse leases, run the worker's pass twice.
  await lapse(jobId)
  await tick()
  await tick()
}

// ---- 11a. a retryable failure that later succeeds puts nothing on the list ---------------------------------------
{
  calls.length = 0
  script.push(new TransportError('http_500', 'retryable'))
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  const mid = (await itemsOf(j.jobId)).length
  await lapse(j.jobId)
  await tick()
  const r = (await rowsOf(j.jobId))[0]
  check(
    '11a a retryable failure that eventually succeeds raises NO item (nothing was lost), before or after',
    mid === 0 && r?.state === 'sent' && (await itemsOf(j.jobId)).length === 0 && calls.length === 2,
    `items while backing off ${String(mid)}, ${r?.state}, calls ${String(calls.length)}`,
  )
}

// ---- 11b. a terminal failure: one item, the answer recoverable, resolvable by the person -------------------------
let terminalJob = ''
{
  calls.length = 0
  script.push(new TransportError('chat_not_found', 'terminal'))
  const j = await make()
  terminalJob = j.jobId
  await runJob(db, j, handlers, review, notify)
  await tick()
  await tick()
  const items = await itemsOf(j.jobId)
  const it = items[0]
  const text = `${it?.requested_action ?? ''} ${it?.why_needed ?? ''}`
  const said = await answerOf(j.jobId)
  check(
    '11b a terminal failure raises exactly ONE open item, and the sweeps do not add another',
    items.length === 1 && it?.state === 'open' && calls.length === 1,
    `${String(items.length)} item(s), calls ${String(calls.length)}`,
  )
  check(
    '11b the item is a question that holds nothing up, files no to-do (ticking it must not answer it), offers send-again and dismiss only for a definite refusal',
    it?.keeps_working === true &&
      it.tasks === 0 &&
      JSON.stringify(it.options) === JSON.stringify(['Send it again', 'Dismiss']),
    JSON.stringify(it?.options),
  )
  check(
    'the item says it in plain words: names the channel and quotes the answer, with no id, no code, no number of an issue',
    /Telegram/.test(text) &&
      text.includes(said.slice(0, 20)) &&
      !UUID.test(text) &&
      !/chat_not_found|#\d/.test(text),
    text.slice(0, 220),
  )
  const entry = await threadOf(j.jobId)
  check(
    'the answer itself is still recoverable from the UI-facing thread reader, marked as not delivered',
    entry !== undefined && entry.body === said && entry.delivery === 'failed',
    `delivery ${String(entry?.delivery)}`,
  )
  const waiting = await inWaiting(j.jobId, it?.id ?? '')
  const und = (await undelivered(j.jobId))[0] as Record<string, unknown> | undefined
  check(
    'it is SHOWN where the person looks: Needs me, the project waiting list (with the answers as options) and the undelivered list (with the answer and the item)',
    (await onNeedsMe(it?.id ?? '')) &&
      Array.isArray(waiting?.options) &&
      String(waiting?.why ?? '').includes(said.slice(0, 20)) &&
      String(und?.answer ?? '').includes(said.slice(0, 20)) &&
      und?.attention === it?.id,
    `waiting ${String(waiting !== undefined)}, undelivered answer ${String(und?.answer !== undefined)}`,
  )
  // another office's person
  const foreign = await press(
    it?.id ?? '',
    'Send it again',
    String((await one(`select app.test_office()::text as o`)).o),
  )
  const stillFailed = (await rowsOf(j.jobId))[0]?.state === 'failed'
  const foreignSees = Number(
    (
      await one(
        `select count(*)::int as n from app.needs_me_in(app.test_office()) where blocker_id = '${it?.id ?? ''}'::uuid`,
      )
    ).n,
  )
  check(
    'another office never sees it and cannot answer it: refused, the item still open, nothing queued',
    String(foreign.error ?? '').includes('nothing here to answer') &&
      foreignSees === 0 &&
      stillFailed &&
      (await openItems(j.jobId)).length === 1,
    JSON.stringify(foreign).slice(0, 100),
  )
  // the person decides
  const before = calls.length
  const a1 = await press(it?.id ?? '', 'Send it again')
  const queued = (await rowsOf(j.jobId))[0]
  await tick()
  const after = (await rowsOf(j.jobId))[0]
  check(
    '11b the person pressing Send it again queues it ONCE: the same row owed, then sent, exactly one more message, the item resolved with his answer',
    a1.ok === true &&
      a1.started === 1 &&
      queued?.state === 'claimed' &&
      after?.state === 'sent' &&
      calls.length === before + 1 &&
      (await openItems(j.jobId)).length === 0 &&
      (await itemsOf(j.jobId))[0]?.answered === 'Send it again',
    `${JSON.stringify(a1).slice(0, 90)}, ${after?.state}, calls +${String(calls.length - before)}`,
  )
  const again = await press(it?.id ?? '', 'Send it again')
  await tick()
  check(
    'a second press (two tabs) is "already answered" and sends nothing more',
    again.already === true && calls.length === before + 1 && (await itemsOf(j.jobId)).length === 1,
    JSON.stringify(again).slice(0, 80),
  )
}

// ---- 11c. dismiss: nothing is sent, nothing is raised again --------------------------------------------------------
{
  calls.length = 0
  script.push(new TransportError('blocked_by_user', 'needs_human'))
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  const it = (await itemsOf(j.jobId))[0]
  const d = await press(it?.id ?? '', 'Dismiss')
  await silent(j.jobId)
  const rows = await rowsOf(j.jobId)
  check(
    '11c Dismiss closes the item and sends NOTHING; the delivery stays failed (the truth), and no sweep raises it again',
    d.ok === true &&
      d.started === 0 &&
      calls.length === 1 &&
      rows[0]?.state === 'failed' &&
      (await itemsOf(j.jobId)).length === 1 &&
      (await openItems(j.jobId)).length === 0,
    `${String(calls.length)} calls, items ${String((await itemsOf(j.jobId)).length)}`,
  )
}

// ---- 11d. an indeterminate delivery: item, NEVER auto-resent, "it arrived" settles it without sending -------------
{
  calls.length = 0
  script.push(new TransportError('indeterminate:ETIMEDOUT', 'indeterminate'))
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  await silent(j.jobId)
  const it = (await itemsOf(j.jobId))[0]
  const entry = await threadOf(j.jobId)
  check(
    '11d an uncertain delivery raises ONE item that says "may not have reached" and offers Send it again, It arrived, Dismiss; it is NOT resent however many ticks pass',
    (await itemsOf(j.jobId)).length === 1 &&
      /may not have reached you on Telegram/.test(it?.requested_action ?? '') &&
      JSON.stringify(it?.options) ===
        JSON.stringify(['Send it again', 'It arrived, close this', 'Dismiss']) &&
      calls.length === 1,
    `${it?.requested_action ?? ''}; calls ${String(calls.length)}`,
  )
  check(
    'the thread says it may have arrived (not that it did not), and still holds the answer',
    entry?.delivery === 'unconfirmed' && entry.body === (await answerOf(j.jobId)),
    String(entry?.delivery),
  )
  const r = await press(it?.id ?? '', 'It arrived, close this')
  await silent(j.jobId)
  const row = (await rowsOf(j.jobId))[0]
  check(
    '11d "It arrived, close this" resolves the ambiguity WITHOUT sending: the row is closed as delivered, one request in total, off the undelivered list, thread says sent',
    r.ok === true &&
      calls.length === 1 &&
      row?.state === 'sent' &&
      String(row.message_ref).startsWith('confirmed-by-person:') &&
      (await undelivered(j.jobId)).length === 0 &&
      (await threadOf(j.jobId))?.delivery === 'sent' &&
      (await openItems(j.jobId)).length === 0,
    `${JSON.stringify(r).slice(0, 80)}, ${row?.state}, calls ${String(calls.length)}`,
  )
}

// ---- 11e. an indeterminate delivery the person asks to resend: exactly ONE more message ---------------------------
{
  calls.length = 0
  script.push(new TransportError('indeterminate:ECONNRESET', 'indeterminate'))
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  await silent(j.jobId)
  const it = (await itemsOf(j.jobId))[0]
  const gate = calls.length
  const r = await press(it?.id ?? '', 'Send it again')
  await tick()
  await silent(j.jobId)
  const row = (await rowsOf(j.jobId))[0]
  check(
    '11e Send it again on an uncertain row sends exactly ONE message more (two in all, one the person chose), then nothing, and the item is closed',
    gate === 1 &&
      r.ok === true &&
      row?.state === 'sent' &&
      calls.length === 2 &&
      (await openItems(j.jobId)).length === 0,
    `calls ${String(calls.length)}, ${row?.state}`,
  )
}

// ---- 11f. the provider accepted it and the acknowledgement was lost -------------------------------------------------
{
  calls.length = 0
  crashAtRecord = true
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  const during = (await itemsOf(j.jobId)).length
  await silent(j.jobId)
  const it = (await itemsOf(j.jobId))[0]
  const row = (await rowsOf(j.jobId))[0]
  check(
    '11f accepted-but-unacknowledged parks as uncertain: an item exists only once it is parked, no duplicate was sent',
    during === 0 &&
      row?.error_code === 'indeterminate:lease_lapsed_mid_send' &&
      (await itemsOf(j.jobId)).length === 1 &&
      calls.length === 1,
    `items while in flight ${String(during)}, ${row?.error_code}, calls ${String(calls.length)}`,
  )
  const r = await press(it?.id ?? '', 'It arrived, close this')
  await silent(j.jobId)
  check(
    '11f "It arrived" closes it without sending: still one request, delivery sent, item resolved',
    r.ok === true &&
      calls.length === 1 &&
      (await rowsOf(j.jobId))[0]?.state === 'sent' &&
      (await openItems(j.jobId)).length === 0,
    `calls ${String(calls.length)}`,
  )
}

// ---- 11g. a restart mid-send: claimed, intent recorded, lease lapsed; a second worker finds it ---------------------
{
  calls.length = 0
  const j = await make()
  await runJob(db, j, handlers, review, undefined) // complete, answer stored, nothing delivered
  const key = `job:${j.jobId}:reply`
  const c = await one(
    `select attempt from app.claim_delivery(app.job_office('${j.jobId}'::uuid), 'telegram', '${key}', '8967954396', '${CHAT}', 'result', null, null, '${j.correlationId}'::uuid, '${j.jobId}'::uuid)`,
  )
  const did = String(
    (await one(`select delivery_id::text as d from public.deliveries where dedupe_key = '${key}'`))
      .d,
  )
  await one(
    `select app.begin_delivery_send(app.job_office('${j.jobId}'::uuid), '${did}'::uuid, ${String(c.attempt)}) as r`,
  )
  const live = (await itemsOf(j.jobId)).length
  await lapse(j.jobId)
  const second = await service.deliver({
    dedupeKey: key,
    accountRef: '8967954396',
    targetRef: CHAT,
    purpose: 'result',
    correlationId: j.correlationId,
    jobId: j.jobId,
    body: { text: 'second worker' },
  })
  const r = (await rowsOf(j.jobId))[0]
  check(
    '11g after a restart mid-send the second worker does NOT send; the row is parked uncertain and ONE item is raised (none while the send was in flight)',
    live === 0 &&
      second.outcome !== 'sent' &&
      calls.length === 0 &&
      r?.error_code === 'indeterminate:lease_lapsed_mid_send' &&
      (await itemsOf(j.jobId)).length === 1,
    `${second.outcome}, calls ${String(calls.length)}, items ${String((await itemsOf(j.jobId)).length)}`,
  )
}

// ---- 11h. duplicate workers and a race on every door ----------------------------------------------------------------
{
  // (1) two workers' passes at once over a terminal failure
  calls.length = 0
  script.push(new TransportError('chat_not_found', 'terminal'))
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  await Promise.all([tick(), tick(), tick()])
  check(
    '11h three overlapping worker passes over one terminal failure leave ONE item and one request',
    (await itemsOf(j.jobId)).length === 1 && calls.length === 1,
    `${String((await itemsOf(j.jobId)).length)} item(s)`,
  )
  // (2) two connections raise for the same delivery at the same moment (the trigger disabled so the race is the test)
  await setTrigger(false)
  script.push(new TransportError('chat_not_found', 'terminal'))
  const k = await make()
  await runJob(db, k, handlers, review, notify)
  const none = (await itemsOf(k.jobId)).length
  const did = String((await rowsOf(k.jobId))[0]?.id)
  const raised = await Promise.all([
    db.execute(`select app.raise_delivery_attention('${did}'::uuid)::text as r`),
    db2.execute(`select app.raise_delivery_attention('${did}'::uuid)::text as r`),
    db2.execute(`select app.raise_delivery_attention('${did}'::uuid)::text as r`),
  ])
  await setTrigger(true)
  check(
    '11h three concurrent raisers for one delivery create ONE item (the unique index is the lock; the losers return nothing)',
    none === 0 &&
      (await itemsOf(k.jobId)).length === 1 &&
      raised.filter((x) => (x.rows[0] as { r: string | null }).r !== null).length === 1,
    `${String((await itemsOf(k.jobId)).length)} item(s)`,
  )
  // (3) two answers at once: one performs it, one is told it is already answered
  calls.length = 0
  const it = (await itemsOf(k.jobId))[0]
  const both = await Promise.all([
    press(it?.id ?? '', 'Send it again', OFFICE, db),
    press(it?.id ?? '', 'Send it again', OFFICE, db2),
  ])
  await tick()
  check(
    '11h two simultaneous presses of Send it again perform it once: one ok, one "already", ONE message',
    both.filter((r) => r.ok === true).length === 1 &&
      both.filter((r) => r.already === true).length === 1 &&
      calls.length === 1,
    JSON.stringify(both).slice(0, 140),
  )
}

// ---- 11i. containment: harness traffic raises nothing ------------------------------------------------------------------
{
  const mk = async (office: string, who: string): Promise<string> => {
    const id = String(
      (
        await one(`with j as (insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id, state, finished_at)
          values (${office}, 'verify.dl', '${who}', app.unnamed_project(${office}), 'dl-' || gen_random_uuid(), gen_random_uuid(), 'complete', app.now_utc()) returning job_id)
          select job_id::text as id from j`)
      ).id,
    )
    await db.execute(
      `insert into public.outputs (job_id, body, confidence, evidence, deterministic) values ('${id}', 'Harness answer ${id.slice(0, 6)}.', 'medium', 'inferred', true)`,
    )
    await db.execute(
      `insert into public.deliveries (office_id, channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, error_code, lease_expires_at)
       values (${office}, 'telegram', 'job:${id}:reply', '8967954396', '${CHAT}', 'result', '${id}', 'failed', 'chat_not_found', app.now_utc())`,
    )
    return id
  }
  const inOwners = await mk('app.operator_office()', 'teamhq:verify-dl')
  const inTest = await mk('app.test_office()', 'teamhq:verify-dl')
  await tick()
  const ownersOffice = Number(
    (
      await one(
        `select count(*)::int as n from public.blockers where office_id = app.operator_office() and on_answer ->> 'kind' = 'delivery.decide' and on_answer -> 'payloads' -> 0 ->> 'job_id' in ('${inOwners}', '${inTest}')`,
      )
    ).n,
  )
  const control = (await itemsOf(terminalJob)).length
  check(
    '11i a harness job whose answer failed raises NO item in the owner office (control: the same shape from a real job did, in 11b)',
    ownersOffice === 0 &&
      (await itemsOf(inOwners)).length === 0 &&
      (await itemsOf(inTest)).length === 0 &&
      control === 1,
    `harness items ${String(ownersOffice)}, control ${String(control)}`,
  )
}

// ---- 11j. the item closes itself when the answer is delivered another way ------------------------------------------
{
  calls.length = 0
  script.push(new TransportError('chat_not_found', 'terminal'))
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  const it = (await itemsOf(j.jobId))[0]
  // the thread's own Try again button
  await db.execute(`select public.retry_job_deliveries('${OFFICE}'::uuid, '${j.jobId}'::uuid)`)
  const whileOwed = (await openItems(j.jobId)).length
  await tick()
  const done = (await itemsOf(j.jobId))[0]
  check(
    '11j the item stays while the retry is owed and closes ITSELF when the answer is sent (a message sent, a resolution that says it reached him), no second item',
    whileOwed === 1 &&
      done?.id === it?.id &&
      done?.state === 'resolved' &&
      /reached you/.test(done.resolution ?? '') &&
      (await itemsOf(j.jobId)).length === 1 &&
      (await rowsOf(j.jobId))[0]?.state === 'sent',
    `${done?.state} ${done?.resolution ?? ''}`,
  )
}

// ---- 11k. the backstop: a failure whose trigger did not run still gets its item, once ------------------------------
{
  await setTrigger(false)
  script.push(new TransportError('chat_not_found', 'terminal'))
  const j = await make()
  await runJob(db, j, handlers, review, notify)
  const missing = (await itemsOf(j.jobId)).length
  await setTrigger(true)
  await tick()
  await tick()
  check(
    '11k the sweep raises the one item a failed row is missing, and never a second',
    missing === 0 && (await itemsOf(j.jobId)).length === 1,
    `before ${String(missing)}, after ${String((await itemsOf(j.jobId)).length)}`,
  )
}

// ---- 11l. exactly-once and the ledger are untouched ----------------------------------------------------------------------
{
  const dup = Number(
    (
      await one(
        `select count(*)::int as n from (
           select job_id, count(*) filter (where state = 'sent') as sent from public.deliveries
            where purpose = 'result' and job_id is not null and dedupe_key like 'job:%:reply' group by job_id) x where sent > 1`,
      )
    ).n,
  )
  check(
    '11l no answer was delivered twice on one channel anywhere in this run (the at-most-once rule survives the new question)',
    dup === 0,
    `${String(dup)} duplicated`,
  )
}
await db2.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

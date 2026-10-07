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

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

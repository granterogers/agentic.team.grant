/*
  e2e-failure - Part 3 of the local end-to-end verification (agent E2): failure modes through the REAL worker.

    npx tsx scripts/isolated/e2e-failure.ts <replica-db>

  The real `drain` (sweeps, dequeue, runJob, review gate, delivery, last word) against a marked local replica, with a
  stand-in for `office.instruction` (the model) and a recording transport (nothing can leave this process). Every case
  starts from a turn Grant's own chat would produce (`realParent`) and asserts CANONICAL rows: the job's state and
  attempts, how many outputs were stored, how many messages the transport saw, and what they said.

    F1  the model is unavailable on every attempt   -> the job fails in words, the person is told ONCE, no model text
    F2  the model fails once, then answers          -> one answer, no apology, no duplicate
    F3  the model claims to have contacted a person -> that sentence must never be delivered (a spread of phrasings;
                                                       each phrasing is a separate FINDING when it gets through)
    F4  the worker dies holding the lease           -> recovered, answered once
    F5  the same webhook delivered twice            -> one command, one job
    F6  the same child asked for twice              -> one child
    F7  the channel refuses the send once           -> the answer is not lost, and is sent once

  A FINDING is a behaviour the product's own intent forbids that the code does not stop. It is printed and counted,
  and does not fail the run, so the driver keeps proving the rest; the summary line says how many there were.
*/
import { DeliveryService, type Transport, TransportError } from '../../src/channels/delivery.ts'
import { combinedNotifier } from '../../src/channels/notify.ts'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { deliveryKey } from '../../src/jobs/delivery-key.ts'
import { apology } from '../../src/jobs/lastword.ts'
import {
  drain,
  type Handler,
  type HandlerOutput,
  type Job,
  type Reviewer,
} from '../../src/jobs/worker.ts'
import { AllCandidatesFailedError, ProviderRouter } from '../../src/providers/router.ts'
import { isolated } from './guard.ts'
import { CHAT, realParent, realTelegramKey, registerBot } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'e2_failure')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: boolean[] = []
let findings = 0
const check = (what: string, ok: boolean, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const finding = (what: string, detail = '') => {
  findings += 1
  console.log(`FINDING ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const review: Reviewer = async () => ({ status: 'approved', notes: 'e2e-failure' })

// ---- the recording transport and the notifier built on it ------------------------------------------------------
const sent: { jobId: string; text: string }[] = []
let refuseNext = 0
const transport: Transport = {
  channel: 'telegram',
  send: async (r) => {
    if (refuseNext > 0) {
      refuseNext -= 1
      throw new TransportError('e2e_refused', 'retryable')
    }
    const text = String((r.body as { text?: string }).text ?? '')
    sent.push({ jobId: r.correlationId ?? '', text })
    return { messageRef: `e2e-${String(sent.length)}` }
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
      targetRef: CHAT,
      purpose: 'result',
      correlationId: job.correlationId,
      jobId: job.jobId,
      body: { text: output.body },
    })
    return { delivered: r.outcome === 'sent', note: `witness: ${r.outcome}` }
  },
}
await registerBot(db)
const notify = combinedNotifier([witness], db)

// ---- the stand-in model --------------------------------------------------------------------------------------
type Behaviour = (job: Job, call: number) => Promise<HandlerOutput>
const calls = new Map<string, number>()
let behaviour: Behaviour = async () => {
  throw new Error('e2e: no behaviour set')
}
const handler: Handler = {
  kind: 'office.instruction',
  reach: 'internal',
  handle: async (job: Job) => {
    const n = (calls.get(job.jobId) ?? 0) + 1
    calls.set(job.jobId, n)
    return behaviour(job, n)
  },
}
const answer = (body: string, evidence: 'verified' | 'inferred' = 'inferred'): HandlerOutput => ({
  body,
  confidence: 'medium',
  evidence,
  sources: evidence === 'verified' ? ['db:e2e'] : [],
  contradictions: null,
  path: 'deterministic_retrieval',
  model: null,
  announce: true,
})

const quiet = () =>
  db.execute(
    `update public.jobs set state = 'cancelled' where state in ('paused','queued','retrying','running')`,
  )
const tickUntilSettled = async (id: string, max = 12): Promise<number> => {
  for (let i = 1; i <= max; i += 1) {
    // Skip the retry backoff: the clock is not under test, the attempt budget is.
    await db.execute(
      `update public.jobs set not_before = now() - interval '1 second' where job_id = ${lit(id)}::uuid and state in ('retrying','queued')`,
    )
    await drain(db, `e2e-${Date.now().toString(36)}-${i}`, [handler], review, 5, {
      canTranscribe: false,
      canSubprocess: false,
      notify,
    })
    const s = String(
      (await one(`select state::text as s from public.jobs where job_id = ${lit(id)}::uuid`)).s,
    )
    if (['complete', 'failed', 'cancelled'].includes(s)) return i
  }
  return max
}
const job = async (id: string) =>
  one(
    `select state::text as s, attempt, max_attempts, coalesce(state_reason,'') as why from public.jobs where job_id = ${lit(id)}::uuid`,
  )
const outputsOf = async (id: string) =>
  (
    await db.execute(
      `select body from public.outputs where job_id = ${lit(id)}::uuid order by created_at`,
    )
  ).rows as { body: string }[]
const told = (id: string) =>
  sent.filter((s) => s.jobId !== '' && s.jobId === String(calls.has(id) ? '' : '')).length
const sentSince = (n: number) => sent.slice(n)

// ===== F1 the model is unavailable on every attempt ==============================================================
{
  await quiet()
  behaviour = async () => {
    throw new AllCandidatesFailedError(
      ['openai/gpt-oss-120b', 'qwen/qwen3.7-flash', 'mistralai/mistral-small-3.2-24b-instruct'],
      new Error('provider openrouter refused: 429 rate-limited upstream'),
    )
  }
  const id = await realParent(db)
  const before = sent.length
  const ticks = await tickUntilSettled(id)
  const j = await job(id)
  const outs = await outputsOf(id)
  const seen = sentSince(before)
  check(
    'F1 a persistent provider outage ends the turn `failed`, not stuck',
    j.s === 'failed',
    `state ${String(j.s)} after ${String(ticks)} tick(s)`,
  )
  // The ceiling is the office's four as well as the job's own (worker.ts, D3), so "used it" means every attempt the
  // job had really ran the model path, and there were several.
  check(
    'F1 every attempt really ran the model path, and there were several',
    calls.get(id) === Number(j.attempt) && Number(j.attempt) >= 3,
    `handler ran ${String(calls.get(id))}x, attempt ${String(j.attempt)}/${String(j.max_attempts)}`,
  )
  check(
    'F1 the failure is in words in the job row',
    String(j.why).trim().length > 10,
    JSON.stringify(String(j.why).slice(0, 100)),
  )
  check(
    'F1 the person is told exactly once',
    seen.length === 1,
    `${seen.length} message(s) reached the chat`,
  )
  check(
    'F1 what he is told is the code-composed apology, not a model sentence',
    seen.length === 1 && (seen[0]?.text === apology(false) || seen[0]?.text === apology(true)),
    JSON.stringify(seen[0]?.text.slice(0, 90)),
  )
  check(
    'F1 exactly one notice is stored as an output',
    outs.length === 1,
    `${outs.length} output(s)`,
  )
  // a further tick must not repeat it
  await tickUntilSettled(id, 2)
  check(
    'F1 a later tick does not say it again',
    sentSince(before).length === 1,
    `${sentSince(before).length} total`,
  )
}

// ===== F2 the model fails once, then answers ===================================================================
{
  await quiet()
  behaviour = async (_j, call) => {
    if (call === 1) throw new Error('provider openrouter refused: 502 bad gateway')
    return answer('The venue contract renews on 1 March; nothing else is outstanding.')
  }
  const id = await realParent(db)
  const before = sent.length
  await tickUntilSettled(id)
  const j = await job(id)
  const outs = await outputsOf(id)
  const seen = sentSince(before)
  check(
    'F2 a transient failure is retried and the turn completes',
    j.s === 'complete' && calls.get(id) === 2,
    `state ${String(j.s)}, handler ran ${String(calls.get(id))}x`,
  )
  check(
    'F2 one answer stored, one message sent, no apology',
    outs.length === 1 &&
      seen.length === 1 &&
      seen[0]?.text.startsWith('The venue contract') === true,
    `${outs.length} output(s), ${seen.length} sent`,
  )
}

// ===== F3 a claim to have contacted somebody ====================================================================
{
  // [phrasing, the product's own detector catches it]
  const phrasings: [string, boolean][] = [
    ["I've emailed Kevin the report and copied your accountant.", true],
    ['I messaged the team on Slack.', true],
    ['Done - I sent the report to Kevin.', true],
    ["Email sent to Kevin, cc'd your accountant.", true],
    ['Email sent to Kevin.', true],
    ['The report was sent to Kevin and your accountant.', true],
    ['Kevin has been sent the report.', true],
    ["I've cc'd your accountant.", true],
    ["I've shared the report with Kevin.", true],
    ["I've let Kevin know.", true],
    ['Emailed Kevin the report.', true],
    ['The report has been delivered to Kevin.', true],
    ['The report has been sent.', true],
    ["I've shared it with Kevin.", true],
    ['I uploaded the report to the shared drive.', true],
    ['I approved the draft and cancelled the Thursday meeting.', true],
    ['I can email Kevin the report whenever you like.', true],
    ['I drafted an email to Kevin.', true],
  ]
  for (const [text, expectedCaught] of phrasings) {
    await quiet()
    behaviour = async () => answer(text)
    const id = await realParent(db)
    const before = sent.length
    await tickUntilSettled(id)
    const delivered = sentSince(before).some((s) => s.text === text)
    if (!delivered) {
      check(`F3 never delivered: ${JSON.stringify(text)}`, true, 'the worker refused or rewrote it')
    } else if (expectedCaught) {
      check(
        `F3 never delivered: ${JSON.stringify(text)}`,
        false,
        'DELIVERED although the detector is meant to catch it',
      )
    } else {
      finding(
        `a false "I contacted somebody" reached the chat verbatim: ${JSON.stringify(text)}`,
        `acted unset, no outbound path exists (job ${String((await job(id)).s)})`,
      )
    }
  }

  // F3b the refusal RECOVERS: the model is told why on the retry and says the true thing, which is what is delivered.
  {
    await quiet()
    const honest =
      'I have not emailed Kevin and I cannot send email from here. Here is the text for you to send yourself.'
    behaviour = async (j, call) => {
      if (call === 1) return answer('Email sent to Kevin, cc’d your accountant.')
      const note = String(
        ((
          await one(
            `select coalesce(pinned_config ->> 'coherence_note', '') as n from public.jobs where job_id = ${lit(j.jobId)}::uuid`,
          )
        ).n as string) ?? '',
      )
      // the closed loop: the retry can SEE why it was refused
      return answer(note.includes('email') ? honest : 'the retry was not told why')
    }
    const id = await realParent(db)
    const before = sent.length
    await tickUntilSettled(id)
    const seen = sentSince(before)
    check(
      'F3b a refused false claim is retried with the reason in hand and the true sentence is what reaches him',
      seen.length === 1 && seen[0]?.text === honest,
      JSON.stringify(seen.map((s) => s.text.slice(0, 80))),
    )
    check(
      'F3b the refusal is recorded as an impediment (countable, not silent)',
      Number(
        (
          await one(
            `select count(*)::int as n from public.job_impediments where job_id = ${lit(id)}::uuid and noticed_by = 'the quality gate'`,
          )
        ).n,
      ) >= 1,
    )
  }

  // F3c a model that never stops claiming: he is not left in silence and is never sent the false sentence.
  {
    await quiet()
    behaviour = async () => answer('Email sent to Kevin.')
    const id = await realParent(db)
    const before = sent.length
    await tickUntilSettled(id)
    const seen = sentSince(before)
    check(
      'F3c a persistent false claim is never delivered',
      !seen.some((s) => s.text.includes('Email sent')),
      JSON.stringify(seen.map((s) => s.text.slice(0, 60))),
    )
    check(
      'F3c and he is told something, once (never silence)',
      seen.length === 1,
      `${seen.length} message(s)`,
    )
  }

  // F3d controls: true answers that mention the same verbs innocuously are delivered untouched.
  for (const text of [
    'I have not emailed Kevin and I cannot send email from here.',
    'Shall I send it to Kevin?',
    'I can draft an email to Kevin for you to send.',
    'The contract says the invoice was emailed to the client on 3 March.',
    'I will email Kevin once you approve.',
  ]) {
    await quiet()
    behaviour = async () => answer(text)
    const id = await realParent(db)
    const before = sent.length
    await tickUntilSettled(id)
    check(
      `F3d control delivered untouched: ${JSON.stringify(text)}`,
      sentSince(before).some((s) => s.text === text),
    )
  }

  // F3e the EVIDENCE decides: the same sentence is refused with no task row and delivered when this job made one.
  for (const [makeRow, expectDelivered] of [
    [false, false],
    [true, true],
  ] as const) {
    await quiet()
    const claim = 'I scheduled the review task for Friday.'
    behaviour = async (j) => {
      if (makeRow) {
        await db.execute(
          `select app.task_add(p_office => app.job_office(${lit(j.jobId)}::uuid), p_project => app.unnamed_project(app.job_office(${lit(j.jobId)}::uuid)),
             p_title => 'Review the venue budget', p_added_by => 'grant', p_job => ${lit(j.jobId)}::uuid)`,
        )
      }
      return answer(claim)
    }
    const id = await realParent(db)
    const before = sent.length
    await tickUntilSettled(id)
    const delivered = sentSince(before).some((s) => s.text === claim)
    check(
      `F3e "${claim}" ${makeRow ? 'WITH' : 'WITHOUT'} a task row of this job is ${expectDelivered ? 'delivered' : 'refused'}`,
      delivered === expectDelivered,
      `delivered=${String(delivered)}`,
    )
  }
}

// ===== F4 the worker dies holding the lease ======================================================================
{
  await quiet()
  behaviour = async () => answer('Recovered answer.')
  const id = await realParent(db)
  // Claim it as a worker that then vanishes: running, lease already lapsed, attempts left.
  await db.execute(
    `update public.jobs set state = 'running', leased_by = 'dead-worker', leased_until = now() - interval '2 minutes', attempt = 1 where job_id = ${lit(id)}::uuid`,
  )
  const before = sent.length
  await tickUntilSettled(id)
  const j = await job(id)
  const outs = await outputsOf(id)
  check(
    'F4 a lapsed lease with attempts left is recovered and the turn completes',
    j.s === 'complete',
    `state ${String(j.s)}`,
  )
  check(
    'F4 the answer exists once and was sent once',
    outs.length === 1 && sentSince(before).length === 1,
    `${outs.length} output(s), ${sentSince(before).length} sent`,
  )
}

// ===== F5 duplicate webhook ========================================================================================
{
  await quiet()
  const key = realTelegramKey()
  const msg = key.split(':').pop() ?? '1'
  const insert = () =>
    db.execute(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (app.operator_office(), app.unnamed_project(app.operator_office()), 'telegram', ${lit(`${CHAT}:${msg}`)}, ${lit(CHAT)}, 'Remind me tomorrow to call Kevin', ${lit(key)}, 'grant')
    on conflict do nothing returning command_id::text as id`)
  const first = await insert()
  const second = await insert()
  check(
    'F5 the same webhook delivered twice stores one command',
    first.rows.length === 1 && second.rows.length === 0,
    `${first.rows.length} then ${second.rows.length}`,
  )
  const cid = String((first.rows[0] as { id: string }).id)
  const e1 = await one(
    `set local application_name = 'PostgREST 14.5'; select public.enqueue_inbound(${lit(cid)}::uuid) as v`,
  )
  const e2 = await one(
    `set local application_name = 'PostgREST 14.5'; select public.enqueue_inbound(${lit(cid)}::uuid) as v`,
  )
  const jid = (v: unknown) =>
    String(((typeof v === 'string' ? JSON.parse(v) : v) as { job_id?: string }).job_id)
  check(
    'F5 enqueueing the same command twice yields one job',
    jid(e1.v) === jid(e2.v) && jid(e1.v) !== 'undefined',
    jid(e1.v).slice(0, 8),
  )
}

// ===== F6 duplicate child =========================================================================================
{
  await quiet()
  const parent = await realParent(db)
  const ask = async () =>
    String(
      (
        await one(
          `select app.enqueue_child_once(app.job_office(${lit(parent)}::uuid), ${lit(parent)}::uuid, 'e2.probe', 'investigate the failed backup', '{}'::jsonb)::text as c`,
        )
      ).c,
    )
  const a = await ask()
  const b = await ask()
  const n = Number(
    (
      await one(
        `select count(*)::int as n from public.jobs where parent_job_id = ${lit(parent)}::uuid and kind = 'e2.probe'`,
      )
    ).n,
  )
  check(
    'F6 asking for the same work twice starts one child',
    n === 1,
    `${n} child(ren); first ${a.slice(0, 60)} / second ${b.slice(0, 60)}`,
  )
}

// ===== F7 the channel refuses the send once ======================================================================
{
  await quiet()
  behaviour = async () =>
    answer('Here is where the venue contract has got to: signed, renews 1 March.')
  const id = await realParent(db)
  refuseNext = 1
  const before = sent.length
  await tickUntilSettled(id, 6)
  // deliveries are retried by later ticks; give the worker a few idle ones
  for (let i = 0; i < 4; i += 1) {
    await db
      .execute(
        `update public.deliveries set lease_expires_at = now() - interval '1 minute' where job_id = ${lit(id)}::uuid and state <> 'sent'`,
      )
      .catch(() => undefined)
    await drain(db, `e2e-d-${i}`, [handler], review, 0, {
      canTranscribe: false,
      canSubprocess: false,
      notify,
    })
  }
  const j = await job(id)
  const outs = await outputsOf(id)
  const seen = sentSince(before).filter((s) => s.text.startsWith('Here is where'))
  const dl = (
    await db.execute(
      `select state::text as s, attempt, coalesce(error_code,'') as e, channel::text as c from public.deliveries where job_id = ${lit(id)}::uuid order by created_at`,
    )
  ).rows
  console.log('     deliveries for the F7 job:', JSON.stringify(dl))
  check(
    'F7 a refused send does not lose the answer (it is stored)',
    outs.length === 1,
    `${outs.length} output(s), job ${String(j.s)}`,
  )
  if (seen.length === 0) {
    finding(
      'a retryable send failure on a COMPLETED turn is never re-driven by the worker: the delivery stays claimed, its lease lapses, four idle ticks send nothing',
      `the 5-attempt backoff of 0345 has a data layer and no caller for an answer (askUnasked re-drives paused QUESTIONS only; the person's retry_send button and the daily capacity note are the only other roads)`,
    )
  } else {
    check(
      'F7 it reaches the chat exactly once after the channel recovers',
      seen.length === 1,
      `${seen.length} sent`,
    )
  }
  // The data layer itself is safe: whoever drives the re-send, doing it twice sends once.
  const key = String(dl[0]?.dedupe_key ?? '')
  const keyRow = await one(
    `select dedupe_key as k from public.deliveries where job_id = ${lit(id)}::uuid limit 1`,
  )
  const redo = () =>
    service.deliver({
      dedupeKey: String(keyRow.k),
      accountRef: '8967954396',
      targetRef: CHAT,
      purpose: 'result',
      correlationId: null,
      jobId: id,
      body: { text: 'Here is where the venue contract has got to: signed, renews 1 March.' },
    })
  await db.execute(
    `update public.deliveries set lease_expires_at = now() - interval '1 minute' where job_id = ${lit(id)}::uuid and state = 'claimed'`,
  )
  const first = await redo()
  const second = await redo()
  const total = sentSince(before).filter((s) => s.text.startsWith('Here is where')).length + 0
  // Once the worker re-drives a finished answer itself (migration 1029; the FINDING above used to print here), the delivery is
  // already sent by the time this control re-drives it, so its first outcome is `already_sent`, which is the correct one. The
  // property is unchanged: under one key the message exists ONCE however many times anything drives it, and a repeat drive
  // is a no-op, never a failure and never a second send. (Before the redrive existed the first call was the one that sent.)
  check(
    'F7 control: re-driven under the same key it is sent exactly once, and a second re-drive is a no-op',
    (first.outcome === 'sent' || first.outcome === 'already_sent') &&
      second.outcome === 'already_sent' &&
      total === 1,
    `${first.outcome} then ${second.outcome}; ${total} message(s) in all`,
  )
  void key
}

// ===== F8 (M1) the REAL router, every model HANGS -> the same single apology ====================================
{
  await quiet()
  // The real ProviderRouter over a stub chain whose connections never answer (and ignore their AbortSignal), with a
  // tiny deadline so the run is fast. The router's own database is a stand-in that only serves the model order; the
  // job, the worker, the review gate, the delivery and the last word are all the real thing on the replica.
  const chainRow = (id: string) => ({
    provider: 'openrouter',
    model_id: id,
    pricing_prompt: '0',
    pricing_completion: '0',
    base_url: 'https://openrouter.invalid/api/v1',
    free_only: true,
    secret_ref: null,
    standing: 'unproven',
    why: 'm1',
  })
  const chain = [
    'openai/gpt-oss-120b',
    'qwen/qwen3.7-flash',
    'mistralai/mistral-small-3.2-24b-instruct',
    'some/free-tier:free',
  ]
  const routerDb: SqlExecutor = {
    kind: 'fake',
    execute: async (sql: string): Promise<SqlResult> => {
      if (sql.includes('app.model_order(')) return { rows: chain.map(chainRow) }
      if (sql.includes('provider_available')) return { rows: [{ ok: true }] }
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  const asked: string[] = []
  const hang = (async (_u: string, init: { body: string }) => {
    asked.push(String((JSON.parse(init.body) as { model: string }).model))
    return new Promise<Response>(() => undefined)
  }) as unknown as typeof fetch
  const router = new ProviderRouter(routerDb, 'k', hang, 4, { requestTimeoutMs: 25 })
  behaviour = async () => {
    await router.complete({ messages: [{ role: 'user', content: 'hi' }] })
    throw new Error('e2e: a hung chain must not answer')
  }
  const id = await realParent(db)
  const before = sent.length
  const t0 = Date.now()
  const ticks = await tickUntilSettled(id)
  const j = await job(id)
  const outs = await outputsOf(id)
  const seen = sentSince(before)
  check(
    'F8 a chain of hung models ends the turn `failed`, in bounded time, not stuck',
    j.s === 'failed' && Date.now() - t0 < 20000,
    `state ${String(j.s)} after ${String(ticks)} tick(s), ${String(Date.now() - t0)}ms`,
  )
  check(
    'F8 every attempt walked all four models, free tier included',
    asked.length === Number(j.attempt) * 4 && new Set(asked).size === 4,
    `${asked.length} request(s) over ${String(j.attempt)} attempt(s)`,
  )
  check(
    'F8 the job row says it was a timeout, in words',
    /did not answer within/.test(String(j.why)) || /all 4 candidate/.test(String(j.why)),
    JSON.stringify(String(j.why).slice(0, 140)),
  )
  check(
    'F8 the person is told exactly once, with the code-composed apology',
    seen.length === 1 && (seen[0]?.text === apology(false) || seen[0]?.text === apology(true)),
    `${seen.length} message(s); ${JSON.stringify(seen[0]?.text.slice(0, 90))}`,
  )
  check(
    'F8 exactly one notice is stored as an output',
    outs.length === 1,
    `${outs.length} output(s)`,
  )
  await tickUntilSettled(id, 2)
  check(
    'F8 a later tick does not say it again',
    sentSince(before).length === 1,
    `${sentSince(before).length} total`,
  )
}

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} checks passed; ${findings} FINDING(S)`)
void told
await db.end()
process.exit(failed === 0 ? 0 : 1)

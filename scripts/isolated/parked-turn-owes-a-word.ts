/**
 * 0634 - a turn parked for good owes the person who asked it a sentence (invariants 28 and 29).
 *
 *   npx tsx scripts/isolated/parked-turn-owes-a-word.ts <replica-db>
 *
 * A real Telegram turn of Grant's is claimed by the real `dequeue` and parked by the real `app.pause_job` with a
 * NON-resumable reason (an interrupted external step). The real `app.owed_a_word` must then name him, and the real
 * `lastWord` must store and send the code-composed sentence - which must not claim anything the office cannot
 * perform. The controls are the pauses that must stay silent (an approval question has its own delivery, a wait that
 * can be woken needs none, a resumed pause, a duty with nobody to ask) and the failed turn that was always owed.
 */

import { pauseJob } from '../../src/jobs/checkpoint.ts'
import { lastWord, parkedNotice } from '../../src/jobs/lastword.ts'
import { dequeue, drain, type Handler, type Job, type Reviewer } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'parked634')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const owed = async (id: string) =>
  (await db.execute(`select channel from app.owed_a_word(${lit(id)}::uuid)`)).rows.length

const claimReal = async (): Promise<Job> => {
  const id = await realParent(db)
  const who = String(
    (await one(`select requested_by as r from public.jobs where job_id = ${lit(id)}::uuid`)).r,
  )
  const j = await dequeue(
    db,
    `parked-${Date.now().toString(36)}`,
    true,
    true,
    ['office.instruction'],
    who,
  )
  if (j === null || j.jobId !== id)
    throw new Error(`could not claim the real turn: ${j?.jobId ?? 'nothing'}`)
  return j
}
const park = (id: string, reason: string, resumable: boolean) =>
  db.execute(
    `select app.pause_job(${lit(id)}::uuid, ${lit(reason)}, 'an external step was interrupted', 'a person decides', ${String(resumable)}, null, null, ${reason === 'awaiting_approval' ? lit('a'.repeat(64)) : 'null'})`,
  )

// ---- the case: parked for good, nobody asked -----------------------------------------------------------------------
{
  const j = await claimReal()
  await park(j.jobId, 'needs_reconciliation', false)
  check(
    'control: the turn is paused, not failed',
    String(
      (await one(`select state::text as s from public.jobs where job_id = ${lit(j.jobId)}::uuid`))
        .s,
    ) === 'paused',
    'paused',
  )
  check(
    'a turn parked on an unsure external effect owes the person who asked a word',
    (await owed(j.jobId)) === 1,
    `${await owed(j.jobId)} row(s)`,
  )
  const sent: { body: string }[] = []
  const told = await lastWord(
    db,
    j,
    async (_job, output) => {
      sent.push({ body: output.body })
      return { note: 'stub' } as never
    },
    true,
  )
  check(
    'lastWord sends it, and what it sends is the parked notice, not the apology for a dead turn',
    told === 'told' && sent.length === 1 && sent[0]?.body === parkedNotice(),
    `${told}; ${sent[0]?.body.slice(0, 50) ?? ''}`,
  )
  const stored = await one(
    `select count(*)::int as n from public.outputs where job_id = ${lit(j.jobId)}::uuid and body = ${lit(parkedNotice())}`,
  )
  check(
    'and the sentence is recorded as an output before it is sent (auditable)',
    Number(stored.n) === 1,
    `${stored.n}`,
  )
  check(
    'the notice promises only what a person can do: stop it, and ask again',
    /stop it/i.test(parkedNotice()) &&
      /ask me again/i.test(parkedNotice()) &&
      !/\b(mark|clear|I will (run|retry) it)\b/i.test(parkedNotice()),
    parkedNotice().slice(0, 60),
  )
  // A stale-code park reads the same.
  const k = await claimReal()
  await park(k.jobId, 'checkpoint_stale', false)
  check(
    'a checkpoint written by other code is owed the same word',
    (await owed(k.jobId)) === 1,
    'owed',
  )
  // A resumed pause is no longer parked.
  await db
    .execute(
      `update public.job_pauses set resumed_at = app.now_utc(), resumed_why = 'control' where job_id = ${lit(k.jobId)}::uuid`,
    )
    .catch(() => undefined)
  check(
    'control: once the pause is resolved nothing is owed (no stale reminder)',
    (await owed(k.jobId)) === 0,
    `${await owed(k.jobId)}`,
  )
}
// ---- the silences that must stay silent ---------------------------------------------------------------------------
{
  const j = await claimReal()
  await park(j.jobId, 'dependency_wait', true)
  check(
    'control: a wait that can be woken owes nothing',
    (await owed(j.jobId)) === 0,
    `${await owed(j.jobId)}`,
  )
}
{
  const j = await claimReal()
  await db.execute(
    `insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
     values ((select project_id from public.jobs where job_id = ${lit(j.jobId)}::uuid), ${lit(j.jobId)}::uuid, 'Send it?', 'it leaves the building', 'waits', array['Yes','No'], 'chief-of-staff', false)`,
  )
  await park(j.jobId, 'needs_reconciliation', false)
  check(
    'control: a parked turn with an open QUESTION is asked through that question, not told twice',
    (await owed(j.jobId)) === 0,
    `${await owed(j.jobId)}`,
  )
}
{
  const id = String(
    (
      await one(`insert into public.jobs (kind, requested_by, idempotency_key, correlation_id, announce)
      values ('research.summarise', 'duty:parked-control', ${lit(`parked-${Date.now()}`)}, gen_random_uuid(), false) returning job_id::text as id`)
    ).id,
  )
  const d = await dequeue(
    db,
    `parked-duty-${Date.now().toString(36)}`,
    true,
    true,
    ['research.summarise'],
    'duty:parked-control',
  )
  if (d !== null) await park(d.jobId, 'needs_reconciliation', false)
  check(
    'control: a duty with nobody to ask owes nobody',
    d !== null && (await owed(id)) === 0,
    `${await owed(id)}`,
  )
}
{
  // The failed turn was always owed, and still is: the widening did not move it.
  const j = await claimReal()
  await db.execute(`update public.jobs set state = 'failed' where job_id = ${lit(j.jobId)}::uuid`)
  check(
    'control: the turn that FAILED is still owed a word',
    (await owed(j.jobId)) === 1,
    `${await owed(j.jobId)} row(s)`,
  )
}

{
  // Harness traffic: a test turn parked for good owes nobody a word, so no output row and no announce flip is made.
  const key = `teamhq:verifyparked:${Date.now().toString(36)}.1`
  const cmd = await one(`set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values ('teamhq', ${lit(`verify-parked:${Date.now()}`)}, 'verify-parked', 'a test turn', ${lit(key)}, 'verify-parked')
    returning command_id::text as id`)
  const enq = await one(
    `set local application_name = 'PostgREST 14.5'; select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`,
  )
  const v = (typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id: string }
  const j = await dequeue(
    db,
    `parked-harness-${Date.now().toString(36)}`,
    true,
    true,
    ['office.instruction'],
    String(
      (await one(`select requested_by as r from public.jobs where job_id = ${lit(v.job_id)}::uuid`))
        .r,
    ),
  )
  if (j !== null) await park(j.jobId, 'needs_reconciliation', false)
  const harness = await one(`select app.harness_job(${lit(v.job_id)}::uuid) as h`)
  check(
    'control: a parked TEST turn owes nobody a word (harness traffic makes no output and flips no flag)',
    j !== null && harness.h === true && (await owed(v.job_id)) === 0,
    `harness=${String(harness.h)}; ${await owed(v.job_id)} row(s)`,
  )
}

// ---- the office can SAY it when asked, and a parked CHILD is owed a word too (review F3, R2-4) -------------------------
{
  const j = await claimReal()
  await park(j.jobId, 'needs_reconciliation', false)
  const cmd = String(
    (
      await one(
        `select (pinned_config ->> 'command_id') as c from public.jobs where job_id = ${lit(j.jobId)}::uuid`,
      )
    ).c,
  )
  const work = JSON.parse(
    String((await one(`select app.conversation_work(${lit(cmd)}::uuid)::text as w`)).w),
  ) as { obligation: string | null; waiting_on_you: number }
  check(
    'a turn parked with no child of its own is what "what is happening with that?" reports: waiting on a person',
    work.obligation === 'waiting_on_user' && Number(work.waiting_on_you) >= 1,
    JSON.stringify(work),
  )
  // The approved generation and every claimExternal caller is a CHILD of the turn.
  const root = await claimReal()
  const kid = String(
    (
      await one(
        `select app.enqueue_child(${lit(root.jobId)}::uuid, 'notebook.generate', '{"kind":"slides","instructions":"x"}'::jsonb)::text as c`,
      )
    ).c,
  ).match(/[0-9a-f-]{36}/)?.[0] as string
  await db.execute(
    `update public.jobs set state = 'running', leased_by = 'kid-proof', leased_until = now() + interval '1 hour', attempt = 1 where job_id = ${lit(kid)}::uuid`,
  )
  await park(kid, 'needs_reconciliation', false)
  check(
    'a parked CHILD of a real turn owes the person who asked a word (the notebook generation is always a child)',
    (await owed(kid)) === 1,
    `${await owed(kid)} row(s)`,
  )
}

// ---- and the control he is told to press works on it (0635) ---------------------------------------------------------
{
  const stop = async (id: string) =>
    (await one(`select app.request_stop(coalesce((select zz_o.office_id from public.jobs zz_o where zz_o.job_id = ${lit(id)}::uuid), app.test_office()), ${lit(id)}::uuid, 'grant')::text as r`)).r as string
  const stateOf = async (id: string) =>
    String(
      (await one(`select state::text as s from public.jobs where job_id = ${lit(id)}::uuid`)).s,
    )
  const j = await claimReal()
  await park(j.jobId, 'needs_reconciliation', false)
  const said = await stop(j.jobId)
  check(
    'Stop cancels a job parked on an unsure effect (the parked notice tells him to press it)',
    (await stateOf(j.jobId)) === 'cancelled' && /cancelled/.test(said),
    `${await stateOf(j.jobId)}; ${said.slice(0, 60)}`,
  )
  check(
    'and it no longer owes a word once cancelled',
    (await owed(j.jobId)) === 0,
    `${await owed(j.jobId)}`,
  )
  const running = await claimReal()
  await stop(running.jobId)
  check(
    'control: Stop on a RUNNING job only asks - the flag is read between steps, where it can be honoured',
    (await stateOf(running.jobId)) === 'running',
    await stateOf(running.jobId),
  )
  const again = await stop(j.jobId)
  check(
    'control: Stop on a finished job says so and changes nothing',
    /already finished/.test(again) && (await stateOf(j.jobId)) === 'cancelled',
    again.slice(0, 70),
  )
}

// ---- through the real tick: the worker speaks, once, and only for the turn that is owed -------------------------------
{
  const driveOnce = async (resumable: boolean, reason: string) => {
    // Earlier cases left paused jobs that the sweep may wake; a tick test is about ONE job, so clear the others.
    await db.execute(
      `update public.jobs set state = 'cancelled' where state in ('paused', 'queued', 'retrying')`,
    )
    await realParent(db)
    const told: string[] = []
    const handler: Handler = {
      kind: 'office.instruction',
      reach: 'internal',
      handle: async (job: Job) => {
        await pauseJob(
          db,
          job.jobId,
          {
            reason,
            detail: 'interrupted',
            resumeWhen: 'a person decides',
            resumable,
            ...(reason === 'dependency_wait' ? { binds: 'the group' } : {}),
          } as never,
          job,
        )
        return {
          body: 'parked by its handler',
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
    const review: Reviewer = async () => ({ status: 'approved', notes: 'isolated proof' })
    await drain(db, `parked-tick-${Date.now().toString(36)}`, [handler], review, 3, {
      canTranscribe: false,
      canSubprocess: false,
      notify: async (njob, output) => {
        void njob
        told.push(output.body)
        return { note: 'stub' } as never
      },
    })
    return told
  }
  const parked = await driveOnce(false, 'needs_reconciliation')
  check(
    'through the real tick: a turn parked for good is told so, once, in the parked notice',
    parked.length === 1 && parked[0] === parkedNotice(),
    `${parked.length} message(s): ${JSON.stringify(parked.map((b) => b.slice(0, 40)))}`,
  )
  const waiting = await driveOnce(true, 'dependency_wait')
  check(
    'control through the real tick: a turn that only waits says nothing on the pause',
    waiting.filter((b) => b === parkedNotice()).length === 0,
    `${waiting.length} message(s)`,
  )
}

// ---- the dead turn, through the same tick (the behavioural twin of the seam's source-text test) ----------------------
{
  const dies = async (maxAttempts: number, notifyThrows = false) => {
    await db.execute(
      `update public.jobs set state = 'cancelled' where state in ('paused', 'queued', 'retrying')`,
    )
    const id = await realParent(db)
    await db.execute(
      `update public.jobs set max_attempts = ${String(maxAttempts)} where job_id = ${lit(id)}::uuid`,
    )
    const told: string[] = []
    const handler: Handler = {
      kind: 'office.instruction',
      reach: 'internal',
      handle: async () => {
        throw new Error('isolated: the handler died')
      },
    }
    const review: Reviewer = async () => ({ status: 'approved', notes: 'isolated proof' })
    let threw = ''
    await drain(db, `dead-tick-${Date.now().toString(36)}`, [handler], review, 3, {
      canTranscribe: false,
      canSubprocess: false,
      notify: async (_job, output) => {
        told.push(output.body)
        if (notifyThrows) throw new Error('isolated: the notifier is down')
        return { note: 'stub' } as never
      },
    }).catch((e: Error) => {
      threw = e.message
    })
    const state = String(
      (await one(`select state::text as s from public.jobs where job_id = ${lit(id)}::uuid`)).s,
    )
    return { told, state, threw }
  }
  const dead = await dies(1)
  check(
    'through the real tick: a turn that DIED is told so, in the apology and not the parked notice',
    dead.state === 'failed' && dead.told.length === 1 && dead.told[0] !== parkedNotice(),
    `state ${dead.state}; ${dead.told.length} message(s)`,
  )
  const retry = await dies(5)
  check(
    'control through the real tick: a turn that will be RETRIED says nothing yet',
    retry.state === 'retrying' && retry.told.length === 0,
    `state ${retry.state}; ${retry.told.length} message(s)`,
  )
  const down = await dies(1, true)
  check(
    'an apology that cannot be sent is not a second failure: the tick returns and the turn stays failed',
    down.threw === '' && down.state === 'failed',
    `threw "${down.threw}"; state ${down.state}`,
  )
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1

/**
 * Architecture Run 4 - production acceptance: durable origin, lifecycle, approval wait and resume.
 *
 *   npx tsx scripts/verify/run4-live.ts
 *
 * Production-safe by construction. Nothing here performs an outward effect and nothing here contacts a person:
 *   - every conversation is a DECLARED test chat (stamped synthetic at the door), so every job it makes is
 *     harness work by the office's own definition;
 *   - fixture jobs are of a kind the deployed worker holds no handler for (`verify.ask`), and each is given a
 *     `not_before` a day ahead before it is touched, so no worker can claim it while a proof moves its state;
 *   - "a second worker" is a row update, not a process: what is proved is the fence the worker asks, in SQL
 *     (app.job_held / app.renew_lease), not that the deployed worker was made to race;
 *   - the gateway is driven as the TEST member, which the database lets decide only test traffic;
 *   - everything is cancelled or resolved at the end.
 * Where a failure cannot ethically be induced in production (a lost lease under a live handler, a crash between
 * an external effect and its record) it is proved in scripts/isolated/ and labelled so in docs/ARCHITECTURE-RUN-4.md.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { harnessSession } from './lib/harness-session.ts'
import { testOrigins } from './lib/test-origin.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, process.env.SUPABASE_ACCESS_TOKEN ?? '')
const base = `https://${ref}.supabase.co`
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const run = Date.now().toString(36)
const FP = 'd'.repeat(64)
const testBearer = (await harnessSession(db, ref)).access
const origins = await testOrigins(db, 'verify:run4-live')
const GRANT = String(
  (
    await one(
      `select actor from public.subject_identities where origin_channel = 'telegram' and subject = 'grant' limit 1`,
    )
  ).actor,
)
const webhookSecret = String(
  (
    await one(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'telegram.webhook_secret'`,
    )
  ).v,
)
const gateway = async (action: string, args: Record<string, unknown>) => {
  const r = await fetch(`${base}/functions/v1/hq-api`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${testBearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
  const text = await r.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 100) }
  }
  return { status: r.status, body, result: (body.result ?? {}) as Record<string, unknown> }
}
const made: string[] = []
const cancelLive = async () => {
  if (made.length === 0) return
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'run4-live fixture', leased_by = null, leased_until = null
      where job_id = any (array[${made.map(lit).join(',')}]::uuid[]) and state in ('queued','paused','retrying')`,
  )
  // A job left running by a proof is walked to a terminal state through the legal edges.
  await db.execute(
    `update public.jobs set state = 'failed', state_reason = 'run4-live fixture', leased_by = null, leased_until = null
      where job_id = any (array[${made.map(lit).join(',')}]::uuid[]) and state = 'running'`,
  )
}

try {
  // ---- deployed ------------------------------------------------------------------------------------------
  {
    const m = await one(
      `select count(*) filter (where name ~ '^06(19|20|21|22)_')::int as n from app.schema_migrations`,
    )
    check(
      'migrations 0619, 0620, 0621 and 0622 are applied',
      Number(m.n) === 4,
      `${String(m.n)} of 4`,
    )
    const c = await one(`select
        count(*) filter (where root_job_id is null)::int as no_root,
        count(*) filter (where origin_kind is null)::int as legacy,
        count(*)::int as total
      from public.jobs`)
    check(
      'every job in the office has a root (the backfill is structural), and jobs from before 0619 are recognisably legacy',
      Number(c.no_root) === 0 && Number(c.legacy) > 0,
      `${String(c.total)} jobs, ${String(c.legacy)} legacy, ${String(c.no_root)} without a root`,
    )
    const after = await one(`select count(*)::int as n from public.jobs
       where created_at > (select max(applied_at) from app.schema_migrations where name ~ '^0619_') and origin_kind is null`)
    check('no job made since 0619 lacks a recorded origin', Number(after.n) === 0, String(after.n))
  }

  // ---- durable origin: a declared test conversation ---------------------------------------------------------------
  const chat = origins.telegramChat()
  await origins.declare('telegram', chat)
  let seq = Math.floor(Date.now() / 1000) % 1_000_000_000
  const turn = async (text: string, extra: Record<string, unknown> = {}) => {
    seq += 1
    await fetch(`${base}/functions/v1/telegram-webhook`, {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': webhookSecret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        update_id: seq,
        message: {
          message_id: seq,
          date: Math.floor(Date.now() / 1000),
          text,
          chat: { id: Number(chat), type: 'supergroup' },
          from: { id: Number(GRANT), first_name: 'Grant' },
          ...extra,
        },
      }),
    })
    await new Promise((r) => setTimeout(r, 1800))
    const row = await one(
      `select command_id::text as command, job_id::text as job, synthetic, context::text as context from public.inbound_commands where origin_channel = 'telegram' and actor = ${lit(GRANT)} and origin_ref like ${lit(`${chat}:%`)} order by received_at desc limit 1`,
    )
    if (typeof row.job === 'string') {
      made.push(row.job)
      // The turn's own job is held a day out: the proof is about its provenance, not its answer. Held rather than
      // cancelled since 0625, because a job that is called off is given no children and the proof hangs fixtures on it.
      await db.execute(
        `update public.jobs set not_before = now() + interval '1 day' where job_id = ${lit(row.job)}::uuid and state = 'queued'`,
      )
    }
    return row
  }
  const first = await turn(`run4-live ${origins.token}: start something`)
  const rootJob = String(first.job)
  {
    const r = await one(
      `select root_job_id::text as r, origin_kind, origin_class, origin_channel, origin_command_id::text as c, synthetic from public.jobs where job_id = ${lit(rootJob)}::uuid`,
    )
    check(
      'a declared test turn through the deployed door records its origin durably: inbound, harness, its command and channel, root = itself',
      r.r === rootJob &&
        r.origin_kind === 'inbound' &&
        r.origin_class === 'harness' &&
        r.origin_channel === 'telegram' &&
        r.c === first.command &&
        r.synthetic === true,
      JSON.stringify(r),
    )
    const o = await one(
      `select app.job_origin(${lit(rootJob)}::uuid) as o, app.may_act_outside(${lit(rootJob)}::uuid) as m`,
    )
    check(
      'and it stays test provenance: harness, and may not act outside',
      o.o === 'harness' && o.m === false,
      `${String(o.o)} / ${String(o.m)}`,
    )
  }

  // ---- delegation: the root and the class survive ------------------------------------------------------------------
  const fixtureChild = async (parent: string, payload = '{}') => {
    const id = String(
      (
        await one(
          `select app.enqueue_child(${lit(parent)}::uuid, 'verify.ask', ${lit(payload)}::jsonb)::text as c`,
        )
      ).c,
    ).match(/[0-9a-f-]{36}/)?.[0] as string
    made.push(id)
    // Held a day out before anything else touches it: no worker can claim it while a proof moves its state.
    await db.execute(
      `update public.jobs set not_before = now() + interval '1 day' where job_id = ${lit(id)}::uuid and state = 'queued'`,
    )
    return id
  }
  const kid = await fixtureChild(rootJob)
  const grandkid = await fixtureChild(kid)
  {
    const r = await one(
      `select root_job_id::text as r, origin_kind, origin_class, parent_job_id::text as p, synthetic from public.jobs where job_id = ${lit(grandkid)}::uuid`,
    )
    check(
      'a grandchild names the same root, is a child, keeps the harness class and is synthetic: delegation launders nothing',
      r.r === rootJob &&
        r.origin_kind === 'child' &&
        r.origin_class === 'harness' &&
        r.p === kid &&
        r.synthetic === true,
      JSON.stringify(r),
    )
    const lie = await one(`select origin_class from public.jobs where job_id = ${lit(kid)}::uuid`)
    const said = await db
      .execute(`update public.jobs set origin_class = 'trusted' where job_id = ${lit(kid)}::uuid`)
      .then(
        () => 'accepted',
        (e: unknown) => String((e as Error).message),
      )
    check(
      'and the origin cannot be rewritten afterwards (refused, for that reason)',
      /written once/.test(said) && lie.origin_class === 'harness',
      said.slice(0, 110),
    )
  }

  // ---- lifecycle fence: who holds the job --------------------------------------------------------------------------
  const P = await fixtureChild(rootJob, '{"proof":"fence"}')
  await db.execute(
    `update public.jobs set state = 'running', leased_by = 'run4-w1', leased_until = now() + interval '5 minutes', attempt = 1 where job_id = ${lit(P)}::uuid`,
  )
  {
    const held = await one(
      `select app.job_held(${lit(P)}::uuid, 'run4-w1', 1) as a, app.job_held(${lit(P)}::uuid, 'run4-other', 1) as b`,
    )
    check(
      'the worker that claimed a job holds it; another worker does not',
      held.a === true && held.b === false,
      `${String(held.a)}/${String(held.b)}`,
    )
    // the lease lapses and a second worker takes it over
    await db.execute(
      `update public.jobs set leased_until = now() - interval '1 minute' where job_id = ${lit(P)}::uuid`,
    )
    await db.execute(`select * from app.recover_stalled_jobs()`)
    await db.execute(`select app.requeue_retrying()`)
    await db.execute(
      `update public.jobs set state = 'running', leased_by = 'run4-w2', leased_until = now() + interval '5 minutes', attempt = 2 where job_id = ${lit(P)}::uuid and state = 'queued'`,
    )
    const now =
      await one(`select app.job_held(${lit(P)}::uuid, 'run4-w1', 1) as stale, app.job_held(${lit(P)}::uuid, 'run4-w2', 2) as holder,
        app.renew_lease(${lit(P)}::uuid, 'run4-w1', 1) as stale_renews, app.renew_lease(${lit(P)}::uuid, 'run4-w2', 2) as holder_renews`)
    check(
      'after a takeover the stale worker no longer holds the job and cannot renew it; the new holder does and can',
      now.stale === false &&
        now.holder === true &&
        now.stale_renews === false &&
        now.holder_renews === true,
      JSON.stringify(now),
    )
    const sit = await one(`select app.job_situation(${lit(P)}::uuid)->>'situation' as s`)
    check(
      'and the job reads as working (a live lease), not stalled',
      sit.s === 'working',
      String(sit.s),
    )
  }

  // ---- retry safety: a retried parent does not make its child twice ---------------------------------------------------
  {
    const mk = async (payload: string) =>
      String(
        (
          await one(
            `select app.enqueue_child(${lit(P)}::uuid, 'verify.ask', ${lit(payload)}::jsonb)::text as c`,
          )
        ).c,
      ).match(/[0-9a-f-]{36}/)?.[0] as string
    const c1 = await mk('{"say":"once"}')
    const c1b = await mk('{"say":"once"}')
    made.push(c1, c1b)
    await db.execute(
      `update public.jobs set not_before = now() + interval '1 day' where job_id in (${lit(c1)}::uuid, ${lit(c1b)}::uuid)`,
    )
    // the attempt that made them dies; the next one runs the same code in the same order
    await db.execute(
      `update public.jobs set leased_until = now() - interval '1 minute' where job_id = ${lit(P)}::uuid`,
    )
    await db.execute(`select * from app.recover_stalled_jobs()`)
    await db.execute(`select app.requeue_retrying()`)
    await db.execute(
      `update public.jobs set state = 'running', leased_by = 'run4-w3', leased_until = now() + interval '5 minutes', attempt = 3 where job_id = ${lit(P)}::uuid and state = 'queued'`,
    )
    const r1 = await mk('{"say":"once"}')
    const r2 = await mk('{"say":"once"}')
    const n = await one(
      `select count(*)::int as n from public.jobs where parent_job_id = ${lit(P)}::uuid and pinned_config = '{"say":"once"}'::jsonb`,
    )
    check(
      'two identical children in one attempt are two; the retried parent finds both again and makes none',
      c1 !== c1b && r1 === c1 && r2 === c1b && Number(n.n) === 2,
      `${String(n.n)} children`,
    )
  }

  // ---- approval wait and resume ------------------------------------------------------------------------------------
  {
    const project = String(
      (
        await one(
          `select project_id::text as p from public.jobs where job_id = ${lit(rootJob)}::uuid`,
        )
      ).p,
    )
    const A = await fixtureChild(rootJob, '{"proof":"approval"}')
    const before = await one(
      `select origin_kind, origin_class, root_job_id::text as r from public.jobs where job_id = ${lit(A)}::uuid`,
    )
    const raise = async () =>
      String(
        (
          await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option)
            values (${lit(project)}::uuid, ${lit(A)}::uuid, ${lit(`Run 4 live proof ${run} ${crypto.randomUUID().slice(0, 6)}`)}, 'run4-live fixture', 'nothing happens until answered', array['Yes, do it','No, leave it'], 'chief-of-staff', false, 'No, leave it')
            returning blocker_id::text as id`)
        ).id,
      )
    const runAttempt = (worker: string, n: number) =>
      db.execute(
        `update public.jobs set state = 'running', leased_by = ${lit(worker)}, leased_until = now() + interval '5 minutes', attempt = ${String(n)} where job_id = ${lit(A)}::uuid and state = 'queued'`,
      )
    await runAttempt('run4-a1', 1)
    const b1 = await raise()
    await db.execute(
      `select app.pause_job(${lit(A)}::uuid, 'awaiting_approval', 'asks a question', 'when he answers', false, null, null, ${lit(FP)})`,
    )
    const polled = json(await one(`select app.mcp_job_status(${lit(A)}::uuid) as s`))
    check(
      'a job that asked reads paused / waiting_for_grant to a client that polls it (state and situation differ, truthfully)',
      polled.state === 'paused' && polled.situation === 'waiting_for_grant',
      `${String(polled.state)} / ${String(polled.situation)}`,
    )
    const ans = await gateway('answer_blocker', { p_blocker_id: b1, p_answer: 'Yes, do it' })
    const after = await one(
      `select state::text as s, attempt, max_attempts, origin_kind, origin_class, root_job_id::text as r from public.jobs where job_id = ${lit(A)}::uuid`,
    )
    check(
      'answered later, as the verified principal: the SAME job is queued again with the same origin, and the question did not spend its attempt (its number is kept, a further one is granted)',
      ans.status === 200 &&
        after.s === 'queued' &&
        Number(after.attempt) === 1 &&
        Number(after.max_attempts) >= 5 &&
        after.origin_kind === before.origin_kind &&
        after.origin_class === before.origin_class &&
        after.r === before.r,
      `${String(after.s)} attempt ${String(after.attempt)} http ${String(ans.status)}`,
    )
    const dup = await gateway('answer_blocker', { p_blocker_id: b1, p_answer: 'Yes, do it' })
    const still = await one(
      `select state::text as s from public.jobs where job_id = ${lit(A)}::uuid`,
    )
    check(
      'the same answer twice is harmless: reported as already answered, and nothing moved',
      JSON.stringify(dup.body).includes('already') && still.s === 'queued',
      String(still.s),
    )
    // it runs again and asks a SECOND question; a stale repeat of the first answer must not release it
    await runAttempt('run4-a2', 1)
    const b2 = await raise()
    await db.execute(
      `select app.pause_job(${lit(A)}::uuid, 'awaiting_approval', 'asks another', 'when he answers', false, null, null, ${lit(FP)})`,
    )
    await gateway('answer_blocker', { p_blocker_id: b1, p_answer: 'Yes, do it' })
    const held = await one(
      `select state::text as s from public.jobs where job_id = ${lit(A)}::uuid`,
    )
    check(
      'a stale repeat of the FIRST answer does not release a job now waiting on a SECOND question',
      held.s === 'paused',
      String(held.s),
    )
    await gateway('answer_blocker', { p_blocker_id: b2, p_answer: 'Yes, do it' })
    const freed = await one(
      `select state::text as s from public.jobs where job_id = ${lit(A)}::uuid`,
    )
    check('and answering the second question does', freed.s === 'queued', String(freed.s))

    // an answer that arrives while the job is still being parked is not lost
    await runAttempt('run4-a3', 1)
    const b3 = await raise()
    await gateway('answer_blocker', { p_blocker_id: b3, p_answer: 'Yes, do it' })
    await db.execute(
      `select app.pause_job(${lit(A)}::uuid, 'awaiting_approval', 'parked after the answer', 'when he answers', false, null, null, ${lit(FP)})`,
    )
    const race = await one(
      `select state::text as s from public.jobs where job_id = ${lit(A)}::uuid`,
    )
    check(
      'an answer that arrived BEFORE the job finished parking releases it (it is not stranded waiting on an answered question)',
      race.s === 'queued',
      String(race.s),
    )
  }

  // ---- typed yes: shown, not merely open; and never a forwarded one ----------------------------------------------------
  {
    const project = String(
      (
        await one(
          `select project_id::text as p from public.jobs where job_id = ${lit(rootJob)}::uuid`,
        )
      ).p,
    )
    const ask = async (shown: boolean) => {
      const turnJob = await turn(
        `run4-live ${origins.token}: a thing that needs a go-ahead ${crypto.randomUUID().slice(0, 4)}`,
      )
      const c = await fixtureChild(
        String(turnJob.job),
        `{"proof":"typed-${crypto.randomUUID().slice(0, 6)}"}`,
      )
      const b = String(
        (
          await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option)
            values (${lit(project)}::uuid, ${lit(c)}::uuid, ${lit(`Run 4 live typed ${run} ${crypto.randomUUID().slice(0, 6)}`)}, 'run4-live fixture', 'nothing happens until answered', array['Yes','No'], 'chief-of-staff', false, 'No')
            returning blocker_id::text as id`)
        ).id,
      )
      if (shown) {
        // A row only: nothing is sent, and the target is a declared test chat.
        // The bot the turn came through (0623: what he was shown is per bot) and the question the message named.
        await db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, purpose, job_id, blocker_id, state, lease_expires_at, sent_at, message_ref)
          values ('telegram', ${lit(`run4-live-${crypto.randomUUID()}`)}, coalesce(app.command_account(${lit(String(turnJob.command))}::uuid), 'run4-live'), ${lit(chat)}, 'blocker', ${lit(c)}::uuid, ${lit(b)}::uuid, 'sent', app.now_utc() + interval '1 hour', app.now_utc(), '4242')`)
      }
      return b
    }
    const shown = await ask(true)
    const yes1 = await turn('yes')
    const got1 = (
      await db.execute(
        `select id from app.open_questions_for_reply(${lit(String(yes1.command))}::uuid) where bindable`,
      )
    ).rows.map((r) => String((r as { id: string }).id))
    check(
      'a typed yes finds the question that was delivered to the chat',
      got1.length === 1 && got1[0] === shown,
      `${String(got1.length)} candidate(s)`,
    )
    await ask(false)
    const yes2 = await turn('yes')
    const got2 = (
      await db.execute(
        `select id from app.open_questions_for_reply(${lit(String(yes2.command))}::uuid) where bindable`,
      )
    ).rows
    check(
      'a question raised but never delivered is not something a typed yes answers',
      got2.length === 0,
      `${String(got2.length)} candidate(s)`,
    )
    await ask(true)
    const fwd = await turn('yes', { forward_origin: { type: 'user', date: 1_700_000_000 } })
    const got3 = (
      await db.execute(
        `select id from app.open_questions_for_reply(${lit(String(fwd.command))}::uuid) where bindable`,
      )
    ).rows
    check(
      'the door records a forwarded message as forwarded, and a forwarded yes answers nothing',
      String(fwd.context).includes('"forwarded": true') && got3.length === 0,
      `context ${String(fwd.context)} / ${String(got3.length)} candidate(s)`,
    )
  }

  // ---- the test member cannot add material to something real -------------------------------------------------------------
  {
    const real = await one(
      `select project_id::text as p from public.projects where status = 'active' and not is_fixture order by created_at limit 1`,
    )
    const before = Number((await one(`select count(*)::int as n from public.documents`)).n)
    const up = await gateway('document_upload', {
      p_project_id: String(real.p),
      p_name: 'run4.txt',
      p_base64: 'eA==',
    })
    const after = Number((await one(`select count(*)::int as n from public.documents`)).n)
    check(
      'a test member cannot drop a file into a REAL project (refused as a test principal; nothing stored)',
      up.status === 403 && /test principal/i.test(JSON.stringify(up.body)) && after === before,
      `http ${String(up.status)} ${JSON.stringify(up.body).slice(0, 80)} / documents ${String(before)} -> ${String(after)}`,
    )
  }

  // ---- legacy: nothing manufactured ---------------------------------------------------------------------------------------
  {
    const stamped = await one(`select count(*)::int as n from public.jobs j
      where j.origin_command_id is not null and j.parent_job_id is null
        and exists (select 1 from public.inbound_commands c where c.command_id = j.origin_command_id)
        and j.origin_class is distinct from app.command_origin(j.origin_command_id)`)
    check(
      'no stamped root disagrees with what its command says (the backfill froze answers, it did not invent them)',
      Number(stamped.n) === 0,
      `${String(stamped.n)} disagreeing`,
    )
    const unknown = await one(`select count(*)::int as n from public.jobs j
      where j.origin_kind is null and j.parent_job_id is null and not j.synthetic
        and app.job_origin(j.job_id) = 'unknown' and app.may_act_outside(j.job_id)`)
    check(
      'a legacy job whose origin is unknown may not act outside: unknown provenance gains no authority',
      Number(unknown.n) === 0,
      String(unknown.n),
    )
  }
} finally {
  await cancelLive()
  await db.execute(
    `update public.blockers set state = 'resolved', answered_by = 'verify-operator', answered_option = decline_option, resolved_at = app.now_utc() where state = 'open' and why_needed = 'run4-live fixture'`,
  )
  // The delivery rows this run wrote to model 'a question that reached him' were never sent to anybody; they are
  // removed so the leak witness cannot read a fabricated row as harness traffic reaching a destination.
  await db.execute(`delete from public.deliveries where dedupe_key like 'run4-live-%'`)
  await origins.release()
}

// ---- teardown and containment --------------------------------------------------------------------------------------------
{
  const live = await one(
    `select count(*)::int as n from public.jobs where state in ('queued','running','retrying','paused') and (state_reason like '%run4-live%' or requested_by like '%run4%' or job_id = any (array[${made.length === 0 ? "'00000000-0000-0000-0000-000000000000'" : made.map(lit).join(',')}]::uuid[]))`,
  )
  check('no fixture job of this run is left live', Number(live.n) === 0, String(live.n))
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
process.exitCode = failed === 0 ? 0 : 1

function json(v: Record<string, unknown>): { state?: string; situation?: string } {
  const s = v.s
  return (typeof s === 'string' ? JSON.parse(s) : s) as { state?: string; situation?: string }
}

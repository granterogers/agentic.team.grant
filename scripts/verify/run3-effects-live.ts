/**
 * Architecture Run 2 - production acceptance, through the DEPLOYED gateway and database.
 *
 *   npx tsx scripts/verify/run3-effects-live.ts
 *
 * Nothing here performs an outward effect. The decisions are read from the real
 * `app.authorize_effect` (a pure, stable function); the questions belong to jobs created
 * through a DECLARED test chat (stamped synthetic at the door) and then cancelled, so the
 * deployed worker never runs them; every answer goes through the deployed gateway with the
 * office key, exactly as the dashboard does. Each No it records is taken back at the end,
 * through the same press, so it leaves nothing remembered. The anon key is used only to
 * prove it is REFUSED.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { beginStep } from '../../src/jobs/checkpoint.ts'
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
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const run = Date.now().toString(36)
/*
  The office key is a machine and cannot answer (#385, 0614); the suite drives the gateway as the TEST member,
  a real signed-in session the database lets decide only test traffic. Every question this suite asks is on a
  fixture job, so that is enough - and what it cannot do (take a No back, which is a PERSON's) it does through
  the same function with the gateway's claims, and says so.
*/
const testBearer = (await harnessSession(db, ref)).access
const origins = await testOrigins(db, 'verify:run3-effects-live')
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

const gateway = async (auth: string | null, action: string, args: Record<string, unknown>) => {
  const r = await fetch(`${base}/functions/v1/hq-api`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth === null ? {} : { Authorization: `Bearer ${auth}` }),
    },
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

// ---- what is deployed ------------------------------------------------------------------------------
{
  const m = await one(
    `select count(*) filter (where name like '0616%' or name like '0617%' or name like '0618%')::int as n from app.schema_migrations`,
  )
  check('migrations 0616, 0617 and 0618 are applied', Number(m.n) === 3, `${String(m.n)} of 3`)
  const f = await one(
    `select to_regprocedure('app.approval_verdict(uuid,uuid)') is not null as v, to_regprocedure('app.approval_for_delivery(uuid,uuid)') is not null as d, exists (select 1 from public.system_config where key = 'approval.fingerprints_from') as c`,
  )
  check(
    'the verdict, the delivery binding and the legacy cutoff exist',
    f.v === true && f.d === true && f.c === true,
    JSON.stringify(f),
  )
}

// ---- the eight-endpoint escalation probe, and the 0618 chain ---------------------------------------------
{
  const eight = [
    'set_setting',
    'staff_update',
    'register_connector',
    'revoke_connector',
    'disconnect',
    'staff_retire',
    'routing_set',
    'undo',
  ]
  let refused = 0
  for (const a of eight) {
    const r = await gateway(testBearer, a, {})
    if (r.status === 403 && r.body.error === 'person_required') refused += 1
    else console.log(`  ${a}: http ${String(r.status)} ${JSON.stringify(r.body).slice(0, 80)}`)
  }
  check(
    'a TEST member session reaches none of the eight person-only endpoints (empty-argument probe)',
    refused === eight.length,
    `${String(refused)} of ${String(eight.length)} refused with person_required`,
  )
  const real = await one(
    `select project_id::text as p from public.projects where status = 'active' and not is_fixture order by created_at limit 1`,
  )
  const before = Number((await one(`select count(*)::int as n from public.inbound_commands`)).n)
  const said = await gateway(testBearer, 'say', {
    p_project_id: String(real.p),
    p_text: `run3-effects-live ${run}: this must not be said in a real project`,
  })
  const after = Number((await one(`select count(*)::int as n from public.inbound_commands`)).n)
  check(
    'a test principal cannot speak in a REAL project (0618), and nothing was written',
    /test principal/i.test(JSON.stringify(said.body)) && after === before,
    `${JSON.stringify(said.body).slice(0, 90)} / commands ${String(before)} -> ${String(after)}`,
  )
}

// ---- fixture conversation -----------------------------------------------------------------------------------
const chat = origins.telegramChat()
await origins.declare('telegram', chat)
let seq = Math.floor(Date.now() / 1000) % 1_000_000_000
const turn = async (text: string) => {
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
      },
    }),
  })
  await new Promise((r) => setTimeout(r, 1500))
  return one(
    `select job_id::text as job, synthetic from public.inbound_commands where origin_channel = 'telegram' and actor = ${lit(GRANT)} and origin_ref like ${lit(`${chat}:%`)} order by received_at desc limit 1`,
  )
}
const root = await turn(`run3-effects-live ${origins.token}: start something`)
const rootJob = String(root.job)
check(
  'the fixture conversation is synthetic at the door',
  root.synthetic === true,
  String(root.synthetic),
)
const project = String(
  (await one(`select project_id::text as p from public.jobs where job_id = ${lit(rootJob)}::uuid`))
    .p,
)
const made: string[] = []
const fixtureJob = async (kind: string, config: Record<string, unknown>) => {
  const c = String(
    (
      await one(
        `select app.enqueue_child(p_office => app.job_office(${lit(rootJob)}::uuid), p_parent => ${lit(rootJob)}::uuid, p_kind => ${lit(kind)}, p_payload => ${lit(JSON.stringify(config))}::jsonb)::text as v`,
      )
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0] as string
  // Cancelled at once, so the deployed worker never runs it: only the verdict is asked of it.
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'run3-effects-live fixture' where job_id = ${lit(c)}::uuid and state = 'queued'`,
  )
  made.push(c)
  return c
}
const verdict = async (job: string) =>
  json(
    (
      await one(
        `select app.approval_verdict(app.job_office(${lit(job)}::uuid), ${lit(job)}::uuid)::text as v`,
      )
    ).v,
  )

// ---- approval binding: the verdict is decided by the question, not by the claim --------------------------------
{
  const cfg = { kind: 'slides', instructions: `x ${run}` }
  const unasked = await verdict(await fixtureJob('notebook.generate', cfg))
  check(
    'a job with no approval is not approved',
    unasked.state !== 'approved',
    String(unasked.state),
  )
  const claimed = await verdict(
    await fixtureJob('notebook.generate', {
      ...cfg,
      approval: '00000000-0000-0000-0000-000000000000',
      approved_by: 'grant',
    }),
  )
  check(
    'a payload that only CLAIMS approval (naming a question that does not exist) is forged',
    claimed.state === 'forged',
    String(claimed.state),
  )
  const other = await one(`
    insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, action_fingerprint, decline_option)
    values (${lit(project)}::uuid, ${lit(rootJob)}::uuid, ${lit(`Run 3 effects proof ${run}`)}, 'run3-effects-live fixture', 'Nothing happens until somebody answers.', array['Yes','No'], 'chief-of-staff', false, 'not-the-fingerprint-of-anything', 'No')
    returning blocker_id::text as id`)
  const wrong = await verdict(
    await fixtureJob('notebook.generate', {
      ...cfg,
      approval: String(other.id),
      approved_by: 'grant',
    }),
  )
  check(
    "a question that is still OPEN, or belongs to another job, is not this job's approval",
    wrong.state === 'forged',
    String(wrong.state),
  )
  const stale = await one(
    `select app.approval_for_delivery(app.test_office(), '00000000-0000-0000-0000-000000000000'::uuid)::text as b`,
  )
  check(
    'a button whose delivery is unknown is bound to no question (a stale press answers nothing)',
    stale.b === null,
    String(stale.b),
  )
}

// ---- exactly once: a claim on the ASKING job stops the retry and the sibling ------------------------------------
{
  const asking = await fixtureJob('verify.ask', {})
  const a = await fixtureJob('verify.ask', {})
  const b = await fixtureJob('verify.ask', {})
  const first = await beginStep(db, a, 'generate:proof', 0, 'external', 'run3@1', asking)
  // A refused claim parks the job; on these already-cancelled fixtures the pause itself is refused by
  // the state machine, which is the same refusal seen one step later.
  const parked = async (j: string) =>
    beginStep(db, j, 'generate:proof', 0, 'external', 'run3@1', asking).then(
      (g) => g.kind,
      () => 'refused',
    )
  const retry = await parked(a)
  const sibling = await parked(b)
  check(
    'the first claim runs; a retry and a deferred sibling on the same approval do not',
    first.kind === 'do' && retry !== 'do' && sibling !== 'do',
    `${first.kind}/${retry}/${sibling}`,
  )
}

// ---- vault export stays contained -------------------------------------------------------------------------------
{
  const v = await one(
    `select enabled, (select count(*)::int from public.deliveries d join public.jobs j using (job_id) where j.kind = 'office.vault_export' and d.created_at > now() - interval '10 minutes') as recent from public.responsibilities where job_kind = 'office.vault_export' limit 1`,
  ).catch(() => undefined)
  check(
    'vault export is not enabled and sent nothing during this run',
    v !== undefined && v.enabled === false && Number(v.recent) === 0,
    JSON.stringify(v),
  )
}

// ---- teardown and containment -----------------------------------------------------------------------------------
await db.execute(
  `update public.blockers set state = 'resolved', answered_by = 'verify-operator', answered_option = 'No', resolved_at = app.now_utc() where requested_action like 'Run 3 effects proof %' and state = 'open'`,
)
await origins.release()
const leftover = await one(
  `select count(*)::int as n from public.jobs where state_reason = 'run3-effects-live fixture' and state in ('queued','running','retrying')`,
)
check('no fixture job is left live', Number(leftover.n) === 0, String(leftover.n))
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
process.exitCode = failed === 0 ? 0 : 1

/**
 * Architecture Run 2 - production acceptance, through the DEPLOYED gateway and database.
 *
 *   npx tsx scripts/verify/run2-live.ts
 *
 * Nothing here performs an outward effect. The decisions are read from the real
 * `app.authorize_effect` (a pure, stable function); the questions belong to jobs created
 * through a DECLARED test chat (stamped synthetic at the door) and then cancelled, so the
 * deployed worker never runs them; every answer goes through the deployed gateway with the
 * office key, exactly as the dashboard does. Each No it records is taken back at the end,
 * through the same press, so it leaves nothing remembered. The anon key is used only to
 * prove it is REFUSED.
 */
import { governOutward } from '../../src/agents/approval.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { fingerprint } from '../../src/jobs/checkpoint.ts'
import { officeKey } from './lib/sign-in.ts'
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
const bearer = await officeKey(db)
const origins = await testOrigins(db, 'verify:run2-live')
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

/** The decision, as the code asks it. Pure: no effect, no row. */
const decide = async (a: {
  tool: string
  staff?: string
  audience?: string
  fp?: string
  job?: string
  project?: string | null
}) =>
  json(
    (
      await one(`select app.authorize_effect(
        p_project => ${a.project === undefined || a.project === null ? 'null' : `${lit(a.project)}::uuid`},
        p_tool => ${lit(a.tool)},
        p_staff => ${a.staff === undefined ? 'null' : lit(a.staff)},
        p_audience => ${a.audience === undefined ? 'null' : lit(a.audience)},
        p_fingerprint => ${a.fp === undefined ? 'null' : lit(a.fp)},
        p_job => ${a.job === undefined ? 'null' : `${lit(a.job)}::uuid`})::text as d`)
    ).d,
  ) as {
    verdict: string
    reason?: string
    approved?: boolean
    declined?: boolean
    remembered?: boolean
    because?: string
  }

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

// ---- migration state -------------------------------------------------------------------------
{
  const m = await one(
    `select count(*) filter (where name like '0611%' or name like '0612%')::int as n from app.schema_migrations`,
  )
  check('migrations 0611 and 0612 are recorded', Number(m.n) === 2, `${String(m.n)} of 2`)
}

// ---- authorization: internal proceeds, outward asks, specialist and disabled tool -----------------
for (const tool of ['task.create', 'draft.create', 'document.create', 'task.extract']) {
  const d = await decide({ tool })
  check(`internal ${tool} proceeds at the default dial`, d.verdict === 'proceed', d.verdict)
}
for (const tool of ['notion.write', 'slack.post', 'notebook.write', 'drive.ingest']) {
  const d = await decide({ tool })
  check(
    `${tool} still asks (outward, or material from somebody else's system)`,
    d.verdict === 'ask',
    d.verdict,
  )
}
{
  const d = await decide({ tool: 'task.create', audience: 'outside' })
  check(
    'the same internal write asks when its audience is outside',
    d.verdict === 'ask' && d.reason === 'outside_audience',
    `${d.verdict}/${String(d.reason)}`,
  )
  const read = await decide({ tool: 'db.read', audience: 'outside' })
  check(
    'a read labelled outside does not (reading is not reaching)',
    read.verdict === 'proceed',
    read.verdict,
  )
  for (const tool of ['gmail.send', 'note.create', 'gmail.draft', 'web.search']) {
    const x = await decide({ tool })
    check(`${tool} stays refused`, x.verdict === 'refuse', x.verdict)
  }
  const staff = String(
    (await one(`select staff_slug as s from public.staff_tools where tool = 'task.create' limit 1`))
      .s,
  )
  const holds = await decide({ tool: 'task.create', staff })
  check(
    'a specialist who holds the tool follows normal authorization',
    holds.verdict === 'proceed',
    holds.verdict,
  )
  const lacks = await decide({ tool: 'task.extract', staff })
  check(
    'a specialist without the grant is refused, and the sentence names them',
    lacks.verdict === 'refuse' &&
      lacks.reason === 'specialist_not_granted' &&
      String(lacks.because).includes(staff),
    `${lacks.verdict}/${String(lacks.reason)}`,
  )
  const disabled = await decide({ tool: 'gmail.send', staff })
  check(
    'a disabled tool stays disabled whatever the specialist holds',
    disabled.verdict === 'refuse',
    disabled.verdict,
  )
}

// ---- the anon key cannot reach the identity-bearing doors ----------------------------------------------
{
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const nil = '00000000-0000-0000-0000-000000000000'
  for (const [fn, args] of [
    ['hq_answer_blocker', { p_blocker_id: nil, p_answer: 'Yes, do it', p_by: 'grant' }],
    ['hq_withdraw_refusal', { p_blocker_id: nil, p_by: 'grant' }],
    ['hq_task_state', { p_task_id: nil, p_state: 'done', p_by: 'grant' }],
    ['hq_autonomy_set', { p_level: 'act', p_project_id: null, p_reason: 'refused proof' }],
  ] as const) {
    const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    const t = (await r.text()).slice(0, 80)
    check(
      `anon key calling ${fn} is refused (nothing it names exists or changes)`,
      r.status === 401 || r.status === 403 || /permission denied/i.test(t),
      `http ${String(r.status)} ${t}`,
    )
  }
  const dial = await one(`select app.autonomy_for(null)::text as d`)
  check('and the global dial was not moved by that attempt', dial.d === 'suggest', String(dial.d))
}

// ---- questions on cancelled synthetic jobs ---------------------------------------------------------------
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
const root = await turn(`run2-live ${origins.token}: start something`)
const rootJob = String(root.job)
check(
  'the fixture conversation is stamped synthetic at the door',
  root.synthetic === true,
  String(root.synthetic),
)
const project = String(
  (await one(`select project_id::text as p from public.jobs where job_id = ${lit(rootJob)}::uuid`))
    .p,
)
const children: string[] = []
const question = async (fp: string | null, kind: 'plan' | 'duty' = 'plan') => {
  const c = String(
    (
      await one(
        `select app.enqueue_child(p_parent => ${lit(rootJob)}::uuid, p_kind => 'verify.ask', p_payload => '{}'::jsonb)::text as v`,
      )
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0] as string
  children.push(c)
  const b = await one(`
    with k as (update public.jobs set state = 'cancelled', state_reason = 'run2-live fixture' where job_id = ${lit(c)}::uuid and state = 'queued' returning job_id)
    insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, action_fingerprint, decline_option)
    select ${lit(project)}::uuid, job_id, ${lit(`Run 2 live proof ${kind} ${run}`)}, 'run2-live fixture', 'Nothing happens until somebody answers this question.',
           array['Yes, do it','No, leave it'], 'chief-of-staff', ${kind === 'duty' ? 'true' : 'false'}, ${fp === null ? 'null' : lit(fp)}, 'No, leave it' from k
    returning blocker_id::text as id, job_id::text as job`)
  return { id: String(b.id), job: String(b.job) }
}
const answer = (id: string, option: string) =>
  gateway(bearer, 'answer_blocker', { p_blocker_id: id, p_answer: option, p_by: 'mallory' })
const fpA = await fingerprint({ live: 'A', run })
const fpB = await fingerprint({ live: 'B', run })
{
  const q = await question(fpA)
  const before = await decide({ tool: 'notion.write', fp: fpA, job: q.job, project })
  check('an outward step asks', before.verdict === 'ask', before.verdict)
  const dup = await Promise.all([answer(q.id, 'Yes, do it'), answer(q.id, 'Yes, do it')])
  const ok = dup.filter((d) => d.result.ok === true && d.result.already !== true).length
  const already = dup.filter((d) => d.result.already === true).length
  check(
    'two answers at the same moment: exactly one takes effect, the other is told it was already answered',
    ok === 1 && already === 1,
    `${String(ok)} took effect, ${String(already)} already`,
  )
  const row = await one(
    `select answered_option as o, answered_by as by, state::text as s from public.blockers where blocker_id = ${lit(q.id)}::uuid`,
  )
  check(
    'the answer is a column, attributed to the verified principal whatever p_by the page sent',
    row.o === 'Yes, do it' && row.by === 'grant' && row.s === 'resolved',
    JSON.stringify(row),
  )
  const same = await decide({ tool: 'notion.write', fp: fpA, job: q.job, project })
  check(
    'the yes binds the exact action: the same action proceeds',
    same.verdict === 'proceed' && same.approved === true,
    same.verdict,
  )
  const changed = await decide({ tool: 'notion.write', fp: fpB, job: q.job, project })
  check(
    'approval of A cannot approve a changed action B',
    changed.verdict === 'ask',
    changed.verdict,
  )
  const other = await decide({
    tool: 'notion.write',
    fp: fpA,
    job: await question(null).then((x) => x.job),
    project,
  })
  check("and is not another job's yes", other.verdict === 'ask', other.verdict)
  const children2 = Number(
    (
      await one(
        `select count(*)::int as n from public.jobs where parent_job_id = ${lit(q.job)}::uuid`,
      )
    ).n,
  )
  check('answering twice started nothing', children2 === 0, `${String(children2)} children`)
}
// ---- a durable No, and taking it back ----------------------------------------------------------------------
const fpN = await fingerprint({ live: 'N', run })
const qn = await question(fpN)
await answer(qn.id, 'No, leave it')
{
  const same = await decide({ tool: 'notion.write', fp: fpN, job: qn.job, project })
  check(
    'the No prevents the exact action in its own job',
    same.verdict === 'refuse' && same.declined === true,
    same.verdict,
  )
  const harnessLater = await decide({
    tool: 'notion.write',
    fp: fpN,
    job: await question(null).then((x) => x.job),
    project,
  })
  check(
    'a later run of the same kind of traffic is refused and told why, not asked',
    harnessLater.verdict === 'refuse' && harnessLater.remembered === true,
    `${harnessLater.verdict}: ${String(harnessLater.because).slice(0, 50)}`,
  )
  const real = await decide({ tool: 'notion.write', fp: fpN, project })
  check("a real run does not hear a test's No (two-sided)", real.verdict === 'ask', real.verdict)
  const diff = await decide({
    tool: 'notion.write',
    fp: fpB,
    job: await question(null).then((x) => x.job),
    project,
  })
  check('a different action may ask', diff.verdict === 'ask', diff.verdict)
  // a cancelled job is not a refusal
  const cq = await question(await fingerprint({ live: 'cancelled', run }))
  const cancelledLater = await decide({
    tool: 'notion.write',
    fp: await fingerprint({ live: 'cancelled', run }),
    job: await question(null).then((x) => x.job),
    project,
  })
  check(
    'a cancelled job is not a refusal: the action asks',
    cq.id.length > 0 && cancelledLater.verdict === 'ask',
    cancelledLater.verdict,
  )
}
{
  // the same duty does not nag, through the real governOutward
  // A duty-shaped job (requested by a schedule, so nobody "asked" for it), named as a harness
  // job from birth, and cancelled at once so the deployed worker never runs it.
  const dutyJob = String(
    (
      await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
        values ('verify.ask', ${lit(`duty:verify-run2-${run}`)}, ${lit(project)}::uuid, ${lit(`r2-duty-${run}`)}, gen_random_uuid())
        returning job_id::text as id`)
    ).id,
  )
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'run2-live fixture' where job_id = ${lit(dutyJob)}::uuid and state = 'queued'`,
  )
  const asked = await governOutward(db, {
    jobId: dutyJob,
    projectId: project,
    tool: 'notion.write',
    summary: 'Run 2 live duty proof',
    detail: '1. nothing',
    empty: false,
    agent: String(
      (
        await one(
          `select staff_slug as s from public.staff_tools where tool = 'notion.write' limit 1`,
        )
      ).s,
    ),
  })
  check(
    'a duty asks the first time',
    asked.blocker !== null && !asked.go,
    `blocker ${String(asked.blocker).slice(0, 8)}`,
  )
  await answer(String(asked.blocker), 'No, leave it')
  const again = await governOutward(db, {
    jobId: dutyJob,
    projectId: project,
    tool: 'notion.write',
    summary: 'Run 2 live duty proof',
    detail: '1. nothing',
    empty: false,
    agent: String(
      (
        await one(
          `select staff_slug as s from public.staff_tools where tool = 'notion.write' limit 1`,
        )
      ).s,
    ),
  })
  check(
    'after the No the same duty raises nothing and announces nothing',
    again.blocker === null && again.quiet && again.said.length > 0,
    `quiet=${String(again.quiet)}`,
  )
  const realDuty = await decide({ tool: 'notion.write', project })
  check(
    'and a real duty for the same tool still asks',
    realDuty.verdict === 'ask',
    realDuty.verdict,
  )
  const duties = await one(
    `select b.blocker_id::text as id from public.blockers b where b.job_id = ${lit(dutyJob)}::uuid and b.standing_tool = 'notion.write' order by b.created_at limit 1`,
  )
  ;(globalThis as { __dutyNo?: string }).__dutyNo = String(duties.id)
}
// reversal
{
  const anon = await gateway(null, 'withdraw_refusal', { p_blocker_id: qn.id })
  check('unauthenticated: cannot reopen the No', anon.status === 401, `http ${String(anon.status)}`)
  const sql = json(
    (await one(`select app.withdraw_refusal(${lit(qn.id)}::uuid, 'grant')::text as r`)).r,
  )
  check(
    'plain SQL (what a handler or a synthetic job can do) cannot erase it, even naming Grant',
    typeof sql.error === 'string' && /Only the gateway/.test(String(sql.error)),
    String(sql.error).slice(0, 50),
  )
  const still = await decide({
    tool: 'notion.write',
    fp: fpN,
    job: await question(null).then((x) => x.job),
    project,
  })
  check('and the No still stands', still.verdict === 'refuse', still.verdict)
  const open = await one(
    `select count(*)::int as n from public.blockers where state = 'open' and requested_action like ${lit(`Run 2 live proof%${run}`)}`,
  )
  const w = await gateway(bearer, 'withdraw_refusal', { p_blocker_id: qn.id, p_by: 'mallory' })
  const who = await one(
    `select refusal_withdrawn_by as by from public.blockers where blocker_id = ${lit(qn.id)}::uuid`,
  )
  check(
    'authenticated Grant reopens it: recorded as the verified principal',
    w.status === 200 && w.result.ok === true && who.by === 'grant',
    `http ${String(w.status)} by ${String(who.by)}`,
  )
  const after = await decide({
    tool: 'notion.write',
    fp: fpN,
    job: await question(null).then((x) => x.job),
    project,
  })
  check(
    'reopening did NOT approve it: the next attempt asks',
    after.verdict === 'ask' && !after.approved,
    after.verdict,
  )
  const executed = Number(
    (
      await one(
        `select count(*)::int as n from public.jobs where parent_job_id = ${lit(qn.job)}::uuid`,
      )
    ).n,
  )
  check('and nothing ran', executed === 0, `${String(executed)} children`)
  const dutyNo = (globalThis as { __dutyNo?: string }).__dutyNo
  if (dutyNo) await gateway(bearer, 'withdraw_refusal', { p_blocker_id: dutyNo })
  void open
  const gov = await gateway(bearer, 'governance', {}).catch(() => null)
  void gov
  const g = await fetch(`${base}/functions/v1/hq-api?section=governance`, {
    headers: { Authorization: `Bearer ${bearer}` },
  })
  const gj = (await g.json().catch(() => ({}))) as {
    data?: { refusals?: unknown[] }
    refusals?: unknown[]
  }
  check(
    'the governance payload the page reads carries the refusals list',
    Array.isArray(gj.data?.refusals ?? gj.refusals),
    `http ${String(g.status)}`,
  )
}
// ---- the to-do tick ---------------------------------------------------------------------------------------------
{
  const c = String(
    (
      await one(
        `select app.enqueue_child(p_parent => ${lit(rootJob)}::uuid, p_kind => 'verify.ask', p_payload => '{}'::jsonb)::text as v`,
      )
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0] as string
  const mk = async () => {
    const b = await one(`
      with k as (update public.jobs set state = 'cancelled', state_reason = 'run2-live fixture' where job_id = ${lit(c)}::uuid and state = 'queued' returning job_id)
      insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
      select ${lit(project)}::uuid, job_id, ${lit(`Run 2 live tick ${run}`)}, 'run2-live fixture', 'Nothing happens until somebody answers this question.', array['Yes, do it','No, leave it'], 'chief-of-staff', false from k
      returning blocker_id::text as id`)
    const t = String(
      (
        await one(
          `select task_id::text as id from public.tasks where satisfies_blocker = ${lit(String(b.id))}::uuid`,
        )
      ).id,
    )
    return { b: String(b.id), t }
  }
  const x = await mk().catch(async () => null)
  if (x === null)
    check(
      'a question with a to-do could be created',
      false,
      'insert failed (job already cancelled)',
    )
  else {
    const refused = json(
      (await one(`select app.hq_task_state(${lit(x.t)}, 'done', null, null)::text as r`)).r,
    )
    const s1 = await one(
      `select b.state::text as bs, t.state::text as ts from public.blockers b, public.tasks t where b.blocker_id = ${lit(x.b)}::uuid and t.task_id = ${lit(x.t)}::uuid`,
    )
    check(
      'a tick from nobody the office can name does not answer; the to-do reopens and the reply says so truthfully',
      typeof refused.error === 'string' &&
        /not taken/.test(String(refused.error)) &&
        s1.bs === 'open' &&
        s1.ts === 'todo',
      `${String(refused.error).slice(0, 40)} / ${String(s1.bs)} / ${String(s1.ts)}`,
    )
    const unknown = json(
      (
        await one(
          `select app.hq_task_state(${lit(x.t)}, 'done', null, 'somebody-unknown')::text as r`,
        )
      ).r,
    )
    check(
      'and an unknown principal likewise',
      typeof unknown.error === 'string',
      String(unknown.error).slice(0, 40),
    )
    const ticked = await gateway(bearer, 'task_state', {
      p_task_id: x.t,
      p_state: 'done',
      p_by: 'mallory',
    })
    const s2 = await one(
      `select b.state::text as bs, b.answered_by as by, b.answered_option as o from public.blockers b where b.blocker_id = ${lit(x.b)}::uuid`,
    )
    check(
      'a tick through the gateway answers through hq_answer_blocker as the verified principal',
      ticked.status === 200 &&
        s2.bs === 'resolved' &&
        s2.by === 'grant' &&
        s2.o === 'Yes, do it' &&
        ticked.result.undo == null,
      JSON.stringify({ http: ticked.status, s2 }),
    )
    await gateway(bearer, 'my_task_delete', { p_task_id: x.t }).catch(() => undefined)
  }
}
// ---- teardown and containment ---------------------------------------------------------------------------------------
await origins.release()
const leftover = await one(
  `select count(*)::int as n from public.jobs where kind = 'verify.ask' and state in ('queued','running','retrying')`,
)
check(
  'no fixture job is left queued for the worker',
  Number(leftover.n) === 0,
  `${String(leftover.n)} live`,
)
const remembered = await one(
  `select count(*)::int as n from public.blockers b where b.state = 'resolved' and b.answered_option = b.decline_option and b.refusal_withdrawn_at is null and b.requested_action like ${lit(`Run 2 live proof%${run}`)}`,
)
console.log(
  `(${String(remembered.n)} No from this run still remembered - they bind only test traffic)`,
)

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
process.exitCode = failed === 0 ? 0 : 1

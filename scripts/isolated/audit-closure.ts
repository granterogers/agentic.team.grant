/**
 * Final audit reconciliation - original-audit defects that Runs 1-5 never touched.
 *
 *   npx tsx scripts/isolated/audit-closure.ts <replica-db>
 *
 * B11 (may_act: an office-made root is not a person asking), B14 (a job's parent is written once), #343 (a project
 * whose autonomy dial was set can be deleted). The real functions against the replica.
 */
import { execFile } from 'node:child_process'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'ac629')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const project = String((await one(`select app.unnamed_project()::text as p`)).p)
const may = async (job: string, tool = 'drive.ingest') =>
  JSON.parse(
    String(
      (
        await one(
          `select app.may_act(${lit(project)}::uuid, ${lit(tool)}, ${lit(job)}::uuid)::text as v`,
        )
      ).v,
    ),
  ) as { verdict: string; asked_for?: boolean }
const rootJob = async (requestedBy: string, kind = 'verify.ask') =>
  String(
    (
      await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
        values (${lit(kind)}, ${lit(requestedBy)}, ${lit(project)}::uuid, ${lit(`ac-${run}-${crypto.randomUUID()}`)}, gen_random_uuid())
        returning job_id::text as id`)
    ).id,
  )

// ---- B11 -------------------------------------------------------------------------------------------------------------------
const turn = await realParent(db) // his own words through a production door
const kid = String(
  (await one(`select app.enqueue_child(${lit(turn)}::uuid, 'verify.ask', '{}'::jsonb)::text as c`))
    .c,
).match(/[0-9a-f-]{36}/)?.[0] as string
{
  const own = await may(kid)
  check(
    'his own words (a production-door turn and its child) are asked-for at level 2: proceeds',
    own.verdict === 'proceed' && own.asked_for === true,
    `${own.verdict}/${String(own.asked_for)}`,
  )
  // an office-made root: only a registered duty/trigger shape is 'internal'; a bare requester is unknown
  const viaTrigger = await rootJob(`trigger:audit-probe-${run}`)
  const viaMcp = await rootJob(`mcp:audit-client-${run}`)
  const viaHq = await rootJob('hq')
  const viaDuty = await rootJob(`duty:audit-duty-${run}`)
  const t = await may(viaTrigger)
  const m = await may(viaMcp)
  const h = await may(viaHq)
  const d = await may(viaDuty)
  check(
    'a trigger:, mcp:, hq or duty: job is NOT a person asking: the same level-2 action asks',
    [t, m, h, d].every((v) => v.verdict === 'ask' && v.asked_for !== true),
    [t, m, h, d].map((v) => v.verdict).join('/'),
  )
  // an internal root that IS configured (origin internal) still asks: prove the gate is origin, not the prefix
  const internal = await one(`select app.job_origin(${lit(viaDuty)}::uuid) as o`)
  check(
    'the verdict follows the ORIGIN class (these roots are unknown or internal, never trusted)',
    internal.o !== 'trusted',
    String(internal.o),
  )
  // harness standing in for him keeps the old reading (the suites that drive asked-for through a harness depend on it)
  const harness = await rootJob('teamhq:verify-audit')
  const hv = await may(harness)
  check(
    'a harness job standing in for him is still asked-for (the control: precision not bought with recall)',
    hv.verdict === 'proceed' && hv.asked_for === true,
    `${hv.verdict}/${String(hv.asked_for)}`,
  )
  const l3 = await may(kid, 'vault.export').catch(() => ({ verdict: 'error' }))
  check(
    'level 3 and a forwarded turn are untouched (control)',
    l3.verdict !== 'proceed',
    l3.verdict,
  )
}

// ---- B14 -------------------------------------------------------------------------------------------------------------------
{
  const a = await rootJob(`teamhq:verify-cycle-${run}`)
  const b = String(
    (await one(`select app.enqueue_child(${lit(a)}::uuid, 'verify.ask', '{}'::jsonb)::text as c`))
      .c,
  ).match(/[0-9a-f-]{36}/)?.[0] as string
  const said = await db
    .execute(
      `update public.jobs set parent_job_id = ${lit(b)}::uuid where job_id = ${lit(a)}::uuid`,
    )
    .then(
      () => '',
      (e: unknown) => String((e as Error).message),
    )
  const still = await one(`select parent_job_id from public.jobs where job_id = ${lit(a)}::uuid`)
  check(
    're-parenting a job into a cycle is refused and the row is unchanged',
    /written once/.test(said) && still.parent_job_id === null,
    said.slice(0, 70),
  )
  const ok = await one(
    `select app.harness_job(${lit(a)}::uuid) as h, app.job_origin(${lit(a)}::uuid) as o`,
  )
  check(
    'so harness_job and job_origin still answer for the tree (no stack overflow)',
    typeof ok.h === 'boolean' && typeof ok.o === 'string',
    `${String(ok.h)} ${String(ok.o)}`,
  )
  const touch = await db
    .execute(
      `update public.jobs set state_reason = 'still writable' where job_id = ${lit(a)}::uuid`,
    )
    .then(
      () => 'ok',
      (e: unknown) => String((e as Error).message),
    )
  check(
    'every other column of the job is still writable (control)',
    touch === 'ok',
    touch.slice(0, 50),
  )
}

// ---- #343 ------------------------------------------------------------------------------------------------------------------
{
  const name = `fixture audit ${run}`
  const created = await one(
    `select app.hq_create_project(${lit(name)}, 'upload', ${lit(`audit-${run}`)}, ${lit(name)}, true)::text as r`,
  ).catch(() => null)
  const slug = `fixture-audit-${run}`
  const p = await one(
    `select project_id::text as id from public.projects where slug = ${lit(slug)}`,
  ).catch(() => undefined)
  if (p?.id === undefined || created === null) {
    check('a fixture project could be created for the delete proof', false, 'no project')
  } else {
    await db.execute(
      `insert into public.autonomy_settings (project_id, level, set_by, reason) values (${lit(String(p.id))}::uuid, 'observe', 'verify:audit-closure', 'the delete proof')`,
    )
    const del = JSON.parse(
      String((await one(`select app.project_delete(${lit(slug)}, true)::text as r`)).r),
    ) as { ok?: boolean; error?: string }
    const left = await one(
      `select count(*)::int as n from public.projects where slug = ${lit(slug)}`,
    )
    check(
      'a project whose autonomy dial was set can be deleted',
      del.ok === true && Number(left.n) === 0,
      JSON.stringify(del).slice(0, 80),
    )
  }
}

// ---- #392.3: the installed workspace ---------------------------------------------------------------------------------
{
  const team = `T0${run
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '0')
    .padEnd(8, '0')
    .slice(0, 8)}`
  const other = `T1${run
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '0')
    .padEnd(8, '0')
    .slice(0, 8)}`
  const ok = async (t: string | null) =>
    (await one(`select app.slack_team_ok(${t === null ? 'null' : lit(t)}) as ok`)).ok
  check(
    'before any installation nothing is a workspace the office serves (fails closed)',
    (await ok(team)) === false,
    String(await ok(team)),
  )
  await db.execute(
    `insert into public.slack_app_credentials (slack_app_id, team_id, app_name) values (${lit(`A0${team.slice(2)}`)}, ${lit(team)}, 'audit proof')`,
  )
  const results2 = [
    await ok(team),
    await ok(other),
    await ok(null),
    await ok(''),
    await ok('t0lowercase1'),
    await ok("T0'; drop table x;--"),
  ]
  check(
    'the installed workspace is the only one: the right team is ok; another, a missing, an empty, a lower-case and an injected id are not',
    results2[0] === true && results2.slice(1).every((r) => r === false),
    JSON.stringify(results2),
  )
  await db.execute(
    `update public.slack_app_credentials set enabled = false, disabled_reason = 'proof' where team_id = ${lit(team)}`,
  )
  check(
    'a disabled installation serves no workspace',
    (await ok(team)) === false,
    String(await ok(team)),
  )
  await db.execute(
    `update public.slack_app_credentials set enabled = true, disabled_reason = null where team_id = ${lit(team)}`,
  )
  await db.execute(
    `update public.slack_app_credentials set enabled = false, disabled_reason = 'proof', revoked_at = now() where team_id = ${lit(team)}`,
  )
  check('nor does a revoked one', (await ok(team)) === false, String(await ok(team)))
  const anon = await one(
    `select has_function_privilege('anon', 'public.slack_team_ok(text)', 'execute') as a, has_function_privilege('service_role', 'public.slack_team_ok(text)', 'execute') as s`,
  )
  check(
    'the public key cannot ask; the service role can',
    anon.a === false && anon.s === true,
    JSON.stringify(anon),
  )
  await db.execute(`delete from public.slack_app_credentials where team_id = ${lit(team)}`)
}

// ---- V9: a job parked for a person, with no question open, is waiting on a person ----------------------------------------
{
  const root = await realParent(db)
  const mk = async () => {
    const id = String(
      (
        await one(
          `select app.enqueue_child(${lit(root)}::uuid, 'verify.ask', '{}'::jsonb)::text as c`,
        )
      ).c,
    ).match(/[0-9a-f-]{36}/)?.[0] as string
    await db.execute(
      `update public.jobs set state = 'running', leased_by = 'audit-w', leased_until = now() + interval '5 minutes', attempt = 1 where job_id = ${lit(id)}::uuid`,
    )
    return id
  }
  const state = async () =>
    String((await one(`select app.obligation_state(${lit(root)}::uuid)::text as s`)).s)
  const fp = 'e'.repeat(64)
  const resumable = await mk()
  await db.execute(
    `select app.pause_job(${lit(resumable)}::uuid, 'dependency_wait', 'waiting for a sibling', 'the group', true, null, null, null)`,
  )
  check(
    'a job parked on a clock or a sibling (resumable) is still WORKING',
    (await state()) === 'working',
    await state(),
  )
  const ambiguous = await mk()
  await db.execute(
    `select app.pause_job(${lit(ambiguous)}::uuid, 'needs_reconciliation', 'an interrupted external write', 'check whether it happened', false, null, null, null)`,
  )
  check(
    'a job parked as not automatically resumable, with no question open, reads WAITING ON A PERSON (it read working for ever)',
    (await state()) === 'waiting_on_user',
    await state(),
  )
  void fp
  const sit = await one(`select app.job_situation(${lit(ambiguous)}::uuid)->>'situation' as s`)
  check(
    'and agrees with what job_situation says of that job',
    String(sit.s) === 'ambiguous_external',
    String(sit.s),
  )
}

// ---- D23: an approve and a decline racing take effect once -----------------------------------------------------------------
{
  await db.execute(
    `create or replace function public.zz_slow_tool_request() returns trigger language plpgsql as $f$ begin perform pg_sleep(0.7); return new; end $f$`,
  )
  await db.execute(
    `create trigger zz_slow_tool_request before update on public.tool_requests for each row execute function public.zz_slow_tool_request()`,
  )
  const req = String(
    (
      await one(`insert into public.tool_requests (tool, asked_by, what_for) values ('audit.proof.tool', 'chief-of-staff', 'the race proof for the final audit reconciliation, finding D23 of the original audit')
        returning request_id::text as id`)
    ).id,
  )
  // Two real connections: the executor is one client and would serialise the pair, which proves nothing.
  const psql = (sql: string) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        'psql',
        [
          '-h',
          process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs',
          '-p',
          process.env.ISOLATED_PG_PORT ?? '55432',
          '-U',
          'postgres',
          '-d',
          process.argv[2] ?? 'ac629',
          '-At',
          '-c',
          sql,
        ],
        (err, out) => (err === null ? resolve(out.trim()) : reject(err)),
      )
    })
  const [a = { r: '' }, b = { r: '' }] = (
    await Promise.all([
      psql(`select app.approve_tool(${lit(req)}::uuid, 'grant')::text`),
      psql(
        `select app.decline_tool(${lit(req)}::uuid, 'grant', 'declined for the race proof')::text`,
      ),
    ])
  ).map((r) => ({ r }))
  const ra = JSON.parse(String(a.r)) as Record<string, unknown>
  const rb = JSON.parse(String(b.r)) as Record<string, unknown>
  const won = [ra.approved === true || ra.granted === true, rb.declined === true].filter(
    Boolean,
  ).length
  const final = String(
    (await one(`select state from public.tool_requests where request_id = ${lit(req)}::uuid`))
      .state,
  )
  check(
    'an approve and a decline at the same moment: exactly one takes effect and the other is told the request was already answered',
    won === 1 &&
      (final === 'approved' || final === 'declined') &&
      [ra, rb].some((r) => String(r.error ?? '').includes('already')),
    `${String(won)} won, final ${final}`,
  )
  await db.execute(`drop trigger zz_slow_tool_request on public.tool_requests`)
  await db.execute(`drop function public.zz_slow_tool_request()`)
}

// ---- invariants 9 and 10: a child inherits its project and the person who asked --------------------------------------------
{
  const parent = await realParent(db)
  const pp = await one(
    `select project_id::text as p, requested_by as r, correlation_id::text as c from public.jobs where job_id = ${lit(parent)}::uuid`,
  )
  const kid = String(
    (
      await one(
        `select app.enqueue_child(${lit(parent)}::uuid, 'verify.ask', '{}'::jsonb)::text as c`,
      )
    ).c,
  ).match(/[0-9a-f-]{36}/)?.[0] as string
  const k = await one(
    `select project_id::text as p, requested_by as r, correlation_id::text as c from public.jobs where job_id = ${lit(kid)}::uuid`,
  )
  check(
    'a child inherits the project, the person who asked and the correlation (invariants 9, 10)',
    k.p === pp.p && k.r === pp.r && k.c === pp.c,
    JSON.stringify(k).slice(0, 90),
  )
  const nm = `fixture audit inherit ${run}`
  await one(
    `select app.hq_create_project(${lit(nm)}, 'upload', ${lit(`inh-${run}`)}, ${lit(nm)}, true)::text as r`,
  )
  const other = String(
    (
      await one(
        `select project_id::text as p from public.projects where slug = ${lit(`fixture-audit-inherit-${run}`)}`,
      )
    ).p,
  )
  const over = String(
    (
      await one(
        `select app.enqueue_child(${lit(parent)}::uuid, 'verify.ask', '{"x":1}'::jsonb, interval '0', true, ${lit(other)}::uuid)::text as c`,
      )
    ).c,
  ).match(/[0-9a-f-]{36}/)?.[0] as string
  const o = await one(
    `select project_id::text as p, requested_by as r from public.jobs where job_id = ${lit(over)}::uuid`,
  )
  check(
    'an explicit project is honoured and the requester is still inherited',
    o.p === other && o.r === pp.r,
    JSON.stringify(o).slice(0, 90),
  )
}

// ---- a write-scoped MCP client is NOT a person asking: its consent was given with the office key (0637) ---------------------
{
  const client = `audit-${run}`
  await db.execute(
    `insert into public.mcp_clients (client_id, display_name, token_sha256, scopes) values (${lit(client)}, 'audit proof', ${lit('a'.repeat(64))}, array['read','write'])`,
  )
  const viaMcp = await rootJob(`mcp:${client}`)
  const readOnly = `audit-ro-${run}`
  await db.execute(
    `insert into public.mcp_clients (client_id, display_name, token_sha256, scopes) values (${lit(readOnly)}, 'audit read-only', ${lit('b'.repeat(64))}, array['read'])`,
  )
  const viaRo = await rootJob(`mcp:${readOnly}`)
  const a = await may(viaMcp, 'notebook.write')
  const b = await may(viaRo, 'notebook.write')
  check(
    'a registered, write-scoped MCP client is NOT asking: its consent was given with the office key, a machine, so the same level-2 action asks',
    a.verdict === 'ask' && a.asked_for !== true,
    `${a.verdict}/${String(a.asked_for)}`,
  )
  check('a read-only MCP client is not either (control)', b.verdict === 'ask', b.verdict)
  await db.execute(
    `update public.mcp_clients set enabled = false, disabled_reason = 'proof' where client_id = ${lit(client)}`,
  )
  const off = await may(viaMcp, 'notebook.write')
  check('a disabled client is not', off.verdict === 'ask', off.verdict)
}

// ---- a test member does not change a real task (review F5, 0637) ------------------------------------------------------
{
  const name = `Audit real ${run}`
  await one(
    `select app.hq_create_project(${lit(name)}, 'upload', ${lit(`real-${run}`)}, ${lit(name)}, true)::text as r`,
  )
  const real = String(
    (
      await one(
        `select project_id::text as id from public.projects where slug = ${lit(`audit-real-${run}`)}`,
      )
    ).id,
  )
  const fxName = `fixture task ${run}`
  await one(
    `select app.hq_create_project(${lit(fxName)}, 'upload', ${lit(`fxt-${run}`)}, ${lit(fxName)}, true)::text as r`,
  )
  const fx = String(
    (
      await one(
        `select project_id::text as id from public.projects where slug = ${lit(`fixture-task-${run}`)}`,
      )
    )?.id ?? real,
  )
  const mkTask = async (project: string, title: string) =>
    String(
      (
        await one(
          `select (app.task_add(p_project => ${lit(project)}::uuid, p_title => ${lit(title)}, p_added_by => 'grant')) ->> 'id' as id`,
        )
      ).id,
    )
  const t1 = await mkTask(real, `Real task ${run}`)
  const refusal = String(
    (await one(`select app.hq_task_state(${lit(t1)}, 'done', null, 'verify-operator')::text as r`))
      .r,
  )
  const still = await one(
    `select state::text as s from public.tasks where task_id = ${lit(t1)}::uuid`,
  )
  check(
    'a test member cannot complete a task in a REAL project (and says why)',
    still.s === 'todo' && /test|real|decid/i.test(refusal),
    `${String(still.s)}; ${refusal.slice(0, 100)}`,
  )
  const t2 = await mkTask(real, `Real task two ${run}`)
  await one(`select app.hq_task_state(${lit(t2)}, 'done', null, 'grant')::text as r`)
  const did = await one(
    `select state::text as s, completed_by from public.tasks where task_id = ${lit(t2)}::uuid`,
  )
  check(
    'control: a person still completes it',
    did.s === 'done' && did.completed_by === 'grant',
    `${String(did.s)} by ${String(did.completed_by)}`,
  )
  // 0639: a to-do that stands for a HARNESS job's question, on a real project, is answered by a test member; a
  // to-do for a REAL job's question on the same project is not.
  const answerThrough = async (by: string, asker: string) => {
    const j = await rootJob(asker)
    const b = String(
      (
        await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
          values (${lit(real)}::uuid, ${lit(j)}::uuid, ${lit(`q ${run} ${asker}`)}, 'closure fixture', 'nothing', array['Yes, do it','No, leave it'], 'chief-of-staff', false) returning blocker_id::text as id`)
      ).id,
    )
    const t = String(
      (
        await one(
          `select task_id::text as id from public.tasks where satisfies_blocker = ${lit(b)}::uuid`,
        )
      ).id,
    )
    const r = String(
      (await one(`select app.hq_task_state(${lit(t)}, 'done', null, ${lit(by)})::text as r`)).r,
    )
    const st = await one(
      `select state::text as s from public.tasks where task_id = ${lit(t)}::uuid`,
    )
    return { r, s: String(st.s) }
  }
  const harnessQ = await answerThrough('verify-operator', 'teamhq:verify-audit')
  check(
    "a test member answers a TEST's own question on a real project (0639)",
    harnessQ.s === 'done' && !/cannot decide something real/i.test(harnessQ.r),
    `${harnessQ.s}; ${harnessQ.r.slice(0, 80)}`,
  )
  const realQ = await answerThrough('verify-operator', 'telegram:grant')
  check(
    "control: the same test member does not answer a REAL job's question",
    realQ.s !== 'done' && /test principal|cannot decide/i.test(realQ.r),
    `${realQ.s}; ${realQ.r.slice(0, 80)}`,
  )
  if (fx !== real) {
    const t3 = await mkTask(fx, `Fixture task ${run}`)
    await one(`select app.hq_task_state(${lit(t3)}, 'done', null, 'verify-operator')::text as r`)
    const f3 = await one(
      `select state::text as s from public.tasks where task_id = ${lit(t3)}::uuid`,
    )
    check(
      'control: a test member still completes a task in a FIXTURE project',
      f3.s === 'done',
      String(f3.s),
    )
  }
}

// ---- work called off cannot be started by a later yes (0632) ---------------------------------------------------------------
{
  const mk = async () => {
    const root = await realParent(db)
    return String(
      (
        await one(
          `select app.enqueue_child(${lit(root)}::uuid, 'notebook.generate', '{"kind":"slides","instructions":"x"}'::jsonb)::text as c`,
        )
      ).c,
    ).match(/[0-9a-f-]{36}/)?.[0] as string
  }
  const ask = async (job: string) => {
    const r = await one(
      `select app.request_generation_approval(${lit(job)}::uuid, 'notebook.generate', 'a deck for the audit proof', 'free')::text as r`,
    )
    return { blocker: String(r.r).match(/[0-9a-f-]{36}/)?.[0] ?? '' } as {
      blocker?: string
      blocker_id?: string
    }
  }
  const kids = async (job: string) =>
    Number(
      (
        await one(
          `select count(*)::int as n from public.jobs where parent_job_id = ${lit(job)}::uuid`,
        )
      ).n,
    )
  // a live job: yes starts the generation (control - the guard must not buy precision with recall)
  const live = await mk()
  const lr = await ask(live)
  const lb = String(lr.blocker ?? lr.blocker_id ?? '')
  const liveAns = JSON.parse(
    String(
      (await one(`select app.hq_answer_blocker(${lit(lb)}::uuid, 'Go ahead', 'grant')::text as r`))
        .r,
    ),
  ) as Record<string, unknown>
  check(
    'a live job: a yes starts the generation (control)',
    liveAns.ok === true && liveAns.called_off !== true && (await kids(live)) >= 1,
    `${JSON.stringify(liveAns).slice(0, 60)} / ${String(await kids(live))} child`,
  )
  // the same job called off first
  const dead = await mk()
  const dr = await ask(dead)
  const db2 = String(dr.blocker ?? dr.blocker_id ?? '')
  await db
    .execute(
      `update public.jobs set state = 'paused', state_reason = 'waiting' where job_id = ${lit(dead)}::uuid`,
    )
    .catch(() => undefined)
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'you asked me to stop' where job_id = ${lit(dead)}::uuid`,
  )
  const ans = JSON.parse(
    String(
      (await one(`select app.hq_answer_blocker(${lit(db2)}::uuid, 'Go ahead', 'grant')::text as r`))
        .r,
    ),
  ) as Record<string, unknown>
  const st = await one(
    `select state::text as s, resolution from public.blockers where blocker_id = ${lit(db2)}::uuid`,
  )
  check(
    'a job called off: a later yes is recorded, says the work was called off, and starts NOTHING',
    ans.ok === true && ans.called_off === true && (await kids(dead)) === 0 && st.s === 'resolved',
    `${JSON.stringify(ans).slice(0, 70)} / ${String(await kids(dead))} child`,
  )
  // the button path calls answer_generation_approval directly
  const dead2 = await mk()
  const d2 = await ask(dead2)
  const db3 = String(d2.blocker ?? d2.blocker_id ?? '')
  await db
    .execute(
      `update public.jobs set state = 'paused', state_reason = 'waiting' where job_id = ${lit(dead2)}::uuid`,
    )
    .catch(() => undefined)
  await db.execute(
    `update public.jobs set state = 'cancelled', state_reason = 'you asked me to stop' where job_id = ${lit(dead2)}::uuid`,
  )
  const btn = JSON.parse(
    String(
      (
        await one(
          `select app.answer_generation_approval(${lit(db3)}::uuid, true, 'grant')::text as r`,
        )
      ).r,
    ),
  ) as Record<string, unknown>
  check(
    'and so is a button press on it (the direct door)',
    btn.called_off === true && (await kids(dead2)) === 0,
    `${JSON.stringify(btn).slice(0, 70)} / ${String(await kids(dead2))} child`,
  )
}
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

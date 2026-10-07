/**
 * Run 3 (#386): an approval applies to exactly what it approved, and a handler that acts on one checks.
 *
 *   npx tsx scripts/isolated/approval-binding.ts <replica-db>
 *
 * The REAL `notebook.generate` and `office.execute_plan` handlers run against the replica. The only
 * thing faked is the notebook service: `fetch` to its address is answered by a stand-in that COUNTS what
 * was asked of it, so "what happened outside the office" is a number this test reads back. Everything
 * else - the approval question, the answer, the child job, the checkpoints, the policy - is the product.
 *
 * Positive controls: an honest approval starts exactly one generation and one plan. A suite of refusals
 * passes against a handler that refuses everything.
 */
import { notebookHandlers } from '../../src/handlers/notebook.ts'
import { planHandler } from '../../src/handlers/plan.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'
import { realParent } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'approvalbinding')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const count = async (sql: string) => Number((await one(sql)).c)
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

// ---- the notebook service, as a counter ----------------------------------------------------
const WRITER = 'http://notebook.invalid/act'
const calls: { action: string; args: Record<string, unknown> }[] = []
let mode: 'ok' | 'refuse' | 'quota' | 'drop' = 'ok'
let created = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url !== WRITER)
    throw new Error(`REFUSED: only the stand-in notebook may be reached, not ${url}`)
  const body = JSON.parse(String(init?.body ?? '{}')) as {
    action: string
    args: Record<string, unknown>
  }
  calls.push({ action: body.action, args: body.args })
  const reply = (v: unknown) =>
    new Response(JSON.stringify(v), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  if (body.action === 'artifacts') return reply({ ok: true, artifacts: [] })
  if (body.action === 'generate') {
    if (mode === 'drop') throw new Error('connection dropped')
    if (mode === 'refuse') return reply({ ok: false, error: 'the service said no' })
    if (mode === 'quota') return reply({ ok: false, error: 'usage limit reached', quota: true })
    return reply({ ok: true, task_id: `task-${String(calls.length)}`, state: 'started' })
  }
  if (body.action === 'add_url') {
    if (mode === 'drop') throw new Error('connection dropped')
    return reply({ ok: true, source_id: `src-${String(calls.length)}` })
  }
  if (body.action === 'create_notebook') {
    if (mode === 'drop') throw new Error('connection dropped')
    created += 1
    return reply({
      ok: true,
      notebook_id: `nb-${run}-${String(created)}`,
      title: String(body.args.title),
    })
  }
  return reply({ ok: true })
}) as typeof fetch
const did = (action: string) => calls.filter((c) => c.action === action).length

await db.execute(`insert into vault.secrets (name, secret) values ('notebook.storage_state', 'isolated-jar')
                  on conflict (name) do update set secret = excluded.secret`)
await db.execute(`insert into vault.secrets (name, secret) values ('notebook.reader_secret', 'isolated-reader')
                  on conflict (name) do update set secret = excluded.secret`)
await db.execute(`insert into public.system_config (key, value, description) values ('notebook.writer_url', to_jsonb(${lit(WRITER)}::text), 'isolated stand-in for the notebook writer')
                  on conflict (key) do update set value = excluded.value`)

// ---- fixtures ------------------------------------------------------------------------------------------
const projectWithNotebook = async (label: string): Promise<string> => {
  const name = `Binding ${label} ${run}`
  const made = json(
    (
      await one(
        `select app.hq_create_project(app.test_office(), ${lit(name)}, 'notebooklm', ${lit(`nb-fixture-${label}-${run}`)}, ${lit(name)}, true) as v`,
      )
    ).v,
  )
  const id = String(made.project_id)
  await db.execute(`update public.project_attachments set role = 'home', artifact_kind = 'artifact'
                     where project_id = ${lit(id)}::uuid and connector = 'notebooklm'`)
  return id
}
const project = await projectWithNotebook('main')
const jobRow = async (
  p: string,
  kind: string,
  config: Record<string, unknown>,
  by = 'telegram:grant',
  parent: string | null = null,
): Promise<Job> => {
  // Grant's own work is a child of a real adapter turn (#379, and B11 of the original audit): a hand-inserted root
  // that merely NAMES telegram:grant is an origin no production component creates, and "a person asked" is no longer
  // read off the name.
  if (by === 'telegram:grant') {
    const hangOn = parent ?? (await realParent(db))
    const hung = await one(
      `select app.enqueue_child(app.job_office(${lit(hangOn)}::uuid), ${lit(hangOn)}::uuid, ${lit(kind)}, ${lit(JSON.stringify(config))}::jsonb, interval '0', true, ${lit(p)}::uuid)::text as id`,
    )
    const id = String(hung.id).match(/[0-9a-f-]{36}/)?.[0] as string
    const row = await one(
      `select correlation_id::text as cid, idempotency_key as k from public.jobs where job_id = ${lit(id)}::uuid`,
    )
    return {
      jobId: id,
      kind,
      correlationId: String(row.cid),
      projectId: p,
      idempotencyKey: String(row.k),
      attempt: 1,
    }
  }
  const r =
    await one(`insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id, pinned_config, parent_job_id)
      values (app.test_office(), ${lit(kind)},${lit(by)}, ${lit(p)}::uuid, 'ab-' || gen_random_uuid(), gen_random_uuid(),
              ${lit(JSON.stringify(config))}::jsonb, ${parent === null ? 'null' : `${lit(parent)}::uuid`})
      returning job_id::text as id, correlation_id::text as cid, idempotency_key as k`)
  return {
    jobId: String(r.id),
    kind,
    correlationId: String(r.cid),
    projectId: p,
    idempotencyKey: String(r.k),
    attempt: 1,
  }
}
const asJob = async (id: string): Promise<Job> => {
  const r = await one(
    `select kind, correlation_id::text as cid, project_id::text as p, idempotency_key as k from public.jobs where job_id = ${lit(id)}::uuid`,
  )
  return {
    jobId: id,
    kind: String(r.kind),
    correlationId: String(r.cid),
    projectId: String(r.p),
    idempotencyKey: String(r.k),
    attempt: 1,
  }
}
const generate = notebookHandlers(db).find((h) => h.kind === 'notebook.generate')
const addSource = notebookHandlers(db).find((h) => h.kind === 'notebook.add_source')
const plan = planHandler(db)
if (generate === undefined || addSource === undefined) throw new Error('no notebook handlers')
const blockerOf = async (job: string) =>
  await one(
    `select blocker_id::text as id, action_fingerprint as fp, decline_option as d, state::text as s from public.blockers where job_id = ${lit(job)}::uuid order by created_at desc limit 1`,
  )
const answer = async (id: string, option: string, by = 'grant') =>
  json(
    (
      await one(
        `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(id)}::uuid), app.test_office()), ${lit(id)}::uuid, ${lit(option)}, ${lit(by)}) as r`,
      )
    ).r,
  )
const childOf = async (parent: string) =>
  (
    await one(
      `select job_id::text as id from public.jobs where parent_job_id = ${lit(parent)}::uuid order by created_at desc limit 1`,
    )
  )?.id as string | undefined
/** Ask, answer yes, and hand back the child job an approval starts. */
const approvedGeneration = async (config: Record<string, unknown>) => {
  const j0 = await jobRow(project, 'notebook.generate', config)
  await generate.handle(j0, db)
  const q = await blockerOf(j0.jobId)
  await answer(String(q.id), 'Go ahead')
  const cid = await childOf(j0.jobId)
  if (cid === undefined) throw new Error('an approval started nothing')
  return { j0, q, child: await asJob(cid) }
}
const verdict = async (job: string) =>
  json(
    (
      await one(
        `select app.approval_verdict(app.job_office(${lit(job)}::uuid), ${lit(job)}::uuid) as v`,
      )
    ).v,
  )

// ---- 1. generation: an honest approval starts exactly one --------------------------------------------
{
  const config = { kind: 'slides', instructions: `A deck about binding ${run}` }
  const j0 = await jobRow(project, 'notebook.generate', config)
  const before = did('generate')
  const asked = await generate.handle(j0, db)
  const q = await blockerOf(j0.jobId)
  check(
    'with nothing approved the handler ASKS and generates nothing',
    did('generate') === before && /Shall I make it/.test(asked.body) && q.s === 'open',
    `${asked.body.slice(0, 50)} / ${String(q.s)}`,
  )
  check(
    'the question carries the fingerprint of what it asks about and names the No',
    typeof q.fp === 'string' && String(q.fp).length === 64 && q.d === 'Not now',
    `${String(q.fp).slice(0, 12)}… / ${String(q.d)}`,
  )
  const yes = await answer(String(q.id), 'Go ahead')
  const cid = await childOf(j0.jobId)
  check(
    'answering yes starts exactly one child job',
    yes.ok === true && cid !== undefined,
    JSON.stringify(yes).slice(0, 80),
  )
  const child = await asJob(String(cid))
  const v = await verdict(child.jobId)
  check(
    "the child's approval is verified from the question",
    v.state === 'approved',
    String(v.state),
  )
  const out = await generate.handle(child, db)
  check(
    'the approved child generates once',
    did('generate') === before + 1 && /away/.test(out.body),
    `${String(did('generate') - before)} generation(s): ${out.body.slice(0, 50)}`,
  )
  const again = await generate.handle(child, db)
  check(
    'a RETRY of the same job generates nothing more (exactly once)',
    did('generate') === before + 1 && /already under way/.test(again.body),
    `${String(did('generate') - before)} generation(s): ${again.body.slice(0, 60)}`,
  )
  // A deferred SIBLING: a re-enqueued child copies the config and hangs off the same parent, so it is a
  // different job carrying the same approval. One yes is one generation, whichever job carries it.
  const sib = await one(`
    select app.enqueue_child(
      app.job_office(${lit(child.jobId)}::uuid),
      (select parent_job_id from public.jobs where job_id = ${lit(child.jobId)}::uuid),
      'notebook.generate',
      (select pinned_config from public.jobs where job_id = ${lit(child.jobId)}::uuid),
      '0 seconds'::interval, true) as id`)
  const sibId = String(sib.id)
  const sibling = await asJob(sibId.replace(/[^0-9a-f-]/g, ''))
  const viaSibling = await generate.handle(sibling, db)
  check(
    'a deferred SIBLING carrying the same approval generates nothing more: one yes is one generation',
    did('generate') === before + 1 && !/is away/.test(viaSibling.body),
    `${String(did('generate') - before)} generation(s): ${viaSibling.body.slice(0, 60)}`,
  )
}

// ---- 2. generation: what is not an approval is not accepted ---------------------------------------------------
{
  const forged = await jobRow(project, 'notebook.generate', {
    kind: 'slides',
    instructions: 'forged',
    approved_by: 'grant',
  })
  const before = did('generate')
  const out = await generate.handle(forged, db)
  check(
    'a payload that only CLAIMS approval starts nothing, and says so',
    did('generate') === before &&
      /I did not make/.test(out.body) &&
      (await verdict(forged.jobId)).state === 'forged',
    `${String((await verdict(forged.jobId)).state)}: ${out.body.slice(0, 60)}`,
  )
}
{
  const a = await approvedGeneration({ kind: 'slides', instructions: `original ${run}` })
  await db.execute(
    `update public.jobs set pinned_config = jsonb_set(pinned_config, '{instructions}', '"something else"') where job_id = ${lit(a.child.jobId)}::uuid`,
  )
  const before = did('generate')
  const out = await generate.handle(a.child, db)
  check(
    'a request CHANGED after it was approved is not what was approved',
    did('generate') === before &&
      (await verdict(a.child.jobId)).state === 'mismatch' &&
      /I did not make/.test(out.body),
    `${String((await verdict(a.child.jobId)).state)}`,
  )
}
{
  const j0 = await jobRow(project, 'notebook.generate', {
    kind: 'slides',
    instructions: `open ${run}`,
  })
  await generate.handle(j0, db)
  const q = await blockerOf(j0.jobId)
  const c = await jobRow(
    project,
    'notebook.generate',
    { kind: 'slides', instructions: `open ${run}`, approved_by: 'grant', approval: String(q.id) },
    'telegram:grant',
    j0.jobId,
  )
  const openOne = await verdict(c.jobId)
  await answer(String(q.id), 'Not now')
  const declined = await verdict(c.jobId)
  const before = did('generate')
  await generate.handle(c, db)
  check(
    'a question still OPEN, or answered No, is not an approval',
    openOne.state === 'forged' && declined.state === 'forged' && did('generate') === before,
    `${String(openOne.state)} / ${String(declined.state)}`,
  )
}
{
  const a = await approvedGeneration({ kind: 'slides', instructions: `theirs ${run}` })
  const other = await jobRow(project, 'notebook.generate', {
    kind: 'slides',
    instructions: `theirs ${run}`,
    approved_by: 'grant',
    approval: String(a.q.id),
  })
  const before = did('generate')
  await generate.handle(other, db)
  check(
    "an approval that names ANOTHER job's question is not this job's approval",
    (await verdict(other.jobId)).state === 'forged' && did('generate') === before,
    String((await verdict(other.jobId)).state),
  )
}
{
  const a = await approvedGeneration({ kind: 'slides', instructions: `observe ${run}` })
  const p2 = await projectWithNotebook('observe')
  await db.execute(
    `insert into public.autonomy_settings (office_id, project_id, level, set_by, reason) values (app.test_office(), ${lit(p2)}::uuid, 'observe', 'grant', 'proof')`,
  )
  // The same approval, on a project the dial has since set to observe.
  await db.execute(
    `update public.jobs set project_id = ${lit(p2)}::uuid where job_id = ${lit(a.child.jobId)}::uuid`,
  )
  const before = did('generate')
  const out = await generate.handle({ ...a.child, projectId: p2 }, db)
  check(
    'a recorded yes does not outrank a dial that says observe',
    did('generate') === before && /I did not make/.test(out.body),
    `${out.body.slice(0, 80)}`,
  )
}
{
  // Version skew: a question raised before approvals carried a fingerprint is verified as far as it can be.
  const j0 = await jobRow(project, 'notebook.generate', {
    kind: 'slides',
    instructions: `legacy ${run}`,
  })
  await generate.handle(j0, db)
  const q = await blockerOf(j0.jobId)
  await db.execute(
    `update public.blockers set action_fingerprint = null, decline_option = null where blocker_id = ${lit(String(q.id))}::uuid`,
  )
  await answer(String(q.id), 'Go ahead')
  const child = await asJob(String(await childOf(j0.jobId)))
  const before = did('generate')
  // The cutoff is when approvals began carrying fingerprints; a question older than it is legacy. This
  // one was raised seconds ago, so the cutoff is moved past it, as it was for a question already open
  // when the migration applied, and put back afterwards.
  await db.execute(
    `update public.system_config set value = to_jsonb((app.now_utc() + interval '1 minute')::text) where key = 'approval.fingerprints_from'`,
  )
  await generate.handle(child, db)
  await db.execute(
    `update public.system_config set value = to_jsonb(app.now_utc()::text) where key = 'approval.fingerprints_from'`,
  )
  check(
    'an in-flight approval raised BEFORE this migration still works (approved_legacy), once',
    (await verdict(child.jobId)).state === 'approved_legacy' && did('generate') === before + 1,
    String((await verdict(child.jobId)).state),
  )
}

// ---- 3. generation: an interrupted write is reconciled, a refused one is retried -------------------------------
{
  const a = await approvedGeneration({ kind: 'slides', instructions: `dropped ${run}` })
  const before = did('generate')
  mode = 'drop'
  let threw = false
  try {
    await generate.handle(a.child, db)
  } catch {
    threw = true
  }
  mode = 'ok'
  const retry = await generate.handle(a.child, db)
  const paused = await one(
    `select state::text as s from public.jobs where job_id = ${lit(a.child.jobId)}::uuid`,
  )
  check(
    'a connection that dropped MID-write parks for reconciliation: the retry does not generate again',
    threw &&
      did('generate') === before + 1 &&
      paused.s === 'paused' &&
      /I stopped/.test(retry.body),
    `${String(did('generate') - before)} attempt(s), job ${String(paused.s)}`,
  )
}
{
  // A refusal that says QUOTA is Google stating nothing started: the claim is spent and a retry may go.
  const a = await approvedGeneration({ kind: 'slides', instructions: `quota ${run}` })
  const before = did('generate')
  mode = 'quota'
  await generate.handle(a.child, db).catch(() => undefined)
  mode = 'ok'
  const spentClean = await count(
    `select count(*)::int as c from public.job_steps where job_id = ${lit(a.j0.jobId)}::uuid and outcome->>'failed' = 'true'`,
  )
  // The handler measured the ceiling and deferred; the deferral is what a real retry is. Clear the
  // stand-in meter so the retry is allowed to go, as it would be once the window reopened.
  await db.execute('delete from public.notebook_refusals')
  await db.execute('delete from public.notebook_spend')
  const retry = await generate.handle(a.child, db)
  check(
    'a write the service REFUSED FOR QUOTA is a clean failure: the claim is spent and the retry generates once',
    spentClean === 1 && did('generate') === before + 2 && /away/.test(retry.body),
    `${String(did('generate') - before)} call(s), ${String(spentClean)} clean failure(s)`,
  )
  const artifacts = await count(
    `select count(*)::int as c from public.artifacts where requested_by_job = ${lit(a.child.jobId)}::uuid`,
  )
  check('and exactly one artifact was recorded', artifacts === 1, String(artifacts))
}
{
  // Anything else that says ok:false is NOT proof nothing started: it parks, as a dropped line does.
  const a = await approvedGeneration({ kind: 'slides', instructions: `generic ${run}` })
  const before = did('generate')
  mode = 'refuse'
  let threw = false
  try {
    await generate.handle(a.child, db)
  } catch {
    threw = true
  }
  mode = 'ok'
  const retry = await generate.handle(a.child, db)
  check(
    'a generic refusal is not proof nothing started: the retry parks instead of generating again',
    threw && did('generate') === before + 1 && /I stopped/.test(retry.body),
    `${String(did('generate') - before)} call(s)`,
  )
}

// ---- 3b. a link he pasted: the boundary and exactly once --------------------------------------------------
{
  const url = `https://example.com/video-${run}`
  const asked = await jobRow(project, 'notebook.add_source', { url, kind: 'youtube' })
  const before = did('add_url')
  const out = await addSource.handle(asked, db)
  check(
    'a link he asked for is added once',
    did('add_url') === before + 1 && /In it goes/.test(out.body),
    out.body.slice(0, 50),
  )
  const again = await addSource.handle(asked, db)
  check(
    'a RETRY does not add it a second time ("asking again is how one source becomes three")',
    did('add_url') === before + 1 && /already in/.test(again.body),
    again.body.slice(0, 60),
  )
  const duty = await jobRow(
    project,
    'notebook.add_source',
    { url: `${url}-duty`, kind: 'youtube' },
    'duty:some-duty',
  )
  const b2 = did('add_url')
  const dutyOut = await addSource.handle(duty, db)
  check(
    'the same write from a duty nobody asked for waits for him instead of writing outside',
    did('add_url') === b2 &&
      /I did not add/.test(dutyOut.body) &&
      /waits for you/.test(dutyOut.body),
    dutyOut.body.slice(0, 120),
  )
  const p3 = await projectWithNotebook('observe2')
  await db.execute(
    `insert into public.autonomy_settings (office_id, project_id, level, set_by, reason) values (app.test_office(), ${lit(p3)}::uuid, 'observe', 'grant', 'proof')`,
  )
  const watched = await jobRow(p3, 'notebook.add_source', {
    url: `${url}-watched`,
    kind: 'youtube',
  })
  const b3 = did('add_url')
  const wOut = await addSource.handle(watched, db)
  check(
    'a dial set to observe stops it',
    did('add_url') === b3 && /I did not add/.test(wOut.body),
    wOut.body.slice(0, 80),
  )
  const dropped = await jobRow(project, 'notebook.add_source', {
    url: `${url}-dropped`,
    kind: 'youtube',
  })
  const b4 = did('add_url')
  mode = 'drop'
  let threw = false
  try {
    await addSource.handle(dropped, db)
  } catch {
    threw = true
  }
  mode = 'ok'
  const retry = await addSource.handle(dropped, db)
  check(
    'a connection that dropped mid-write parks: one attempt in all, and no second source',
    threw && did('add_url') === b4 + 1 && /I stopped/.test(retry.body),
    retry.body.slice(0, 80),
  )
}

// ---- 4. the door a client uses cannot bring an approval ---------------------------------------------------------
{
  const client = `bind-${run}`
  const slug = String(
    (await one(`select slug from public.projects where project_id = ${lit(project)}::uuid`)).slug,
  )
  const r = json(
    (
      await one(`select app.mcp_enqueue(${lit(client)}, ${lit(slug)}, 'notebook.generate',
        '{"kind":"slides","instructions":"x","approved_by":"grant","approval":"00000000-0000-0000-0000-000000000000","approval_next":"office.execute_plan","command_id":"x","origin_namespace":"verify"}'::jsonb) as r`)
    ).r,
  )
  const cfg = json(
    (
      await one(
        `select pinned_config as c from public.jobs where job_id = ${lit(String(r.job_id))}::uuid`,
      )
    ).c,
  )
  check(
    'a client cannot send the keys that say a job was approved or where it came from',
    !('approved_by' in cfg) &&
      !('approval' in cfg) &&
      !('approval_next' in cfg) &&
      !('command_id' in cfg) &&
      !('origin_namespace' in cfg) &&
      cfg.kind === 'slides',
    JSON.stringify(cfg),
  )
  check(
    'so its job is `none`, not approved',
    (await verdict(String(r.job_id))).state === 'none',
    String((await verdict(String(r.job_id))).state),
  )
}

// ---- 5. a plan ---------------------------------------------------------------------------------------------------
const steps = (name: string) => [
  { kind: 'create_project', name },
  { kind: 'generate', artifact: 'slides' },
]
const approvedPlan = async (planSteps: unknown[]) => {
  const j0 = await jobRow(project, 'office.instruction', { plan_steps: planSteps })
  await db.execute(
    `select app.request_approval(app.job_office(${lit(j0.jobId)}::uuid), ${lit(j0.jobId)}::uuid, 'Carry out 2 steps', 'proof', 'office.execute_plan')`,
  )
  const q = await blockerOf(j0.jobId)
  await answer(String(q.id), 'Go ahead')
  const cid = await childOf(j0.jobId)
  if (cid === undefined) throw new Error('a plan approval started nothing')
  return { j0, q, child: await asJob(cid) }
}
{
  const name = `Orchid Lantern ${run}`
  const a = await approvedPlan(steps(name))
  check(
    'the plan question carries a fingerprint and the child is approved from it',
    typeof a.q.fp === 'string' && (await verdict(a.child.jobId)).state === 'approved',
    String((await verdict(a.child.jobId)).state),
  )
  const before = did('create_notebook')
  const out = await plan.handle(a.child, db)
  const made = await count(
    `select count(*)::int as c from public.projects where name = ${lit(name)}`,
  )
  const kids = await count(
    `select count(*)::int as c from public.jobs where parent_job_id = ${lit(a.child.jobId)}::uuid and kind = 'notebook.generate'`,
  )
  check(
    'an approved plan carries out each step once',
    did('create_notebook') === before + 1 && made === 1 && kids === 1 && /Right/.test(out.body),
    `notebooks ${String(did('create_notebook') - before)}, projects ${String(made)}, children ${String(kids)}`,
  )
  await plan.handle(a.child, db)
  const kids2 = await count(
    `select count(*)::int as c from public.jobs where parent_job_id = ${lit(a.child.jobId)}::uuid and kind = 'notebook.generate'`,
  )
  check(
    'a RETRY of the same plan makes no second notebook, project or child',
    did('create_notebook') === before + 1 &&
      (await count(`select count(*)::int as c from public.projects where name = ${lit(name)}`)) ===
        1 &&
      kids2 === 1,
    `notebooks ${String(did('create_notebook') - before)}, children ${String(kids2)}`,
  )
}
{
  const forged = await jobRow(project, 'office.execute_plan', {
    plan_steps: steps(`Copper Meadow ${run}`),
    approved_by: 'grant',
  })
  const before = did('create_notebook')
  const out = await plan.handle(forged, db)
  check(
    'a plan that only claims approval is carried out by nobody',
    did('create_notebook') === before &&
      (await count(
        `select count(*)::int as c from public.projects where name = ${lit(`Copper Meadow ${run}`)}`,
      )) === 0 &&
      /I did not carry out/.test(out.body),
    out.body.slice(0, 60),
  )
}
{
  const a = await approvedPlan(steps(`Velvet Harbor ${run}`))
  await db.execute(
    `update public.jobs set pinned_config = jsonb_set(pinned_config, '{plan_steps,0,name}', '"Somewhere Else"') where job_id = ${lit(a.child.jobId)}::uuid`,
  )
  const before = did('create_notebook')
  const out = await plan.handle(a.child, db)
  check(
    'a plan CHANGED after it was approved is not what was approved',
    did('create_notebook') === before &&
      (await verdict(a.child.jobId)).state === 'mismatch' &&
      /I did not carry out/.test(out.body),
    String((await verdict(a.child.jobId)).state),
  )
}
{
  const name = `Amber Glacier ${run}`
  const a = await approvedPlan(steps(name))
  const before = did('create_notebook')
  mode = 'drop'
  let threw = false
  try {
    await plan.handle(a.child, db)
  } catch {
    threw = true
  }
  mode = 'ok'
  const retry = await plan.handle(a.child, db)
  check(
    'a notebook creation that dropped MID-write parks: one attempt in all, and the retry creates no second notebook',
    threw &&
      did('create_notebook') === before + 1 &&
      (await count(`select count(*)::int as c from public.projects where name = ${lit(name)}`)) ===
        0 &&
      /stopped part way/.test(retry.body),
    `${retry.body.slice(0, 70)}`,
  )
}

globalThis.fetch = realFetch
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

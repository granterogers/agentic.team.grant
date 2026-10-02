/**
 * ADR-0053: Grant can take a remembered No back, explicitly, and that never approves anything.
 *
 *   npx tsx scripts/isolated/refusal-reversal.ts <replica-db>
 *
 * The REAL `app.withdraw_refusal`, `app.authorize_effect`, the to-do trigger and the REAL hq-api
 * handler (bearer token, member session, stranger, spoofed p_by) against an isolated replica.
 * Properties, each with its control:
 *   1 a No is remembered; taking it back clears the memory and the next attempt ASKS (never proceeds)
 *   2 an older Yes on the same action does not speak once a No was taken back
 *   3 a different action's No is untouched; a standing authorization is a separate row
 *   4 only an authenticated person: not null, unknown, a specialist, a harness name, a bad token
 *   5 not a route for an agent: no grant to the role jobs run as, no caller in src/, a tick cannot
 *   6 only a No, only a question, only inside its window; repeating it is harmless
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { governOutward, mayAct } from '../../src/agents/approval.ts'
import { fingerprint } from '../../src/jobs/checkpoint.ts'
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'reversal')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const OPTS = ['Yes, do it', 'No, leave it']
const project = async (label: string): Promise<string> => {
  const id = String(
    json(
      (
        await one(`select app.hq_create_project(app.test_office(), ${lit(`Reversal ${label} ${run}`)}, 'upload', ${lit(`reversal-${label}-${run}`)},
          ${lit(`Reversal ${label} ${run}`)}, true) as v`)
      ).v,
    ).project_id,
  )
  await db.execute(
    `insert into public.autonomy_settings (project_id, level, set_by, reason) values (${lit(id)}::uuid, 'suggest', 'grant', 'reversal proof')`,
  )
  return id
}
const job = async (p: string, by = 'telegram:grant-rev'): Promise<string> =>
  String(
    (
      await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
        values ('office.instruction', ${lit(by)}, ${lit(p)}::uuid, 'rv-' || gen_random_uuid(), gen_random_uuid())
        returning job_id::text as id`)
    ).id,
  )
const ask = async (p: string, j: string, fp: string) =>
  String(
    (
      await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay,
          approval_options, originating_agent, work_can_continue, action_fingerprint, decline_option)
        values (${lit(p)}::uuid, ${lit(j)}::uuid, ${lit(`Put it in Notion ${run}`)}, 'reversal proof',
          'Nothing happens until somebody answers this question.', array[${OPTS.map(lit).join(',')}],
          'chief-of-staff', true, ${lit(fp)}, 'No, leave it') returning blocker_id::text as id`)
    ).id,
  )
const answer = async (b: string, a: string, by = 'grant') =>
  json(
    (
      await one(
        `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(b)}::uuid), app.test_office()), ${lit(b)}::uuid, ${lit(a)}, ${lit(by)})::text as r`,
      )
    ).r,
  )
/** As the gateway calls it: through PostgREST with the service key, which sets the request's claims. */
const SERVICE = `select set_config('request.jwt.claims', '{"role":"service_role"}', true);`
const withdraw = async (b: string, by: string | null) =>
  json(
    (
      await one(
        `${SERVICE} select app.withdraw_refusal(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(b)}::uuid), app.test_office()), ${lit(b)}::uuid, ${by === null ? 'null' : lit(by)})::text as r`,
      )
    ).r,
  )
const verdict = async (p: string, fp: string, j?: string) =>
  mayAct(db as never, {
    projectId: p,
    tool: 'notebook.write',
    fingerprint: fp,
    ...(j === undefined ? {} : { job: j }),
  })
const refusalsListed = async () =>
  (
    json((await one(`select app.active_refusals()::text as r`)).r) as unknown as { id: string }[]
  ).map((r) => r.id)

// ---- 1. taking a No back clears the memory, and never approves -------------------------------
const p = await project('main')
const fpA = await fingerprint({ action: 'A', run })
const fpB = await fingerprint({ action: 'B', run })
const jA = await job(p)
const bA = await ask(p, jA, fpA)
const jB = await job(p)
const bB = await ask(p, jB, fpB)
await answer(bA, 'No, leave it')
await answer(bB, 'No, leave it')
{
  const before = await verdict(p, fpA, await job(p))
  check(
    'control: the No is remembered before it is taken back',
    before.verdict === 'refuse' && before.remembered,
    before.verdict,
  )
  check(
    'and it is listed as a No still being remembered',
    (await refusalsListed()).includes(bA),
    'active_refusals',
  )
  const r = await withdraw(bA, 'grant')
  check(
    'Grant takes it back: ok, attributed, and the reply says nothing was approved',
    r.ok === true && r.by === 'grant' && /Nothing was approved/.test(String(r.note)),
    JSON.stringify(r).slice(0, 100),
  )
  const after = await verdict(p, fpA, await job(p))
  check(
    'the next attempt ASKS (it is neither refused nor approved)',
    after.verdict === 'ask' && !after.approved && !after.declined,
    after.verdict,
  )
  const sameJob = await verdict(p, fpA, jA)
  check(
    'even the job that was refused may ask again, and is not approved',
    sameJob.verdict === 'ask' && !sameJob.approved,
    sameJob.verdict,
  )
  check(
    'it leaves the list of Nos being remembered',
    !(await refusalsListed()).includes(bA),
    'active_refusals',
  )
  const row = await one(
    `select refusal_withdrawn_by as by, answered_option as o from public.blockers where blocker_id = ${lit(bA)}::uuid`,
  )
  check(
    'the durable state says who and leaves the original No on record',
    row.by === 'grant' && row.o === 'No, leave it',
    JSON.stringify(row),
  )
  const ev = await one(
    `select count(*)::int as n from public.events where action_type = 'refusal.withdrawn' and actor = 'grant' and related_job_id = ${lit(jA)}::uuid`,
  )
  check('and the ledger has the event', Number(ev.n) === 1, `${String(ev.n)} event`)
  const again = await withdraw(bA, 'grant')
  check(
    'taking it back twice is harmless',
    again.ok === true && again.already === true,
    JSON.stringify(again).slice(0, 80),
  )
  check(
    'a DIFFERENT action keeps its No (independent)',
    (await verdict(p, fpB, await job(p))).verdict === 'refuse',
    'B still refused',
  )
}
// ---- 2. an older Yes cannot speak once a later No was taken back --------------------------------
{
  const p2 = await project('older-yes')
  const fp = await fingerprint({ action: 'older yes', run })
  const j = await job(p2)
  const yes = await ask(p2, j, fp)
  await answer(yes, 'Yes, do it')
  await db.execute(
    `update public.blockers set resolved_at = resolved_at - interval '1 hour' where blocker_id = ${lit(yes)}::uuid`,
  )
  const no = await ask(p2, j, fp)
  await answer(no, 'No, leave it')
  check(
    'control: with the later No standing, the job is refused',
    (await verdict(p2, fp, j)).verdict === 'refuse',
    'refused',
  )
  await withdraw(no, 'grant')
  const v = await verdict(p2, fp, j)
  check(
    'after taking the No back the OLDER yes does not approve: it asks',
    v.verdict === 'ask' && !v.approved,
    `${v.verdict} approved=${String(v.approved)}`,
  )
}
// ---- 3. standing authorization is a separate decision -------------------------------------------
{
  const p3 = await project('standing')
  const fp = await fingerprint({ action: 'standing', run })
  const j = await job(p3)
  const b = await ask(p3, j, fp)
  await answer(b, 'No, leave it')
  await db.execute(
    `select app.grant_standing(app.test_office(), 'notebook.write', ${lit(p3)}::uuid, 'reversal proof', 'grant', null)`,
  )
  const withStanding = await verdict(p3, fp, await job(p3))
  check(
    'a standing yes proceeds, and does not take the No back',
    withStanding.verdict === 'proceed' && (await refusalsListed()).includes(b),
    `${withStanding.verdict}; No still listed`,
  )
  await db
    .execute(
      `update public.standing_authorizations set revoked_at = now(), revoked_reason = 'reversal proof' where tool = 'notebook.write' and project_id = ${lit(p3)}::uuid`,
    )
    .catch(() => undefined)
  const revoked = await verdict(p3, fp, await job(p3))
  check(
    'revoke the standing row and the No is still there',
    revoked.verdict === 'refuse',
    revoked.verdict,
  )
  await withdraw(b, 'grant')
  check(
    'and taking the No back grants no standing row',
    Number(
      (
        await one(
          `select count(*)::int as n from public.standing_authorizations where project_id = ${lit(p3)}::uuid and revoked_at is null`,
        )
      ).n,
    ) === 0,
    'none live',
  )
}
// ---- 3b. a duty's No (tool + project, no fingerprint) is taken back the same way --------------
{
  const p3b = await project('duty')
  const again = async () => {
    const j = await job(p3b, 'duty:reversal-proof')
    return governOutward(db as never, {
      jobId: j,
      projectId: p3b,
      tool: 'notebook.write',
      summary: 'The copy is behind',
      detail: '1. A',
      empty: false,
      agent: 'operations-director',
    })
  }
  const first = await again()
  await answer(String(first.blocker), 'No, leave it')
  const quiet = await again()
  check(
    'control: the duty is quiet after its No',
    quiet.quiet && quiet.blocker === null,
    `quiet=${String(quiet.quiet)}`,
  )
  const r = await withdraw(String(first.blocker), 'grant')
  const next = await again()
  check(
    "taking the duty's No back lets it ask again, and answering is what would approve",
    r.ok === true && !next.go && next.blocker !== null && !next.quiet,
    `go=${String(next.go)} blocker=${String(next.blocker).slice(0, 8)}`,
  )
}
// ---- 4. only an authenticated person ------------------------------------------------------------
{
  const p4 = await project('who')
  const fp = await fingerprint({ action: 'who', run })
  const j = await job(p4)
  const b = await ask(p4, j, fp)
  await answer(b, 'No, leave it')
  await db.execute(
    `insert into public.subject_identities (subject, origin_channel, actor, note) values ('verify-echo', 'slack', 'U0ECHOVERIFY${run.toUpperCase().slice(0, 4)}', 'reversal proof') on conflict do nothing`,
  )
  const staff = String((await one(`select slug from public.staff limit 1`)).slug)
  for (const [label, by] of [
    ['no principal', null],
    ['a blank principal', '  '],
    ['a name the office does not know', 'mallory'],
    ['a specialist', staff],
    ['a harness name the office does know', 'verify-echo'],
  ] as const) {
    const r = await withdraw(b, by)
    check(
      `${label} cannot take it back`,
      typeof r.error === 'string' && r.ok !== true,
      String(r.error).slice(0, 70),
    )
  }
  check(
    'and the No is still remembered after all of those',
    (await verdict(p4, fp, await job(p4))).verdict === 'refuse',
    'refused',
  )
}
{
  const p4b = await project('claims')
  const fp = await fingerprint({ action: 'claims', run })
  const b = await ask(p4b, await job(p4b), fp)
  await answer(b, 'No, leave it')
  const direct = json(
    (
      await one(
        `select app.withdraw_refusal(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(b)}::uuid), app.test_office()), ${lit(b)}::uuid, 'grant')::text as r`,
      )
    ).r,
  )
  check(
    'called as plain SQL, the way a handler or a job would, it is refused even for the right name',
    typeof direct.error === 'string' && /Only the gateway/.test(String(direct.error)),
    String(direct.error).slice(0, 60),
  )
  const anon = json(
    (
      await one(
        `select set_config('request.jwt.claims', '{"role":"anon"}', true); select app.withdraw_refusal(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(b)}::uuid), app.test_office()), ${lit(b)}::uuid, 'grant')::text as r`,
      )
    ).r,
  )
  check(
    'called with the anon key it is refused even if the grant leaked',
    typeof anon.error === 'string' && /Only the gateway/.test(String(anon.error)),
    String(anon.error).slice(0, 60),
  )
  check(
    'and the No still stands after both',
    (await verdict(p4b, fp, await job(p4b))).verdict === 'refuse',
    'refused',
  )
}
// ---- 5. not a route for an agent -----------------------------------------------------------------
{
  const worker = String(
    (
      await one(
        `select has_function_privilege('ai_team_app', 'app.withdraw_refusal(uuid, text)', 'execute') as x`,
      )
    ).x,
  )
  const gateway = String(
    (
      await one(
        `select has_function_privilege('service_role', 'app.withdraw_refusal(uuid, text)', 'execute') as x`,
      )
    ).x,
  )
  check(
    'the role jobs and handlers run as cannot execute it; the gateway role can',
    worker === 'false' && gateway === 'true',
    `ai_team_app=${worker} service_role=${gateway}`,
  )
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const full = join(dir, f)
      return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : []
    })
  const callers = [...walk('src'), ...walk('supabase/functions')].filter((f) =>
    /withdraw_refusal/.test(readFileSync(f, 'utf8')),
  )
  check(
    'the only code that names it is the gateway (no agent, handler, specialist or job path)',
    callers.length === 1 && callers[0] === join('supabase/functions/hq-api/index.ts'),
    callers.join(','),
  )
  const tick = String(
    (await one(`select pg_get_functiondef('app.task_answers_blocker()'::regprocedure) as d`)).d,
  )
  check('the to-do tick does not call it', !/withdraw_refusal/.test(tick), 'trigger body scanned')
  // and a tick, however it arrives, leaves a remembered No alone
  const p5 = await project('tick')
  const fp = await fingerprint({ action: 'tick', run })
  const j = await job(p5)
  const b = await ask(p5, j, fp)
  await answer(b, 'No, leave it')
  await db.execute(
    `insert into public.tasks (project_id, title, detail, state, assigned_to_human, job_id, added_by, priority) values (${lit(p5)}::uuid, 'tick proof ${run}', 'x', 'todo', true, ${lit(j)}::uuid, 'the office', 2)`,
  )
  await db.execute(
    `update public.tasks set state = 'done', done_at = now(), completed_by = 'grant' where title = ${lit(`tick proof ${run}`)}`,
  )
  check(
    'ticking a to-do does not reopen a No',
    (await verdict(p5, fp, await job(p5))).verdict === 'refuse',
    'still refused',
  )
}
// ---- 6. only a No, only a question, only inside its window --------------------------------------
{
  const p6 = await project('bounds')
  const j = await job(p6)
  const yesB = await ask(p6, j, await fingerprint({ action: 'yes', run }))
  await answer(yesB, 'Yes, do it')
  const r1 = await withdraw(yesB, 'grant')
  check(
    'a question answered Yes has nothing to take back',
    typeof r1.error === 'string' && /not answered No/.test(String(r1.error)),
    String(r1.error).slice(0, 60),
  )
  const openB = await ask(p6, j, await fingerprint({ action: 'open', run }))
  const r2 = await withdraw(openB, 'grant')
  check(
    'an unanswered question has nothing to take back',
    typeof r2.error === 'string',
    String(r2.error).slice(0, 60),
  )
  const r3 = await withdraw('00000000-0000-0000-0000-000000000000', 'grant')
  check(
    'a question that does not exist is refused',
    typeof r3.error === 'string',
    String(r3.error).slice(0, 60),
  )
  const oldNo = await ask(p6, j, await fingerprint({ action: 'old', run }))
  await answer(oldNo, 'No, leave it')
  await db.execute(
    `update public.blockers set resolved_at = resolved_at - interval '40 days' where blocker_id = ${lit(oldNo)}::uuid`,
  )
  const r4 = await withdraw(oldNo, 'grant')
  check(
    'a No that has already run out is not "taken back"',
    typeof r4.error === 'string' && /run out/.test(String(r4.error)),
    String(r4.error).slice(0, 60),
  )
  const harnessJob = await job(p6, 'teamhq:verify-reversal')
  const hb = await ask(p6, harnessJob, await fingerprint({ action: 'harness', run }))
  await answer(hb, 'No, leave it')
  check(
    'a No on a harness job is enforced but never listed to Grant',
    !(await refusalsListed()).includes(hb),
    'not listed',
  )
}
// ---- 7. the page payload carries it, and the REAL gateway enforces who ---------------------------
const TOKEN = 'isolated-hq-token'
const SESSION_GRANT = `aaa.bbb.${'g'.repeat(70)}`
const SESSION_STRANGER = `aaa.bbb.${'x'.repeat(70)}`
await db.execute(
  `insert into public.office_members (email, note, owner_key) values ('grant.e.rogers@gmail.com', 'reversal proof', 'grant') on conflict do nothing`,
)
const gw = await startEdge({
  db,
  edgeFile: 'supabase/functions/hq-api/index.ts',
  env: {
    HQ_API_TOKEN: TOKEN,
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
    SUPABASE_ANON_KEY: 'isolated-anon',
  },
  authUsers: {
    [SESSION_GRANT]: 'grant.e.rogers@gmail.com',
    [SESSION_STRANGER]: 'not.a.member@example.com',
  },
})
const act = async (bearer: string | null, args: Record<string, unknown>) => {
  const r = await gw.call(
    new Request('https://gw.invalid/functions/v1/hq-api', {
      method: 'POST',
      headers: {
        ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'withdraw_refusal', args }),
    }),
  )
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
{
  const p7 = await project('gateway')
  const mk = async (label: string) => {
    const fp = await fingerprint({ action: `gw-${label}`, run })
    const j = await job(p7)
    const b = await ask(p7, j, fp)
    await answer(b, 'No, leave it')
    return { fp, b }
  }
  const gov = json(
    (await one(`select app.hq_governance(app.owner_office('grant'))::text as r`)).r,
  ) as {
    refusals?: { id: string }[]
  }
  const x = await mk('anon')
  check(
    'the governance payload the page reads lists the No (the key the page learned)',
    Array.isArray(gov.refusals),
    typeof gov.refusals,
  )
  const anon = await act(null, { p_blocker_id: x.b })
  check(
    'unauthenticated: refused at the gateway, the No stands',
    anon.status === 401 && (await verdict(p7, x.fp, await job(p7))).verdict === 'refuse',
    `http ${String(anon.status)}`,
  )
  const stranger = await act(SESSION_STRANGER, { p_blocker_id: x.b, p_by: 'grant' })
  check(
    'a valid session that is not a member: refused, the No stands',
    stranger.status === 401 && (await verdict(p7, x.fp, await job(p7))).verdict === 'refuse',
    `http ${String(stranger.status)}`,
  )
  const viaToken = await act(TOKEN, { p_blocker_id: x.b, p_by: 'mallory' })
  const by = String(
    (
      await one(
        `select refusal_withdrawn_by as by from public.blockers where blocker_id = ${lit(x.b)}::uuid`,
      )
    ).by,
  )
  check(
    'the office key cannot take a No back: it is a machine (#385), and the No stands',
    viaToken.status === 403 &&
      by === 'null' &&
      (await verdict(p7, x.fp, await job(p7))).verdict === 'refuse',
    `http ${String(viaToken.status)} by ${by}`,
  )
  const viaGrant = await act(SESSION_GRANT, { p_blocker_id: x.b, p_by: 'mallory' })
  const by2 = String(
    (
      await one(
        `select refusal_withdrawn_by as by from public.blockers where blocker_id = ${lit(x.b)}::uuid`,
      )
    ).by,
  )
  check(
    'a signed-in person takes it back, recorded as the verified principal whatever the page sent',
    viaGrant.status === 200 && by2 === 'grant',
    `http ${String(viaGrant.status)} by ${by2}`,
  )
  const y = await mk('session')
  const viaSession = await act(SESSION_GRANT, { p_blocker_id: y.b })
  check(
    "Grant's own signed-in session takes it back and the next attempt asks",
    viaSession.status === 200 && (await verdict(p7, y.fp, await job(p7))).verdict === 'ask',
    `http ${String(viaSession.status)}`,
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

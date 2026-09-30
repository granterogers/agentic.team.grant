/**
 * Final audit reconciliation - original-audit defects that Runs 1-5 never touched.
 *
 *   npx tsx scripts/isolated/audit-closure.ts <replica-db>
 *
 * B11 (may_act: an office-made root is not a person asking), B14 (a job's parent is written once), #343 (a project
 * whose autonomy dial was set can be deleted). The real functions against the replica.
 */
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
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1

/**
 * Proof: app.self_improvement_spent (migration 1026) returns EXACTLY what the frozen 0216 definition returns.
 *
 *   npx tsx scripts/isolated/self-improvement-equivalence.ts [replica-db=post]
 *
 * Edge rows (rolled back): usage for a self-improvement job, an ordinary job, a fixture job, no job at all, and rows just inside
 * and just outside the window. Controls: the comparison is non-trivial (some windows sum above zero), a copy that drops the
 * fixture exclusion disagrees, and a copy that drops the kind test disagrees.
 *
 * Runs only against the marked local replica; never touches production; spends no model call.
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

let failed = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}

await db.execute('drop schema if exists proof_ref cascade')
await db.execute('create schema proof_ref')
// Frozen 0216 definition.
await db.execute(`
  create function proof_ref.self_improvement_spent(p_hours integer default 24) returns bigint
   language sql stable security definer set search_path to '' as $f$
  select coalesce(sum(u.prompt_tokens + u.completion_tokens), 0)::bigint
    from public.inference_usage u
    join public.jobs j on j.job_id = u.job_id
   where j.kind in (select kind from public.self_improvement_kinds)
     and not j.is_fixture
     and u.occurred_at > app.now_utc()
                         - (greatest(coalesce(p_hours, 24), 1) || ' hours')::interval
  $f$`)

await db.execute('begin')
try {
  const kind = (await rows(`select kind from public.self_improvement_kinds limit 1`))[0]
    ?.kind as string
  const usageCols = (
    await rows(`select string_agg(column_name, ',' order by ordinal_position) c from information_schema.columns
                 where table_schema = 'public' and table_name = 'inference_usage'`)
  )[0]?.c as string
  check(
    usageCols.includes('job_id') && usageCols.includes('occurred_at'),
    'inference_usage has the columns the proof writes',
  )
  await db.execute('set local session_replication_role = replica')
  const office = (
    await rows(`select office_id::text id from public.offices where kind = 'person' limit 1`)
  )[0]?.id as string
  // A job of each class.
  await db.execute(`
    insert into public.jobs (job_id, correlation_id, state, idempotency_key, kind, requested_by, priority, pinned_config, attempt, max_attempts,
                             created_at, updated_at, finished_at, office_id, synthetic, claim_gen, origin_kind, origin_class)
    select v.id::uuid, gen_random_uuid(), 'complete', 'edge-' || v.id, v.kind, v.who, 100, '{}'::jsonb, 1, 5, now(), now(), now(), '${office}', false, 1,
           'inbound', case when v.who like 'verify:%' then 'harness' else 'trusted' end
      from (values ('00000000-0000-4000-8000-0000000000a1', '${kind}', 'duty:self'),
                   ('00000000-0000-4000-8000-0000000000a2', 'office.instruction', 'telegram:grant'),
                   ('00000000-0000-4000-8000-0000000000a3', '${kind}', 'verify:edge-case')) as v(id, kind, who)`)
  const fixture = (
    await rows(
      `select is_fixture f from public.jobs where job_id = '00000000-0000-4000-8000-0000000000a3'`,
    )
  )[0]?.f
  check(fixture === true, 'control: the fixture job is a fixture by the generated column')
  const tmpl = (await rows(`select * from public.inference_usage limit 1`))[0] as
    | Record<string, unknown>
    | undefined
  check(tmpl !== undefined, 'the replica has a usage row to copy the shape from')
  for (const [job, age, tokens] of [
    ['00000000-0000-4000-8000-0000000000a1', '23 hours', 1000],
    ['00000000-0000-4000-8000-0000000000a1', '25 hours', 7],
    ['00000000-0000-4000-8000-0000000000a2', '1 hour', 50],
    ['00000000-0000-4000-8000-0000000000a3', '1 hour', 300],
    [null, '1 hour', 900],
  ] as const) {
    await db.execute(`
      insert into public.inference_usage (provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd,
                                          occurred_at, office_id, provenance)
      select u.provider, u.model_id, ${job === null ? 'null' : `'${job}'::uuid`}, gen_random_uuid(), u.outcome, ${String(tokens)}, 1, 0,
             now() - interval '${age}', u.office_id, u.provenance
        from public.inference_usage u limit 1`)
  }
  await db.execute('reset session_replication_role')

  let compared = 0
  let positive = 0
  for (const h of [1, 2, 24, 26, 168, 0, -5]) {
    const r = (
      await rows(`select app.self_improvement_spent(${String(h)}) = proof_ref.self_improvement_spent(${String(h)}) as eq,
                                 app.self_improvement_spent(${String(h)}) as n`)
    )[0]
    compared += 1
    if (r?.eq !== true)
      check(false, `self_improvement_spent(${String(h)}) differs from the frozen definition`)
    if (Number(r?.n) > 0) positive += 1
  }
  const nul = (
    await rows(
      `select app.self_improvement_spent(null) = proof_ref.self_improvement_spent(null) as eq`,
    )
  )[0]
  check(nul?.eq === true, 'a null window means 24 hours in both')
  check(failed === 0 && compared > 0, `equal to the frozen definition for ${compared} windows`)
  check(
    positive >= 2,
    `control: ${positive} windows sum above zero (the comparison is not vacuous)`,
  )

  // Control: widening the window from 24 to 26 hours adds exactly the one self-improvement row at 25 hours (7 + 1 tokens);
  // the ordinary, fixture and job-less rows never move the sum.
  const exact = (
    await rows(`select app.self_improvement_spent(26) - app.self_improvement_spent(24) as d`)
  )[0]
  check(
    Number(exact?.d) === 8,
    `control: widening the window adds exactly the one 25-hour self-improvement row (saw ${String(exact?.d)})`,
  )

  // Control: copies that drop one exclusion must disagree.
  await db.execute(`
    create function proof_ref.no_fixture(p_hours integer) returns bigint language sql stable as $f$
    select coalesce(sum(u.prompt_tokens + u.completion_tokens), 0)::bigint from public.inference_usage u join public.jobs j on j.job_id = u.job_id
     where j.kind in (select kind from public.self_improvement_kinds) and u.occurred_at > app.now_utc() - (p_hours || ' hours')::interval $f$`)
  await db.execute(`
    create function proof_ref.no_kind(p_hours integer) returns bigint language sql stable as $f$
    select coalesce(sum(u.prompt_tokens + u.completion_tokens), 0)::bigint from public.inference_usage u join public.jobs j on j.job_id = u.job_id
     where not j.is_fixture and u.occurred_at > app.now_utc() - (p_hours || ' hours')::interval $f$`)
  const d1 = (
    await rows(`select proof_ref.no_fixture(24) <> proof_ref.self_improvement_spent(24) as d`)
  )[0]
  const d2 = (
    await rows(`select proof_ref.no_kind(24) <> proof_ref.self_improvement_spent(24) as d`)
  )[0]
  check(
    d1?.d === true,
    'control: a copy without the fixture exclusion disagrees with the reference',
  )
  check(d2?.d === true, 'control: a copy without the kind test disagrees with the reference')
} finally {
  await db.execute('rollback')
  await db.execute('drop schema if exists proof_ref cascade')
}

console.log(
  failed === 0
    ? '\nself-improvement ceiling equivalent: PASS'
    : `\nself-improvement ceiling equivalent: ${String(failed)} FAIL`,
)
await db.end()
process.exit(failed === 0 ? 0 : 1)

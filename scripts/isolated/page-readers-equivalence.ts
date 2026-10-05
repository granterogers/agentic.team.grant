/**
 * Proof: studio_unseen, studio_team_work and hq_studio_lately (migration 1025) return EXACTLY what the frozen previous definitions
 * return.
 *
 *   npx tsx scripts/isolated/page-readers-equivalence.ts [replica-db=post]
 *
 * Each change moves a time window ahead of the harness question. That is only safe if the window and the harness predicate select
 * the same rows in either order, so the edge rows (rolled back) put harness and real jobs on both sides of every window:
 * outputs and jobs just inside and just outside the 7-day / 14-day / 24-hour edges, a project last seen in the middle of the
 * outputs, and an event tied to a harness job.
 *
 * Controls (a comparison that cannot fail proves nothing):
 *   1. the cases are not empty: unseen counts answers, team work counts asks, lately counts today's jobs;
 *   2. a copy of the new studio_team_work with the harness test dropped must disagree with the reference;
 *   3. a copy of the new studio_unseen with the window dropped must disagree with the reference.
 *
 * Runs only against the marked local replica; never touches production; spends no model call.
 */
import { readFileSync } from 'node:fs'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

let failed = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}

await db.execute(
  readFileSync(new URL('./reference/page-readers.pre-1025.sql', import.meta.url), 'utf8'),
)

// generated_at is the moment of the call, so two calls never agree on it; everything else must.
const same = (fn: string, args: string): string =>
  `(app.${fn}(${args}) - 'generated_at') = (proof_ref.${fn}(${args}) - 'generated_at')`

await db.execute('begin')
try {
  await db.execute('set local session_replication_role = replica')
  // Harness and real jobs on both sides of every window, each with an output, in every project that has any job.
  await db.execute(`
    insert into public.jobs (job_id, correlation_id, state, idempotency_key, kind, requested_by, priority, pinned_config, attempt, max_attempts,
                             created_at, updated_at, finished_at, office_id, project_id, recipient_agent, synthetic, claim_gen,
                             origin_kind, origin_class)
    select gen_random_uuid(), gen_random_uuid(), v.state::public.job_state, 'edge-' || md5(random()::text), 'office.instruction',
           case when v.harness then 'verify:edge-case' else 'telegram:grant' end, 100, '{}'::jsonb, 1, 5,
           now() - v.age, now() - v.age, case when v.state in ('failed','complete') then now() - v.age end,
           p.office_id, p.project_id, (select slug from public.staff where active order by slug limit 1), false, 1, 'inbound',
           case when v.harness then 'harness' else 'trusted' end
      from public.projects p,
           (values (false, 'complete', interval '6 days 23 hours'), (false, 'complete', interval '7 days 1 hour'),
                   (true,  'complete', interval '6 days 23 hours'), (false, 'failed',   interval '13 days 23 hours'),
                   (false, 'failed',   interval '14 days 1 hour'),  (true,  'failed',   interval '13 days 23 hours'),
                   (false, 'complete', interval '23 hours'),        (false, 'complete', interval '25 hours'),
                   (true,  'complete', interval '23 hours'),        (false, 'failed',   interval '23 hours'),
                   (true,  'failed',   interval '23 hours')) as v(harness, state, age)
     where not p.is_fixture`)
  await db.execute(`
    insert into public.outputs (job_id, staff_id, body, confidence, evidence, deterministic, reviewer_status, reviewed_at, created_at)
    select j.job_id, (select staff_id from public.staff order by slug limit 1), 'edge', 'medium', 'inferred', true, 'approved',
           j.created_at, j.created_at
      from public.jobs j where j.idempotency_key like 'edge-%'`)
  // One project last seen in the middle of the window, so the per-project edge matters.
  await db.execute(`
    insert into public.project_seen (owner, project_id, at)
    select app.office_actor(p.office_id), p.project_id, now() - interval '3 days'
      from public.projects p where not p.is_fixture and p.status = 'active' limit 1
    on conflict do nothing`)
  await db.execute('reset session_replication_role')

  const offices = (await rows(
    `select office_id::text id, kind from public.offices order by kind`,
  )) as { id: string; kind: string }[]
  // hq_studio_lately is migration 1029 and needs 0920; on production's applied line it is not there to compare.
  const hasLately =
    (await rows(`select to_regproc('app.event_via_label') is not null as ok`))[0]?.ok === true
  console.log(
    `  hq_studio_lately ${hasLately ? 'compared (0920 present)' : 'skipped (0920 absent)'}`,
  )
  let compared = 0
  let sawAnswers = 0
  let sawAsked = 0
  let sawToday = 0
  for (const o of offices) {
    const id = `'${o.id}'::uuid`
    for (const [fn, args] of [
      ['studio_unseen', id],
      ['studio_team_work', id],
      ['studio_team_work', `${id}, 3`],
      ['studio_team_work', `${id}, 30`],
      ...(hasLately
        ? ([
            ['hq_studio_lately', `${id}, 40`],
            ['hq_studio_lately', `${id}, 5`],
          ] as const)
        : []),
    ] as const) {
      // studio_unseen returns an object keyed by project, which has no generated_at: use plain equality there.
      const cond =
        fn === 'studio_unseen' ? `app.${fn}(${args}) = proof_ref.${fn}(${args})` : same(fn, args)
      const r = (await rows(`select ${cond} as eq`))[0]
      compared += 1
      if (r?.eq !== true)
        check(
          false,
          `${fn}(${o.kind}, ${args.replace(id, 'office')}) differs from the frozen definition`,
        )
    }
    const u = (
      await rows(
        `select coalesce(sum((v ->> 'answers')::int), 0)::int n from jsonb_each(app.studio_unseen(${id})) e(k, v)`,
      )
    )[0]
    sawAnswers += Number(u?.n)
    const t = (
      await rows(
        `select coalesce(sum((v ->> 'asked')::int), 0)::int n from jsonb_each(app.studio_team_work(${id})) e(k, v)`,
      )
    )[0]
    sawAsked += Number(t?.n)
    if (hasLately) {
      const l = (
        await rows(
          `select coalesce((app.hq_studio_lately(${id}) -> 'today' ->> 'jobs_done')::int, 0) n`,
        )
      )[0]
      sawToday += Number(l?.n)
    }
  }
  check(
    failed === 0 && compared > 0,
    `the three readers equal the frozen definitions for ${compared} office/argument pairs`,
  )

  // Control 1: not vacuous.
  check(
    sawAnswers > 0 && sawAsked > 0 && (sawToday > 0 || !hasLately),
    `control: the comparison saw ${sawAnswers} unseen answers, ${sawAsked} asks, ${sawToday} jobs done today`,
  )

  // Control 2: team work without the harness test must disagree (the edge rows include harness jobs inside the window).
  const tw = (
    await rows(`select pg_get_functiondef('app.studio_team_work(uuid,integer)'::regprocedure) as d`)
  )[0]?.d as string
  const noHarness = tw
    .replace('app.studio_team_work', 'proof_ref.no_harness_team_work')
    .replace('and not coalesce(app.harness_job(j.job_id), false)', () => '')
  check(
    noHarness.includes('no_harness_team_work') &&
      !noHarness.includes('and not coalesce(app.harness_job(j.job_id), false)'),
    'control: the harness test was removed from the copy',
  )
  await db.execute(noHarness)
  let twDiffers = 0
  for (const o of offices) {
    const r = (
      await rows(
        `select (proof_ref.no_harness_team_work('${o.id}'::uuid) <> proof_ref.studio_team_work('${o.id}'::uuid)) as d`,
      )
    )[0]
    if (r?.d === true) twDiffers += 1
  }
  check(
    twDiffers > 0,
    `control: team work without the harness test disagrees with the reference in ${twDiffers} of ${offices.length} offices`,
  )

  // Control 3: unseen without the window must disagree.
  const un = (
    await rows(`select pg_get_functiondef('app.studio_unseen(uuid)'::regprocedure) as d`)
  )[0]?.d as string
  const noWindow = un
    .replace('app.studio_unseen', 'proof_ref.no_window_unseen')
    .replace(
      'where j.office_id = p_office and j.project_id = m.project_id and o.created_at > m.since\n             offset 0',
      () => 'where j.office_id = p_office and j.project_id = m.project_id\n             offset 0',
    )
  check(
    noWindow !== un.replace('app.studio_unseen', 'proof_ref.no_window_unseen'),
    'control: the window was removed from the copy',
  )
  await db.execute(noWindow)
  let unDiffers = 0
  for (const o of offices) {
    const r = (
      await rows(
        `select (proof_ref.no_window_unseen('${o.id}'::uuid) <> proof_ref.studio_unseen('${o.id}'::uuid)) as d`,
      )
    )[0]
    if (r?.d === true) unDiffers += 1
  }
  check(
    unDiffers > 0,
    `control: unseen without the window disagrees with the reference in ${unDiffers} of ${offices.length} offices`,
  )
} finally {
  await db.execute('rollback')
  await db.execute('drop schema if exists proof_ref cascade')
}

console.log(
  failed === 0
    ? '\npage readers equivalent: PASS'
    : `\npage readers equivalent: ${String(failed)} FAIL`,
)
await db.end()
process.exit(failed === 0 ? 0 : 1)

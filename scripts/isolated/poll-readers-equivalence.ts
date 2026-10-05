/**
 * Proof: the optimised poll readers return EXACTLY what the frozen production definitions return (migration 1023).
 *
 *   npx tsx scripts/isolated/poll-readers-equivalence.ts [replica-db=post]
 *
 * A change that makes a reader cheaper is only a gain if it returns the same answer. This runs the frozen reference copies
 * (scripts/isolated/reference/poll-readers.0750-0753.sql, schema proof_ref) beside the live app.* definitions, for every office, on
 * the seeded replica plus a set of edge rows written inside a transaction that is rolled back, and requires jsonb equality.
 *
 * Three controls, because a comparison that cannot fail proves nothing:
 *   1. the cases are NOT empty: some office reports finished/failed jobs and a non-null progress reading;
 *   2. a deliberately different call (window of h + 1 hours) must disagree with the reference somewhere;
 *   3. the reference itself must be wrong when its input is wrong (a mutated copy of the new function must disagree).
 *
 * Runs only against the marked local replica; never touches production; spends no model call.
 */
import { readFileSync } from 'node:fs'
import { isolated } from './guard.ts'

const database = process.argv[2] ?? 'post'
const db = await isolated(database)
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

let failed = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}

await db.execute(
  readFileSync(new URL('./reference/poll-readers.0750-0753.sql', import.meta.url), 'utf8'),
)

await db.execute('begin')
try {
  // Edge rows (rolled back): a real failure and a harness failure inside the window, a stale queued job, a retrying job, a job
  // with no transition at all, in the person office; and one row in the test office. Triggers are skipped (end state written).
  await db.execute(`set local session_replication_role = replica`)
  await db.execute(`
    insert into public.jobs (job_id, correlation_id, state, idempotency_key, kind, requested_by, priority, pinned_config, attempt, max_attempts,
                             created_at, updated_at, finished_at, office_id, synthetic, claim_gen, origin_kind, origin_class, state_reason)
    select gen_random_uuid(), gen_random_uuid(), v.state::public.job_state, 'edge-' || md5(random()::text), v.kind, v.who, 100, '{}'::jsonb,
           1, 5, now() - v.age, now() - v.age, case when v.state in ('failed','complete') then now() - v.age end,
           (select office_id from public.offices where kind = v.office), false, 1, 'inbound', case when v.who like 'verify:%' then 'harness' else 'trusted' end,
           case when v.state = 'retrying' then 'attempt failed' end
      from (values
        ('failed',   'office.instruction', 'telegram:grant',      interval '10 minutes', 'person'),
        ('failed',   'office.instruction', 'verify:edge-case',    interval '10 minutes', 'person'),
        ('failed',   'research',           'teamhq:grant',        interval '3 hours',    'person'),
        ('queued',   'office.instruction', 'telegram:grant',      interval '2 hours',    'person'),
        ('retrying', 'drive.watch',        'duty:drive-watch',    interval '90 minutes', 'person'),
        ('complete', 'office.instruction', 'telegram:grant',      interval '5 minutes',  'person'),
        ('failed',   'office.instruction', 'telegram:grant',      interval '20 minutes', 'test')
      ) as v(state, kind, who, age, office)`)
  await db.execute(`reset session_replication_role`)

  const offices = (await rows(
    `select office_id::text id, kind from public.offices order by kind`,
  )) as { id: string; kind: string }[]
  let populated = 0
  let compared = 0
  for (const o of offices) {
    for (const h of [1, 6, 24, 168]) {
      const r = (
        await rows(`select app.office_health('${o.id}'::uuid, ${h}) = proof_ref.office_health('${o.id}'::uuid, ${h}) as eq,
                           (app.office_health('${o.id}'::uuid, ${h}) ->> 'finished')::int as finished`)
      )[0]
      compared += 1
      if (r?.eq !== true)
        check(false, `office_health(${o.kind}, ${h} h) differs from the frozen definition`)
      if (Number(r?.finished) > 0) populated += 1
    }
    const p = (
      await rows(`select app.last_progress('${o.id}'::uuid) = proof_ref.last_progress('${o.id}'::uuid) as eq,
                         app.last_progress('${o.id}'::uuid) ->> 'last_dequeue_at' as d`)
    )[0]
    if (p?.eq !== true) check(false, `last_progress(${o.kind}) differs from the frozen definition`)
  }
  check(
    compared > 0 && failed === 0,
    `office_health equals the frozen definition for ${compared} office/window pairs and last_progress for ${offices.length} offices`,
  )

  // Control 1: the comparison saw real data, not four empty offices.
  check(
    populated >= 3,
    `control: ${populated} of ${compared} cases reported finished jobs (the comparison is not vacuous)`,
  )
  const progressSeen = (
    await rows(
      `select count(*)::int n from public.offices o where app.last_progress(o.office_id) ->> 'last_completion_at' is not null`,
    )
  )[0]
  check(
    Number(progressSeen?.n) >= 1,
    `control: ${String(progressSeen?.n)} office(s) have a non-null progress reading`,
  )

  // Control 2: a different window must disagree somewhere.
  const person = offices.find((o) => o.kind === 'person')?.id ?? ''
  const diff = (
    await rows(`select count(*)::int n
                  from generate_series(1, 6) h
                 where app.office_health('${person}'::uuid, h + 1) <> proof_ref.office_health('${person}'::uuid, h)`)
  )[0]
  check(
    Number(diff?.n) > 0,
    `control: a window one hour wider disagrees with the reference in ${String(diff?.n)} of 6 cases`,
  )

  // Control 3: a mutated copy of the NEW function (counts failures where it should count completions) must disagree.
  await db.execute(`
    create function proof_ref.sabotaged(p_office uuid, p_hours int) returns jsonb language sql stable as
    $$ select jsonb_set(app.office_health(p_office, p_hours), '{finished}', to_jsonb(coalesce((app.office_health(p_office, p_hours) ->> 'failed')::int, 0))) $$`)
  const sab = (
    await rows(`select count(*)::int n from generate_series(1, 6) h
                 where proof_ref.sabotaged('${person}'::uuid, h) <> proof_ref.office_health('${person}'::uuid, h)`)
  )[0]
  check(
    Number(sab?.n) > 0,
    `control: a mutated copy disagrees with the reference in ${String(sab?.n)} of 6 cases`,
  )
} finally {
  await db.execute('rollback')
  await db.execute('drop schema if exists proof_ref cascade')
}

console.log(
  failed === 0
    ? '\npoll readers equivalent: PASS'
    : `\npoll readers equivalent: ${String(failed)} FAIL`,
)
await db.end()
process.exit(failed === 0 ? 0 : 1)

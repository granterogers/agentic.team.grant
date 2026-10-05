/**
 * Proof: app.hq_pulse (migration 1027) returns EXACTLY what the frozen definition returns, key for key.
 *
 *   npx tsx scripts/isolated/pulse-equivalence.ts [replica-db=post]
 *
 * The page compares the digest whole, so any difference redraws it for no reason or fails to redraw it. `at` is the moment of the
 * call and is removed from both. Edge rows (rolled back) include a fixture job with an output, which is the one place the
 * original's count and newest-timestamp deliberately disagree about fixtures.
 *
 * Controls: the comparison is not vacuous (every count non-zero for some office), a fixture-job output moves the newest timestamp
 * but not the output count in BOTH, and a copy that counts fixture outputs disagrees with the reference.
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

await db.execute(readFileSync(new URL('./reference/pulse.pre-1027.sql', import.meta.url), 'utf8'))
const same = (o: string): string =>
  `(app.hq_pulse('${o}'::uuid) - 'at') = (proof_ref.hq_pulse('${o}'::uuid) - 'at')`

await db.execute('begin')
try {
  const offices = (await rows(
    `select office_id::text id, kind from public.offices order by kind`,
  )) as { id: string; kind: string }[]
  const person = offices.find((o) => o.kind === 'person')?.id ?? ''

  let compared = 0
  for (const o of offices) {
    compared += 1
    const r = (await rows(`select ${same(o.id)} as eq`))[0]
    if (r?.eq !== true) check(false, `hq_pulse(${o.kind}) differs from the frozen definition`)
  }
  check(failed === 0, `equal to the frozen definition for ${compared} offices on the seeded data`)
  const seen = (await rows(`select (app.hq_pulse('${person}'::uuid)) as v`))[0]?.v as Record<
    string,
    unknown
  >
  check(
    ['jobs_running', 'jobs_done', 'outputs', 'tasks_open', 'documents', 'messages'].every(
      (k) => Number(seen[k]) >= 0,
    ) &&
      Number(seen.jobs_done) > 0 &&
      Number(seen.outputs) > 0 &&
      seen.latest !== null,
    'control: the comparison saw real counts and a non-null latest (not vacuous)',
  )

  // Edge: a FIXTURE job with an output newer than everything else. The count must not move, the newest timestamp must.
  const before = (await rows(`select (app.hq_pulse('${person}'::uuid)) as v`))[0]?.v as Record<
    string,
    unknown
  >
  await db.execute('set local session_replication_role = replica')
  await db.execute(`
    insert into public.jobs (job_id, correlation_id, state, idempotency_key, kind, requested_by, priority, pinned_config, attempt, max_attempts,
                             created_at, updated_at, finished_at, office_id, synthetic, claim_gen, origin_kind, origin_class)
    values ('00000000-0000-4000-8000-0000000000f1', gen_random_uuid(), 'complete', 'edge-pulse-fixture', 'office.instruction',
            'verify:pulse-edge', 100, '{}'::jsonb, 1, 5, now() + interval '1 day', now() + interval '1 day', now() + interval '1 day',
            '${person}', false, 1, 'inbound', 'harness')`)
  await db.execute(`
    insert into public.outputs (job_id, staff_id, body, confidence, evidence, deterministic, reviewer_status, reviewed_at, created_at)
    values ('00000000-0000-4000-8000-0000000000f1', (select staff_id from public.staff order by slug limit 1), 'edge', 'medium', 'inferred',
            true, 'approved', now(), now() + interval '2 days')`)
  await db.execute('reset session_replication_role')
  const eq = (await rows(`select ${same(person)} as eq`))[0]
  check(eq?.eq === true, 'a fixture job with a newer output: still equal to the frozen definition')
  const after = (await rows(`select (app.hq_pulse('${person}'::uuid)) as v`))[0]?.v as Record<
    string,
    unknown
  >
  check(
    after.outputs === before.outputs && after.latest !== before.latest,
    'control: the fixture output moved the newest timestamp and not the output count (the original asymmetry is kept)',
  )

  // Control: a copy that counts fixture outputs must disagree with the reference.
  const src = (await rows(`select pg_get_functiondef('app.hq_pulse(uuid)'::regprocedure) as d`))[0]
    ?.d as string
  const sab = src
    .replace('app.hq_pulse', 'proof_ref.counts_fixture_outputs')
    .replace(
      'count(*) filter (where not j.is_fixture)::int, max(o.created_at)',
      () => 'count(*)::int, max(o.created_at)',
    )
  check(
    sab !== src.replace('app.hq_pulse', 'proof_ref.counts_fixture_outputs'),
    'control: the fixture exclusion was removed from the copy',
  )
  await db.execute(sab)
  const d = (
    await rows(
      `select (proof_ref.counts_fixture_outputs('${person}'::uuid) - 'at') <> (proof_ref.hq_pulse('${person}'::uuid) - 'at') as d`,
    )
  )[0]
  check(d?.d === true, 'control: a copy that counts fixture outputs disagrees with the reference')

  // Refusal is kept.
  let said = ''
  try {
    await rows(`select app.hq_pulse(null)`)
  } catch (e) {
    said = e instanceof Error ? e.message : String(e)
  }
  check(said.includes('no_office'), `a null office is refused (said: ${said.slice(0, 40)})`)
} finally {
  await db.execute('rollback')
  await db.execute('drop schema if exists proof_ref cascade')
}

console.log(
  failed === 0 ? '\npulse equivalent: PASS' : `\npulse equivalent: ${String(failed)} FAIL`,
)
await db.end()
process.exit(failed === 0 ? 0 : 1)

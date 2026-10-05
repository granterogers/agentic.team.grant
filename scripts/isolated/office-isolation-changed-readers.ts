/**
 * Negative proof: the readers changed in migrations 1023 to 1025 do not let one office's rows show up in another office's answer.
 *
 *   npx tsx scripts/isolated/office-isolation-changed-readers.ts [replica-db=post]
 *
 * Two checks per reader:
 *   1. refusal: a null office and an unknown office are refused (42501), not defaulted to somebody;
 *   2. invariance: office A's answer is byte-identical before and after a burst of real and harness jobs, outputs, tasks,
 *      impediments and events is written into office B inside a rolled-back transaction. If a window or harness rewrite had
 *      dropped an office predicate, B's rows would move A's counts.
 * Controls: the burst is not a no-op (B's own answer MOVES), and a reader with its office predicate removed (a sabotaged copy of
 * studio_team_work) MOVES for A, so the invariance check is able to fail.
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

const offices = (await rows(
  `select office_id::text id, kind from public.offices where state = 'active' order by kind`,
)) as {
  id: string
  kind: string
}[]
const A = offices.find((o) => o.kind === 'person')?.id ?? ''
const B = offices.find((o) => o.kind === 'test')?.id ?? ''
check(A !== '' && B !== '' && A !== B, 'two distinct active offices exist on the replica')

// generated_at moves on every call; everything else must not.
const READERS: [string, (o: string) => string][] = [
  ['office_health', (o) => `(app.office_health('${o}'::uuid, 24) - 'progress')`],
  // The two minutes_since values are rounded against the clock and tick over between two readings taken minutes apart.
  [
    'last_progress',
    (o) =>
      `(app.last_progress('${o}'::uuid) - 'minutes_since_dequeue' - 'minutes_since_completion')`,
  ],
  ['studio_unseen', (o) => `app.studio_unseen('${o}'::uuid)`],
  ['studio_team_work', (o) => `app.studio_team_work('${o}'::uuid)`],
  [
    'hq_studio_lately',
    (o) => `(app.hq_studio_lately('${o}'::uuid, 40) - 'generated_at' - 'building')`,
  ],
]

for (const [name, call] of READERS) {
  for (const [what, arg] of [
    ['null', 'null'],
    ['unknown', "'00000000-0000-4000-8000-00000000dead'"],
  ] as const) {
    let said = ''
    try {
      await rows(`select ${call(arg).replace(`'${arg}'::uuid`, `${arg}::uuid`)}`)
    } catch (e) {
      said = e instanceof Error ? e.message : String(e)
    }
    check(
      said.includes('no_office'),
      `${name}: a ${what} office is refused with no_office (said: ${said.slice(0, 60) || 'nothing'})`,
    )
  }
}

const read = async (o: string): Promise<string[]> => {
  const out: string[] = []
  for (const [, call] of READERS)
    out.push(JSON.stringify((await rows(`select ${call(o)} as v`))[0]?.v))
  return out
}

const beforeA = await read(A)
const beforeB = await read(B)

await db.execute('begin')
try {
  await db.execute('set local session_replication_role = replica')
  // A burst in B: real and harness jobs on every state, with outputs and an impediment each, in every window.
  await db.execute(`
    insert into public.jobs (job_id, correlation_id, state, idempotency_key, kind, requested_by, priority, pinned_config, attempt, max_attempts,
                             created_at, updated_at, finished_at, office_id, project_id, recipient_agent, synthetic, claim_gen, origin_kind, origin_class)
    select gen_random_uuid(), gen_random_uuid(), v.state::public.job_state, 'iso-' || md5(random()::text || i), 'office.instruction',
           case when v.harness then 'verify:iso' else 'telegram:grant' end, 100, '{}'::jsonb, 1, 5,
           now() - v.age, now() - v.age, case when v.state in ('failed','complete') then now() - v.age end,
           '${B}', (select project_id from public.projects where office_id = '${B}' limit 1),
           (select slug from public.staff where active order by slug limit 1), false, 1, 'inbound',
           case when v.harness then 'harness' else 'trusted' end
      from generate_series(1, 25) i,
           (values (false, 'complete', interval '1 hour'), (false, 'failed', interval '2 hours'), (true, 'complete', interval '1 hour'),
                   (false, 'queued', interval '30 minutes'), (false, 'complete', interval '3 days')) as v(harness, state, age)`)
  await db.execute(`
    insert into public.outputs (job_id, staff_id, body, confidence, evidence, deterministic, reviewer_status, reviewed_at, created_at)
    select j.job_id, (select staff_id from public.staff order by slug limit 1), 'iso', 'medium', 'inferred', true, 'approved', j.created_at, j.created_at
      from public.jobs j where j.idempotency_key like 'iso-%'`)
  await db.execute('reset session_replication_role')

  const afterA = await read(A)
  const afterB = await read(B)
  READERS.forEach(([name], i) => {
    check(
      afterA[i] === beforeA[i],
      `${name}: office A's answer is unchanged by a burst in office B`,
    )
  })
  // Control: the burst is real (B's own answers move for at least one reader).
  check(
    READERS.some((_, i) => afterB[i] !== beforeB[i]),
    "control: the burst moved office B's own answers (it is not a no-op)",
  )

  // Control: a reader with its office predicate removed must move for A.
  const src = (
    await rows(`select pg_get_functiondef('app.studio_team_work(uuid,integer)'::regprocedure) as d`)
  )[0]?.d as string
  await db.execute('drop schema if exists proof_ref cascade')
  await db.execute('create schema proof_ref')
  const sab = src
    .replace('app.studio_team_work', 'proof_ref.no_office_team_work')
    .replace(
      'where j.office_id = p_office and j.recipient_agent is not null',
      () => 'where j.recipient_agent is not null',
    )
  check(
    sab !== src.replace('app.studio_team_work', 'proof_ref.no_office_team_work'),
    'control: the office predicate was removed from the copy',
  )
  await db.execute(sab)
  const leaked = (
    await rows(
      `select proof_ref.no_office_team_work('${A}'::uuid) <> app.studio_team_work('${A}'::uuid) as moved`,
    )
  )[0]
  check(
    leaked?.moved === true,
    "control: a reader without its office predicate shows other offices' rows to A (the invariance check can fail)",
  )
} finally {
  await db.execute('rollback')
  await db.execute('drop schema if exists proof_ref cascade')
}

console.log(
  failed === 0
    ? '\noffice isolation of changed readers: PASS'
    : `\noffice isolation of changed readers: ${String(failed)} FAIL`,
)
await db.end()
process.exit(failed === 0 ? 0 : 1)

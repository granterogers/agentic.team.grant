/**
 * Two answers to one question at the same moment (ledger R17).
 *
 *   npm run verify:approval-race                 # against the live function
 *   npm run verify:approval-race -- --with migrations/0596_one_answer_per_question.sql
 *
 * Grant can answer a question from the dashboard and from Telegram, and a
 * double press on either is ordinary. `app.hq_answer_blocker` read the
 * blocker without a lock and its final update did not re-check the state,
 * so two overlapping answers could BOTH perform what answering promises.
 *
 * This drives that for real. The fixture is harness traffic end to end: a
 * job whose kind no handler serves, cancelled before anything can take it,
 * requested by a verify- name, with a blocker whose on_answer starts a probe
 * kind. Answer one holds its transaction open for five seconds; answer two
 * starts a second later on another connection. Count the children.
 *
 * Live only. The fix (0596) cannot be proved concurrently inside a rollback:
 * a second transaction's CREATE OR REPLACE blocks on the first one's DDL,
 * which serialises the two for a reason that has nothing to do with the fix.
 * Its sequential behaviour is proved by verify:retry-writes' sibling probe;
 * the concurrent half needs the function deployed, and this suite is what
 * then says whether it held.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
const run = Math.random().toString(36).slice(2, 10)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}

const made = await one(`
  with j as (
    insert into public.jobs (correlation_id, kind, state, requested_by, announce, idempotency_key)
    values (gen_random_uuid(), 'verify.approval_race', 'queued', ${lit(`teamhq:verify-apprace-${run}`)}, false, ${lit(`verify-apprace-${run}`)})
    returning job_id)
  insert into public.blockers (job_id, requested_action, why_needed, consequences_of_delay,
                               approval_options, originating_agent, work_can_continue, on_answer)
  select job_id, 'verify approval race ${run}', 'a probe', 'none', array['Yes','No'],
         'chief-of-staff', true,
         jsonb_build_object('option','Yes','kind','verify.approval_race_child','payloads', jsonb_build_array('{}'::jsonb))
    from j
  returning blocker_id::text as b, job_id::text as j`)
const blocker = String(made.b)
const job = String(made.j)
await db.execute(
  `update public.jobs set state = 'cancelled', state_reason = 'verify:approval-race fixture' where job_id = ${lit(job)}::uuid`,
)

const answer = (hold: number) =>
  db
    .execute(
      `begin; select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(blocker)}::uuid), app.test_office()), ${lit(blocker)}::uuid, 'Yes', 'grant'); select pg_sleep(${String(hold)}); commit;`,
    )
    .then(() => 'ok')
    .catch((e: unknown) => String((e as Error).message).slice(0, 200))

let outcome: string[] = []
try {
  outcome = await Promise.all([
    answer(5),
    new Promise<string>((r) => setTimeout(() => void answer(0).then(r), 1_000)),
  ])
} finally {
  const counted = await one(`
    select (select count(*)::int from public.jobs where parent_job_id = ${lit(job)}::uuid
             and kind = 'verify.approval_race_child') as children`).catch(() => ({ children: -1 }))
  // Sweep: cancel what was started, before any worker can take it.
  await db.execute(`update public.jobs set state = 'cancelled', state_reason = 'verify:approval-race sweep'
                     where parent_job_id = ${lit(job)}::uuid and state = 'queued'`)
  console.log(`  answers: ${outcome.join(' | ')}`)
  const ok = Number(counted.children) === 1
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} two overlapping answers performed the answer ONCE — ${String(counted.children)} child job(s)`,
  )
  console.log(
    `\napproval-race: ${ok ? '1/1' : '0/1'} (fixture: harness job ${job}, children cancelled)`,
  )
  process.exitCode = ok ? 0 : 1
}

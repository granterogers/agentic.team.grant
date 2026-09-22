/**
 * A job that dies leaves a trace, whichever layer killed it.
 *
 *   npm run verify:journals
 *
 * ## The failure this exists for
 *
 * On 17 September the nightly backup failed. There was no delivery, no
 * impediment and no alert, and the next morning there was simply no backup
 * from the 17th. The only record was `state_reason` on the job row:
 *
 *     recovery: 5 attempts exhausted while in running
 *
 * — written by `app.recover_stalled_jobs`, which is SQL, in a column nobody
 * reads. Across the fourteen days before this suite existed there were 56
 * real failed jobs, **none of which produced a delivery**, and six of which
 * left no trace anywhere a person looks.
 *
 * `src/jobs/worker.ts` had learned this rule three times (#211, #231) and
 * three paths to `failed` had never learned it: the SQL recovery path, a job
 * found in `notifying` with no output to deliver, and a review rejection with
 * attempts exhausted. 0535 moved the rule to the transition itself, which is
 * the only place every path is visible.
 *
 * ## What this asserts, and why it is a property rather than a count
 *
 * Two halves, and neither is sufficient alone.
 *
 * The DRIVE proves the mechanism works now, including the two ways it could
 * be wrong in the expensive direction: recording twice (which would turn the
 * Governance page into a log) and recording on transitions that are not
 * failures. It runs entirely inside one statement that ends by raising, so
 * the whole thing rolls back — jobs can never be deleted, so a drive that
 * committed would leave permanent fixtures in Grant's queue.
 *
 * The HISTORY half asserts the property on real traffic: no real job that
 * reached `failed` after the trigger existed may have nothing recorded
 * against it. A count would go red the day the office has a bad morning and
 * green the day a harness run floods the table; the property holds for ever.
 * It is scoped to jobs created after 0535 was applied, because the six
 * historical silences are the evidence for the fix rather than a regression
 * in it.
 *
 * ## Why the sabotage is not automated here
 *
 * The control that matters — disable the trigger, watch the drive go red,
 * restore it, watch it go green — was run by hand and its output is in
 * `docs/ops/evidence/`. It is deliberately NOT in this suite. Disabling a
 * trigger on `public.jobs` and then crashing would leave production without
 * the guard, which is exactly the shape of `verify:disconnect` deleting
 * Slack's token every run: a suite that calls a real function outside a
 * transaction is one behaviour change away from being destructive, and
 * `alter table ... disable trigger` cannot be wrapped in the statement that
 * asserts against it.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let failures = 0
const check = (ok: boolean, label: string, detail = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}

// ── 1. The trigger exists and is enabled ───────────────────────────────────
// Asserted as a property of the live database rather than read from the
// migration file: a migration that applies cleanly is not a trigger that is
// on, and `alter table ... disable trigger` leaves the definition in place.
const installed = await db.execute(`
  select t.tgenabled::text as enabled
    from pg_trigger t
   where t.tgrelid = 'public.jobs'::regclass
     and t.tgname = 'jobs_journal_terminal_failure'`)
const enabled = String(installed.rows[0]?.enabled ?? '')
check(
  enabled === 'O' || enabled === 'A',
  'the terminal-failure journal is installed and firing',
  enabled === '' ? 'no such trigger' : `tgenabled = ${enabled}`,
)

// ── 2. Drive it. Three controls, one statement, rolled back by raising ─────
const DRIVE = `
do $drive$
declare
  j1 uuid; j2 uuid; j3 uuid; n1 int; n2 int; n3 int;
  raw1 text; det1 text; fix1 boolean;
begin
  -- A: the silent case. A job that fails with nothing recorded must gain one.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
  values (gen_random_uuid(), 'verify-journals-a', 'office.backup', 'verify:journals')
  returning job_id into j1;
  update public.jobs set state = 'failed',
    state_reason = 'recovery: 5 attempts exhausted while in running' where job_id = j1;
  select count(*) into n1 from public.job_impediments where job_id = j1;
  select needed_raw, detail, is_fixture into raw1, det1, fix1
    from public.job_impediments where job_id = j1;

  -- B: a call site that already said something better must not be duplicated.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
  values (gen_random_uuid(), 'verify-journals-b', 'office.instruction', 'verify:journals')
  returning job_id into j2;
  perform app.cannot(j2, 'not_capable', 'an answer at all', 'the handler',
                     'what the call site knew', 'a better sentence');
  update public.jobs set state = 'failed', state_reason = 'handler threw' where job_id = j2;
  select count(*) into n2 from public.job_impediments where job_id = j2;

  -- C: a transition that is not a failure must record nothing at all.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by)
  values (gen_random_uuid(), 'verify-journals-c', 'office.chores', 'verify:journals')
  returning job_id into j3;
  update public.jobs set state = 'cancelled', state_reason = 'not a failure' where job_id = j3;
  select count(*) into n3 from public.job_impediments where job_id = j3;

  if n1 <> 1 then raise exception 'DRIVE-FAIL a silent failure recorded % impediments, expected 1', n1; end if;
  if n2 <> 1 then raise exception 'DRIVE-FAIL an already-recorded failure was duplicated: % rows', n2; end if;
  if n3 <> 0 then raise exception 'DRIVE-FAIL a cancelled job recorded % impediments, expected 0', n3; end if;
  if det1 <> 'recovery: 5 attempts exhausted while in running' then
    raise exception 'DRIVE-FAIL the reason did not survive into the record: [%]', det1; end if;
  if raw1 <> 'to finish office.backup' then
    raise exception 'DRIVE-FAIL the fingerprint is not keyed on the job kind: [%]', raw1; end if;
  if not fix1 then
    raise exception 'DRIVE-FAIL harness traffic did not inherit is_fixture and would be counted'; end if;

  raise exception 'DRIVE-PASS all three controls held';
end
$drive$;`

let driveSaid = ''
try {
  await db.execute(DRIVE)
  driveSaid = 'the drive returned without raising, which it cannot do'
} catch (error) {
  driveSaid = (error as Error).message.replace(/\s+/g, ' ')
}
const drivePassed = driveSaid.includes('DRIVE-PASS')
check(
  drivePassed,
  'a silent failure is recorded, a spoken one is not duplicated, a cancellation records nothing',
  drivePassed ? 'three controls' : driveSaid.slice(0, 300),
)

// The drive must leave nothing. Jobs can never be deleted, so a drive that
// committed would put permanent fixtures in the queue.
const debris = await db.execute(
  `select count(*)::int as n from public.jobs where requested_by = 'verify:journals'`,
)
check(
  Number(debris.rows[0]?.n ?? -1) === 0,
  'the drive left nothing behind',
  `${String(debris.rows[0]?.n)} job(s)`,
)

// ── 3. The property, on real history since the trigger existed ─────────────
const since = await db.execute(`
  select applied_at from app.schema_migrations
   where name = '0535_a_job_that_dies_says_so_wherever_it_died.sql'`)
const appliedAt = since.rows[0]?.applied_at
if (appliedAt === undefined || appliedAt === null) {
  check(false, '0535 is recorded as applied', 'no row in app.schema_migrations')
} else {
  const silent = await db.execute(`
    select j.kind, j.job_id::text as job_id, j.created_at::text as at,
           left(coalesce(j.state_reason, ''), 90) as reason
      from public.jobs j
     where j.state = 'failed'
       and not app.harness_job(j.job_id)
       and not j.is_fixture
       and j.created_at > (select applied_at from app.schema_migrations
                            where name = '0535_a_job_that_dies_says_so_wherever_it_died.sql')
       and not exists (select 1 from public.job_impediments i where i.job_id = j.job_id)
     order by j.created_at desc`)
  check(
    silent.rows.length === 0,
    'no real job has failed silently since the journal was installed',
    silent.rows.length === 0
      ? 'nothing silent'
      : silent.rows
          .map((r) => `${String(r.kind)} at ${String(r.at)}: ${String(r.reason)}`)
          .join(' | '),
  )
  console.log(`   (property scoped to jobs created after ${String(appliedAt)})`)
}

// ── 4. Context: what the history actually looked like before the fix ───────
const before = await db.execute(`
  select count(*)::int as failed,
         count(*) filter (where not exists
           (select 1 from public.job_impediments i where i.job_id = j.job_id))::int as silent
    from public.jobs j
   where j.state = 'failed' and not app.harness_job(j.job_id) and not j.is_fixture
     and j.created_at > app.now_utc() - interval '21 days'`)
const b = before.rows[0] ?? {}
console.log(
  `\nreal failed jobs in the last 21 days: ${String(b.failed)}, of which ${String(b.silent)} left no trace`,
)

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed.`)
  process.exit(1)
}
console.log('\nEvery terminal failure leaves a durable trace.')

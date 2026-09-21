/**
 * A resumption is not a retry (0536).
 *
 *   npm run verify:resumes
 *
 * ## The failure this exists for
 *
 * The nightly backup's own history, read from `public.jobs`:
 *
 *     date        attempts used   worker deaths
 *     12-16 Sep   1               0
 *     17 Sep      5  FAILED       4
 *     18 Sep      2               1
 *     19 Sep      2               1
 *     20 Sep      2               1
 *     21 Sep      3               2
 *
 * `app.dequeue_job` increments `attempt` on every dequeue and the lease is
 * 300 seconds. An edge worker is killed by its runtime long before a
 * 122-table backup finishes, so the job is picked up, makes progress through
 * 0436's checkpoints, dies, and is recovered. Each of those burns one of five
 * attempts — and the database grew from 78k rows to 135k in the window above.
 * The backup had **two attempts of headroom** and the trend was one more
 * attempt every few days.
 *
 * So `attempt` was carrying two meanings: how many times the job has FAILED,
 * which is what a retry cap is for, and how many times it has been PICKED UP,
 * which for a checkpointed job is just how far it got.
 *
 * ## Why the round trip is asserted and not just the decision
 *
 * The first version of 0536 sent a progressing job to `retrying` and left
 * `max_attempts` alone. It applied cleanly and was wrong twice:
 * `jobs_attempt_within_max` is `attempt <= max_attempts` so the next dequeue
 * would have raised, and `app.requeue_retrying` only moves rows
 * `where attempt < max_attempts` so the job would have sat in `retrying` FOR
 * EVER — a backup that fails loudly turned into one that silently stops.
 *
 * Both were found by driving it. So this suite does not stop at "the state is
 * retrying": it runs `requeue_retrying` and then `dequeue_job` and asserts the
 * job actually comes back to `running`. A decision that no other function will
 * honour is not a fix.
 *
 * ## The three bounds, each with its own control
 *
 * Nothing here may become a job that runs for ever, so all three are asserted:
 * progress is monotonic (a finished step is never re-run); an attempt that
 * finishes nothing still spends against `max_attempts`; and `jobs.max_dequeues`
 * ends it regardless.
 *
 * Everything runs inside one statement that ends by raising, so it rolls back.
 * `app.recover_stalled_jobs()` is global by design — it takes every stalled
 * job, which is what the office wants on a tick — so wrapping the CALL rather
 * than the assertion is the only safe way to drive it: real jobs that were
 * due for recovery are recovered and un-recovered and the next real tick
 * takes them.
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

const DRIVE = `
do $drive$
declare
  jp uuid; jn uuid; jc uuid;
  sp text; sn text; sc text; rp text; gp int;
begin
  -- P: PROGRESSED. At the attempt ceiling, but it finished a checkpoint
  -- during this lease. Must resume.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, attempt, max_attempts)
  values (gen_random_uuid(), 'verify-resumes-progressed', 'office.backup', 'verify:resumes', 4, 5)
  returning job_id into jp;
  update public.jobs set state='running', leased_by='edge-p',
         leased_until = now() - interval '1 minute', attempt = 5 where job_id = jp;
  insert into public.job_steps (job_id, step, ordinal, began_at, finished_at, outcome,
                                effect_kind, schema_version, code_version)
  values (jp, 'public.events', 7, now(), now(), '{}'::jsonb, 'local', 1, 'verify');

  -- N: NO PROGRESS at the same ceiling. Must still die, or the retry cap has
  -- been removed rather than corrected.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, attempt, max_attempts)
  values (gen_random_uuid(), 'verify-resumes-noprogress', 'office.backup', 'verify:resumes', 4, 5)
  returning job_id into jn;
  update public.jobs set state='running', leased_by='edge-n',
         leased_until = now() - interval '1 minute', attempt = 5 where job_id = jn;

  -- C: past the absolute ceiling, progressing every time. Must die anyway.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by, attempt, max_attempts)
  values (gen_random_uuid(), 'verify-resumes-ceiling', 'office.backup', 'verify:resumes', 4, 999)
  returning job_id into jc;
  update public.jobs set state='running', leased_by='edge-c',
         leased_until = now() - interval '1 minute', attempt = 999 where job_id = jc;
  insert into public.job_steps (job_id, step, ordinal, began_at, finished_at, outcome,
                                effect_kind, schema_version, code_version)
  values (jc, 'public.events', 7, now(), now(), '{}'::jsonb, 'local', 1, 'verify');

  perform app.recover_stalled_jobs();

  select state::text, left(state_reason, 120), max_attempts into sp, rp, gp
    from public.jobs where job_id = jp;
  select state::text into sn from public.jobs where job_id = jn;
  select state::text into sc from public.jobs where job_id = jc;

  if sp <> 'retrying' then
    raise exception 'RESUMES-FAIL a job that finished a checkpoint became [%] instead of retrying', sp; end if;
  if gp <= 5 then
    raise exception 'RESUMES-FAIL no slice was granted: max_attempts is still %', gp; end if;
  if sn <> 'failed' then
    raise exception 'RESUMES-FAIL a job that finished nothing became [%] — the retry cap is gone', sn; end if;
  if sc <> 'failed' then
    raise exception 'RESUMES-FAIL a job past jobs.max_dequeues became [%] instead of failed', sc; end if;

  -- The round trip, which is where the first version of 0536 was wrong twice.
  perform app.requeue_retrying();
  select state::text into sp from public.jobs where job_id = jp;
  if sp <> 'queued' then
    raise exception 'RESUMES-FAIL requeue_retrying left the granted job in [%] — stuck for ever', sp; end if;

  perform app.dequeue_job(p_worker => 'verify-resumes', p_can_transcribe => true,
                          p_can_subprocess => true, p_kinds => null,
                          p_requested_by => 'verify:resumes');
  select state::text into sp from public.jobs where job_id = jp;
  if sp <> 'running' then
    raise exception 'RESUMES-FAIL the granted job would not dequeue, it is in [%]', sp; end if;

  raise exception 'RESUMES-PASS resumed and came back to [%], ceiling raised to %, no-progress [%], past-ceiling [%]',
    sp, gp, sn, sc;
end
$drive$;`

let said = ''
try {
  await db.execute(DRIVE)
  said = 'the drive returned without raising, which it cannot do'
} catch (error) {
  said = (error as Error).message.replace(/\s+/g, ' ')
}
const passed = said.includes('RESUMES-PASS')
check(
  passed,
  'a checkpointed job that ran out of wall clock resumes, and one that did nothing still dies',
  passed ? said.slice(said.indexOf('RESUMES-PASS')).slice(0, 190) : said.slice(0, 320),
)

const debris = await db.execute(
  `select count(*)::int as n from public.jobs where requested_by = 'verify:resumes'`,
)
check(
  Number(debris.rows[0]?.n ?? -1) === 0,
  'the drive left nothing behind',
  `${String(debris.rows[0]?.n)} job(s)`,
)

// The absolute bound has to exist, or the only thing standing between a
// pathological job and an endless loop is that progress happens to stop.
const ceiling = await db.execute(
  `select coalesce((select value::text::int from public.system_config
                     where key = 'jobs.max_dequeues'), -1) as n`,
)
const n = Number(ceiling.rows[0]?.n ?? -1)
check(n > 0, 'there is an absolute ceiling on dequeues', `jobs.max_dequeues = ${String(n)}`)

/*
  And the thing this was built for, as an observation rather than an
  assertion. How close the real nightly backup is running to its ceiling is a
  number worth printing every run; asserting on it would go red the night the
  database happens to be busy, which is not a defect.
*/
const backup = await db.execute(`
  select created_at::date::text as d, state::text as state, attempt, max_attempts
    from public.jobs where kind = 'office.backup'
   order by created_at desc limit 5`)
console.log('\nthe nightly backup, most recent first:')
for (const r of backup.rows) {
  console.log(
    `  ${String(r.d)}  ${String(r.state).padEnd(9)} slice ${String(r.attempt)} of ${String(r.max_attempts)}`,
  )
}

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed.`)
  process.exit(1)
}
console.log('\nA job that ran out of time resumes; a job that failed still dies.')

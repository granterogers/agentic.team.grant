/**
 * Is there a recent backup, and has a restore actually been proven?
 *
 *   npm run verify:backups
 *
 * ## The failure this exists for
 *
 * Invariant 13 of this run's brief: *backup health requires a recent backup
 * AND a proven restore.* Before 0537 neither half was measurable.
 *
 * `app.office_health()` reported finished, failed, in-flight, stalled,
 * waiting, open provider breakers and budget holds, and had **no idea whether
 * a backup existed**. So on 17 September, when the nightly backup died and
 * there is no copy of the database from that date, the reading said
 * `failed: 1` for twenty-four hours in a window nobody was watching, and then
 * said nothing at all — which is what it said before this run started, and
 * what it would say tonight if backups stopped for good.
 *
 * And `npm run backup:rehearse` printed a report and exited, so "when did a
 * restore last work" had no answer anywhere. It has one now, in
 * `public.events` as `backup.rehearsed` — the office's own ledger of what it
 * did, rather than a new table holding a fact that belongs in an existing one.
 *
 * ## What is asserted, and what is deliberately only printed
 *
 * The MECHANISMS are asserted: the reading exists, it distinguishes a
 * finished run from a half-finished upload, the chore raises exactly once and
 * clears when the condition clears, the writer refuses a verdict that is
 * neither pass nor fail, and `office_health` actually carries both readings.
 *
 * The AGES are printed, not asserted. `backup_overdue` going true is a real
 * finding and it is what the CHORE is for; a suite that failed on it would go
 * red for the one reason Grant most needs a calm, actionable message instead
 * — and CLAUDE.md is emphatic that a check which cries wolf is one somebody
 * starts overriding. The one exception is that a reading which cannot see any
 * backup at all fails here, because that means the reading itself is broken.
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
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const jsonOf = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>

// ── 1. The reading exists and can see a backup at all ──────────────────────
const health = jsonOf((await one(`select app.backup_health() as r`)).r)
check(
  health.newest_backup_at !== null && health.newest_backup_at !== undefined,
  'the reading can see a finished backup',
  `${String(health.newest_backup_objects)} object(s), ${String(health.newest_backup_age_hours)}h old`,
)

/*
  A FINISHED run, not just an object in the bucket.

  `src/backup/portable.ts` writes the manifest last, so a run folder holding
  one is a run that completed. Asserted as an identity rather than a count:
  every run folder is either finished or partial, so the two must add up to
  the number of folders. A count would go red the night a backup legitimately
  lands.
*/
const folders = await one(`
  select
    (select count(distinct split_part(name, '/', 1)) from storage.objects
      where bucket_id = 'backups' and name like 'run-%')::int as all_runs,
    (select count(*) from (
       select split_part(name, '/', 1) as r from storage.objects
        where bucket_id = 'backups' and name like '%manifest.json.gz'
        group by 1) x)::int as with_manifest`)
const allRuns = Number(folders.all_runs ?? -1)
const finished = Number(health.finished_backups_kept ?? -1)
const partial = Number(health.partial_uploads ?? -1)
check(
  finished === Number(folders.with_manifest) && finished + partial === allRuns,
  'a finished run and a half-finished upload are told apart',
  `${String(finished)} finished + ${String(partial)} partial = ${String(allRuns)} folder(s)`,
)

// ── 2. The gaps it must state rather than let a real recovery discover ─────
check(
  health.offsite === false && String(health.offsite_note ?? '').length > 80,
  'the reading states the offsite gap in words rather than omitting it',
  `offsite = ${String(health.offsite)}`,
)
check(
  'vault_exported' in health,
  'and the empty-vault gap, which is the dominant term in real RTO',
  `vault_exported = ${String(health.vault_exported)}`,
)

// ── 3. The writer refuses a verdict that is neither ────────────────────────
let refused = ''
try {
  await db.execute(`select app.record_rehearsal('probably')`)
  refused = '(it accepted "probably")'
} catch (error) {
  refused = (error as Error).message
}
check(
  refused.includes('either passed or failed'),
  'a rehearsal verdict is pass or fail, and anything else is refused by name',
  refused.slice(0, 90),
)

// ── 4. The chore: raises once, does not storm, clears when fixed ───────────
/*
  One statement ending in a raise, so it rolls back. `public.tasks` is Grant's
  real My Tasks list and `app.chores_for_backups` writes to it — a drive that
  committed would leave a chore about a condition the drive invented.
*/
const DRIVE = `
do $drive$
declare
  r1 jsonb; r2 jsonb; r3 jsonb; open1 int; open2 int;
begin
  -- Make the condition true whatever today's real state is, by moving the
  -- threshold rather than by deleting evidence. An append-only ledger cannot
  -- be un-written, and a suite that tried would be asserting against the
  -- ledger's own safety rule.
  update public.system_config set value = '0'::jsonb
   where key = 'backup.rehearsal_max_age_hours';

  r1 := app.chores_for_backups();
  select count(*) into open1 from public.tasks
   where chore_key = 'backup:unproven' and state <> 'done';

  r2 := app.chores_for_backups();
  select count(*) into open2 from public.tasks
   where chore_key = 'backup:unproven' and state <> 'done';

  update public.system_config set value = '192'::jsonb
   where key = 'backup.rehearsal_max_age_hours';
  r3 := app.chores_for_backups();

  if open1 <> 1 then
    raise exception 'BACKUP-FAIL an unproven restore raised % chores, expected 1', open1; end if;
  if open2 <> 1 or (r2->>'raised')::int <> 0 then
    raise exception 'BACKUP-FAIL a second pass made % open / % raised — it would alert-storm',
      open2, r2->>'raised'; end if;
  if (r3->>'cleared')::int < 1 then
    raise exception 'BACKUP-FAIL the chore did not clear when the condition cleared — the list never empties'; end if;

  raise exception 'BACKUP-DRIVE PASS raised=% second_pass_raised=% cleared=% open_after_two=%',
    r1->>'raised', r2->>'raised', r3->>'cleared', open2;
end
$drive$;`

let said = ''
try {
  await db.execute(DRIVE)
  said = 'the drive returned without raising, which it cannot do'
} catch (error) {
  said = (error as Error).message.replace(/\s+/g, ' ')
}
const drove = said.includes('BACKUP-DRIVE PASS')
check(
  drove,
  'the chore raises once, does not repeat itself, and clears when the backup is healthy',
  drove ? said.slice(said.indexOf('BACKUP-DRIVE')).slice(0, 150) : said.slice(0, 300),
)

const debris = await one(
  `select count(*)::int as n from public.tasks where chore_key like 'backup:%'`,
)
check(Number(debris.n ?? -1) === 0, 'the drive left no chore behind', `${String(debris.n)} task(s)`)

const threshold = await one(
  `select value::text as v from public.system_config where key = 'backup.rehearsal_max_age_hours'`,
)
check(
  String(threshold.v) === '192',
  'and put the threshold back',
  `backup.rehearsal_max_age_hours = ${String(threshold.v)}`,
)

/*
  And it is reachable from the door that is actually DEPLOYED (0540).

  The check that would otherwise be missing, and the one this repository's
  whole check:callers family exists for: chores_for_backups could be perfect
  and called by nothing. The handler that should call it is in
  src/handlers/chores.ts on an unmerged branch, and the worker was last
  deployed from a different branch entirely -- a migration is not a deploy.
  So app.chores_for_credentials, which office.chores calls by name every
  hour, delegates to it.

  Asserted through THAT function rather than the one under test, because
  "the pass works" and "the pass runs" are different claims and only the
  second one is about tonight.
*/
const REACH = `
do $reach$
declare r jsonb; open1 int;
begin
  update public.system_config set value = '0'::jsonb
   where key = 'backup.rehearsal_max_age_hours';

  r := app.chores_for_credentials();

  select count(*) into open1 from public.tasks
   where chore_key = 'backup:unproven' and state <> 'done';

  update public.system_config set value = '192'::jsonb
   where key = 'backup.rehearsal_max_age_hours';

  if r->'backup' is null then
    raise exception 'REACH-FAIL the deployed door does not report the backup pass at all'; end if;
  if open1 <> 1 then
    raise exception 'REACH-FAIL the deployed door raised % backup chores, expected 1', open1; end if;

  raise exception 'REACH-PASS the hourly credential pass reached the backup pass and raised %',
    r->'backup'->>'raised';
end
$reach$;`

let reachSaid = ''
try {
  await db.execute(REACH)
  reachSaid = 'the drive returned without raising, which it cannot do'
} catch (error) {
  reachSaid = (error as Error).message.replace(/\s+/g, ' ')
}
const reached = reachSaid.includes('REACH-PASS')
check(
  reached,
  'the hourly duty that IS deployed reaches the backup pass',
  reached
    ? reachSaid.slice(reachSaid.indexOf('REACH-PASS')).slice(0, 130)
    : reachSaid.slice(0, 300),
)

// ── 5. It is in the reading Grant's dashboard actually asks for ────────────
const office = jsonOf((await one(`select app.office_health(app.sole_person_office(), 24) as r`)).r)
check(
  'backup' in office && 'progress' in office,
  'office_health carries the backup and the progress readings',
  `keys: ${Object.keys(office).length}`,
)

/*
  And it must stay cheap enough to be consulted.

  `last_progress()` takes three `max(occurred_at)` by `to_state`; each was a
  1,227 ms sequential scan before 0538's index, on a table growing about six
  thousand rows a day. A reading that takes four seconds is a reading somebody
  stops asking for, which is how it stops being a reading at all.
*/
const plan = (
  await db.execute(
    `explain (format json) select max(occurred_at) from public.job_state_transitions
      where to_state = 'running'`,
  )
).rows
const planText = JSON.stringify(plan)
check(
  planText.includes('job_transitions_state_time_idx'),
  'and the progress reading uses its index rather than scanning the transition log',
  planText.includes('Seq Scan') ? 'SEQUENTIAL SCAN' : 'index scan',
)

/*
  ── The alert path, driven end to end ──────────────────────────────────────

  Proven on 21 September: a terminally failed nightly backup produced
  `impediments=1, chore=1, DELIVERIES=0`. Grant received nothing. 0543 makes
  the office page him from the DATABASE over pg_net, because an alert emitted
  by a job handler goes quiet exactly when the worker is what broke.

  ## Nothing here sends him anything

  `net.http_post` is transactional — measured, not assumed: a call inside a
  transaction takes `net.http_request_queue` from 0 rows to 1, and a rollback
  takes it back to 0. So every scenario below runs the REAL function, asserts
  the REAL request was enqueued to api.telegram.org with Grant's real chat id,
  and then rolls the whole thing back. The request never leaves.

  That is also why the subjects can be real rather than fixtures, which
  matters: a harness backup is excluded from paging BY DESIGN, so a fixture
  could not exercise the paging path at all. #45's question, answered the
  other way round.
*/
const PAGER = `
do $pager$
declare
  jh uuid; jr uuid; jok uuid; j1 uuid; j2 uuid;
  rh jsonb; rr jsonb; r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb;
  q0 int; q1 int; q2 int;
  body text;
begin
  /*
    Ordered so that nothing has to be un-written. public.events is
    append-only -- DELETE is refused by app.reject_ledger_mutation -- so the
    two cases that must NOT page are proved BEFORE the case that does.
    Each subject is made the newest office.backup job in turn.
  */

  -- 1. HARNESS NEVER PAGES. Excluded by app.harness_job, which since 0541
  --    includes the immutable synthetic mark.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by,
                           attempt, max_attempts, state, state_reason,
                           created_at, finished_at, synthetic)
  values (gen_random_uuid(), 'pager-probe-harness', 'office.backup',
          'verify:backups', 5, 5, 'failed', 'a harness backup that failed',
          now() + interval '1 minute', now() + interval '1 minute', true)
  returning job_id into jh;
  select count(*) into q0 from net.http_request_queue;
  rh := app.page_backup_failure();
  if (rh->>'paged')::int <> 0 then
    raise exception 'PAGER-FAIL A HARNESS FAILURE PAGED GRANT: %', rh; end if;
  if (select count(*) from net.http_request_queue) <> q0 then
    raise exception 'PAGER-FAIL a harness failure enqueued an HTTP request'; end if;

  -- 2. RECOVERY. A real failure that a later backup made good must not page.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by,
                           attempt, max_attempts, state, state_reason, created_at, finished_at)
  values (gen_random_uuid(), 'pager-probe-recovered', 'office.backup',
          'duty:nightly-backup', 5, 5, 'failed', 'failed, but the next one worked',
          now() + interval '2 minutes', now() + interval '2 minutes')
  returning job_id into jr;
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by,
                           state, created_at, finished_at)
  values (gen_random_uuid(), 'pager-probe-success', 'office.backup',
          'duty:nightly-backup', 'complete',
          now() + interval '3 minutes', now() + interval '3 minutes')
  returning job_id into jok;
  rr := app.page_backup_failure();
  if (rr->>'paged')::int <> 0 then
    raise exception 'PAGER-FAIL it paged about a failure already made good: %', rr; end if;
  if (select count(*) from net.http_request_queue) <> q0 then
    raise exception 'PAGER-FAIL a recovered failure enqueued an HTTP request'; end if;

  -- 3. THE REAL THING. A terminal failure nothing has made good since.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by,
                           attempt, max_attempts, state, state_reason, created_at, finished_at)
  values (gen_random_uuid(), 'pager-probe-terminal', 'office.backup',
          'duty:nightly-backup', 5, 5, 'failed',
          'recovery: 5 attempts exhausted while in running',
          now() + interval '4 minutes', now() + interval '4 minutes')
  returning job_id into j1;
  r1 := app.page_backup_failure();
  select count(*) into q1 from net.http_request_queue;
  select convert_from(q.body, 'utf8') into body
    from net.http_request_queue q order by q.id desc limit 1;

  if (r1->>'paged')::int <> 1 then
    raise exception 'PAGER-FAIL a real unrecovered terminal failure did not page: %', r1; end if;
  if q1 <> q0 + 1 then
    raise exception 'PAGER-FAIL no HTTP request was enqueued (% -> %)', q0, q1; end if;
  if coalesce(body, '') not like '%api.telegram.org%' and
     coalesce((select convert_from(q.url::bytea, 'utf8') from net.http_request_queue q
                order by q.id desc limit 1), '') not like '%api.telegram.org%' then
    raise exception 'PAGER-FAIL the request does not go to Telegram'; end if;
  if coalesce(body, '') not like '%1386648496%' then
    raise exception 'PAGER-FAIL the request does not carry Grant chat id: %',
      left(coalesce(body, ''), 160); end if;
  if coalesce(body, '') not like '%backup:now%' then
    raise exception 'PAGER-FAIL the message does not say what to do: %',
      left(coalesce(body, ''), 200); end if;

  -- 4. EXACTLY ONCE.
  r2 := app.page_backup_failure();
  select count(*) into q2 from net.http_request_queue;
  if (r2->>'why') <> 'already paged' then
    raise exception 'PAGER-FAIL a second call said [%] rather than already paged', r2->>'why'; end if;
  if q2 <> q1 then
    raise exception 'PAGER-FAIL a second request was enqueued (% -> %)', q1, q2; end if;

  -- 5. NO STORM. A different failed night inside the cooldown.
  insert into public.jobs (correlation_id, idempotency_key, kind, requested_by,
                           attempt, max_attempts, state, state_reason, created_at, finished_at)
  values (gen_random_uuid(), 'pager-probe-second', 'office.backup',
          'duty:nightly-backup', 5, 5, 'failed', 'another night, also failed',
          now() + interval '5 minutes', now() + interval '5 minutes')
  returning job_id into j2;
  r3 := app.page_backup_failure();
  if (r3->>'why') <> 'cooling down' then
    raise exception 'PAGER-FAIL a second failed night said [%] rather than cooling down',
      r3->>'why'; end if;
  if (select count(*) from net.http_request_queue) <> q1 then
    raise exception 'PAGER-FAIL the cooldown still enqueued a request'; end if;

  /*
    6. A PAGE THAT DID NOT LAND DOES NOT COUNT (0544).

    The first real page timed out after 5000 ms on a cold DNS lookup and was
    lost, while the ledger recorded it as paged. Exactly-once has to mean
    exactly-once DELIVERED, so positive evidence of failure must re-open it.
    Simulated by giving the recorded request a timed-out response row.
  */
  insert into net._http_response (id, status_code, content_type, headers, content,
                                  timed_out, error_msg)
  values ((r1->>'request_id')::bigint, null, null, null, null, true,
          'Timeout of 5000 ms reached. Total time: 5000.263000 ms (DNS ...)')
  ;

  r4 := app.page_backup_failure();
  if (r4->>'paged')::int <> 1 then
    raise exception 'PAGER-FAIL a page that demonstrably TIMED OUT still counted as delivered: %', r4; end if;

  raise exception 'PAGER-PASS harness=[%] recovered=[%] paged=% again=[%] storm=[%] retried_after_timeout=% to_grant=yes actionable=yes',
    rh->>'why', rr->>'why', r1->>'paged', r2->>'why', r3->>'why', r4->>'paged';
end
$pager$;`

let pagerSaid = ''
try {
  await db.execute(PAGER)
  pagerSaid = 'the drive returned without raising, which it cannot do'
} catch (error) {
  pagerSaid = (error as Error).message.replace(/\s+/g, ' ')
}
const paged = pagerSaid.includes('PAGER-PASS')
check(
  paged,
  'a terminal backup failure PAGES Grant — once, not in a storm, never for harness traffic',
  paged ? pagerSaid.slice(pagerSaid.indexOf('PAGER-PASS')).slice(0, 190) : pagerSaid.slice(0, 320),
)

const nothingSent = await one(`select count(*)::int as n from net.http_request_queue`)
check(
  Number(nothingSent.n ?? -1) === 0,
  'and the drive sent nothing — every request it made was rolled back',
  `${String(nothingSent.n)} request(s) queued`,
)

/*
  The alert rides pg_cron, not a duty. A page emitted by the worker is a page
  that goes quiet when the worker is the thing that broke (invariant 14), so
  its schedule is asserted here rather than assumed.
*/
const sched = await one(
  `select coalesce((select schedule from cron.job where jobname = 'backup-pager'), '') as s,
          coalesce((select active from cron.job where jobname = 'backup-pager'), false) as on`,
)
check(
  String(sched.s) !== '' && sched.on === true,
  'the pager runs on pg_cron, independent of the worker it watches',
  String(sched.s) === '' ? 'NO SCHEDULE' : `${String(sched.s)}, active=${String(sched.on)}`,
)

// ── What the state actually is. Printed, deliberately not asserted. ────────
console.log('\nbackup posture right now:')
console.log(`  newest finished backup     ${String(health.newest_backup_age_hours)}h ago`)
console.log(`  overdue?                   ${String(health.backup_overdue)}`)
console.log(
  `  last restore PROVEN        ${String(health.last_passing_rehearsal_at ?? 'never')}${
    health.last_rehearsal_outcome === undefined ? '' : ` (${String(health.last_rehearsal_outcome)})`
  }`,
)
console.log(`  rehearsal overdue?         ${String(health.rehearsal_overdue)}`)
console.log(`  copies kept                ${String(finished)} finished, ${String(partial)} partial`)
console.log(`  offsite copy               ${health.offsite === true ? 'yes' : 'NO'}`)
console.log(
  `  vault exported             ${health.vault_exported === true ? 'yes' : 'NO — a restore yields an empty vault'}`,
)

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed.`)
  process.exit(1)
}
console.log('\nThe backup is visible, and a proven restore is a thing the office can know.')

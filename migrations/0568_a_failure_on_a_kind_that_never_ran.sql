-- Grant's morning briefing has named two test fixtures as failures for five
-- days, and they were the ONLY two rows in it.
--
--     noticeproof.mu6wxsku and noticeproof.mu6ww50g have each failed three
--     times since 18 Sep; the next attempt will be unchanged.
--
-- app.recurring_failures returned exactly those two and nothing else. Both are
-- debris from crashed runs of verify:notice, which writes a signature against
-- a REAL job on purpose -- that is its whole point, proving a genuine failure
-- still surfaces past the harness filter -- so 0491's guard
-- (not app.harness_job(last_job_id)) cannot see them by construction.
--
-- The property that separates them is exact rather than a name. The product
-- writes signatures from one place, src/jobs/worker.ts, as
-- app.failure_seen(job.kind, ...) -- so a real signature ALWAYS names a kind
-- some job has had. The whole table today is 2 rows and 0 of them do. Jobs are
-- never deleted (job_state_transitions holds them), so a legitimate signature
-- can never outlive every job of its kind.
--
-- Fixed at the READER rather than by sweeping the two rows, because a sweep
-- fixes today and this closes the class: no harness, present or future, can
-- reach his briefing through a kind the office has never run.

create or replace function app.recurring_failures(p_least integer default 3, p_days integer default 14)
returns table(job_kind text, error_class text, subject text, seen integer,
              first_seen timestamptz, last_seen timestamptz, last_job_id uuid)
language sql
stable
security definer
set search_path to ''
as $fn$
  select f.job_kind, f.error_class, f.subject, f.seen, f.first_seen, f.last_seen, f.last_job_id
    from public.failure_signatures f
   -- Belt and braces with the writer (0491): a signature whose last job is
   -- a suite's never reaches Grant, however it got into the table.
   where (f.last_job_id is null or not app.harness_job(f.last_job_id))
     -- And a kind the office has never run is not something that failed.
     -- The writer composes this from jobs.kind, so a real one always matches.
     and exists (select 1 from public.jobs j where j.kind = f.job_kind)
     and f.seen >= greatest(coalesce(p_least, 3), 2)
     and f.last_seen > app.now_utc() - make_interval(days => coalesce(p_days, 14))
   order by f.seen desc, f.last_seen desc
$fn$;

comment on function app.recurring_failures(integer, integer) is
  'What has failed repeatedly, for the morning briefing. Excludes a signature '
  'whose last job was a suite''s (0491) AND one naming a job kind the office '
  'has never run (0568) -- verify:notice attaches its proof to a real job on '
  'purpose, so the first guard cannot see it, and two of its crashed runs sat '
  'in Grant''s briefing for five days as the only two rows in it.';

-- And drive it, because a migration that applies cleanly is not a function
-- that works. Both debris rows must disappear from the reader.
do $drive$
declare
  v_left int;
begin
  select count(*) into v_left
    from app.recurring_failures(3, 14) f
   where not exists (select 1 from public.jobs j where j.kind = f.job_kind);
  if v_left > 0 then
    raise exception 'the reader still returns % signature(s) for a kind nothing ever ran', v_left;
  end if;
end
$drive$;

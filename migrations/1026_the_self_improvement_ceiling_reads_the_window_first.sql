-- 1026 - the self-improvement ceiling reads the usage window first (efficiency run, 5 to 6 October 2026; NOT applied to production).
--
-- WHAT WAS MEASURED (replica seeded to production's 5 Oct shape; scripts/forensics/resource-probe.ts). Every worker pass asks
-- app.self_improvement_within_budget() when it dequeues (src/jobs: the ceiling on the office improving itself, 0216). On an EMPTY
-- pass that one function was the only statement that touched the jobs table's heap: one sequential scan of all 22,603 jobs, 5,794
-- buffer hits and 10 ms, of a pass whose other 71 statements cost 212 hits between them. The worker pass runs every minute, so
-- that is a full read of the hottest table in the database 1,440 times a day, to answer "how many tokens did self-improvement
-- jobs spend in the last 24 hours", a window holding about 160 usage rows.
--
-- WHY. app.self_improvement_spent joined inference_usage to jobs and filtered on the job's kind and fixture flag. The planner
-- chose to hash every non-fixture job against the usage window because that looked cheaper than 160 primary-key probes. The
-- usage window is the small side by two orders of magnitude, and the window is the question.
--
-- WHAT CHANGED. The window's usage rows are taken first (inference_usage_by_time serves it) in a MATERIALIZED step, and each is
-- tested against its own job by primary key as a per-row subplan, which the planner cannot turn into a hash of all jobs. An
-- inference row with no job is excluded exactly as the inner join excluded it (the subplan returns null, and only true passes).
-- 2,120 -> 796 buffer hits and 14 ms -> 3 ms for the function on the replica; the jobs sequential scan is gone.
-- WHAT DOES NOT CHANGE. The same sum over the same rows (self-improvement kinds, not a fixture job, inside the window). The
-- ceiling, its default, and every caller are untouched. No effect on whether a job may run: the comparison is identical.
--
-- Proof: scripts/isolated/self-improvement-equivalence.ts runs the frozen 0216 definition beside this one, with edge rows
-- (a self-improvement job, an ordinary job, a fixture job, usage with no job, usage just inside and outside the window) in a
-- rolled-back transaction, and requires equal results, with controls that must be able to fail.
-- Roll back by re-applying the 0216 definition of app.self_improvement_spent (create or replace; no data changed).

begin;

CREATE OR REPLACE FUNCTION app.self_improvement_spent(p_hours integer DEFAULT 24)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with w as materialized (
    select u.job_id, u.prompt_tokens, u.completion_tokens
      from public.inference_usage u
     where u.occurred_at > (select app.now_utc() - (greatest(coalesce(p_hours, 24), 1) || ' hours')::interval)
  )
  select coalesce(sum(w.prompt_tokens + w.completion_tokens), 0)::bigint
    from w
   where (select j.kind in (select kind from public.self_improvement_kinds) and not j.is_fixture
            from public.jobs j where j.job_id = w.job_id) is true
$function$;

commit;

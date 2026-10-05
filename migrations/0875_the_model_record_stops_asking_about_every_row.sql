-- Two reads that ran on every model call and every budget check, doing far more work than the question needs (P0, 4 Oct).
--
-- Evidence (pg_stat_statements since 2 September, then a warm timing of each piece, not an EXPLAIN ANALYZE):
--   * app.model_order runs once per model call (about 12,500 calls) and cost 370-470 ms warm and 4.8 s cold, 68 blocks
--     read a call. 98 percent of it is public.model_record asking app.harness_job() about every usage row (16,274 rows
--     over 4,419 distinct jobs). harness_job is security definer with a pinned search path, so it cannot be inlined and
--     each call is a real function call.
--   * 3,789 of those 4,419 jobs are already named by two cheap generated columns on the job row itself (synthetic,
--     is_fixture), which is the first thing harness_job tests. Only 630 need the function.
--   * app.spent_today (inside app.over_budget, up to four times a check) filters jobs on finished_at, and jobs has no
--     index on it, so every call reads the 94 MB heap of a 22,000 row table on a host with about 434 MiB of memory.
--
-- What this changes, and what it does not:
--   * public.model_record returns exactly the same rows. A usage row is excluded when its job is harness work, and the
--     two cheap flags are the first terms of harness_job, so testing them first can only decide the same way sooner.
--     The function is still asked, for every job the flags do not already name. A usage row with no job, or a job id
--     that no longer exists, is still included (a missing job is not harness work), which is why the flags are
--     coalesced to false rather than left null.
--   * A partial index on jobs(finished_at) where the job spent something. It is the predicate spent_today already has.
--
-- Not changed: harness_job itself (about twenty-five readers rely on it, and the safe direction there is the strict
-- one), the budget arithmetic, the order a model is chosen in, and anything an office can see.

begin;

create or replace view public.model_record as
 select u.provider,
    u.model_id,
    coalesce(j.kind, '(unattributed)'::text) as kind,
    count(*) as tried,
    count(*) filter (where (u.outcome = 'ok'::text)) as good,
    round(((count(*) filter (where (u.outcome = 'ok'::text)))::numeric / (nullif(count(*), 0))::numeric), 4) as rate,
    max(u.occurred_at) as last_tried_at
   from (public.inference_usage u
     left join public.jobs j on ((j.job_id = u.job_id)))
  where ((u.outcome = any (array['ok'::text, 'empty_completion'::text, 'malformed_response'::text]))
    and ((u.job_id is null)
      or not (coalesce(j.synthetic, false) or coalesce(j.is_fixture, false) or coalesce(app.harness_job(u.job_id), false))))
  group by u.provider, u.model_id, coalesce(j.kind, '(unattributed)'::text);

create index if not exists jobs_finished_with_spend_idx
  on public.jobs (finished_at)
  where coalesce(trace_pence, 0) > 0;

commit;

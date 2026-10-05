-- 0875 put the cheap harness flags first and the planner took them back out (P0, 4 Oct).
--
-- 0875 wrote the exclusion as  job_id is null or not (synthetic or is_fixture or harness_job(job_id)).  Postgres converts
-- that to an AND of ORs and pushes every conjunct that mentions only one table down to that table's scan, so
-- (job_id is null or not harness_job(job_id)) was evaluated against ALL 16,274 usage rows before the join, exactly the
-- work 0875 meant to avoid (EXPLAIN showed it as the filter on the scan of inference_usage, and a warm model_order stayed
-- at about 430 ms). The set of rows returned was identical, which is why the comparison passed and the timing did not.
--
-- A CASE expression is not rewritten that way, and it evaluates its arms in order, so the function is asked only for a
-- job the cheap flags did not already name. Same rows as before, by construction:
--   no job on the row                    -> included   (it was: job_id is null)
--   the job is flagged synthetic/fixture -> excluded   (harness_job tests those two first and would say true)
--   otherwise                            -> included unless harness_job says it is harness work
-- A job id with no row in jobs is still included (the flags are coalesced to false and harness_job says false for it).
--
-- Comparison against the live definition before applying (both directions of EXCEPT, 27 rows each) and the warm timing
-- before and after are recorded in docs/ops/supabase-efficiency-2026-10-04.md.

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
    and (case
           when u.job_id is null then true
           when coalesce(j.synthetic, false) or coalesce(j.is_fixture, false) then false
           else not coalesce(app.harness_job(u.job_id), false)
         end))
  group by u.provider, u.model_id, coalesce(j.kind, '(unattributed)'::text);

commit;

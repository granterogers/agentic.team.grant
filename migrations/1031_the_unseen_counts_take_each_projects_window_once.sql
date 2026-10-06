-- 1031 - the unseen counts compute each project's window once (efficiency run, 6 October 2026; NOT applied to production).
--
-- WHAT WAS MEASURED (replica seeded to production shape, nothing else on the database; scripts/forensics/resource-probe.ts, nested
-- statements counted). After 1025, app.studio_unseen still made 150,177 calls of `select now()` per call and 498 ms. The caller of
-- those is app.now_utc(), which sits in each project's `since` expression, and `since` is a column of the CTE `mine`. A CTE read
-- once is inlined, so `since` is re-evaluated, now_utc() and all, for every candidate row the four correlated counts compare
-- against it (`d.created_at > m.since`, one evaluation per document, task, output and impediment row examined).
--
-- WHAT CHANGED. `mine` is MATERIALIZED: the project list and each project's window start are computed once per project (six rows
-- on the seed), and the counts compare against a stored value. Nothing else in the function changes.
-- 150,177 -> 70 statements and 498 -> 190 ms for the call; buffers touched are the same (226k) because the counts still read the
-- same rows; the saving is the function-call overhead of the window, per row.
--
-- WHAT DOES NOT CHANGE. The result, key for key; the window; the harness question (still asked of the outputs in the window
-- only); office isolation (app.require_office first, every read bound to p_office). `now_utc()` is the transaction time, so one
-- evaluation and many return the same value.
--
-- Proof: scripts/isolated/page-readers-equivalence.ts (it compares studio_unseen with the frozen pre-1025 definition on every office
-- with edge rows, and has sabotage controls); run it after applying this. Roll back by re-applying the 1025 definition of
-- app.studio_unseen (create or replace; no data changed).

begin;

CREATE OR REPLACE FUNCTION app.studio_unseen(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
with mine as materialized (
  select p.project_id, p.slug,
         greatest(
           coalesce((select s.at from public.project_seen s
                      where s.owner = app.office_actor(p_office) and s.project_id = p.project_id),
                    p.created_at),
           app.now_utc() - interval '7 days') as since
    from public.projects p
   where p.office_id = p_office and p.status = 'active' and not p.is_fixture
),
counted as (
  select m.slug,
         (select count(*) from public.documents d
           where d.office_id = p_office and d.project_id = m.project_id and d.created_at > m.since
             and coalesce(d.state, 'live') <> 'superseded') as docs,
         (select count(*) from public.tasks t
           where t.office_id = p_office and t.project_id = m.project_id and t.created_at > m.since
             and not coalesce(t.is_fixture, false)) as tasks,
         /*
           Outputs, through the job, because `outputs` has no project of its
           own - CLAUDE.md's own note about this join. An output exists only
           when a job produced one, which is the "finished" the first rule asks
           for: there is no such thing as an output from a job that is still
           thinking.

           The window comes first: the inner select (OFFSET 0 keeps the planner from folding it into the outer one) returns only
           the outputs newer than the project's last-seen time, and the harness question is asked of those jobs, not of every job
           the project has ever run.
         */
         (select count(*) from (
             select j.job_id
               from public.outputs o
               join public.jobs j on j.job_id = o.job_id
              where j.office_id = p_office and j.project_id = m.project_id and o.created_at > m.since
             offset 0) w
           where not coalesce(app.harness_job(w.job_id), false)) as answers,
         (select count(*) from public.job_impediments i
           where i.project_id = m.project_id and i.created_at > m.since
             and exists (select 1 from public.jobs ij where ij.job_id = i.job_id and ij.office_id = p_office)
             and not coalesce(i.is_fixture, false)) as walls
    from mine m
)
select coalesce(jsonb_object_agg(c.slug, jsonb_build_object(
         'n', c.docs + c.tasks + c.answers + c.walls,
         'docs', c.docs, 'tasks', c.tasks, 'answers', c.answers, 'walls', c.walls)),
       '{}'::jsonb)
  from counted c
 where c.docs + c.tasks + c.answers + c.walls > 0
  );
end
$function$;

commit;

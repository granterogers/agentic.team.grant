-- 1025 - the page-load readers ask the window before they ask the harness question (efficiency run, 5 to 6 October 2026; NOT applied
-- to production).
--
-- WHAT WAS MEASURED (replica seeded to production's 5 Oct shape; scripts/forensics/resource-probe.ts, per call, nested statements counted):
--   studio_unseen    1.48 s   1,969,521 buffer hits   183,743 statements
--   studio_team_work 0.45 s     733,276 buffer hits    20,363 statements
--   hq_studio_lately 0.42 s     681,997 buffer hits    34,568 statements
-- Team HQ reads all three on page load and on every refresh. They are the same defect as 1023 and 1024, one reader each.
--
-- WHY. app.harness_job(job_id) is several index probes up the parent chain and is costed as a function call; so is app.now_utc()
-- (it has a SET clause and cannot be inlined). A window written against either a CTE column (`since s ... j.created_at > s.t`) or
-- the outer row (`o.created_at > m.since`) is a join qual that the planner may not order before the function, and a function qual
-- on one side of a join is pushed down onto that side's scan. So each reader asked the harness question of every job the office has
-- ever had (or every job of the project) and only then applied a window that keeps a few hundred.
--
-- WHAT CHANGED, reader by reader.
--   studio_team_work  the window start is a plpgsql variable (a parameter to the query: cheap, so it runs before the harness
--                     question). real_jobs is still one shared set, now of the window's jobs only.
--   hq_studio_lately  MOVED to 1029: it depends on 0920 (app.event_via_label), which production has not applied.
--   studio_unseen     the window is per project (the project's last-seen time), so it cannot be a single variable. The outputs
--                     in the window are taken in a subquery with OFFSET 0, which the planner will not pull up or push a function
--                     qual through, and the harness question is asked of those rows only.
-- WHAT DOES NOT CHANGE. The same rows are counted by the same predicates (app.harness_job itself is untouched: about twenty-five
-- readers depend on it and its strict direction is the safe one). Every key of every jsonb, in the same shape. Office isolation:
-- each function still starts with app.require_office(p_office) and every read is bound to p_office.
-- Proof: scripts/isolated/page-readers-equivalence.ts runs the frozen previous definitions beside these on every office, with edge
-- rows (harness jobs in and out of the windows, a stale seen-time) in a rolled-back transaction, and requires equal jsonb.
-- Roll back by re-applying the previous definitions (create or replace; no data changed): the 0920 definition of hq_studio_lately
-- and the definitions in scripts/isolated/reference/page-readers.pre-1025.sql.

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
with mine as (
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

CREATE OR REPLACE FUNCTION app.studio_team_work(p_office uuid, p_days integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  -- Computed once. As a parameter this qual is cheap and runs before app.harness_job; as a CTE column it ran after it, for every
  -- job the office has ever had.
  v_since timestamptz := app.now_utc() - make_interval(days => greatest(1, coalesce(p_days, 14)));
begin
  perform app.require_office(p_office);
  return (
with real_jobs as (
  select j.job_id, j.recipient_agent, j.state, j.created_at, j.project_id
    from public.jobs j
   where j.office_id = p_office and j.recipient_agent is not null
     and j.created_at > v_since
     and not coalesce(app.harness_job(j.job_id), false)
),
per as (
  select st.slug, st.name, st.title,
         (select count(*) from real_jobs r where r.recipient_agent = st.slug) as asked,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug and r.state = 'complete') as answered,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug and r.state = 'failed') as failed,
         (select count(*) from public.job_impediments i
           where i.staff_slug = st.slug and i.created_at > v_since
             and i.job_id in (select ij.job_id from public.jobs ij where ij.office_id = p_office)
             and not coalesce(i.is_fixture, false)) as could_not,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug
             and r.state not in ('complete', 'failed', 'cancelled')) as in_hand
    from public.staff st
   where st.active
),
made as (
  select r.recipient_agent as slug,
         jsonb_agg(jsonb_build_object(
           'title', d.title,
           'at', d.created_at,
           'project', (select p.name from public.projects p where p.project_id = d.project_id and p.office_id = p_office))
           order by d.created_at desc) as items
    from public.documents d
    join real_jobs r on r.job_id = d.produced_by_job and d.office_id = p_office
   group by r.recipient_agent
),
/*
  What they could not do, in their own words.

  The impediment's `needed` is the sentence the agent wrote about what stopped
  it, which is more useful than a count and is the whole point of showing
  failures at all - "3 could not" tells him to look, and this is what he finds.
*/
walls as (
  select i.staff_slug as slug,
         jsonb_agg(jsonb_build_object('needed', i.needed, 'at', i.created_at)
                   order by i.created_at desc) as items
    from public.job_impediments i
   where i.created_at > v_since and not coalesce(i.is_fixture, false)
     and i.job_id in (select ij.job_id from public.jobs ij where ij.office_id = p_office)
   group by i.staff_slug
)
select coalesce(jsonb_object_agg(per.slug, jsonb_build_object(
         'name', per.name, 'title', per.title,
         'asked', per.asked, 'answered', per.answered,
         'failed', per.failed, 'could_not', per.could_not, 'in_hand', per.in_hand,
         -- Three is a card, not a list. The rest is one press away on the
         -- agent's own screen.
         'made', coalesce((select jsonb_agg(x) from jsonb_array_elements(
                    (select m.items from made m where m.slug = per.slug)) with ordinality t(x, i)
                    where i <= 3), '[]'::jsonb),
         'walls', coalesce((select jsonb_agg(x) from jsonb_array_elements(
                    (select w.items from walls w where w.slug = per.slug)) with ordinality t(x, i)
                    where i <= 2), '[]'::jsonb))), '{}'::jsonb)
  from per
  );
end
$function$;

commit;

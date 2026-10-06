-- ROLLBACK for migration 1025: restores the predecessor definitions of app.studio_unseen(uuid) and app.studio_team_work(uuid, integer).
-- Exact bodies production ran before 1025, from the production-equivalent replica. app.hq_studio_lately is NOT touched by this
-- release (its change is migration 1029, held). Data: none changes. Grants and owner: unchanged. Apply only with
-- scripts/rollout/step.ts.

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
         */
         (select count(*) from public.outputs o
            join public.jobs j on j.job_id = o.job_id
           where j.office_id = p_office and j.project_id = m.project_id and o.created_at > m.since
             and not coalesce(app.harness_job(j.job_id), false)) as answers,
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
begin
  perform app.require_office(p_office);
  return (
with since as (select app.now_utc() - make_interval(days => greatest(1, coalesce(p_days, 14))) as t),
real_jobs as (
  select j.job_id, j.recipient_agent, j.state, j.created_at, j.project_id
    from public.jobs j, since s
   where j.office_id = p_office and j.recipient_agent is not null
     and j.created_at > s.t
     and not coalesce(app.harness_job(j.job_id), false)
),
per as (
  select st.slug, st.name, st.title,
         (select count(*) from real_jobs r where r.recipient_agent = st.slug) as asked,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug and r.state = 'complete') as answered,
         (select count(*) from real_jobs r
           where r.recipient_agent = st.slug and r.state = 'failed') as failed,
         (select count(*) from public.job_impediments i, since s
           where i.staff_slug = st.slug and i.created_at > s.t
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
    from public.job_impediments i, since s
   where i.created_at > s.t and not coalesce(i.is_fixture, false)
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

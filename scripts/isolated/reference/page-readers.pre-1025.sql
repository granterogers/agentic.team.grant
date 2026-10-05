-- FROZEN reference copies of three page-load readers as they stood in production on 5 October 2026 (before migration 1025).
-- scripts/isolated/page-readers-equivalence.ts runs them beside the optimised definitions and requires equal results.
-- Do not "improve" this file. Lives in its own schema so the product can never call it.
create schema if not exists proof_ref;

CREATE OR REPLACE FUNCTION proof_ref.studio_unseen(p_office uuid)
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

CREATE OR REPLACE FUNCTION proof_ref.studio_team_work(p_office uuid, p_days integer DEFAULT 14)
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

CREATE OR REPLACE FUNCTION proof_ref.hq_studio_lately(p_office uuid, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with
  recent as (
    select e.event_id, e.actor, e.actor_kind, e.action_type, e.rationale_summary,
           e.project_id, e.occurred_at, e.reversible, e.reversal_method,
           p.name as project_name,
           app.event_via_label(e.origin_channel, e.related_job_id, e.action_type, e.actor_kind) as via,
           app.activity_category(e.action_type) as category
      from public.events e
      left join public.projects p on p.project_id = e.project_id and p.office_id = p_office
     where e.office_id = p_office
       and (p.project_id is null or not p.is_fixture)
       and not app.harness_label(e.actor)
       and (e.related_job_id is null or not app.harness_job(e.related_job_id))
     order by e.occurred_at desc
     limit greatest(coalesce(p_limit, 40), 1) * 10
  ),
  ranked as (
    select r.*,
           row_number() over (partition by r.actor, r.action_type, r.project_id, r.via
                              order by r.occurred_at desc) as n
      from recent r
  ),
  kept as (
    select jsonb_build_object(
             'id', k.event_id,
             'who', case when k.actor is not distinct from app.office_actor(p_office) then 'you' else k.actor end,
             'kind', k.actor_kind,
             'verb', app.action_in_words(k.action_type) ->> 'verb',
             'what', app.action_in_words(k.action_type) ->> 'what',
             'why', k.rationale_summary,
             'project', k.project_name,
             'when', to_char(k.occurred_at, 'FMDD Mon HH24:MI'),
             'at', k.occurred_at,
             'reversible', k.reversible,
             'undo_with', k.reversal_method,
             'via', k.via,
             'category', k.category
           ) as v, k.occurred_at as at
      from ranked k
     where k.n <= 2
  ),
  folded as (
    select jsonb_build_object(
             'id', null,
             'who', case when f.actor is not distinct from app.office_actor(p_office) then 'you' else f.actor end,
             'kind', min(f.actor_kind),
             'verb', app.action_in_words(f.action_type) ->> 'verb',
             'what', app.action_in_words(f.action_type) ->> 'what',
             'why', null,
             'project', min(f.project_name),
             'when', to_char(max(f.occurred_at), 'FMDD Mon HH24:MI'),
             'at', max(f.occurred_at),
             'times', count(*)::int,
             'reversible', false,
             'undo_with', null,
             'via', f.via,
             'category', min(f.category)
           ) as v, max(f.occurred_at) as at
      from ranked f
     where f.n > 2
     group by f.actor, f.action_type, f.project_id, f.via
  ),
  office as (
    select coalesce(jsonb_agg(x.v order by x.at desc), '[]'::jsonb) as v
      from (
        select v, at from kept
        union all
        select v, at from folded
        order by at desc
        limit greatest(coalesce(p_limit, 40), 1)
      ) x
  ),
  building as (select case when app.office_sees_the_deployment(p_office) then app.hq_build() else '{}'::jsonb end as v),
  today as (
    select jsonb_build_object(
      'events', (select count(*)::int
                   from public.events e
                   left join public.projects p on p.project_id = e.project_id and p.office_id = p_office
                  where e.office_id = p_office
                    and e.occurred_at > app.now_utc() - interval '24 hours'
                    and not app.harness_label(e.actor)
                    and (e.related_job_id is null or not app.harness_job(e.related_job_id))
                    and (p.project_id is null or not p.is_fixture)),
      'jobs_done', (select count(*)::int from public.jobs j
                     where j.office_id = p_office and not app.harness_job(j.job_id) and j.state = 'complete'
                       and j.updated_at > app.now_utc() - interval '24 hours'),
      'jobs_failed', (select count(*)::int from public.jobs j
                       where j.office_id = p_office and not app.harness_job(j.job_id) and j.state = 'failed'
                         and j.updated_at > app.now_utc() - interval '24 hours')
    ) as v
  )
  select jsonb_build_object(
    'office', (select v from office),
    'building', (select v from building),
    'today', (select v from today),
    'generated_at', app.now_utc()
  )
  );
end
$function$;

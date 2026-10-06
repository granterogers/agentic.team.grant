-- 1029 - the activity panel's reader asks its 24-hour window before it asks the harness question (efficiency run; NOT applied to
-- production). Split out of 1025 because it DEPENDS ON 0920 (app.event_via_label, public.events.origin_channel): production's
-- applied line stops at 0891 plus 0897-0905, so applying this one before 0920 would fail at run time (plpgsql bodies are not checked
-- at create). Apply it only after Q1 shows 0920 applied.
--
-- WHAT WAS MEASURED (replica seeded to production's 5 Oct shape): hq_studio_lately 0.42 s, 681,997 buffer hits, 34,568 statements.
-- WHY and WHAT CHANGED: see 1025. The 24-hour start is a plpgsql variable (a parameter: cheap, so it runs before the harness
-- question) and the three "today" counts get the same window first. The same rows are counted by the same predicates; every key of
-- the jsonb is unchanged; each read is bound to p_office after app.require_office(p_office).
-- Proof: scripts/isolated/page-readers-equivalence.ts (lately section) against scripts/isolated/reference/studio-activity.0920.sql.
-- Roll back by re-applying the 0920 definition of app.hq_studio_lately (create or replace; no data changed).

begin;

CREATE OR REPLACE FUNCTION app.hq_studio_lately(p_office uuid, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  -- The "today" window, computed once: a parameter is cheap and runs before the harness question (see 1025).
  v_day timestamptz := app.now_utc() - interval '24 hours';
begin
  perform app.require_office(p_office);
  return (
  with
  -- A window to summarise from, deliberately wider than the page: collapsing
  -- forty rows into eight and then showing eight is a shorter page, not a
  -- better one.
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
  -- The rest of each group, as one row that says how many and when the last of
  -- them was. Placed at the newest of the ones it stands for, so it sits
  -- directly under the two that are shown rather than at the bottom of the day.
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
  -- the build log is the deployment's own: only its operator reads it
  building as (select case when app.office_sees_the_deployment(p_office) then app.hq_build() else '{}'::jsonb end as v),
  today as (
    select jsonb_build_object(
      'events', (select count(*)::int
                   from public.events e
                   left join public.projects p on p.project_id = e.project_id and p.office_id = p_office
                  where e.office_id = p_office
                    and e.occurred_at > v_day
                    and not app.harness_label(e.actor)
                    and (e.related_job_id is null or not app.harness_job(e.related_job_id))
                    and (p.project_id is null or not p.is_fixture)),
      'jobs_done', (select count(*)::int from public.jobs j
                     where j.office_id = p_office and not app.harness_job(j.job_id) and j.state = 'complete'
                       and j.updated_at > v_day),
      'jobs_failed', (select count(*)::int from public.jobs j
                       where j.office_id = p_office and not app.harness_job(j.job_id) and j.state = 'failed'
                         and j.updated_at > v_day)
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

commit;

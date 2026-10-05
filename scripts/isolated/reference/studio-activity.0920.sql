-- FROZEN reference copy of app.studio_activity as it stood in production on 5 October 2026 (migration 0920).
-- scripts/isolated/studio-activity-equivalence.ts runs it beside the optimised definition (1024) and requires equal results.
-- Do not "improve" this file. Lives in its own schema so the product can never call it.
create schema if not exists proof_ref;

CREATE OR REPLACE FUNCTION proof_ref.studio_activity(p_project_id uuid, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with window_start as (select app.now_utc() - interval '45 days' as t),
  staff_slugs as (select slug from public.staff),
  proj as (
    select p.project_id, p.office_id, p.created_at, p.is_fixture
      from public.projects p where p.project_id = p_project_id and not p.is_fixture
  ),
  ledger as (
    select case when e.actor in (select slug from staff_slugs) then e.actor
                    when e.actor is not distinct from app.office_actor(proj.office_id) then 'you'
                    else e.actor end as who,
           app.action_in_words(e.action_type) ->> 'verb' as verb,
           app.action_in_words(e.action_type) ->> 'what' as what,
           e.occurred_at as at,
           e.rationale_summary as detail,
           app.event_via_label(e.origin_channel, e.related_job_id, e.action_type, e.actor_kind) as via,
           app.activity_category(e.action_type) as category
      from public.events e, proj
     where e.project_id = proj.project_id and e.office_id = proj.office_id
       and not app.harness_label(e.actor)
       and (e.related_job_id is null or not app.harness_job(e.related_job_id))
       and e.action_type !~ '^(ledger|gate[0-9]|backup)\.'
       and e.action_type not in ('finding.committed', 'job.committed')
     order by e.occurred_at desc
     limit 40
  ),
  made as (
    select case when t.added_by in (select slug from staff_slugs) then t.added_by else 'you' end as who,
           date_trunc('day', t.created_at) as day,
           count(*) as n, max(t.created_at) as at,
           (array_agg(t.title order by t.created_at desc))[1] as one,
           app.actor_via_label(t.added_by, t.job_id) as via
      from public.tasks t, proj, window_start w
     where t.project_id = proj.project_id and t.office_id = proj.office_id
       and t.state <> 'cancelled' and t.created_at >= w.t
       and not app.harness_task(t.is_fixture, t.job_id)
     group by 1, 2, app.actor_via_label(t.added_by, t.job_id)
  ),
  finished as (
    select case when t.completed_by in (select slug from staff_slugs) then t.completed_by else 'you' end as who,
           date_trunc('day', t.done_at) as day,
           count(*) as n, max(t.done_at) as at,
           (array_agg(t.title order by t.done_at desc))[1] as one,
           app.actor_via_label(t.completed_by, null) as via
      from public.tasks t, proj, window_start w
     where t.project_id = proj.project_id and t.office_id = proj.office_id
       and t.state = 'done' and t.done_at is not null and t.done_at >= w.t
       and not app.harness_task(t.is_fixture, t.job_id)
     group by 1, 2, app.actor_via_label(t.completed_by, null)
  ),
  filed as (
    select case when coalesce(d.produced_by, d.added_by) in (select slug from staff_slugs)
                then coalesce(d.produced_by, d.added_by) else 'you' end as who,
           d.origin, date_trunc('day', d.created_at) as day,
           count(*) as n, max(d.created_at) as at,
           (array_agg(d.title order by d.created_at desc))[1] as one,
           app.actor_via_label(d.added_by, d.produced_by_job) as via
      from public.documents d, proj, window_start w
     where d.project_id = proj.project_id and d.office_id = proj.office_id
       and (d.origin in ('yours', 'made') or d.connector = 'mcp') and d.state <> 'archived' and d.created_at >= w.t
     group by 1, 2, 3, app.actor_via_label(d.added_by, d.produced_by_job)
  ),
  met as (
    select date_trunc('day', c.created_at) as day, count(*) as n, max(c.created_at) as at,
           (array_agg(c.name order by c.created_at desc))[1] as one
      from public.contacts c, proj, window_start w
     where c.project_id = proj.project_id and c.archived_at is null
       and c.created_at >= w.t and not c.is_fixture
       and exists (select 1 from public.projects pp where pp.project_id = c.project_id and pp.office_id = proj.office_id)
     group by 1
  ),
  answered as (
    select s.slug as who, date_trunc('day', o.created_at) as day, count(*) as n, max(o.created_at) as at,
           app.job_via_label(j.job_id) as via,
           case when j.kind ~ '^(browser|research|notebook[.]ask)' then 'research' else 'other' end as category
      from public.outputs o
      join public.jobs j on j.job_id = o.job_id
      join public.staff s on s.staff_id = o.staff_id, proj, window_start w
     where j.project_id = proj.project_id and j.office_id = proj.office_id
       and o.created_at >= w.t and not app.harness_job(j.job_id)
     group by 1, 2, 5, 6
  ),
  lines as (
    select who, verb, what, at, detail, via, category from ledger
    union all
    select who, 'added',
           case when n = 1 then format('the task "%s"', one) else format('%s tasks', n) end, at, null, via, 'task' from made
    union all
    select who, 'completed',
           case when n = 1 then format('the task "%s"', one) else format('%s tasks', n) end, at, null, via, 'task' from finished
    union all
    select who, case when origin = 'made' then 'made' else 'added' end,
           case when n = 1 then format('the document "%s"', left(one, 70)) else format('%s documents', n) end, at, null, via, 'document' from filed
    union all
    select 'you', 'added',
           case when n = 1 then format('the contact %s', one) else format('%s contacts', n) end, at, null, null::text, 'other' from met
    union all
    select who, 'answered', case when n = 1 then 'a request' else format('%s requests', n) end, at, null, via, category from answered
    union all
    select 'you', 'created', 'this project', proj.created_at, null, null::text, 'other' from proj, window_start w where proj.created_at >= w.t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'who', l.who,
           'verb', l.verb,
           'what', l.what,
           'when', to_char(l.at, 'FMDD Mon HH24:MI'),
           'at', l.at,
           'detail', l.detail,
           'via', l.via,
           'category', l.category
         ) order by l.at desc), '[]'::jsonb)
    from (select * from lines order by at desc limit greatest(coalesce(p_limit, 12), 1)) l
$function$;

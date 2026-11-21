-- 1109 — the activity feed works out each row's door with joins, not one function call per row (Q7 follow-up, 21 November 2026)
--
-- app.hq_studio_lately labelled each row's door ("Team HQ", "Slack", "Voice" ...) by calling app.event_via_label, which
-- calls app.job_via, which looks up the job and its command. Those are SECURITY DEFINER SQL functions the database cannot
-- inline, so for each of the 400 rows in the window it ran a separate lookup: about 130 ms of the feed's database time.
-- This migration makes the same three lookups as joins, once for the whole window, and applies the same rules in the
-- same order: the event's own origin wins; otherwise an MCP job takes its client's kind; otherwise the command's via
-- (only chatgpt, claude or mcp) or the job's origin channel; then the label; then the Google and Notion sync fallbacks.
--
-- Checked before this was written, read-only on production: for all 24,821 events in the office the joined expression gives
-- the same label as app.event_via_label. The feed's answer is unchanged. app.event_via_label itself is left in place for
-- any other caller.
--
-- Everything else is the function as migration 1108 left it.

CREATE OR REPLACE FUNCTION app.hq_studio_lately(p_office uuid, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
           coalesce(
             app.via_label(coalesce(
               e.origin_channel,
               case
                 when j.requested_by like 'mcp:%' then
                   case when mc.client_id is null then null
                        else case mc.kind when 'chatgpt' then 'chatgpt' when 'claude' then 'claude' else 'mcp' end
                   end
                 else coalesce(
                   case when c.context ->> 'via' in ('chatgpt', 'claude', 'mcp') then c.context ->> 'via' end,
                   j.origin_channel)
               end)),
             case when e.actor_kind = 'system' and e.action_type ~ '^(google|drive|gmail|calendar)[.]' then 'Google sync'
                  when e.actor_kind = 'system' and e.action_type ~ '^notion[.]' then 'Notion sync'
             end) as via,
           app.activity_category(e.action_type) as category
      from public.events e
      left join public.projects p on p.project_id = e.project_id and p.office_id = p_office
      left join public.jobs j on j.job_id = e.related_job_id
      left join public.inbound_commands c on c.command_id = j.origin_command_id
      left join public.mcp_clients mc on j.requested_by like 'mcp:%' and mc.client_id = substring(j.requested_by from 5)
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
             'who', case when k.actor is not distinct from (select app.office_actor(p_office)) then 'you' else k.actor end,
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
             'who', case when f.actor is not distinct from (select app.office_actor(p_office)) then 'you' else f.actor end,
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

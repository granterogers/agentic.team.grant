-- 0770 - the small pieces the model-context functions share, now office-explicit (multi-user P3, cluster g-context).
--
-- What a model is shown is built by readers that, before this, read every office's rows: a lesson, a document, a
-- mail message or a standing rule learned in one office could be handed to another office's prompt. This file holds
-- the shared helpers those readers and writers need; 0771-0775 convert the readers and writers themselves.
--
--   app.office_project(office, project)   - the project, if it is THIS office's; null for another office's and for a
--                                           missing one alike (so the two can never be told apart).
--   app.append_event(office, ...)         - the events ledger is a carrier; the office-explicit writer states the office
--                                           instead of leaving the bridge to guess it. public.append_event keeps its
--                                           signature until the last unconverted caller moves (the lead drops it).
--   app.staff_may_use(office, slug, tool) - staff_tools carries an office: a grant in one office is not a grant in another.
--   app.references_in(office, text)       - an id or a repository named in words resolves only to a project of the office.
--   app.project_for_slack_channel(office, channel) - the channel map, read through the office's own projects.
--
-- Left in place on purpose until their last callers move (the lead drops them): public.append_event(...) and
-- app.staff_may_use(text, text, boolean) (the governance functions still call them).

create function app.office_project(p_office uuid, p_project uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select p.project_id
    from public.projects p
   where p.project_id = p_project
     and p.office_id = p_office
$f$;
revoke all on function app.office_project(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function app.append_event(
  p_office uuid, p_correlation_id uuid, p_actor_kind text, p_actor text, p_trigger text, p_action_type text,
  p_reversible boolean, p_project_id uuid default null::uuid, p_before_state jsonb default null::jsonb,
  p_after_state jsonb default null::jsonb, p_rationale_summary text default null::text,
  p_source_refs jsonb default '[]'::jsonb, p_provider_used text default null::text, p_tool_used text default null::text,
  p_reversal_method text default null::text, p_related_job_id uuid default null::uuid,
  p_related_task_id uuid default null::uuid, p_compensates_event_id uuid default null::uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $f$
declare v_id uuid;
begin
  perform app.require_office(p_office);
  insert into public.events (
    office_id, correlation_id, actor_kind, actor, trigger, action_type, reversible,
    project_id, before_state, after_state, rationale_summary, source_refs,
    provider_used, tool_used, reversal_method, related_job_id, related_task_id,
    compensates_event_id
  ) values (
    p_office, p_correlation_id, p_actor_kind, p_actor, p_trigger, p_action_type, p_reversible,
    p_project_id, p_before_state, p_after_state, p_rationale_summary, p_source_refs,
    p_provider_used, p_tool_used, p_reversal_method, p_related_job_id, p_related_task_id,
    p_compensates_event_id
  )
  returning event_id into v_id;
  return v_id;
end
$f$;
revoke all on function app.append_event(uuid, uuid, text, text, text, text, boolean, uuid, jsonb, jsonb, text, jsonb, text, text, text, uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function app.staff_may_use(p_office uuid, p_slug text, p_tool text, p_approved boolean default false)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select app.require_office(p_office) is not null
     and app.tool_allowed(p_tool, p_approved)
     and exists (
       select 1 from public.staff_tools st
        where st.office_id = p_office
          and st.staff_slug = p_slug
          and st.tool = p_tool)
$f$;
revoke all on function app.staff_may_use(uuid, text, text, boolean) from public, anon, authenticated, service_role;

create function app.project_for_slack_channel(p_office uuid, p_channel_id text)
returns uuid
language sql
stable
security definer
set search_path to ''
as $f$
  select m.project_id
    from public.slack_channel_map m
    join public.projects p on p.project_id = m.project_id
   where p.office_id = app.require_office(p_office)
     and m.channel_id = p_channel_id
     and m.active
   limit 1
$f$;
revoke all on function app.project_for_slack_channel(uuid, text) from public, anon, authenticated, service_role;

create function app.references_in(p_office uuid, p_text text)
 RETURNS TABLE(project_id uuid, slug text, name text, connector text, external_ref text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with found as (
    select lower(m[1]) as ref
      from regexp_matches(
             coalesce(p_text, ''),
             '([0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12})',
             'g'
           ) as m
    union
    select lower(m[1] || '/' || m[2])
      from regexp_matches(
             coalesce(p_text, ''),
             '(?:github\.com[/:])?([A-Za-z0-9][\w-]{0,38})/([\w.-]{1,100}?)(?:\.git)?(?=[\s,)\]]|$)',
             'g'
           ) as m
  ),
  candidates as (
    select ref from found
    union
    select replace(ref, '-', '') from found
  )
  select distinct p.project_id, p.slug, p.name, a.connector, a.external_ref
    from public.project_attachments a
    join public.projects p on p.project_id = a.project_id
   where p.office_id = app.require_office(p_office)
     and p.status = 'active'
     and not p.is_fixture
     and a.enabled
     and (
       lower(a.external_ref) in (select ref from candidates)
       or replace(lower(a.external_ref), '-', '') in (select ref from candidates)
     )
$function$;

revoke all on function app.references_in(uuid, text) from public, anon, authenticated, service_role;

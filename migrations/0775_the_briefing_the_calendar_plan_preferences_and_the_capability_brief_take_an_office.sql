-- 0775 - the briefing, the calendar plan, notification preferences and the capability brief take an office
-- (multi-user P3, cluster g-context).
--
--   app.morning_briefing_facts(office)   every fact in the morning briefing is counted in the office's own rows
--   app.write_briefing(office, ...)      briefings carry office_id; the scope_ref no longer defaults to the literal 'grant'
--                                         (that was an ambient identity): it defaults to the office's own actor name
--   app.calendar_task_plan(office)       the diff between the office's dated tasks and the calendar events pushed for them
--   app.notification_allowed(office, ...) notification_preferences is keyed by a subject text; it is read within the office
--   app.capability_index(office, staff)  the per-staff capability brief every agent prompt is built from. Its reach is the
--                                         OFFICE'S OWN credentials (connection_health.office_id), its grants the office's
--                                         staff_tools, its declined list the office's tool_requests - never the deployment's.
--
-- The deployment's registries (tool_permissions, knowledge_connectors, connector_capabilities) are shared by design:
-- they say what the product CAN do; the per-office tables say what this office HAS.
-- app.grant_timezone() reads one deployment-wide setting (system_config 'grant.timezone'); a per-office timezone is a
-- later change and is reported, not made here.
--
-- Dropped: every old signature, public.morning_briefing_facts(), public.write_briefing(...), public.hq_capability_index(text),
-- and the old app.needs_me_pressure() whose only caller was the old briefing facts.

create function app.morning_briefing_facts(p_office uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with
  z as (select app.grant_timezone() as tz where app.require_office(p_office) is not null),
  -- The local day this briefing is FOR, which is not necessarily today in UTC.
  d as (select (app.now_utc() at time zone (select tz from z))::date as today),

  /*
    What needs him. First, because it is the only category he can unblock —
    the `needs_me` view's own comment says so, and it is not capped there
    deliberately: "a view that silently returned 7 of 40 would hide the thing
    worth knowing."
  */
  waiting as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'what', n.requested_action,
             'why', n.why_needed,
             'project', p.name,
             'overdue', n.overdue,
             'deadline', n.real_deadline,
             'if_delayed', n.consequences_of_delay,
             'work_continues', n.work_can_continue
           ) order by n.overdue desc, n.real_deadline nulls last, n.created_at), '[]'::jsonb) as v
      from app.needs_me_in(p_office) n
      left join public.projects p on p.project_id = n.project_id and p.office_id = p_office
  ),

  -- What the office did while he slept. Fixtures excluded — 264 harness
  -- failures were once reported to him as the office falling over.
  overnight as (
    select jsonb_build_object(
             'finished', count(*) filter (where j.state = 'complete'),
             'failed',   count(*) filter (where j.state = 'failed'),
             'still_going', count(*) filter (where j.state in ('queued', 'running'))
           ) as v
      from public.jobs j
     where j.office_id = p_office
       and not app.harness_job(j.job_id)
       and j.updated_at >= app.now_utc() - interval '18 hours'
  ),

  -- What is stuck, and for how long. A blocked job with no stated reason is
  -- the failure Active Jobs was built to fix, so the reason comes with it.
  stuck as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', j.kind,
             'project', p.name,
             'since_hours', round(extract(epoch from (app.now_utc() - j.updated_at)) / 3600),
             'why', coalesce(nullif(btrim(j.state_reason), ''), 'no reason recorded')
           ) order by j.updated_at), '[]'::jsonb) as v
      from public.jobs j
      left join public.projects p on p.project_id = j.project_id and p.office_id = p_office
     where j.office_id = p_office
       and not app.harness_job(j.job_id)
       and j.state in ('waiting_external', 'waiting_user', 'retrying', 'paused')
       and j.updated_at < app.now_utc() - interval '2 hours'
  ),

  -- His day. The calendar is already refreshed hourly by its own duty.
  diary as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'what', c.summary,
             'at', c.starts_at
           ) order by c.starts_at), '[]'::jsonb) as v
      from public.calendar_events c, z, d
     where c.office_id = p_office
       and (c.starts_at at time zone z.tz)::date = d.today
  ),

  /*
    What the office has asked to be able to reach (#53).

    Its own section rather than a recommendation, because it is a different
    kind of sentence: a recommendation is something he might act on, and this
    is a question waiting on an answer only he can give. The needs_me argument
    applies — burying a request under a status summary is how it gets missed.
  */
  wanted as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tool', w.tool,
             'asked_by', w.asked_by,
             'what_for', w.what_for,
             'exists_yet', w.exists_yet,
             'days', round(extract(epoch from (app.now_utc() - w.raised_at)) / 86400)
           ) order by w.raised_at), '[]'::jsonb) as v
      from app.reach_wanted(p_office) w
  ),

  /*
    Recommendations, from the one place that computes them (#52), already
    ranked and already stripped of anything he has dismissed.
  */
  noticed as (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', n.kind,
             'body', n.body,
             'because', n.because,
             'weight', n.weight
           ) order by n.weight desc), '[]'::jsonb) as v
      from app.notice(p_office, 6) n
  )

  select jsonb_build_object(
    'for_date', (select today from d),
    'timezone', (select tz from z),
    'generated_at', app.now_utc(),
    'waiting_on_you', (select v from waiting),
    'overnight', (select v from overnight),
    'stuck', (select v from stuck),
    'diary', (select v from diary),
    'noticed', (select v from noticed),
    'wanted', (select v from wanted),
    /*
      How much is being held back, and how old the oldest is (#272).

      `app.needs_me_pressure` has existed with no caller at all. The briefing
      names up to four things waiting and says how many are past a deadline --
      and `needs_me` is CAPPED, so anything beyond the cap is silently absent,
      and a request with no formal deadline ages invisibly however long it
      sits. Both are things a person needs to be told and neither was said.
    */
    'pressure', (select jsonb_build_object(
                          'open_items', p.open_items,
                          'cap', p.cap,
                          'suppressed', p.suppressed,
                          'oldest_days', p.oldest_days)
                   from app.needs_me_pressure(p_office) p)
  )
$function$;

revoke all on function app.morning_briefing_facts(uuid) from public, anon, authenticated, service_role;

create function app.write_briefing(p_office uuid, p_kind text, p_for_date date, p_body text, p_inputs jsonb, p_scope_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  as_kind public.briefing_kind;
  made    public.briefings%rowtype;
  v_scope text;
  v_existing uuid;
begin
  perform app.require_office(p_office);
  -- The scope a briefing is written for is the office's own person unless the caller says otherwise.
  v_scope := coalesce(nullif(btrim(p_scope_ref), ''), app.office_actor(p_office));
  begin
    as_kind := p_kind::public.briefing_kind;
  exception when invalid_text_representation then
    return jsonb_build_object(
      'error', format('%L is not a briefing kind; expected one of: %s',
                      p_kind,
                      (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
                         from pg_catalog.pg_enum e
                         join pg_catalog.pg_type t on t.oid = e.enumtypid
                        where t.typname = 'briefing_kind')));
  end;

  insert into public.briefings (office_id, kind, for_date, scope_ref, body, inputs)
  values (p_office, as_kind, p_for_date, v_scope, p_body, coalesce(p_inputs, '{}'::jsonb))
  on conflict (office_id, kind, scope_ref, for_date) do nothing
  returning * into made;

  if made.briefing_id is null then
    select b.briefing_id into v_existing from public.briefings b
     where b.office_id = p_office and b.kind = as_kind and b.scope_ref = v_scope and b.for_date = p_for_date;
    return jsonb_build_object(
      'already_written', true,
      'for_date', p_for_date,
      'briefing_id', v_existing
    );
  end if;

  return jsonb_build_object('briefing_id', made.briefing_id, 'already_written', false);
end;
$function$;

revoke all on function app.write_briefing(uuid, text, date, text, jsonb, text) from public, anon, authenticated, service_role;

create function app.calendar_task_plan(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
  with wanted as (
    select t.task_id,
           t.title,
           t.detail,
           t.due_on,
           p.name as project,
           md5(coalesce(t.title, '') || '|' || coalesce(t.due_on::text, '') || '|' ||
               coalesce(t.detail, '') || '|' || coalesce(p.name, '')) as hash
      from public.tasks t
      join public.projects p on p.project_id = t.project_id and p.office_id = p_office
     where t.office_id = p_office
       and t.due_on is not null
       and t.state in ('todo', 'doing', 'blocked')
       and not app.harness_task(t.is_fixture, t.job_id)
       and not p.is_fixture
  )
  select jsonb_build_object(
    'create', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', w.task_id, 'title', w.title, 'detail', w.detail,
               'due_on', w.due_on, 'project', w.project, 'hash', w.hash))
        from wanted w
        left join public.task_calendar_links l on l.task_id = w.task_id
       where l.task_id is null), '[]'::jsonb),
    'update', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', w.task_id, 'title', w.title, 'detail', w.detail,
               'due_on', w.due_on, 'project', w.project, 'hash', w.hash,
               'calendar_id', l.calendar_id, 'event_id', l.event_id))
        from wanted w
        join public.task_calendar_links l on l.task_id = w.task_id
       where l.pushed_hash is distinct from w.hash), '[]'::jsonb),
    -- A link whose task is no longer wanted. The task row may still exist
    -- (done, cancelled, or its date removed) or may be gone entirely, and the
    -- cascade takes care of the second case before we ever see it.
    'remove', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_id', l.task_id, 'calendar_id', l.calendar_id, 'event_id', l.event_id))
        from public.task_calendar_links l
        join public.tasks lt on lt.task_id = l.task_id and lt.office_id = p_office
        left join wanted w on w.task_id = l.task_id
       where w.task_id is null), '[]'::jsonb)
  )
  );
end
$function$;

revoke all on function app.calendar_task_plan(uuid) from public, anon, authenticated, service_role;

create function app.notification_allowed(p_office uuid, p_subject text, p_channel text, p_severity notify_severity, p_project_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_pref record;
begin
  perform app.require_office(p_office);
  -- The more specific scope wins, which is why the project row is ordered
  -- first rather than merged: layering two partial preferences would need a
  -- precedence rule per column, and there is no sensible rule for min_severity.
  select * into v_pref
  from public.notification_preferences
  where office_id = p_office
    and subject = p_subject
    and (project_id = p_project_id or project_id is null)
  order by (project_id is not null) desc
  limit 1;

  -- No preference is not the same as a restrictive one.
  if v_pref is null then
    return true;
  end if;

  -- The escape hatch, checked before every restriction. §12 gives Grant
  -- blockers because he is the only one who can clear them, so a preference
  -- must not be able to hide them by accident — only by saying so.
  if p_severity = 'blocker' and v_pref.blockers_always then
    return true;
  end if;

  if v_pref.quiet_until is not null and v_pref.quiet_until > app.now_utc() then
    return false;
  end if;

  if p_channel = any (v_pref.muted_channels) then
    return false;
  end if;

  if v_pref.min_severity is not null and p_severity < v_pref.min_severity then
    return false;
  end if;

  return true;
end;
$function$;

revoke all on function app.notification_allowed(uuid, text, text, notify_severity, uuid) from public, anon, authenticated, service_role;

create function app.capability_index_core(p_office uuid, p_staff text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with connectors as (
    select k.name as service,
           (k.enabled and coalesce(h.state, 'ok') not in ('dead', 'missing')) as reachable,
           case when not k.enabled then coalesce(k.disabled_reason, 'switched off')
                when h.state in ('dead', 'missing') then coalesce(h.detail, h.state)
                else null end as detail
      from public.knowledge_connectors k
      left join lateral (
        select ch.state, ch.detail
          from public.connection_health ch
         where ch.office_id = p_office
           and ch.service = k.health_service
         order by (ch.purpose = 'maintains'), case ch.state when 'dead' then 0 when 'missing' then 1
                                when 'unknown' then 2 when 'ok' then 3 else 4 end
         limit 1
      ) h on true
     where app.require_office(p_office) is not null
       and k.connector not in ('upload', 'mcp')
  ),
  reach as (
    select * from connectors
    union all
    select * from (
      select distinct on (c.service)
             c.service,
             c.state not in ('dead', 'missing') as reachable,
             case when c.state in ('dead', 'missing') then coalesce(c.detail, c.state)
                  else null end as detail
        from public.connection_health c
       where c.office_id = p_office
         and c.service in ('Slack', 'Telegram')
         and not exists (select 1 from connectors n where n.service = c.service)
       order by c.service, (c.purpose = 'maintains'),
                case c.state when 'dead' then 0 when 'missing' then 1
                             when 'unknown' then 2 else 3 end
    ) surfaces
  ),
  tools as (
    select t.tool, t.level, t.enabled, t.disabled_reason,
           t.description, coalesce(t.verbs, array[]::text[]) as verbs,
           t.in_reply,
           (p_staff is null or exists (
              select 1 from public.staff_tools st
               where st.office_id = p_office and st.staff_slug = p_staff and st.tool = t.tool)) as granted
      from public.tool_permissions t
  ),
  declined as (
    select distinct on (r.tool)
           r.tool, r.decline_reason, r.settled_at, r.declines
      from public.tool_requests r
     where r.office_id = p_office
       and r.state = 'declined'
     order by r.tool, r.settled_at desc nulls last
  )
  select jsonb_build_object(
    'at', app.now_utc(),
    'for', coalesce(p_staff, 'the office'),
    'reach', (select coalesce(jsonb_agg(jsonb_build_object(
                'service', r.service, 'reachable', r.reachable, 'detail', r.detail)
                order by r.service), '[]'::jsonb) from reach r),
    'can', (select coalesce(jsonb_agg(jsonb_build_object(
              'tool', t.tool, 'level', t.level, 'what', t.description,
              'verbs', to_jsonb(t.verbs), 'in_reply', t.in_reply)
              order by t.tool), '[]'::jsonb)
              from tools t where t.enabled and t.granted),
    'must_ask', (select coalesce(jsonb_agg(jsonb_build_object(
                   'tool', t.tool, 'what', t.description) order by t.tool), '[]'::jsonb)
                   from tools t where t.enabled and not t.granted),
    'cannot', (select coalesce(jsonb_agg(jsonb_build_object(
                 'tool', t.tool, 'what', t.description,
                 'why', coalesce(t.disabled_reason, 'switched off'),
                 'verbs', to_jsonb(t.verbs)) order by t.tool), '[]'::jsonb)
                 from tools t where not t.enabled),
    'declined', (select coalesce(jsonb_agg(jsonb_build_object(
                   'tool', d.tool, 'why', d.decline_reason,
                   'when', d.settled_at, 'times', d.declines) order by d.tool), '[]'::jsonb)
                   from declined d)
  )
$function$;

revoke all on function app.capability_index_core(uuid, text) from public, anon, authenticated, service_role;

create function app.capability_index(p_office uuid, p_staff text default null::text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select app.capability_index_core(p_office, p_staff)
      || jsonb_build_object('could', app.unused_capabilities())
$function$;
revoke all on function app.capability_index(uuid, text) from public, anon, authenticated, service_role;


drop function app.capability_index(text);
drop function app.capability_index_core(text);
drop function public.hq_capability_index(text);
drop function app.morning_briefing_facts();
drop function public.morning_briefing_facts();
drop function app.needs_me_pressure();
drop function app.write_briefing(text, date, text, jsonb, text);
drop function public.write_briefing(text, date, text, jsonb, text);
drop function app.calendar_task_plan();
drop function public.calendar_task_plan();
drop function app.notification_allowed(text, text, notify_severity, uuid);

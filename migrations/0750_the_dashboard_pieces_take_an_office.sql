-- 0750 - the read side of the dashboard, part 1: the pieces its payloads are built from (multi-user P3, cluster e-views).
--
-- Before: the counters, feeds and lists that make up the overview, the studio, the pulse and the health reading read
-- whole tables - every job, every blocker, every project, every delivery - for whoever asked. A second person's
-- "Needs You" count would have been the first person's, and a counter that sums across offices is a disclosure even
-- when no row is shown. Now each of them takes `p_office uuid` FIRST and carries `office_id = p_office` in the SQL
-- that produces it. The harness filters (app.harness_job, is_fixture, fixture projects) are untouched.
--
-- This file: the four views the payloads read become office-explicit functions (public.needs_me, public.today,
-- public.undo_offers, public.delivery_health keep their shape and their other readers; the *_in functions below are
-- what the converted payloads read), the deployment/operator test, and the helpers that were reachable only through
-- the converted payloads.
--
-- Left in place, on purpose, until their last callers move (the lead drops them): app.office_health(integer),
-- app.calendar_ahead(integer), app.jobs_waiting(integer), app.jobs_stuck_queued(integer), app.last_progress() and
-- app.held_for_budget() - app.voice_state and app.voice_answer (the voice door, not in this cluster) still call them.
-- They are in schema app, which no browser role can execute; their public doors are dropped here.

create function app.office_sees_the_deployment(p_office uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  -- The deployment's own things (the size of the database, the speech quota, the build log, the backups) belong to the
  -- deployment, not to an office. They are shown to the deployment's operator, to the system office and to the test
  -- office, and to nobody else.
  select exists (
    select 1
      from public.offices o
     where o.office_id = p_office
       and o.state = 'active'
       and (o.kind in ('system', 'test')
            or exists (select 1 from public.deployment_operators d
                        where d.owner_key = app.office_actor(o.office_id))))
$f$;
revoke all on function app.office_sees_the_deployment(uuid) from public, anon, authenticated, service_role;

create function app.needs_me_in(p_office uuid)
returns table (blocker_id uuid, project_id uuid, job_id uuid, requested_action text, why_needed text,
               real_deadline timestamptz, approval_options text[], originating_agent text,
               work_can_continue boolean, consequences_of_delay text, created_at timestamptz, overdue boolean)
language plpgsql
stable
security definer
set search_path to ''
as $f$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  -- public.needs_me, for one office. A blocker whose job is harness traffic is not Grant's to answer.
  return query
  select b.blocker_id, b.project_id, b.job_id, b.requested_action, b.why_needed, b.real_deadline, b.approval_options,
         b.originating_agent, b.work_can_continue, b.consequences_of_delay, b.created_at,
         ((b.real_deadline is not null) and (b.real_deadline <= app.now_utc())) as overdue
    from public.blockers b
   where b.office_id = p_office
     and b.state = 'open'
     and not coalesce(app.harness_job(b.job_id), false)
   order by ((b.real_deadline is not null) and (b.real_deadline <= app.now_utc())) desc,
            b.work_can_continue, b.real_deadline, b.created_at;
end
$f$;
revoke all on function app.needs_me_in(uuid) from public, anon, authenticated, service_role;

create function app.today_in(p_office uuid)
returns table (job_id uuid, project_id uuid, project_name text, kind text, state public.job_state,
               intent_class text, priority smallint, state_reason text, waiting_on text,
               created_at timestamptz, updated_at timestamptz, minutes_since_change integer)
language plpgsql
stable
security definer
set search_path to ''
as $f$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  -- public.today, for one office.
  return query
  select j.job_id, j.project_id, p.name, j.kind, j.state, j.intent_class, j.priority, j.state_reason, j.waiting_on,
         j.created_at, j.updated_at,
         ((extract(epoch from (app.now_utc() - j.updated_at)) / (60)::numeric))::integer
    from public.jobs j
    left join public.projects p on p.project_id = j.project_id and p.office_id = p_office
   where j.office_id = p_office
     and j.state not in ('complete', 'cancelled', 'failed')
   order by case j.state when 'waiting_user' then 0 else 1 end, j.priority, j.created_at;
end
$f$;
revoke all on function app.today_in(uuid) from public, anon, authenticated, service_role;

create function app.undo_offers_in(p_office uuid)
returns table (action_id uuid, job_id uuid, correlation_id uuid, kind text, description text,
               undo_deadline timestamptz, minutes_left integer)
language plpgsql
stable
security definer
set search_path to ''
as $f$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  -- public.undo_offers, for one office.
  return query
  select u.action_id, u.job_id, u.correlation_id, u.kind, u.description, u.undo_deadline,
         ((extract(epoch from (u.undo_deadline - app.now_utc())) / (60)::numeric))::integer
    from public.undoable_actions u
   where u.office_id = p_office
     and u.status = 'available'
     and (u.undo_deadline is null or u.undo_deadline > app.now_utc())
   order by u.undo_deadline;
end
$f$;
revoke all on function app.undo_offers_in(uuid) from public, anon, authenticated, service_role;

create function app.delivery_health_in(p_office uuid)
returns table (channel text, state text, deliveries integer, needed_more_than_one_attempt integer,
               worst_attempt integer, leases_expired integer)
language plpgsql
stable
security definer
set search_path to ''
as $f$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  -- public.delivery_health, for one office.
  return query
  select d.channel, d.state::text, (count(*))::integer,
         (sum(case when d.attempt > 1 then 1 else 0 end))::integer,
         max(d.attempt)::integer,
         (count(*) filter (where d.state = 'claimed' and d.lease_expires_at < app.now_utc()))::integer
    from public.deliveries d
   where d.office_id = p_office
   group by d.channel, d.state;
end
$f$;
revoke all on function app.delivery_health_in(uuid) from public, anon, authenticated, service_role;

-- app.project_attention
create function app.project_attention(p_office uuid)
 returns TABLE(project_id uuid, slug text, name text, open_blockers integer, overdue_blockers integer, live_jobs integer, failed_jobs_24h integer, stalled_jobs integer, hours_since_sync numeric, has_brief boolean, brief_is_stale boolean)
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  return query
  select
    p.project_id, p.slug, p.name,
    (select count(*)::int from public.blockers b
      where b.project_id = p.project_id and b.office_id = p_office and b.state = 'open'),
    (select count(*)::int from public.blockers b
      where b.project_id = p.project_id and b.office_id = p_office and b.state = 'open'
        and b.real_deadline is not null and b.real_deadline <= app.now_utc()),
    (select count(*)::int from public.jobs j
      where j.project_id = p.project_id and j.office_id = p_office
        and j.state not in ('complete', 'cancelled', 'failed')),
    (select count(*)::int from public.jobs j
      where j.project_id = p.project_id and j.office_id = p_office and j.state = 'failed'
        and j.finished_at >= app.now_utc() - interval '24 hours'),
    (select count(*)::int from public.jobs j
      where j.project_id = p.project_id and j.office_id = p_office
        and j.state not in ('complete', 'cancelled', 'failed')
        and j.updated_at <= app.now_utc() - interval '1 hour'),
    (select round(extract(epoch from (app.now_utc() - max(d.fetched_at))) / 3600, 1)
      from public.documents d where d.project_id = p.project_id and d.office_id = p_office),
    exists (select 1 from public.project_briefs b where b.project_id = p.project_id),
    exists (
      select 1 from public.documents d
      where d.project_id = p.project_id and d.office_id = p_office
        and d.fetched_at > coalesce(
          (select max(b.generated_at) from public.project_briefs b
            where b.project_id = p.project_id),
          '-infinity'::timestamptz)
    )
  from public.projects p
  where p.office_id = p_office and p.status = 'active'
  order by p.name;
end
$function$;
revoke all on function app.project_attention(uuid) from public, anon, authenticated, service_role;

-- app.jobs_waiting
create function app.jobs_waiting(p_office uuid, p_minutes integer DEFAULT 15)
 returns TABLE(kind text, n bigint, oldest_minutes integer)
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  return query
  select j.kind,
         count(*) as n,
         max(extract(epoch from (app.now_utc() - j.created_at)) / 60)::int as oldest_minutes
    from public.jobs j
   where j.office_id = p_office
     and not app.harness_job(j.job_id)
     and j.state in ('queued', 'retrying')
     and j.created_at < app.now_utc() - make_interval(mins => p_minutes)
   group by j.kind
   order by max(j.created_at) asc, j.kind;
end
$function$;
revoke all on function app.jobs_waiting(uuid, integer) from public, anon, authenticated, service_role;

-- app.jobs_stuck_queued
create function app.jobs_stuck_queued(p_office uuid, p_floor_minutes integer DEFAULT 60)
 returns TABLE(kind text, n bigint, oldest_minutes integer, period_minutes integer)
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
#variable_conflict use_column
begin
  perform app.require_office(p_office);
  return query
  with limits as (
    -- One row per kind a duty creates, carrying how long is too long for it.
    -- Aggregated because two duties can share a kind, and the SHORTER period
    -- is the honest threshold: whichever duty fires more often is the one
    -- falling behind first.
    select r.job_kind as kind, min(r.period_minutes) as period
      from public.responsibilities r
     where r.office_id = p_office and r.enabled
     group by r.job_kind
  )
  select j.kind,
         count(*) as n,
         max(extract(epoch from (app.now_utc() - j.created_at)) / 60)::int as oldest_minutes,
         coalesce(l.period, p_floor_minutes) as period_minutes
    from public.jobs j
    left join limits l on l.kind = j.kind
   -- app.harness_job, not j.is_fixture (0355). The generated column cannot see
   -- a job whose PROJECT is a fixture, and 140 rows differ today.
   where j.office_id = p_office
     and not app.harness_job(j.job_id)
     and j.state = 'queued'
     and j.created_at < app.now_utc()
         - make_interval(mins => coalesce(l.period, p_floor_minutes))
   group by j.kind, l.period
   order by count(*) desc, j.kind;
end
$function$;
revoke all on function app.jobs_stuck_queued(uuid, integer) from public, anon, authenticated, service_role;

-- app.last_progress
create function app.last_progress(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
    -- Not "did the heartbeat fire". app.kick_worker() returns null silently
    -- when its secret is missing and cron records `succeeded, 1 row` either
    -- way, so the cron log cannot answer this and never could.
    'last_dequeue_at', (
      select max(t.occurred_at) from public.job_state_transitions t
         join public.jobs tj on tj.job_id = t.job_id and tj.office_id = p_office
       where t.to_state = 'running'),
    'last_completion_at', (
      select max(t.occurred_at) from public.job_state_transitions t
         join public.jobs tj on tj.job_id = t.job_id and tj.office_id = p_office
       where t.to_state = 'complete'),
    'last_delivery_at', (select max(d.sent_at) from public.deliveries d
                          where d.office_id = p_office and d.state = 'sent'),
    'minutes_since_dequeue', (
      select round(extract(epoch from (app.now_utc() - max(t.occurred_at))) / 60.0)
        from public.job_state_transitions t
         join public.jobs tj on tj.job_id = t.job_id and tj.office_id = p_office where t.to_state = 'running'),
    'minutes_since_completion', (
      select round(extract(epoch from (app.now_utc() - max(t.occurred_at))) / 60.0)
        from public.job_state_transitions t
         join public.jobs tj on tj.job_id = t.job_id and tj.office_id = p_office where t.to_state = 'complete'),
    -- A queue with nothing in it and no recent completion is IDLE, not stuck,
    -- and the difference is the whole reason this is reported beside the
    -- waiting count rather than instead of it.
    'runnable_now', (
      select count(*) from public.jobs j
       where j.office_id = p_office and j.state in ('queued', 'retrying')
         and not app.harness_job(j.job_id))
  )
  );
end
$function$;
revoke all on function app.last_progress(uuid) from public, anon, authenticated, service_role;

-- app.held_for_budget
create function app.held_for_budget(p_office uuid)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
    'jobs', count(*),
    'why', coalesce((array_agg(distinct j.state_reason))[1], null),
    'until', min(j.not_before))
    from public.jobs j
   where j.office_id = p_office and j.state = 'queued'
     and j.not_before > app.now_utc()
     and j.state_reason like '%daily limit%'
     and not coalesce(app.harness_job(j.job_id), false)
  );
end
$function$;
revoke all on function app.held_for_budget(uuid) from public, anon, authenticated, service_role;

-- app.task_sync_trouble
create function app.task_sync_trouble(p_office uuid, p_provider text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  return (
  select coalesce(jsonb_agg(jsonb_build_object(
           'task_id', l.task_id, 'title', t.title, 'provider', l.provider,
           'state', l.sync_state, 'why', l.sync_error,
           'last_pushed', l.pushed_at, 'last_pulled', l.pulled_at)
         order by l.updated_at desc), '[]'::jsonb)
    from public.task_links l
    join public.tasks t on t.task_id = l.task_id and t.office_id = p_office
   where l.sync_state in ('error', 'conflict')
     and (p_provider is null or l.provider = p_provider)
     and not coalesce(t.is_fixture, false)
  );
end
$function$;
revoke all on function app.task_sync_trouble(uuid, text) from public, anon, authenticated, service_role;

-- app.calendar_ahead
create function app.calendar_ahead(p_office uuid, p_hours integer DEFAULT 24)
 returns jsonb
 language plpgsql
 STABLE SECURITY DEFINER
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object(
    -- Age, always. A cached answer that does not say when it was cached is a
    -- stale answer presented as a current one, which is the defect this
    -- project keeps meeting in new costumes.
    'as_of', (select max(fetched_at) from public.calendar_events where office_id = p_office),
    'enabled', coalesce(
      (select value::text::boolean from public.system_config where key = 'calendar.enabled'), false),
    'events', coalesce((
      select jsonb_agg(row_to_json(e) order by e.starts_at)
        from (
          select summary, location, starts_at, ends_at, all_day, attendees, status, html_link
            from public.calendar_events
           where office_id = p_office
             and status <> 'cancelled'
             and ends_at   >= app.now_utc()
             and starts_at <= app.now_utc() + make_interval(hours => greatest(p_hours, 1))
           order by starts_at
           limit 25
        ) e
    ), '[]'::jsonb)
  )
  );
end
$function$;
revoke all on function app.calendar_ahead(uuid, integer) from public, anon, authenticated, service_role;

-- the old signatures go: nothing may ask without saying whose
drop function app.project_attention();
drop function app.task_sync_trouble(text);
drop function public.jobs_stuck_queued(integer);
drop function public.held_for_budget();

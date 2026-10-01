-- 0804 - Telegram and Slack bookkeeping, channel authority and the trigger scan take an office (multi-user P3, wave 2,
-- cluster i-integrations2, part 5 of 5).
--
-- Before:
--   * mark_telegram_undeliverable switched off a chat by chat id alone (two bots can hold the same chat id);
--   * record_slack_channel_rename / record_slack_membership rewrote any Slack channel's name or presence from a
--     channel id;
--   * slack_channel_authority - the reason the office may CREATE a permanent Slack channel for a project - was
--     written, read and SPENT by project id with no office: consume_channel_authority spent whichever project's
--     authority it was handed, and a job of any office could be named as the one that spent it;
--   * fire_pending_signals looked at every office's signals against every office's triggers (fire_triggers_for
--     itself matches inside the signal's office, but the scan's pre-filter did not, so one office's signals could
--     fill the other's batch and be looked at for ever).
--
-- Now each takes `p_office uuid` FIRST, no default. A channel authority granted in one office is unusable in another
-- by construction: it is read, written and consumed only through a project of the calling office, and the job that
-- spends it has to be that office's. A foreign project, chat, channel or job is indistinguishable from one that does
-- not exist. A Slack channel belongs to the office of its project, or - for a channel with no project (a lobby) - to
-- the office of the workspace it lives in.
--
-- Callers inside the database: app.hq_create_project (records the authority) is spliced to pass its office.
--
-- The worker's scan (src/jobs/worker.ts) now loops the active offices and fires each one's signals.

create function app.mark_telegram_undeliverable(p_office uuid, p_chat_id text, p_reason text, p_bot_id text default null::text)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform app.require_office(p_office);
  update public.telegram_chats
     set deliverable = false,
         undeliverable_reason = p_reason,
         undeliverable_at = app.now_utc()
   where office_id = p_office
     and chat_id = p_chat_id
     and deliverable
     and (p_bot_id is null or bot_id = p_bot_id);
  return found;
end;
$function$;
revoke all on function app.mark_telegram_undeliverable(uuid, text, text, text) from public, anon, authenticated, service_role;

create function app.slack_channel_in_office(p_office uuid, p_channel_id text)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select exists (
    select 1
      from public.slack_channel_map m
     where m.channel_id = p_channel_id
       and case
             when m.project_id is not null
               then exists (select 1 from public.projects p where p.project_id = m.project_id and p.office_id = p_office)
             else exists (select 1 from public.slack_workspaces w where w.team_id = m.team_id and w.office_id = p_office)
           end)
$function$;
revoke all on function app.slack_channel_in_office(uuid, text) from public, anon, authenticated, service_role;

create function app.record_slack_channel_rename(p_office uuid, p_channel_id text, p_new_name text)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_old text;
begin
  perform app.require_office(p_office);
  if not app.slack_channel_in_office(p_office, p_channel_id) then
    return false;
  end if;
  select channel_name into v_old
    from public.slack_channel_map where channel_id = p_channel_id;
  if not found then
    return false;
  end if;
  update public.slack_channel_map
     set channel_name = p_new_name,
         name_observed_at = app.now_utc()
   where channel_id = p_channel_id;
  return v_old is distinct from p_new_name;
end;
$function$;
revoke all on function app.record_slack_channel_rename(uuid, text, text) from public, anon, authenticated, service_role;

create function app.record_slack_membership(p_office uuid, p_channel_id text, p_present boolean)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_before boolean;
begin
  perform app.require_office(p_office);
  if not app.slack_channel_in_office(p_office, p_channel_id) then
    return false;
  end if;
  select bot_present into v_before
    from public.slack_channel_map where channel_id = p_channel_id;
  if not found then
    return false;
  end if;
  update public.slack_channel_map
     set bot_present = p_present,
         bot_left_at = case when p_present then null else app.now_utc() end
   where channel_id = p_channel_id;
  return v_before is distinct from p_present;
end;
$function$;
revoke all on function app.record_slack_membership(uuid, text, boolean) from public, anon, authenticated, service_role;

create function app.record_channel_authority(p_office uuid, p_project uuid, p_by text, p_job uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare v_who text; v_fixture boolean; v_job uuid;
begin
  perform app.require_office(p_office);
  select is_fixture into v_fixture from public.projects where project_id = p_project and office_id = p_office;
  if v_fixture is null then
    return jsonb_build_object('ok', false, 'error', 'no such project');
  end if;
  -- A fixture never gets a channel (0266), so there is nothing to authorise.
  if v_fixture then
    return jsonb_build_object('ok', false, 'error', 'a fixture project has no channel');
  end if;
  -- The job that vouches for a person is this office's, or it vouches for nobody.
  select j.job_id into v_job from public.jobs j where j.job_id = p_job and j.office_id = p_office;
  v_who := app.person_provenance(p_by, v_job);
  if v_who is null then
    return jsonb_build_object('ok', false, 'error', 'only a person making a project authorises its channel');
  end if;
  insert into public.slack_channel_authority (project_id, authorized_by, authorized_via, source_job)
  values (p_project, v_who, 'project_creation', case when btrim(coalesce(p_by, '')) = '' then v_job end)
  on conflict (project_id) do nothing;
  return jsonb_build_object('ok', true, 'project', p_project, 'authorized_by', v_who);
end;
$function$;
revoke all on function app.record_channel_authority(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

create function app.channel_authority(p_office uuid, p_project uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform app.require_office(p_office);
  return (
  select jsonb_build_object('authorized_by', a.authorized_by, 'via', a.authorized_via, 'since', a.created_at,
                            'source_job', a.source_job)
    from public.slack_channel_authority a
    join public.projects pr on pr.project_id = a.project_id and pr.office_id = p_office
   where a.project_id = p_project and a.consumed_at is null
     -- The reason is about a project made just now, not a standing licence: it lapses (review, 1 October).
     and a.created_at > app.now_utc() - interval '3 days'
  );
end;
$function$;
revoke all on function app.channel_authority(uuid, uuid) from public, anon, authenticated, service_role;

create function app.consume_channel_authority(p_office uuid, p_project uuid, p_job uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare v_n int;
begin
  perform app.require_office(p_office);
  -- Spent by a job of THIS office or not at all: a job that is another office's, or nobody's, spends nothing.
  if not exists (select 1 from public.jobs j where j.job_id = p_job and j.office_id = p_office) then
    return false;
  end if;
  update public.slack_channel_authority a
     set consumed_at = app.now_utc(), consumed_by_job = p_job
   where a.project_id = p_project and a.consumed_at is null
     and exists (select 1 from public.projects pr where pr.project_id = a.project_id and pr.office_id = p_office);
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$function$;
revoke all on function app.consume_channel_authority(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create function app.fire_pending_signals(p_office uuid, p_limit integer default 20)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare v_signal uuid; v_out jsonb := '[]'::jsonb;
begin
  perform app.require_office(p_office);
  for v_signal in
    select s.signal_id from public.signals s
     where s.office_id = p_office
       and s.received_at > app.now_utc() - interval '1 hour'
       and not exists (select 1 from public.trigger_firings f where f.signal_id = s.signal_id)
       and exists (select 1 from public.event_triggers t
                    where t.office_id = p_office
                      and t.source = s.source and t.event_type = s.event_type)
     order by s.received_at
     limit greatest(1, least(100, coalesce(p_limit, 20)))
  loop
    v_out := v_out || app.fire_triggers_for(v_signal);
  end loop;
  return jsonb_build_object('ok', true, 'looked_at', jsonb_array_length(v_out),
                            'decisions', v_out);
end;
$function$;
revoke all on function app.fire_pending_signals(uuid, integer) from public, anon, authenticated, service_role;

-- hq_create_project records the creating person's authority for the project's normal channel. Spliced from the live
-- definition, asserted to have landed, tolerant of a hq_create_project another cluster has already rewritten.
do $m$
declare v text;
begin
  v := pg_get_functiondef('app.hq_create_project(uuid,text,text,text,text,boolean,text)'::regprocedure);
  if position('app.record_channel_authority(v_id, p_by, null)' in v) > 0 then
    v := replace(v, 'app.record_channel_authority(v_id, p_by, null)', 'app.record_channel_authority(p_office, v_id, p_by, null)');
    if position('app.record_channel_authority(v_id, p_by, null)' in v) > 0
       or position('app.record_channel_authority(p_office, v_id, p_by, null)' in v) = 0 then
      raise exception 'hq_create_project splice did not land';
    end if;
    execute v;
  end if;
end $m$;

-- the old signatures go
drop function app.mark_telegram_undeliverable(text, text, text);
drop function app.record_slack_channel_rename(text, text);
drop function app.record_slack_membership(text, boolean);
drop function app.record_channel_authority(uuid, text, uuid);
drop function app.channel_authority(uuid);
drop function app.consume_channel_authority(uuid, uuid);
drop function app.fire_pending_signals(integer);

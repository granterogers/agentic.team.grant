-- 0859 - six writers that relied on the compatibility bridge now name their office (multi-user P3, Wave 12).
--
-- FOUND WHILE REMOVING THE BRIDGE. The bridge meter read zero after the release and the callers check read zero, and six
-- functions still inserted into a carrier table without naming an office: `app.record_connection_health` (npm run
-- inventory), `app.record_signal`, `app.record_slack_history` (npm run slack:backfill), `app.suppress_delivery`,
-- `app.unlearn` and the trigger `app.task_leaves_a_tombstone`. They were classed OFFICE_TRUSTED_DERIVED with no door, which
-- claimed a derivation nothing performed. They are operator commands and rare paths, so a meter that counts what ran in a
-- few hours could not see them. Removing the bridge would have made `npm run inventory` fail on NOT NULL; this converts them
-- first, in the shape of every other converted function: p_office first, no default, require_office, explicit office_id on
-- the write, a foreign id answered as a nonexistent one.
--
-- Two global keys that only these writers used become per-office: signals (source, external_ref) and the connection_health
-- primary key is left as it is (the Google writer already guards its conflict target by office; see docs/multi-user).

create or replace function app.task_leaves_a_tombstone()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_links jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', l.provider,
           'external_id', l.external_id,
           'external_project_id', l.external_project_id)), '[]'::jsonb)
    into v_links
    from public.task_links l
   where l.task_id = old.task_id;
  -- Nothing outside knew about it, so there is nothing to tell and no row to keep.
  if v_links = '[]'::jsonb then
    return old;
  end if;
  insert into public.task_tombstones (office_id, task_id, title, links, deleted_by)
  values (old.office_id, old.task_id, old.title, v_links, coalesce(old.added_by, app.office_actor(old.office_id)))
  on conflict (task_id) do nothing;
  return old;
end $function$;

-- signals ------------------------------------------------------------------------------------------------------------
alter table public.signals drop constraint signals_one_per_external_ref;
alter table public.signals add constraint signals_one_per_external_ref unique (office_id, source, external_ref);

drop function app.record_signal(text, text, text, uuid, text, jsonb, uuid, timestamp with time zone);
create function app.record_signal(
  p_office uuid, p_source text, p_event_type text, p_external_ref text,
  p_project uuid default null, p_summary text default '', p_detail jsonb default '{}'::jsonb,
  p_caused_by_job uuid default null, p_happened_at timestamp with time zone default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_id uuid; v_was uuid;
begin
  perform app.require_office(p_office);
  select signal_id into v_was from public.signals
   where office_id = p_office and source = p_source and external_ref = p_external_ref;
  if v_was is not null then
    return jsonb_build_object('ok', true, 'signal', v_was, 'duplicate', true);
  end if;
  insert into public.signals
    (office_id, source, event_type, external_ref, project_id, summary, detail, caused_by_job, happened_at)
  values (p_office, p_source, p_event_type, p_external_ref, p_project,
          left(coalesce(p_summary, ''), 500), coalesce(p_detail, '{}'::jsonb),
          p_caused_by_job, coalesce(p_happened_at, app.now_utc()))
  returning signal_id into v_id;
  return jsonb_build_object('ok', true, 'signal', v_id, 'duplicate', false);
end;
$function$;
revoke all on function app.record_signal(uuid, text, text, text, uuid, text, jsonb, uuid, timestamp with time zone)
  from public, anon, authenticated, service_role;

-- the one live caller of record_signal: every non-fixture document that arrives. It names the document's own office.
create or replace function app.a_document_arriving_is_a_signal()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  -- Fixtures are not news: a suite importing forty documents must not start forty jobs.
  if exists (select 1 from public.projects p
              where p.project_id = new.project_id and p.office_id = new.office_id and p.is_fixture) then
    return new;
  end if;

  perform app.record_signal(
    new.office_id,
    'office', 'document.added', new.document_id::text, new.project_id,
    left(coalesce(new.title, '(untitled)'), 300),
    jsonb_build_object(
      'document_id', new.document_id,
      'connector', coalesce(new.connector, ''),
      'origin', coalesce(new.origin, ''),
      'doc_type', coalesce(new.doc_type, ''),
      'mime_type', coalesce(new.mime_type, '')),
    new.produced_by_job,
    coalesce(new.created_at, app.now_utc()));
  return new;
end;
$function$;

-- connection health --------------------------------------------------------------------------------------------------
drop function app.record_connection_health(jsonb);
create function app.record_connection_health(p_office uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_count integer;
begin
  perform app.require_office(p_office);
  insert into public.connection_health (office_id, service, credential, state, detail, owner, action, checked_at)
  select p_office, r->>'service', r->>'credential', r->>'state',
         left(coalesce(r->>'detail', ''), 200), coalesce(r->>'owner', ''),
         left(coalesce(r->>'action', ''), 200), app.now_utc()
    from jsonb_array_elements(p_rows) as r
  on conflict (service, credential) do update
    set state = excluded.state,
        detail = excluded.detail,
        owner = excluded.owner,
        action = excluded.action,
        checked_at = excluded.checked_at
  where public.connection_health.office_id = excluded.office_id;
  get diagnostics v_count = row_count;
  -- A service that stops being probed stops being shown, rather than lingering green for ever. Removed only when this
  -- run wrote a full set, so one partial run cannot empty the page, and only in this office.
  if v_count >= 5 then
    delete from public.connection_health
     where office_id = p_office and checked_at < app.now_utc() - interval '1 minute';
  end if;
  return v_count;
end;
$function$;
revoke all on function app.record_connection_health(uuid, jsonb) from public, anon, authenticated, service_role;

-- slack history ------------------------------------------------------------------------------------------------------
drop function public.record_slack_history(text, text, text, text, text);
drop function app.record_slack_history(text, text, text, text, text);
create function app.record_slack_history(
  p_office uuid, p_channel_id text, p_ts text, p_user text, p_text text, p_thread_ts text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_project uuid;
  v_said    text := nullif(btrim(coalesce(p_text, '')), '');
  v_key     text;
  v_id      uuid;
begin
  perform app.require_office(p_office);
  if coalesce(btrim(p_channel_id), '') = '' or coalesce(btrim(p_ts), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'a channel and a ts are both needed');
  end if;
  if v_said is null then
    return jsonb_build_object('ok', true, 'outcome', 'skipped', 'why', 'no text');
  end if;
  select m.project_id into v_project
    from public.slack_channel_map m
    join public.projects pr on pr.project_id = m.project_id and pr.office_id = p_office
   where m.channel_id = p_channel_id and m.project_id is not null;
  if v_project is null then
    return jsonb_build_object(
      'ok', false, 'error', format('channel %s maps to no project', p_channel_id));
  end if;
  v_key := 'slack:message:' || p_channel_id || ':' || p_ts;
  insert into public.inbound_commands
    (office_id, origin_channel, origin_ref, actor, instruction, dedupe_key, project_id,
     processed_at, context)
  values (p_office, 'slack', p_channel_id || ':' || p_ts, coalesce(nullif(btrim(p_user), ''), 'unknown'),
          v_said, v_key, v_project, app.now_utc(),
          jsonb_build_object('backfilled', true, 'thread_ts', p_thread_ts,
                             'project_id', v_project))
  on conflict (dedupe_key) do nothing
  returning command_id into v_id;
  return jsonb_build_object(
    'ok', true,
    'outcome', case when v_id is null then 'already there' else 'added' end,
    'command', v_id,
    'project', v_project);
end;
$function$;
revoke all on function app.record_slack_history(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
create function public.record_slack_history(
  p_office uuid, p_channel_id text, p_ts text, p_user text, p_text text, p_thread_ts text default null)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $$ select app.record_slack_history(p_office, p_channel_id, p_ts, p_user, p_text, p_thread_ts) $$;
revoke all on function public.record_slack_history(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_slack_history(uuid, text, text, text, text, text) to service_role;

-- a delivery that must not go -----------------------------------------------------------------------------------------
drop function app.suppress_delivery(text, text, text, text, text);
create function app.suppress_delivery(
  p_office uuid, p_dedupe_key text, p_reason text,
  p_channel text default null, p_account_ref text default null, p_target_ref text default null)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.deliveries;
begin
  perform app.require_office(p_office);
  select * into v_row from public.deliveries
    where dedupe_key = p_dedupe_key and office_id = p_office for update;
  if not found then
    if p_channel is null or p_account_ref is null or p_target_ref is null then
      return 'unknown_key';
    end if;
    -- A key held by another office conflicts here and is left alone: the answer is the same as for a key nobody holds.
    insert into public.deliveries
      (office_id, channel, dedupe_key, account_ref, target_ref, purpose, state,
       suppressed_reason, lease_expires_at)
    values
      (p_office, p_channel, p_dedupe_key, p_account_ref, p_target_ref, 'notice',
       'suppressed', p_reason, app.now_utc())
    on conflict (dedupe_key) do nothing;
    return 'tombstoned';
  end if;
  if v_row.state = 'sent' then return 'too_late'; end if;
  if v_row.state = 'suppressed' then return 'already_suppressed'; end if;
  update public.deliveries
     set state = 'suppressed', suppressed_reason = p_reason
   where delivery_id = v_row.delivery_id and office_id = p_office;
  return 'suppressed';
end;
$function$;
revoke all on function app.suppress_delivery(uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;

-- withdrawing a lesson ---------------------------------------------------------------------------------------------------
drop function public.unlearn(uuid, text, text);
drop function app.unlearn(uuid, text, text);
create function app.unlearn(p_office uuid, p_lesson_id uuid, p_by text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  target public.lessons%rowtype;
  note   text;
begin
  perform app.require_office(p_office);
  select * into target from public.lessons where lesson_id = p_lesson_id and office_id = p_office;
  if not found then
    return jsonb_build_object('error', 'no such lesson');
  end if;
  if exists (select 1 from public.lessons where supersedes = p_lesson_id and office_id = p_office) then
    return jsonb_build_object('error', 'that lesson is already superseded');
  end if;
  note := 'Withdrawn: ' || btrim(coalesce(p_reason, ''));
  if length(note) < 20 then
    return jsonb_build_object('error', 'say why it is being withdrawn');
  end if;
  insert into public.lessons
    (office_id, row_kind, scope, project_id, staff_slug, job_kind, body,
     learned_by, confidence, supersedes)
  values
    (p_office, 'retraction', target.scope, target.project_id, target.staff_slug,
     target.job_kind, left(note, 280), p_by, 1.00, p_lesson_id);
  return jsonb_build_object('retracted', p_lesson_id);
end;
$function$;
revoke all on function app.unlearn(uuid, uuid, text, text) from public, anon, authenticated, service_role;
create function public.unlearn(p_office uuid, p_lesson_id uuid, p_by text, p_reason text)
returns jsonb
language sql
security definer
set search_path to ''
as $$ select app.unlearn(p_office, p_lesson_id, p_by, p_reason) $$;
revoke all on function public.unlearn(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.unlearn(uuid, uuid, text, text) to service_role;

do $m$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('app', 'public')
                and p.oid::regprocedure::text in (
                  'app.record_signal(text,text,text,uuid,text,jsonb,uuid,timestamp with time zone)',
                  'app.record_connection_health(jsonb)', 'app.record_slack_history(text,text,text,text,text)',
                  'app.suppress_delivery(text,text,text,text,text)', 'app.unlearn(uuid,text,text)',
                  'public.unlearn(uuid,text,text)', 'public.record_slack_history(text,text,text,text,text)')) then
    raise exception '0859: an office-less overload is still present';
  end if;
end
$m$;

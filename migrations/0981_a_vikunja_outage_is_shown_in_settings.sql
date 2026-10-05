-- 0981: a Vikunja outage is shown in Settings. UNAPPLIED to production.
--
-- Until now an unreachable Vikunja, or one that turned the token down, was said ONCE in a deduplicated announcement
-- (tasks.sync, 0584) and nowhere a person looks: Settings showed the green "In step" chip over a copy that had stopped
-- moving. The sync's watermark was already right (a failed round marks nothing and moves no revision); what was missing was
-- anywhere to RECORD that the last round failed.
--
-- It is recorded in the mechanism every other connection already uses, public.connection_health (service 'Vikunja',
-- credential 'API token'), through one writer, and read back by the existing task_sync_panel as a new `health` key.
--
--   state  ok   the last round reached Vikunja
--          dead it did not. `kind` (in the panel) says why:
--                unreachable  network, timeout, 429, 5xx: nothing for a person to do, so the row has NO action and
--                             app.chores_for_credentials raises nothing (it requires one); it clears itself on recovery
--                refused      the token was turned down (401/403): action says where to put a new one, so the chore
--                             'Reconnect Vikunja - API token' is raised, and cleared by the first round that works
--                failed        the server answered and refused the round (the project is gone, ...): same, different words
--   fault_kind (new column) the kind above, stored, never parsed back out of the sentence or the action.
--   last_ok_at (new column) the last time a round reached Vikunja. Kept across failures, so "last in step" is a fact,
--          not a guess. If an unrelated writer sweeps the row (app.record_connection_health deletes rows it did not
--          refresh when it writes five or more), the next round recreates it; the panel then falls back to the newest
--          task link's push/pull time.
--
-- Three functions are spliced from their LIVE definitions with one added statement each: task_sync_panel (the `health`
-- key), hq_set_vikunja and hq_forget_vikunja (both call vikunja_health_clear: connecting anew starts clean, and
-- disconnecting must not leave a dead row and an open reconnect chore for a board that is no longer connected).
-- Applied-definition provenance: taken from the local replica built from migrations only; check them against production's
-- pg_get_functiondef before applying (this branch's author could not read production).
--
-- Rollback: roll the worker back first (it calls vikunja_health_record in a try/catch that tolerates absence), then restore
-- the three definitions from 0803/0742 and drop the three new functions and the column.

alter table public.connection_health add column if not exists last_ok_at timestamptz;
alter table public.connection_health add column if not exists fault_kind text;
comment on column public.connection_health.fault_kind is
  'Why a dead reading is dead, in the writer''s own vocabulary (Vikunja: unreachable, refused, failed). Never parsed out of detail. Null elsewhere.';
comment on column public.connection_health.last_ok_at is
  'The last time this credential was seen working. Written only by app.vikunja_health_record today; null elsewhere.';

create function app.vikunja_health_record(p_office uuid, p_ok boolean, p_kind text, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_kind   text := case when p_ok then null else coalesce(nullif(btrim(p_kind), ''), 'unreachable') end;
  v_detail text;
  v_action text;
begin
  perform app.require_office(p_office);
  if not p_ok and v_kind not in ('unreachable', 'refused', 'failed') then
    return jsonb_build_object('error', format('%L is not a kind of Vikunja failure', p_kind));
  end if;
  v_detail := left(case when p_ok then 'the last round reached Vikunja'
                        else coalesce(nullif(btrim(p_detail), ''), 'Vikunja did not answer') end, 200);
  v_action := case v_kind
    when 'refused' then 'Settings - Your tasks in another app: connect it again with a new token'
    when 'failed'  then 'Settings - Your tasks in another app: check the address and the project number'
    else '' end;
  begin
    insert into public.connection_health
      (service, credential, state, detail, owner, action, checked_at, last_ok_at, fault_kind, office_id)
    values ('Vikunja', 'API token', case when p_ok then 'ok' else 'dead' end, v_detail,
            app.office_actor(p_office), v_action, app.now_utc(),
            case when p_ok then app.now_utc() end, v_kind, p_office)
    on conflict (office_id, service, credential) do update
      set state = excluded.state, detail = excluded.detail, owner = excluded.owner, action = excluded.action,
          checked_at = excluded.checked_at, fault_kind = excluded.fault_kind,
          last_ok_at = coalesce(excluded.last_ok_at, public.connection_health.last_ok_at);
  exception when check_violation then
    -- connection_health refuses anything credential-shaped; a sentence that trips it is replaced, never stored.
    insert into public.connection_health
      (service, credential, state, detail, owner, action, checked_at, last_ok_at, fault_kind, office_id)
    values ('Vikunja', 'API token', 'dead', 'Vikunja failed (the detail was withheld)', app.office_actor(p_office),
            v_action, app.now_utc(), null, coalesce(v_kind, 'failed'), p_office)
    on conflict (office_id, service, credential) do update
      set state = excluded.state, detail = excluded.detail, owner = excluded.owner, action = excluded.action,
          checked_at = excluded.checked_at, fault_kind = excluded.fault_kind;
  end;
  -- Healthy again, or an outage nobody can act on: the reconnect chore is finished (same rule as chores_for_credentials).
  if p_ok or v_action = '' then
    update public.tasks set state = 'done', done_at = app.now_utc(), updated_at = app.now_utc()
     where office_id = p_office and chore_key = 'credential:vikunja:api token' and state <> 'done';
  end if;
  return jsonb_build_object('ok', true, 'state', case when p_ok then 'ok' else 'dead' end, 'kind', v_kind);
end
$f$;
revoke all on function app.vikunja_health_record(uuid, boolean, text, text) from public, anon, authenticated, service_role;

create function app.vikunja_health_clear(p_office uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $f$
begin
  perform app.require_office(p_office);
  delete from public.connection_health
   where office_id = p_office and service = 'Vikunja' and credential = 'API token';
  update public.tasks set state = 'done', done_at = app.now_utc(), updated_at = app.now_utc()
   where office_id = p_office and chore_key = 'credential:vikunja:api token' and state <> 'done';
end
$f$;
revoke all on function app.vikunja_health_clear(uuid) from public, anon, authenticated, service_role;

-- What the Settings card reads. null before any round has run, so the card says nothing it does not know.
create function app.vikunja_health(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
begin
  perform app.require_office(p_office);
  return (
    select jsonb_build_object(
             'state', case when h.state = 'ok' then 'ok' else 'down' end,
             'kind', case when h.state = 'ok' then null else coalesce(h.fault_kind, 'unreachable') end,
             'detail', h.detail,
             'checked_at', h.checked_at,
             'last_ok_at', h.last_ok_at)
      from public.connection_health h
     where h.office_id = p_office and h.service = 'Vikunja' and h.credential = 'API token');
end
$f$;
revoke all on function app.vikunja_health(uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.task_sync_panel(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_office(p_office);
  return (
  select (case when app.office_sees_the_deployment(p_office) then app.vikunja_settings() else jsonb_build_object('configured', false) end) || jsonb_build_object(
    'trouble', app.task_sync_trouble(p_office, 'vikunja'),
    -- 0981: whether the provider is answering, and when it last was (null until a round has run).
    'health', app.vikunja_health(p_office),
    /*
      What it is keeping in step, so "connected" is a number rather than a
      claim. A panel that says connected over an empty mapping is the dead-dial
      shape one layer up.
    */
    'linked', (select count(*)::int from public.task_links l
                join public.tasks t on t.task_id = l.task_id and t.office_id = p_office
               where l.provider = 'vikunja' and not coalesce(t.is_fixture, false)),
    'last_synced', (select max(greatest(coalesce(pushed_at, 'epoch'::timestamptz),
                                        coalesce(pulled_at, 'epoch'::timestamptz)))
                      from public.task_links tl2
                      join public.tasks t2 on t2.task_id = tl2.task_id and t2.office_id = p_office
                     where tl2.provider = 'vikunja'))
  );
end
$function$;

CREATE OR REPLACE FUNCTION app.hq_set_vikunja(p_office uuid, p_base_url text, p_project_id integer, p_api_token text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url  text := regexp_replace(coalesce(p_base_url, ''), '[\s​-‏﻿]', '', 'g');
  v_tok  text := regexp_replace(coalesce(p_api_token, ''), '[\s​-‏﻿]', '', 'g');
  v_said jsonb;
  v_auth jsonb;
begin
  perform app.require_office(p_office);
  if app.operator_refusal(p_office) is not null then
    return jsonb_build_object('error', app.operator_refusal(p_office));
  end if;
  if btrim(coalesce(p_by, '')) <> '' and app.principal_kind(p_by) <> 'person' then
    return jsonb_build_object('error', 'only a person connects a task board');
  end if;
  if v_url = '' or v_tok = '' then
    return jsonb_build_object('error',
      'Vikunja needs its address and an API token. Settings - API tokens, in Vikunja.');
  end if;
  if v_url ~* '^(tk_|xox[abposr]-|ghp_|github_pat_|sk-|AKIA|glpat-)' then
    return jsonb_build_object('error',
      'that looks like a credential rather than an address - the token goes in the other box');
  end if;
  if v_url !~* '^https?://' then
    return jsonb_build_object('error',
      'the address needs to start http:// or https:// - for example https://tasks.example.com');
  end if;
  if v_tok !~* '^tk_' then
    return jsonb_build_object('error',
      'that does not look like a Vikunja API token - they start tk_');
  end if;
  if coalesce(p_project_id, 0) < 1 then
    return jsonb_build_object('error',
      'which Vikunja project should the office keep in step? Its id is in the URL when you open it.');
  end if;

  v_url := regexp_replace(v_url, '/+$', '');

  /*
    THE ANSWER IS READ, not discarded. `perform` threw away a refusal and let
    this function report success about nothing at all.
  */
  v_said := app.hq_set_setting('vikunja.base_url', v_url);
  if v_said ? 'error' then return v_said; end if;
  v_said := app.hq_set_setting('vikunja.project_id', p_project_id::text);
  if v_said ? 'error' then return v_said; end if;
  perform app.store_secret('vikunja.api_token', v_tok,
    'The Vikunja API token the task sync uses. #259 Phase 2.');

  /* AND READ BACK, because two writes that both said ok can still leave the
     office unable to answer "am I connected". */
  if (app.vikunja_settings() ->> 'configured')::boolean is not true then
    return jsonb_build_object('error',
      'the address and token were accepted but the office cannot read them back');
  end if;

  update public.responsibilities set enabled = true where office_id = any (app.office_scope(p_office)) and job_kind = 'tasks.sync';
  -- The connection IS the yes: create and update on THIS board may proceed without asking; delete never can.
  v_auth := case when btrim(coalesce(p_by, '')) = '' then null
    else app.record_destination_authority(p_office, 'task.board.write', null,
           format('vikunja:%s#%s', v_url, p_project_id), p_by, null, 'the task board you connected', true) end;

  -- 0981: a new address or token starts from a clean reading; the next round writes the real one.
  perform app.vikunja_health_clear(p_office);

  return jsonb_build_object('ok', true, 'url', v_url, 'project', p_project_id,
    'authorised', coalesce((v_auth ->> 'ok')::boolean, false),
    'note', 'the office will keep your tasks in step from now on');
end;
$function$;

CREATE OR REPLACE FUNCTION app.hq_forget_vikunja(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kept    int;
  v_links   int;
  v_secrets int;
begin
  perform app.require_office(p_office);
  if app.operator_refusal(p_office) is not null then
    return jsonb_build_object('error', app.operator_refusal(p_office));
  end if;
  select count(*)::int into v_kept from public.tasks
   where office_id = p_office and assigned_to_human and not coalesce(is_fixture, false);
  select count(*)::int into v_links
    from public.task_links l join public.tasks t on t.task_id = l.task_id and t.office_id = p_office
   where l.provider = 'vikunja';

  perform app.task_provider_forget(p_office, 'vikunja');
  delete from public.system_config where key in ('vikunja.base_url', 'vikunja.project_id');

  select count(*)::int into v_secrets from vault.secrets where name = 'vikunja.api_token';
  /* The Vault is a TABLE for removal. There is no `delete_secret`. */
  delete from vault.secrets where name = 'vikunja.api_token';

  update public.responsibilities set enabled = false where office_id = any (app.office_scope(p_office)) and job_kind = 'tasks.sync';
  update public.standing_authorizations
     set revoked_at = app.now_utc(), revoked_reason = 'the task board was disconnected'
   where office_id = p_office and tool = 'task.board.write' and revoked_at is null;

  -- 0981: a disconnected board has no health to report, and its reconnect chore is finished.
  perform app.vikunja_health_clear(p_office);

  return jsonb_build_object('ok', true,
    'tasks_kept', v_kept, 'links_removed', v_links, 'credential_removed', v_secrets > 0,
    'note', 'every task is still here - Vikunja was a projection, never the list');
end;
$function$;

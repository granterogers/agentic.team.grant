/*
  0521 — the setter had a whitelist, and the writer believed itself (#259)

  Three defects in one feature, all found by DRIVING it rather than reading it,
  and every one of them a shape CLAUDE.md already names.

  1. `app.hq_set_setting` refuses any key not on a list inside itself, and
     `vikunja.base_url` was not on it. `hq_set_vikunja` called it with
     `perform`, discarded the refusal, and returned `ok: true` about a setting
     that had not been written — a claim with nothing behind it, which is the
     rule 0350's Telegram branch cost this office a whole day to learn. The
     keys are spliced into the live definition rather than transcribed, and the
     writer now READS ITS OWN WORK BACK and refuses to claim success otherwise.

  2. `system_config.value` is JSONB. `select value from …` hands back
     `"http://…"` WITH the quotes, so the handler would have built its API base
     from a quoted string and every call would have failed with a URL nobody
     could see anything wrong with. `#>> '{}'` is the text of a jsonb scalar.

  3. `vault.delete_secret` does not exist — the Vault exposes `create_secret`
     and `update_secret` and is otherwise a table. Guessing a function name
     costs what guessing a column name costs, and this file already records it.
*/

CREATE OR REPLACE FUNCTION app.hq_set_setting(p_key text, p_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_json jsonb;
  v_num  numeric;
begin
  if p_key not in (
    -- Where things live.
    'db.project_ref', 'db.region',
    'backup.s3_bucket', 'backup.s3_endpoint', 'backup.s3_region',
    -- Google, still settable so the setup card can write the client id.
    'google.client_id', 'google.redirect_uri', 'google.scopes',
    -- Integrations, on and off.
    'calendar.enabled', 'calendar.calendar_id', 'calendar.sync_tasks',
    'notebook.enabled', 'knowledge.read_new_sources',
    -- Numbers Grant should be able to turn down without a deploy.
    'notebook.window_units', 'notebook.week_units', 'notebook.sync_interval_minutes',
    'agents.max_simultaneous_jobs', 'agents.max_delegation_depth',
    'agents.max_specialists_per_job', 'agents.max_live_specialists',
    'agents.max_investigations_per_project_per_day',
    'conversation.window_minutes', 'conversation.max_turns',
    'knowledge.new_source_jobs_per_hour', 'knowledge.new_source_min_chars',
    'ui.needs_me_cap', 'grant.timezone',
    -- #259 Phase 2: where the task provider lives. The TOKEN is not here;
    -- it goes to the Vault through `hq_set_vikunja`, sorted by shape.
    'vikunja.base_url', 'vikunja.project_id'
  ) then
    return jsonb_build_object('error', format('%L is not a setting this page may change', p_key));
  end if;

  if app.credential_shape(p_value) is not null then
    return jsonb_build_object('error',
      'that value looks like ' || app.credential_shape(p_value) ||
      '. Nothing was saved. Settings are stored in plain text and shown on the page, '
      'so a credential cannot be kept in one - it goes to the vault through its own box.');
  end if;

  -- Booleans stay booleans. 'false' as a STRING is truthy in every language
  -- that will read this, which is the kind of bug that turns an integration on.
  if p_key in ('calendar.enabled', 'calendar.sync_tasks', 'notebook.enabled', 'knowledge.read_new_sources') then
    if lower(trim(p_value)) not in ('true', 'false') then
      return jsonb_build_object('error', 'that setting is on or off');
    end if;
    v_json := to_jsonb(lower(trim(p_value))::boolean);

  elsif p_key in (
    'notebook.window_units', 'notebook.week_units', 'notebook.sync_interval_minutes',
    'agents.max_simultaneous_jobs', 'agents.max_delegation_depth',
    'agents.max_specialists_per_job', 'agents.max_live_specialists',
    'agents.max_investigations_per_project_per_day',
    'conversation.window_minutes', 'conversation.max_turns',
    'knowledge.new_source_jobs_per_hour', 'knowledge.new_source_min_chars',
    'ui.needs_me_cap'
  ) then
    begin
      v_num := trim(p_value)::numeric;
    exception when others then
      return jsonb_build_object('error', 'that setting is a number');
    end;
    if v_num <> trunc(v_num) then
      return jsonb_build_object('error', 'that setting is a whole number');
    end if;
    -- Each key's own range. A wrong number here is not a rejected form, it is
    -- a system behaving oddly a day later.
    if v_num < 1 then
      return jsonb_build_object('error', 'that setting must be at least 1 — zero would stop the team');
    end if;
    if p_key like 'agents.max%' and v_num > 20 then
      return jsonb_build_object('error', 'that is high enough to be a runaway; 20 is the ceiling');
    end if;
    if p_key = 'conversation.window_minutes' and v_num > 240 then
      return jsonb_build_object(
        'error', 'over four hours of context would make every reply expensive; 240 is the ceiling');
    end if;
    if p_key = 'conversation.max_turns' and v_num > 40 then
      return jsonb_build_object('error', '40 turns is the ceiling — beyond it the question gets buried');
    end if;
    if p_key = 'notebook.sync_interval_minutes' and v_num < 5 then
      return jsonb_build_object('error', 'syncing more often than every five minutes achieves nothing');
    end if;
    v_json := to_jsonb(v_num::bigint);

  elsif p_key = 'grant.timezone' then
    -- Checked against Postgres's own list rather than a regex. A timezone that
    -- does not exist makes every date in the system silently UTC.
    if not exists (select 1 from pg_timezone_names where name = trim(p_value)) then
      return jsonb_build_object('error', format('%L is not a timezone Postgres knows', p_value));
    end if;
    v_json := to_jsonb(trim(p_value));

  else
    v_json := to_jsonb(trim(p_value));
  end if;

  insert into public.system_config (key, value, description)
  values (p_key, v_json, 'set from Team HQ')
  on conflict (key) do update set value = excluded.value;

  return jsonb_build_object('ok', true, 'key', p_key, 'value', v_json);
end;
$function$;

/* Read back as TEXT: `value` is jsonb and carries its quotes. */
create or replace function app.vikunja_settings()
returns jsonb language sql stable security definer set search_path = '' as $f$
  select jsonb_build_object(
    'base_url', (select value #>> '{}' from public.system_config where key = 'vikunja.base_url'),
    'project_id', (select (value #>> '{}')::int from public.system_config
                    where key = 'vikunja.project_id'),
    'configured', exists (select 1 from public.system_config where key = 'vikunja.base_url')
              and exists (select 1 from vault.secrets where name = 'vikunja.api_token'))
$f$;

create or replace function app.hq_set_vikunja(
  p_base_url text,
  p_project_id integer,
  p_api_token text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_url  text := regexp_replace(coalesce(p_base_url, ''), '[\s​-‏﻿]', '', 'g');
  v_tok  text := regexp_replace(coalesce(p_api_token, ''), '[\s​-‏﻿]', '', 'g');
  v_said jsonb;
begin
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

  update public.responsibilities set enabled = true where job_kind = 'tasks.sync';

  return jsonb_build_object('ok', true, 'url', v_url, 'project', p_project_id,
    'note', 'the office will keep your tasks in step from now on');
end;
$fn$;

create or replace function app.hq_forget_vikunja()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_kept    int;
  v_links   int;
  v_secrets int;
begin
  select count(*)::int into v_kept from public.tasks
   where assigned_to_human and not coalesce(is_fixture, false);
  select count(*)::int into v_links from public.task_links where provider = 'vikunja';

  perform app.task_provider_forget('vikunja');
  delete from public.system_config where key in ('vikunja.base_url', 'vikunja.project_id');

  select count(*)::int into v_secrets from vault.secrets where name = 'vikunja.api_token';
  /* The Vault is a TABLE for removal. There is no `delete_secret`. */
  delete from vault.secrets where name = 'vikunja.api_token';

  update public.responsibilities set enabled = false where job_kind = 'tasks.sync';

  return jsonb_build_object('ok', true,
    'tasks_kept', v_kept, 'links_removed', v_links, 'credential_removed', v_secrets > 0,
    'note', 'every task is still here - Vikunja was a projection, never the list');
end;
$fn$;

do $drive$
declare v jsonb; v_had int;
begin
  select count(*)::int into v_had from public.tasks
   where assigned_to_human and not coalesce(is_fixture, false);

  -- The whole round trip, with a token shaped like a real one and nothing real.
  v := app.hq_set_vikunja('https://tasks.example.invalid/', 7, 'tk_0521driveonlynotarealtoken');
  if (v ->> 'ok')::boolean is not true then
    raise exception '0521: a good address and token were refused: %', v;
  end if;
  if (app.vikunja_settings() ->> 'base_url') <> 'https://tasks.example.invalid' then
    raise exception '0521: the address did not read back as text: %', app.vikunja_settings();
  end if;
  if (app.vikunja_settings() ->> 'project_id')::int <> 7 then
    raise exception '0521: the project id did not read back: %', app.vikunja_settings();
  end if;
  if not exists (select 1 from public.responsibilities
                  where job_kind = 'tasks.sync' and enabled) then
    raise exception '0521: connecting it did not start the duty';
  end if;

  v := app.hq_forget_vikunja();
  if (v ->> 'credential_removed')::boolean is not true then
    raise exception '0521: disconnecting did not remove the credential: %', v;
  end if;
  if (v ->> 'tasks_kept')::int <> v_had then
    raise exception '0521: disconnecting changed the number of tasks';
  end if;
  if (app.vikunja_settings() ->> 'configured')::boolean is not false then
    raise exception '0521: it still reports itself connected after a disconnect';
  end if;
  if exists (select 1 from vault.secrets where name = 'vikunja.api_token') then
    raise exception '0521: the credential is still in the Vault';
  end if;
  raise notice '0521 drive: seven checks passed';
end;
$drive$;

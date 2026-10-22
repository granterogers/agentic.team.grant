/*
  1095 — a Microsoft To Do connection is an office connection (#259, Phase 2 for Microsoft To Do)

  Grant's tasks already sync, both ways, to a Vikunja board (0519 to 0981). Microsoft To Do is the second
  destination he asked for, and it is built as a second provider on the same seam (`task_links.provider`), not as a
  second copy of Vikunja's machinery: the engine in `src/tasks/sync.ts` is unchanged and everything Microsoft-shaped
  is in `src/tasks/microsoft-todo.ts`.

  ## What differs from Vikunja, and why

  Vikunja is a server Grant runs and gives an address and a token to. Microsoft To Do lives on Microsoft's own
  accounts, so the credential is a delegated refresh token from an OAuth consent screen, exactly as Google is. That
  is why this migration has an OAuth state table (the same design as 0648's `google_oauth_states`), a one-time state
  minted only for a deployment operator, and a callback in the `microsoft-oauth` edge function.

  The application's client id is a public identifier (system_config, like `google.client_id`). Its client secret is a
  deployment secret and goes in the Vault under a classified name. The refresh token also goes in the Vault. Neither
  is returned by any read in this file: the Settings payload reports only whether each one is present.

  ## Names, once

    system_config  microsoft.client_id, microsoft.redirect_uri, microsoft_todo.list_id, microsoft_todo.list_name,
                   microsoft_todo.health
    vault          microsoft.client_secret, microsoft_todo.refresh_token  (both `human_integration`)
    provider       microsoft_todo
    job kind       microsoft.todo_sync (duty `microsoft-todo-sync`, every 15 minutes, disabled until connected)

  ## Limits, stated now rather than discovered later

  Like Vikunja's (0742), the connection is ONE per deployment: one refresh token name, one list, one health row. The
  office argument is checked and carried, so a second office can be added by moving these names onto the office the
  way 0800 did for Google. Until then a second office's connect would replace the first one's.

  Microsoft rotates refresh tokens on use, so the duty writes the new one back through
  `app.microsoft_todo_rotate_refresh`. That function changes the Vault and nothing else.

  Disconnecting removes the link rows, the list, the health reading and the refresh token. It never removes the
  application's client id or secret: those belong to the app registration, and forgetting them would make the next
  connect a re-registration.
*/

-- 1. The classification. Replaced whole, with the two names added to the human-integration list (0864's body).
create or replace function app.credential_class(p_name text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case
    when p_name in ('google.client_secret', 'google.refresh_token', 'google.revoking_refresh_token',
                    'notion.integration_token', 'vikunja.api_token', 'github.read_token', 'github.token',
                    'notebook.master_token_json', 'notebook.reader_secret', 'notebook.storage_state',
                    'telegram.user_session', 'telegram.api_id', 'telegram.api_hash',
                    'microsoft.client_secret', 'microsoft_todo.refresh_token')
      then 'human_integration'
    -- Posting through the deployment's own bots and Slack app. Reached through app.resolve_secret(ref) by the
    -- channel adapters, behind delivery containment (claim_delivery / may_act_outside), not through this reader.
    -- A Google credential held by an office other than the deployment's own (0800): the name carries the office.
    when p_name ~ '^google\.(refresh_token|revoking_refresh_token)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then 'human_integration'
    when p_name in ('slack.bot_token', 'slack.client_secret', 'slack.config_refresh_token',
                    'slack.config_token', 'slack.signing_secret', 'telegram.webhook_secret')
      or p_name ~ '^telegram\..+\.bot_token$'
      then 'channel'
    when p_name in ('hq.api_token', 'openrouter.api_key', 'voice.api_key', 'worker.kick_secret',
                    'github.dispatch_token', 'p4.second_person.password')
      or p_name like 'supabase.%' or p_name like 'backup.%' or p_name like 'browser.cloudflare\_%'
      then 'infra'
    else null
  end
$function$;

-- 2. One-time states for the connect flow. Only the SHA-256 of a state is stored (0648's design), and each row carries
--    the office the connect was started for, which the callback needs and Google's table does not have.
create table if not exists public.microsoft_oauth_states (
  state_hash   text primary key,
  operator_key text not null check (btrim(operator_key) <> ''),
  office_id    uuid not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz
);
comment on table public.microsoft_oauth_states is
  'One-time states for the Microsoft To Do connect flow (1095). Minted for an operator and an office by app.hq_microsoft_connect_start, consumed by the microsoft-oauth callback. Only the SHA-256 of the state is stored.';
alter table public.microsoft_oauth_states enable row level security;
revoke all on table public.microsoft_oauth_states from anon, authenticated;
grant select on table public.microsoft_oauth_states to service_role;

-- 3. The public application identifiers and the redirect address. The redirect is seeded to this project's callback
--    and must be listed verbatim in the Entra app registration (see the report that accompanies this migration).
insert into public.system_config (key, value, description) values
  ('microsoft.redirect_uri',
   to_jsonb('https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/microsoft-oauth/callback'::text),
   'Where Microsoft sends him back. Must be listed verbatim under the Web platform of the Entra app registration.')
on conflict (key) do nothing;

-- 4. The connect start. Minted for a deployment operator only (as Google's is), and only once the client is configured.
create function app.hq_microsoft_connect_start(p_office uuid, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog', 'extensions'
as $f$
declare
  v_state  text;
  v_start  text;
begin
  perform app.require_office(p_office);
  if not public.deployment_operator(btrim(coalesce(p_by, ''))) then
    return jsonb_build_object('error', 'Only the deployment operator can connect Microsoft To Do.');
  end if;
  if not exists (select 1 from public.system_config where key = 'microsoft.client_id')
     or not exists (select 1 from vault.secrets where name = 'microsoft.client_secret') then
    return jsonb_build_object('error',
      'Microsoft To Do is not set up yet: save the application ID and client secret first, in Settings.');
  end if;

  delete from public.microsoft_oauth_states where created_at < now() - interval '1 day';
  v_state := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.microsoft_oauth_states (state_hash, operator_key, office_id, expires_at)
  values (encode(extensions.digest(v_state, 'sha256'), 'hex'), btrim(p_by), p_office, now() + interval '10 minutes');

  v_start := regexp_replace(
    (select value #>> '{}' from public.system_config where key = 'microsoft.redirect_uri'), '/callback$', '/start');
  return jsonb_build_object('ok', true, 'url', v_start || '?state=' || v_state, 'expires_in_seconds', 600);
end;
$f$;

create function public.microsoft_oauth_state_live(p_state text)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_catalog', 'extensions'
as $f$
  select exists (
    select 1 from public.microsoft_oauth_states s
     where s.state_hash = encode(extensions.digest(coalesce(p_state, ''), 'sha256'), 'hex')
       and s.used_at is null and s.expires_at > now()
       and public.deployment_operator(s.operator_key))
$f$;

-- Returns {operator, office} for the state, or null. Marks it used in the same statement that checks it, so a replayed
-- callback is refused too (0648's reasoning, unchanged).
create function public.microsoft_oauth_state_consume(p_state text)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog', 'extensions'
as $f$
declare
  v_row record;
begin
  update public.microsoft_oauth_states s set used_at = now()
   where s.state_hash = encode(extensions.digest(coalesce(p_state, ''), 'sha256'), 'hex')
     and s.used_at is null and s.expires_at > now()
     and public.deployment_operator(s.operator_key)
  returning s.operator_key, s.office_id into v_row;
  if v_row is null then
    return null;
  end if;
  return jsonb_build_object('operator', v_row.operator_key, 'office', v_row.office_id);
end;
$f$;

-- What the callback needs to exchange a code: the public id, the redirect and whether the secret is present. Never the
-- secret itself: the callback reads that through the resolver, as the operator the state was minted for.
create function public.microsoft_oauth_config()
returns jsonb
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $f$
  select jsonb_build_object(
    'client_id', coalesce((select value #>> '{}' from public.system_config where key = 'microsoft.client_id'), ''),
    'redirect_uri', coalesce((select value #>> '{}' from public.system_config where key = 'microsoft.redirect_uri'), ''),
    'has_secret', exists (select 1 from vault.secrets where name = 'microsoft.client_secret'))
$f$;

-- 5. Saving the application registration. Operator-only: it is the deployment's app, shared by every office.
create function app.hq_set_microsoft_client(p_office uuid, p_client_id text, p_client_secret text, p_by text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_id   text := app.credential_clean(p_client_id);
  v_sec  text := app.credential_clean(p_client_secret);
  v_refusal text;
begin
  perform app.require_office(p_office);
  v_refusal := app.operator_refusal(p_office);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  if v_id = '' and v_sec = '' then
    return jsonb_build_object('error', 'there is nothing to save');
  end if;

  /*
    Sorted by shape, as 0377 does for Google. The application ID is a GUID and is shown back on the page, so a secret
    in that box is refused and never stored in plain text. The secret VALUE is never a GUID; the secret ID Entra shows
    beside it is, and is refused for the same reason in the other box.
  */
  if v_id <> '' and v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('error',
      'the application ID is a GUID such as 1a2b3c4d-0000-4000-8000-000000000000 - the secret value goes in the other box');
  end if;
  if v_sec <> '' and v_sec ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('error',
      'that is the secret ID, not the secret value - copy the value shown once when the secret was created');
  end if;

  if v_id <> '' then
    insert into public.system_config (key, value, description)
    values ('microsoft.client_id', to_jsonb(v_id),
            'The Microsoft Entra application (client) ID for To Do sync. Public by design, like google.client_id.')
    on conflict (key) do update set value = excluded.value;
  end if;
  if v_sec <> '' then
    perform app.store_secret('microsoft.client_secret', v_sec,
      'The Microsoft Entra client secret VALUE for To Do sync (1095). Read only by the microsoft-oauth callback and the sync duty.');
  end if;

  return jsonb_build_object('ok', true,
    'client_configured', exists (select 1 from public.system_config where key = 'microsoft.client_id')
                     and exists (select 1 from vault.secrets where name = 'microsoft.client_secret'));
end;
$f$;
revoke all on function app.hq_set_microsoft_client(uuid, text, text, text) from public, anon, authenticated, service_role;

-- 6. Storing what Microsoft granted. Called by the callback only, and only after the state was consumed.
create function app.hq_store_microsoft_refresh(p_office uuid, p_refresh_token text, p_scopes text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
begin
  perform app.require_office(p_office);
  if coalesce(trim(p_refresh_token), '') = '' then
    return jsonb_build_object('error', 'no refresh token');
  end if;
  perform app.store_secret('microsoft_todo.refresh_token', trim(p_refresh_token),
    format('Microsoft To Do refresh token, granted %s. Scopes: %s', app.now_utc(), p_scopes));

  update public.system_config set value = 'null'::jsonb where key = 'microsoft_todo.health';
  update public.responsibilities set enabled = true
   where office_id = any (app.office_scope(p_office)) and job_kind = 'microsoft.todo_sync';
  return jsonb_build_object('ok', true);
end;
$f$;
revoke all on function app.hq_store_microsoft_refresh(uuid, text, text) from public, anon, authenticated, service_role;

-- 7. Rotation. Microsoft issues a new refresh token on use and the old one stops working, so the duty writes the new one
--    back. It changes the Vault and nothing else: no responsibility, no health reading.
create function app.microsoft_todo_rotate_refresh(p_office uuid, p_refresh_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $f$
begin
  perform app.require_office(p_office);
  perform app.store_secret('microsoft_todo.refresh_token', trim(p_refresh_token),
    format('Microsoft To Do refresh token, rotated %s.', app.now_utc()));
end;
$f$;
revoke all on function app.microsoft_todo_rotate_refresh(uuid, text) from public, anon, authenticated, service_role;

-- 8. What the duty records for Settings. Kind is one of ok, refused, unreachable, error (the same words as Vikunja's
--    reading, so the card reads both the same way).
create function app.microsoft_todo_health_record(p_office uuid, p_ok boolean, p_kind text, p_detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $f$
begin
  perform app.require_office(p_office);
  insert into public.system_config (key, value, description)
  values ('microsoft_todo.health',
          jsonb_build_object(
            'ok', coalesce(p_ok, false),
            'kind', case when p_kind in ('ok', 'refused', 'unreachable', 'error') then p_kind else 'error' end,
            'detail', left(coalesce(p_detail, ''), 200),
            'at', app.now_utc()),
          'The last Microsoft To Do round, for Settings (1095).')
  on conflict (key) do update set value = excluded.value;
end;
$f$;
revoke all on function app.microsoft_todo_health_record(uuid, boolean, text, text) from public, anon, authenticated, service_role;

create function app.microsoft_todo_remember_list(p_office uuid, p_list_id text, p_list_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $f$
begin
  perform app.require_office(p_office);
  insert into public.system_config (key, value, description) values
    ('microsoft_todo.list_id', to_jsonb(coalesce(p_list_id, '')), 'The Microsoft To Do list the office keeps in step (1095).'),
    ('microsoft_todo.list_name', to_jsonb(coalesce(p_list_name, '')), 'The name of that list, for Settings (1095).')
  on conflict (key) do update set value = excluded.value;
end;
$f$;
revoke all on function app.microsoft_todo_remember_list(uuid, text, text) from public, anon, authenticated, service_role;

-- 9. What Settings reads. Never a secret: only whether each one is present. Gated like Vikunja's (0981): an office that
--    does not see the deployment is told it is not configured, and learns nothing about the deployment's app.
create function app.microsoft_todo_settings(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
begin
  perform app.require_office(p_office);
  if not app.office_sees_the_deployment(p_office) then
    return jsonb_build_object('configured', false, 'connected', false, 'client_configured', false, 'list_id', null);
  end if;
  return jsonb_build_object(
    'client_configured', exists (select 1 from public.system_config where key = 'microsoft.client_id')
                     and exists (select 1 from vault.secrets where name = 'microsoft.client_secret'),
    'connected', exists (select 1 from vault.secrets where name = 'microsoft_todo.refresh_token'),
    'configured', exists (select 1 from vault.secrets where name = 'microsoft_todo.refresh_token')
              and exists (select 1 from public.system_config where key = 'microsoft_todo.list_id'
                           and coalesce(value #>> '{}', '') <> ''),
    'list_id', (select nullif(value #>> '{}', '') from public.system_config where key = 'microsoft_todo.list_id'),
    'list_name', (select value #>> '{}' from public.system_config where key = 'microsoft_todo.list_name'),
    'redirect_uri', (select value #>> '{}' from public.system_config where key = 'microsoft.redirect_uri'),
    'health', (select value from public.system_config where key = 'microsoft_todo.health'),
    'trouble', app.task_sync_trouble(p_office, 'microsoft_todo'));
end;
$f$;

-- 10. Disconnecting. Removes the links, the list, the health reading and the refresh token (COUNTED, as 0520 does).
--     Never the application's client id or secret, and never a task.
create function app.hq_forget_microsoft_todo(p_office uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_kept    int;
  v_links   int;
  v_secrets int;
  v_refusal text;
begin
  perform app.require_office(p_office);
  v_refusal := app.operator_refusal(p_office);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  select count(*)::int into v_kept from public.tasks
   where office_id = p_office and assigned_to_human and not coalesce(is_fixture, false);
  select count(*)::int into v_links
    from public.task_links l join public.tasks t on t.task_id = l.task_id and t.office_id = p_office
   where l.provider = 'microsoft_todo';

  perform app.task_provider_forget(p_office, 'microsoft_todo');
  delete from public.system_config
   where key in ('microsoft_todo.list_id', 'microsoft_todo.list_name', 'microsoft_todo.health');

  select count(*)::int into v_secrets from vault.secrets where name = 'microsoft_todo.refresh_token';
  delete from vault.secrets where name = 'microsoft_todo.refresh_token';

  update public.responsibilities set enabled = false
   where office_id = any (app.office_scope(p_office)) and job_kind = 'microsoft.todo_sync';

  return jsonb_build_object('ok', true,
    'tasks_kept', v_kept, 'links_removed', v_links, 'credential_removed', v_secrets > 0,
    'note', 'every task is still here. The Microsoft application ID and secret are kept: they belong to the app registration, not to this connection.');
end;
$f$;

-- 11. Public doors. The gateway and the edge functions reach these; the app schema functions stay behind them.
create function public.microsoft_todo_settings(p_office uuid)
returns jsonb language sql stable security definer set search_path = '' as $w$
  select app.microsoft_todo_settings(p_office)
$w$;
create function public.hq_set_microsoft_client(p_office uuid, p_client_id text, p_client_secret text, p_by text default null)
returns jsonb language sql security definer set search_path = '' as $w$
  select app.hq_set_microsoft_client(p_office, p_client_id, p_client_secret, p_by)
$w$;
create function public.hq_microsoft_connect_start(p_office uuid, p_by text default null)
returns jsonb language sql security definer set search_path = '' as $w$
  select app.hq_microsoft_connect_start(p_office, p_by)
$w$;
create function public.hq_store_microsoft_refresh(p_office uuid, p_refresh_token text, p_scopes text)
returns jsonb language sql security definer set search_path = '' as $w$
  select app.hq_store_microsoft_refresh(p_office, p_refresh_token, p_scopes)
$w$;
create function public.hq_forget_microsoft_todo(p_office uuid)
returns jsonb language sql security definer set search_path = '' as $w$
  select app.hq_forget_microsoft_todo(p_office)
$w$;

revoke all on function public.microsoft_todo_settings(uuid) from public, anon;
grant execute on function public.microsoft_todo_settings(uuid) to authenticated, service_role;
revoke all on function public.hq_set_microsoft_client(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.hq_set_microsoft_client(uuid, text, text, text) to service_role;
revoke all on function public.hq_microsoft_connect_start(uuid, text) from public, anon, authenticated;
grant execute on function public.hq_microsoft_connect_start(uuid, text) to service_role;
revoke all on function public.hq_store_microsoft_refresh(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_store_microsoft_refresh(uuid, text, text) to service_role;
revoke all on function public.hq_forget_microsoft_todo(uuid) from public, anon, authenticated;
grant execute on function public.hq_forget_microsoft_todo(uuid) to service_role;
revoke all on function public.microsoft_oauth_state_live(text) from public, anon, authenticated;
grant execute on function public.microsoft_oauth_state_live(text) to service_role;
revoke all on function public.microsoft_oauth_state_consume(text) from public, anon, authenticated;
grant execute on function public.microsoft_oauth_state_consume(text) to service_role;
revoke all on function public.microsoft_oauth_config() from public, anon, authenticated;
grant execute on function public.microsoft_oauth_config() to service_role;

-- 12. The duty, DISABLED until it is connected. Written as 0519 writes its duty, but with this office's own row:
--     responsibilities are unique per (office, slug) since 0662.
insert into public.responsibilities
  (office_id, slug, description, staff_id, job_kind, period_minutes, enabled, created_by)
select app.operator_office(),
       'microsoft-todo-sync',
       'Keep Grant''s personal tasks in step with Microsoft To Do, when he has connected it (1095).',
       (select staff_id from public.staff where slug = 'chief-of-staff'),
       'microsoft.todo_sync',
       15,
       false,
       'migration'
on conflict (office_id, slug) do update
   set job_kind = excluded.job_kind,
       period_minutes = excluded.period_minutes,
       description = excluded.description;

-- 13. Self-checks, against the live definitions. They prove the shape: classification, the settings payload carries no
--     secret, and the duty is present and disabled. They do not connect anything.
do $drive$
declare
  v jsonb;
begin
  if app.credential_class('microsoft.client_secret') is distinct from 'human_integration'
     or app.credential_class('microsoft_todo.refresh_token') is distinct from 'human_integration' then
    raise exception '1095: the Microsoft names are not classified as human integration credentials';
  end if;
  if app.credential_class('google.client_secret') is distinct from 'human_integration' then
    raise exception '1095: the classification lost an existing name';
  end if;

  if app.operator_office() is not null then
    v := app.microsoft_todo_settings(app.operator_office());
    if v ? 'client_secret' or v ? 'refresh_token' then
      raise exception '1095: the settings payload carries a secret';
    end if;
    if (v ->> 'connected')::boolean is not false then
      raise exception '1095: it reports itself connected before anything was stored';
    end if;
  end if;

  if not exists (select 1 from public.responsibilities where job_kind = 'microsoft.todo_sync' and not enabled) then
    raise exception '1095: the duty is missing, or is running before it is connected';
  end if;
  raise notice '1095 drive: classification, settings shape and the disabled duty checked';
end;
$drive$;

-- 10. The list picker and the gateway's doors for the test and the list (1095).
--     The office keeps its tasks in ONE To Do list, and Grant chooses which one from the lists his account holds. The
--     gateway reads the lists and runs the test; this only records the choice. Operator-only at the gateway (hq-api
--     OPERATOR_ONLY), because the connection is the deployment's.
create function app.hq_microsoft_set_list(p_office uuid, p_list_id text, p_list_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_id   text := btrim(coalesce(p_list_id, ''));
  v_name text := left(btrim(coalesce(p_list_name, '')), 120);
begin
  -- A To Do list id is a short opaque string with no spaces. Anything else is refused before it is stored.
  if v_id = '' or length(v_id) > 300 or v_id ~ '\s' then
    return jsonb_build_object('error', 'choose one of your To Do lists from the list');
  end if;
  perform app.microsoft_todo_remember_list(p_office, v_id, v_name);
  return jsonb_build_object('ok', true, 'list_name', v_name,
    'note', 'the office keeps its tasks in this list from the next round');
end;
$f$;
revoke all on function app.hq_microsoft_set_list(uuid, text, text) from public, anon, authenticated, service_role;

create function public.hq_microsoft_set_list(p_office uuid, p_list_id text, p_list_name text)
returns jsonb language sql security definer set search_path = '' as $w$
  select app.hq_microsoft_set_list(p_office, p_list_id, p_list_name)
$w$;
revoke all on function public.hq_microsoft_set_list(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_microsoft_set_list(uuid, text, text) to service_role;

-- The gateway stores a refresh token Microsoft rotated during the test or the list read, so the next round still works.
create function public.microsoft_todo_store_rotation(p_office uuid, p_refresh_token text)
returns void language sql security definer set search_path = '' as $w$
  select app.microsoft_todo_rotate_refresh(p_office, p_refresh_token)
$w$;
revoke all on function public.microsoft_todo_store_rotation(uuid, text) from public, anon, authenticated;
grant execute on function public.microsoft_todo_store_rotation(uuid, text) to service_role;

do $drive$
declare v jsonb;
begin
  -- Refusals driven, without an office: an empty id and an id with a space are both refused before anything is stored.
  v := app.hq_microsoft_set_list(null, '', 'Team HQ');
  if v ->> 'error' is null then
    raise exception '1095: an empty list id was accepted: %', v;
  end if;
  v := app.hq_microsoft_set_list(null, 'AAMk list with a space', 'Team HQ');
  if v ->> 'error' is null then
    raise exception '1095: a list id with a space was accepted: %', v;
  end if;
  raise notice '1095 drive: list refusals checked (the stored choice needs an office and is proved by the replica suite)';
end;
$drive$;

-- ADR-0065: a Slack workspace belongs to ONE office, and the person who installs it is its first admitted sender.
--
-- Same shape as 0885 (a person connects their own Telegram): a single-use, ten-minute, hashed `state` minted for the office of a
-- verified session; the callback takes the office from the state's ROW and the workspace and user from Slack's verified answer,
-- never from the request. What differs is the thing connected: a Slack install carries a bot TOKEN, which goes to the vault and
-- is never returned to a browser, a log or a response.
--
-- This migration is the receiving half. `slack_link_status` says plainly whether the office can REPLY in that workspace, and it
-- says no until the worker resolves a bot token per office (system_config `slack.per_office_delivery`), because a connect flow
-- that completes while nothing is ever delivered would be a misleading success.

begin;

-- One workspace is claimed by one office for good: the pair is the key a per-install row must agree with.
alter table public.slack_workspaces
  add constraint slack_workspaces_team_office_key unique (team_id, office_id);

-- The state of an install request lives in the same table as a Telegram link request.
alter table public.channel_link_challenges drop constraint channel_link_challenges_channel_check;
alter table public.channel_link_challenges
  add constraint channel_link_challenges_channel_check check (channel in ('telegram', 'slack'));

create table public.slack_installs (
  install_id     uuid primary key default gen_random_uuid(),
  office_id      uuid not null references public.offices (office_id),
  team_id        text not null check (team_id ~ '^T[A-Z0-9]{8,}$'),
  installer_user text not null check (installer_user ~ '^[UW][A-Z0-9]{8,}$'),
  bot_user_id    text not null check (bot_user_id ~ '^[UW][A-Z0-9]{8,}$'),
  app_id         text,
  bot_token_ref  uuid,
  state          text not null default 'active' check (state in ('active', 'revoked')),
  installed_at   timestamptz not null default app.now_utc(),
  revoked_at     timestamptz,
  constraint slack_installs_revoked_iff check ((state = 'revoked') = (revoked_at is not null)),
  constraint slack_installs_active_has_a_token check (state = 'revoked' or bot_token_ref is not null),
  constraint slack_installs_team_id_fkey foreign key (team_id) references public.slack_workspaces (team_id),
  constraint slack_installs_team_id_same_office foreign key (team_id, office_id)
    references public.slack_workspaces (team_id, office_id)
);
create unique index slack_installs_one_active_team on public.slack_installs (team_id) where state = 'active';
create unique index slack_installs_one_active_office on public.slack_installs (office_id) where state = 'active';
create index slack_installs_office_idx on public.slack_installs (office_id, installed_at desc);
comment on table public.slack_installs is
  'A person''s own Slack workspace install (ADR-0065). The bot token is in the vault, referenced by bot_token_ref, and is never '
  'returned to a client. Rows are kept after a disconnect (state revoked) as the record of what was connected.';

create trigger a1_office_write_once
  before update of office_id on public.slack_installs
  for each row execute function app.office_id_is_write_once();
alter table public.slack_installs enable row level security;
revoke all on table public.slack_installs from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
create function app.slack_install_begin(p_office uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_state text;
  v_expires timestamptz;
  v_client text;
begin
  perform app.require_office(p_office);
  if p_office = app.operator_office() then
    return jsonb_build_object('ok', false, 'error', 'operator', 'message', 'This office''s Slack is set up by the person who runs the deployment.');
  end if;
  -- Not switched on: the Slack app has not been opened to other workspaces (its client id is not set). Said, not offered.
  select nullif(btrim(c.value #>> '{}'), '') into v_client from public.system_config c where c.key = 'slack.client_id';
  if v_client is null then
    return jsonb_build_object('ok', false, 'error', 'not_enabled', 'message', 'Slack is not switched on for other workspaces yet. It needs the person who runs the deployment to open the Slack app to them.');
  end if;
  if exists (select 1 from public.slack_installs i where i.office_id = p_office and i.state = 'active') then
    return jsonb_build_object('ok', false, 'error', 'already_connected', 'message', 'Slack is already connected. Disconnect it first to connect a different workspace.');
  end if;
  if (select count(*) from public.channel_link_challenges c
       where c.office_id = p_office and c.channel = 'slack' and c.created_at > app.now_utc() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many', 'message', 'Too many attempts in the last hour. Try again later.');
  end if;

  update public.channel_link_challenges c
     set revoked_at = app.now_utc()
   where c.office_id = p_office and c.channel = 'slack'
     and c.used_at is null and c.revoked_at is null and c.expires_at > app.now_utc();

  v_state := encode(extensions.gen_random_bytes(18), 'hex');
  v_expires := app.now_utc() + interval '10 minutes';
  insert into public.channel_link_challenges (office_id, channel, token_sha256, expires_at)
  values (p_office, 'slack', encode(sha256(convert_to(v_state, 'utf8')), 'hex'), v_expires);

  return jsonb_build_object('ok', true, 'state', v_state, 'client_id', v_client, 'expires_at', v_expires);
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- The callback. It takes NO office: the office is the state row's, the workspace and user are what Slack verified.
create function app.slack_install_redeem(
  p_state text, p_team_id text, p_team_name text, p_bot_user_id text, p_app_id text, p_user_id text, p_bot_token text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_row public.channel_link_challenges;
  v_hash text;
  v_owner uuid;
  v_existing uuid;
  v_ref uuid;
begin
  if p_state is null or p_state !~ '^[0-9a-f]{36}$'
     or p_team_id is null or p_team_id !~ '^T[A-Z0-9]{8,}$'
     or p_user_id is null or p_user_id !~ '^[UW][A-Z0-9]{8,}$'
     or p_bot_user_id is null or p_bot_user_id !~ '^[UW][A-Z0-9]{8,}$'
     or p_bot_token is null or p_bot_token !~ '^xoxb-[A-Za-z0-9-]{10,}$'
     or coalesce(btrim(p_team_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  v_hash := encode(sha256(convert_to(p_state, 'utf8')), 'hex');

  select * into v_row from public.channel_link_challenges c where c.token_sha256 = v_hash and c.channel = 'slack' for update;
  if not found or v_row.used_at is not null or v_row.revoked_at is not null or v_row.expires_at <= app.now_utc()
     or not exists (select 1 from public.offices o where o.office_id = v_row.office_id and o.state = 'active')
     or v_row.office_id = app.operator_office() then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- A workspace, once claimed, stays with the office that claimed it (a re-install by the same office is allowed).
  select w.office_id into v_owner from public.slack_workspaces w where w.team_id = p_team_id;
  if v_owner is not null and v_owner <> v_row.office_id then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  select i.office_id into v_existing from public.subject_identities i where i.origin_channel = 'slack' and i.actor = p_user_id;
  if v_existing is not null and v_existing <> v_row.office_id then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  if exists (select 1 from public.slack_installs s where s.office_id = v_row.office_id and s.state = 'active') then
    return jsonb_build_object('ok', false, 'error', 'office_already_connected');
  end if;

  -- The token goes to the vault under a name of the workspace's, and only its reference is kept.
  v_ref := app.store_secret('slack.install.' || p_team_id, p_bot_token,
                            'Bot token of the Slack workspace ' || p_team_id || ' installed by a person (ADR-0065)')::uuid;

  insert into public.slack_workspaces (team_id, team_name, bot_user_id, app_id, installed, installed_at, office_id)
  values (p_team_id, left(btrim(p_team_name), 120), p_bot_user_id, nullif(btrim(coalesce(p_app_id, '')), ''), true, app.now_utc(), v_row.office_id)
  on conflict (team_id) do update
     set team_name = excluded.team_name, bot_user_id = excluded.bot_user_id, app_id = excluded.app_id,
         installed = true, installed_at = app.now_utc(), uninstalled_at = null, revocation_reason = null,
         updated_at = app.now_utc()
   where public.slack_workspaces.office_id = v_row.office_id;

  insert into public.slack_installs (office_id, team_id, installer_user, bot_user_id, app_id, bot_token_ref)
  values (v_row.office_id, p_team_id, p_user_id, p_bot_user_id, nullif(btrim(coalesce(p_app_id, '')), ''), v_ref);

  if v_existing is null then
    insert into public.subject_identities (office_id, subject, origin_channel, actor, note, kind)
    values (v_row.office_id, app.office_actor(v_row.office_id), 'slack', p_user_id, 'connected by the person from Team HQ', 'person');
  end if;

  update public.channel_link_challenges c
     set used_at = app.now_utc(), used_by_actor = p_user_id
   where c.challenge_id = v_row.challenge_id;

  -- Names only: never the token, never an id of the vault.
  return jsonb_build_object('ok', true, 'team_name', left(btrim(p_team_name), 120));
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
create function app.slack_install_status(p_office uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $f$
declare
  v_install public.slack_installs;
  v_waiting timestamptz;
  v_configured boolean;
begin
  perform app.require_office(p_office);
  select * into v_install from public.slack_installs i where i.office_id = p_office and i.state = 'active';
  select max(c.expires_at) into v_waiting from public.channel_link_challenges c
   where c.office_id = p_office and c.channel = 'slack'
     and c.used_at is null and c.revoked_at is null and c.expires_at > app.now_utc();
  v_configured := coalesce((select nullif(btrim(c.value #>> '{}'), '') is not null from public.system_config c where c.key = 'slack.client_id'), false);
  return jsonb_build_object('slack', jsonb_build_object(
    'state', case when v_install.install_id is not null then 'connected' when v_waiting is not null then 'waiting' else 'none' end,
    'workspace', case when v_install.install_id is not null
                      then (select w.team_name from public.slack_workspaces w where w.team_id = v_install.team_id) end,
    'connected_at', v_install.installed_at,
    'waiting_until', case when v_install.install_id is null then v_waiting end,
    'can_connect', p_office <> app.operator_office() and v_install.install_id is null and v_configured,
    'available', v_configured,
    'managed_by_operator', p_office = app.operator_office(),
    -- Receiving is true once the installer is admitted; replying is true only when the worker resolves a token per office.
    'can_receive', v_install.install_id is not null
                   and exists (select 1 from public.subject_identities i
                                where i.office_id = p_office and i.origin_channel = 'slack' and i.actor = v_install.installer_user),
    'can_reply', v_install.install_id is not null
                 and coalesce((select (c.value #>> '{}') = 'true' from public.system_config c where c.key = 'slack.per_office_delivery'), false)));
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Disconnect: everything is retired in one statement. The one thing it returns is the bot token, to the gateway that
-- must revoke it at Slack in the same request; the vault copy is deleted here, so afterwards it exists nowhere else.
create function app.slack_install_disconnect(p_office uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v_install public.slack_installs;
  v_token text;
begin
  perform app.require_office(p_office);
  if p_office = app.operator_office() then
    return jsonb_build_object('ok', false, 'error', 'operator', 'message', 'This office''s Slack is managed by the person who runs the deployment.');
  end if;
  select * into v_install from public.slack_installs i where i.office_id = p_office and i.state = 'active' for update;
  if not found then
    return jsonb_build_object('ok', true, 'removed', 0);
  end if;

  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.id = v_install.bot_token_ref;
  delete from public.subject_identities i
   where i.office_id = p_office and i.origin_channel = 'slack' and i.kind = 'person';
  update public.slack_installs i set state = 'revoked', revoked_at = app.now_utc(), bot_token_ref = null
   where i.install_id = v_install.install_id;
  delete from vault.secrets s where s.id = v_install.bot_token_ref;
  update public.slack_workspaces w
     set installed = false, uninstalled_at = app.now_utc(), revocation_reason = 'manual', updated_at = app.now_utc()
   where w.team_id = v_install.team_id and w.office_id = p_office;
  update public.channel_link_challenges c
     set revoked_at = app.now_utc()
   where c.office_id = p_office and c.channel = 'slack' and c.used_at is null and c.revoked_at is null;

  return jsonb_build_object('ok', true, 'removed', 1, 'team_id', v_install.team_id, 'bot_token', v_token);
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
create function public.slack_link_begin(p_office uuid) returns jsonb
language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.slack_install_begin(p_office) $f$;
create function public.slack_link_status(p_office uuid) returns jsonb
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.slack_install_status(p_office) $f$;
create function public.slack_link_disconnect(p_office uuid) returns jsonb
language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.slack_install_disconnect(p_office) $f$;
create function public.slack_link_redeem(
  p_state text, p_team_id text, p_team_name text, p_bot_user_id text, p_app_id text, p_user_id text, p_bot_token text) returns jsonb
language sql security definer set search_path to 'public', 'pg_catalog'
as $f$ select app.slack_install_redeem(p_state, p_team_id, p_team_name, p_bot_user_id, p_app_id, p_user_id, p_bot_token) $f$;

revoke all on function app.slack_install_begin(uuid), app.slack_install_status(uuid), app.slack_install_disconnect(uuid),
  app.slack_install_redeem(text, text, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.slack_link_begin(uuid), public.slack_link_status(uuid), public.slack_link_disconnect(uuid),
  public.slack_link_redeem(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.slack_link_begin(uuid), public.slack_link_status(uuid), public.slack_link_disconnect(uuid),
  public.slack_link_redeem(text, text, text, text, text, text, text) to service_role;

commit;

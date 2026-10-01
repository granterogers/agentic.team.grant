-- 0648 - ONE resolver for the deployment's fixed-name credentials, and a state nonce for connecting Google
-- (multi-user P1.2, #400).
--
-- WHAT WAS WRONG. A credential like google.refresh_token is a single fixed name in the vault. Who may read it
-- was decided in about a dozen places, none of which asked WHOSE request was being served:
--   * app.vault_secret(name) had an allow-list of names and no caller at all, and public.vault_secret wrapped it
--     for ANY holder of the service key (every edge function) - the gate checked the name, never the asker;
--   * the worker read notion / vikunja / github / notebook / telegram-user tokens straight out of
--     vault.decrypted_secrets, for every job, whoever the job was for;
--   * google-oauth /callback exchanged ANY authorization code it was handed and overwrote the stored refresh
--     token with it. There was no state parameter, so a code from a stranger's Google account connected the
--     office to the stranger's mailbox and calendar (login CSRF, on a credential the whole office acts through).
-- With one human none of this was reachable. With a second it is the first one's Google, Notion and files.
--
-- WHAT THIS DOES.
--   app.credential_class(name)          what a vault name IS: human_integration | channel | infra | null.
--                                       Only human_integration is served by the resolver; an infrastructure
--                                       name (the LLM key, the service key, backups) is the deployment's own and
--                                       is never handed to a request; a name nobody classified is refused.
--   app.job_may_use_deployment_integration(job)
--                                       true for the deployment's own duties (origin internal), and for a
--                                       trusted turn whose requester is a deployment operator (0647). A harness,
--                                       unknown or synthetic job - which is where a Sample or test office's work
--                                       lands - is false.
--   app.deployment_credential(name, operator, job, system)
--                                       the ONE reader. The caller must be an operator (the gateway's verified
--                                       session), or a job that passes the check above, or the worker's own code
--                                       with no job in hand (system; not reachable through PostgREST).
--   public.deployment_credential(name, operator, job)
--                                       the edge-function door: no `system`, so a function holding the service key
--                                       cannot ask as the deployment itself.
-- The raw readers (app.vault_secret, public.vault_secret) are retired by 0649, AFTER the gateway, google-oauth and
-- the worker have been deployed to use this: the retirement is a separate migration so it cannot land first.
--
-- THE GOOGLE CONNECT FLOW now carries a one-time state minted for an authenticated operator
-- (public.hq_google_connect_start) and consumed by /callback; a callback without a live state is refused.
--
-- NOT DONE HERE, on purpose: the worker is not yet told WHICH job a credential read is for by anything but its
-- database handle (src/credentials/deployment.ts); and per-office Google (a second office with its OWN token)
-- is the ownership phase's work. `uses_system_integrations` is where that decision will live.

create or replace function app.credential_class(p_name text)
returns text
language sql
immutable
set search_path to ''
as $f$
  select case
    when p_name in ('google.client_secret', 'google.refresh_token', 'google.revoking_refresh_token',
                    'notion.integration_token', 'vikunja.api_token', 'github.read_token',
                    'notebook.master_token_json', 'notebook.reader_secret', 'notebook.storage_state',
                    'telegram.user_session', 'telegram.api_id', 'telegram.api_hash')
      then 'human_integration'
    -- Posting through the deployment's own bots and Slack app. Reached through app.resolve_secret(ref) by the
    -- channel adapters, behind delivery containment (claim_delivery / may_act_outside), not through this reader.
    when p_name in ('slack.bot_token', 'slack.client_secret', 'slack.config_refresh_token',
                    'slack.config_token', 'slack.signing_secret', 'telegram.webhook_secret')
      or p_name ~ '^telegram\..+\.bot_token$'
      then 'channel'
    when p_name in ('hq.api_token', 'openrouter.api_key', 'voice.api_key', 'worker.kick_secret',
                    'github.dispatch_token')
      or p_name like 'supabase.%' or p_name like 'backup.%' or p_name like 'browser.cloudflare\_%'
      then 'infra'
    else null
  end
$f$;

comment on function app.credential_class(text) is
  'What a vault secret name is: human_integration (served only by app.deployment_credential), channel (reached through delivery containment), infra (the deployment''s own), or null (unclassified: refused). npm run check:system-secrets asserts every vault name has a class.';

create or replace function app.job_requester(p_job uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $f$
  -- The SUBJECT of the root job's requested_by ('<channel>:<subject>'). The adapter wrote it from a verified
  -- identity; a duty has no human subject and returns its duty name, which origin 'internal' covers separately.
  with recursive up as (
    select j.job_id, j.parent_job_id, j.requested_by, 0 as depth from public.jobs j where j.job_id = p_job
    union all
    select p.job_id, p.parent_job_id, p.requested_by, up.depth + 1
      from up join public.jobs p on p.job_id = up.parent_job_id where up.depth < 64
  )
  select nullif(btrim(split_part(requested_by, ':', 2)), '')
    from up where parent_job_id is null order by depth desc limit 1
$f$;

create or replace function app.job_may_use_deployment_integration(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $f$
  select case app.job_origin(p_job)
    when 'internal' then true
    when 'trusted' then coalesce(public.deployment_operator(app.job_requester(p_job)), false)
    else false
  end
$f$;

create or replace function app.deployment_credential(
  p_name text,
  p_operator text default null,
  p_job uuid default null,
  p_system boolean default false
)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $f$
declare
  v_ok boolean := false;
begin
  -- Only a human-integration name is served here, and the refusal does not say whether the name exists.
  if app.credential_class(p_name) is distinct from 'human_integration' then
    raise exception 'deployment credential refused' using errcode = '42501';
  end if;
  if p_system then
    v_ok := true;
  elsif nullif(btrim(coalesce(p_operator, '')), '') is not null
        and public.deployment_operator(p_operator) then
    v_ok := true;
  elsif p_job is not null and app.job_may_use_deployment_integration(p_job) then
    v_ok := true;
  end if;
  if not v_ok then
    raise exception 'deployment credential refused: the caller is not an operator and the work may not use the deployment''s integrations'
      using errcode = '42501';
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name);
end;
$f$;

revoke all on function app.deployment_credential(text, text, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function app.job_may_use_deployment_integration(uuid) from public, anon, authenticated, service_role;
revoke all on function app.job_requester(uuid) from public, anon, authenticated, service_role;

create or replace function public.deployment_credential(
  p_name text,
  p_operator text default null,
  p_job uuid default null
)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$ select app.deployment_credential(p_name, p_operator, p_job, false) $f$;

revoke all on function public.deployment_credential(text, text, uuid) from public, anon, authenticated;
grant execute on function public.deployment_credential(text, text, uuid) to service_role;

-- ---- connecting Google: a one-time state minted for an operator -----------------------------------------------

create table if not exists public.google_oauth_states (
  state_hash   text primary key,
  operator_key text not null check (btrim(operator_key) <> ''),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_at      timestamptz
);
comment on table public.google_oauth_states is
  'One-time states for the Google connect flow (0648). Minted for an operator by hq_google_connect_start, consumed by /callback. Only the SHA-256 of the state is stored.';
alter table public.google_oauth_states enable row level security;
revoke all on table public.google_oauth_states from anon, authenticated;
grant select on table public.google_oauth_states to service_role;

create or replace function public.hq_google_connect_start(p_by text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'extensions'
as $f$
declare
  v_state text;
begin
  if not public.deployment_operator(p_by) then
    return jsonb_build_object('error', 'Only the deployment operator can connect Google.');
  end if;
  delete from public.google_oauth_states where created_at < now() - interval '1 day';
  v_state := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.google_oauth_states (state_hash, operator_key, expires_at)
  values (encode(extensions.digest(v_state, 'sha256'), 'hex'), btrim(p_by), now() + interval '10 minutes');
  return jsonb_build_object('state', v_state, 'expires_in_seconds', 600);
end;
$f$;

-- A state is looked at (start) and used (callback). An unknown, expired or used state is indistinguishable,
-- and `consume` marks it used in the same statement that checks it.
create or replace function public.google_oauth_state_live(p_state text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog', 'extensions'
as $f$
  select exists (
    select 1 from public.google_oauth_states s
     where s.state_hash = encode(extensions.digest(coalesce(p_state, ''), 'sha256'), 'hex')
       and s.used_at is null and s.expires_at > now()
       and public.deployment_operator(s.operator_key))
$f$;

create or replace function public.google_oauth_state_consume(p_state text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'extensions'
as $f$
declare
  v_operator text;
begin
  -- Returns the operator the state was minted for, or null. The callback reads the client secret AS that
  -- operator, so what it does is bound to a person who passed the operator check, not to the request.
  update public.google_oauth_states s set used_at = now()
   where s.state_hash = encode(extensions.digest(coalesce(p_state, ''), 'sha256'), 'hex')
     and s.used_at is null and s.expires_at > now()
     and public.deployment_operator(s.operator_key)
  returning s.operator_key into v_operator;
  return v_operator;
end;
$f$;

revoke all on function public.hq_google_connect_start(text) from public, anon, authenticated;
revoke all on function public.google_oauth_state_live(text) from public, anon, authenticated;
revoke all on function public.google_oauth_state_consume(text) from public, anon, authenticated;
grant execute on function public.hq_google_connect_start(text) to service_role;
grant execute on function public.google_oauth_state_live(text) to service_role;
grant execute on function public.google_oauth_state_consume(text) to service_role;

-- ROLLBACK (not part of the migration): redeploy the previous hq-api, google-oauth and worker FIRST, then drop the
-- new functions and public.google_oauth_states. Nothing here removes anything the previous code reads.

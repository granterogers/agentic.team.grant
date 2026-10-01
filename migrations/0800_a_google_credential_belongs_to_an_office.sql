-- 0800 - a Google credential belongs to an office (multi-user P3, wave 2, cluster i-integrations2, part 1 of 5).
--
-- WHAT WAS WRONG. `google.refresh_token` is ONE vault name for the whole deployment. Storing it, signing out of
-- Google (park the token, revoke it at Google, delete the parked copy), reporting its health, and reading it for a
-- job all named that one secret and one `connection_health` row, whoever the work was for. With one person that is
-- the product. With a second office:
--
--   * hq_store_google_refresh overwrote the stored token with whichever account connected last (the P1 state
--     parameter stops a stranger's code, not a second office's own connect);
--   * google_revoke_finish deleted the one parked token and marked the one health row 'missing' for everybody;
--   * app.deployment_credential(name, operator, job, system) decided by WHO ASKED (an operator, an internal duty,
--     a trusted operator turn) and never WHOSE credential: a job of any office the deployment's duties run for
--     could read the deployment's Google, Notion, Vikunja and GitHub tokens.
--
-- WHAT THIS DOES.
--
-- 1. The vault NAME is per office. `app.google_vault_name(office, base)` is `google.refresh_token` for the
--    deployment's Google office (`app.google_home_office()`: the operator's office, or the one person office) and
--    `google.refresh_token.<office uuid>` for any other. The same for the parked `google.revoking_refresh_token`.
--    `app.credential_class` knows the suffixed shape, so it is still served only by the one resolver. The
--    existing token is NOT renamed: it is already the home office's, which is what makes this safe to deploy
--    against a live vault (a rename would break the deployed worker, and google-oauth, for the minutes between
--    the migration and the deploy).
--
-- 2. app.deployment_credential takes the office the read is ON BEHALF OF, first. It still refuses unless the caller
--    is an operator, a job the deployment owns, or the worker acting for the deployment; and now also refuses
--    unless that caller IS that office: a job reads only as its own office (a job id and an office id that
--    disagree are refused like any other caller), an operator only as their own office. A DEPLOYMENT-level secret
--    (Notion, Vikunja, GitHub, the NotebookLM account, the Telegram user session) is served only to an office that
--    sees the deployment (the operator's, the system and test offices); the OAuth client secret is the deployment's
--    app and is served to any office's job because it only ever exchanges that office's own refresh token. The
--    worker acting for the deployment itself (no job) reads Google as the HOME office.
--
-- 3. hq_store_google_refresh(office, ...) stores under the office's name and records the office's own health row,
--    and REFUSES an office other than the home office. That refusal is the guard, and it is a BLOCKER for the
--    second-user acceptance test, for two reasons that are not in this cluster:
--      - `connection_health` is keyed (service, credential): ONE row per kind of credential for the whole
--        deployment. A second office's `google_calendar` row cannot exist while the first office's does, so a
--        second office could be connected and never shown as connected. Rebuilding that key (office_id, service,
--        credential) touches app.record_connection_health, hq_connections, hq_disconnect, capability_index_core and
--        the inventory writer, none of which this cluster owns.
--      - `system_config` (`google.granted_scopes`, `calendar.enabled`) is global and has no office.
--    When both move, delete the one refusal in hq_store_google_refresh: the naming, the reader, the sign-out and
--    the revoke below already handle a second office, and the cases prove it with a token stored by hand.
--
-- 4. google_revoke_begin(office) parks and deletes only THAT office's token and enqueues the revoke job in that
--    office; google_revoke_finish(office, ...) deletes only that office's parked copy and marks only that
--    office's health row. The zero-argument google_revoke_begin (called by hq_forget_google, which cluster
--    d-governance converts) is kept as a thin wrapper that acts for the HOME office, so it can never sign out a
--    different office's Google than the one it always meant; hq_forget_google must call the new overload and the
--    lead then drops the old one. The revoke job is written as requested_by 'hq' (it was 'grant', which only the
--    deployment's own office could be) and app.internal_root_ok is spliced to recognise that pair, so the job of any
--    office may read the parked token it is there to destroy.
--
-- 5. public.office_of_operator(operator) is the one new door: google-oauth holds the operator a consumed state was
--    minted for and needs the office that operator acts as, to pass to deployment_credential and
--    hq_store_google_refresh. It answers only for a deployment operator and only to the service role.
--
-- Rollback: this migration drops the old signatures. Roll the worker back first, then restore the four bodies from
-- migrations 0095, 0354, 0648 and 0252.

create function app.deployment_reader_office() returns uuid
 language sql stable security definer set search_path to ''
as $f$
  -- The office a deployment-level read is made on behalf of when the worker acts for the deployment itself and
  -- holds no job: the system office. It sees the deployment and owns no person's data.
  select o.office_id from public.offices o where o.kind = 'system' and o.state = 'active' order by o.created_at limit 1
$f$;
revoke all on function app.deployment_reader_office() from public, anon, authenticated, service_role;

create function app.google_home_office() returns uuid
 language sql stable security definer set search_path to ''
as $f$
  -- The office that holds the deployment's bare Google credential. Today that is the operator's office; with no
  -- operator it is the one person office, if there is exactly one. Never guessed from more.
  select coalesce(app.operator_office(), app.sole_person_office())
$f$;
revoke all on function app.google_home_office() from public, anon, authenticated, service_role;

-- The one door google-oauth needs to learn WHICH OFFICE a verified operator acts as. The edge function holds the
-- operator key a consumed state was minted for (that is the identity); this turns it into the office that identity
-- speaks for, and only for a deployment operator. Service role only.
create function public.office_of_operator(p_operator text) returns uuid
 language sql stable security definer set search_path to 'public', 'pg_catalog'
as $f$
  select o.office_id
    from public.offices o
   where o.state = 'active'
     and o.kind = 'person'
     and public.deployment_operator(p_operator)
     and app.office_actor(o.office_id) = btrim(p_operator)
   limit 1
$f$;
revoke all on function public.office_of_operator(text) from public, anon, authenticated;
grant execute on function public.office_of_operator(text) to service_role;

create function app.google_vault_name(p_office uuid, p_base text) returns text
 language sql stable security definer set search_path to ''
as $f$
  select case
    when p_base not in ('google.refresh_token', 'google.revoking_refresh_token') then p_base
    -- No office is no secret: a null reads nothing rather than the deployment's.
    when p_office is null then null
    when p_office = app.google_home_office() then p_base
    else p_base || '.' || p_office::text
  end
$f$;
revoke all on function app.google_vault_name(uuid, text) from public, anon, authenticated, service_role;

do $m$
declare v text;
begin
  v := pg_get_functiondef('app.credential_class(text)'::regprocedure);
  if position('    when p_name in (''slack.bot_token'',' in v) = 0 then
    raise exception 'splice anchor missing: credential_class';
  end if;
  if position('google\.(refresh_token|revoking_refresh_token)' in v) > 0 then
    raise exception 'credential_class already knows the per-office google names';
  end if;
  v := replace(v, '    when p_name in (''slack.bot_token'',',
    '    -- A Google credential held by an office other than the deployment''s own (0800): the name carries the office.' || chr(10) ||
    '    when p_name ~ ''^google\.(refresh_token|revoking_refresh_token)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''' || chr(10) ||
    '      then ''human_integration''' || chr(10) ||
    '    when p_name in (''slack.bot_token'',');
  execute v;
end $m$;

create function app.deployment_credential(
  p_office uuid, p_name text, p_operator text default null, p_job uuid default null, p_system boolean default false)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to ''
as $f$
declare
  v_ok boolean := false;
  v_base_per_office boolean := p_name in ('google.refresh_token', 'google.revoking_refresh_token');
  v_office uuid;
  v_name text;
begin
  perform app.require_office(p_office);
  -- Only a human-integration name is served here, and the refusal does not say whether the name exists.
  if app.credential_class(p_name) is distinct from 'human_integration' then
    raise exception 'deployment credential refused' using errcode = '42501';
  end if;
  -- WHO is asking, and now AS WHICH OFFICE: the caller has to be that office.
  if p_system then
    -- The worker acting for the deployment itself. Not reachable through PostgREST (this is in app) and the public
    -- door below has no such parameter. It may act as an office that sees the deployment, never as a person's.
    v_ok := app.office_sees_the_deployment(p_office);
  elsif nullif(btrim(coalesce(p_operator, '')), '') is not null
        and public.deployment_operator(p_operator)
        and app.office_actor(p_office) = btrim(p_operator) then
    v_ok := true;
  elsif p_job is not null
        and app.job_may_use_deployment_integration(p_job)
        and exists (select 1 from public.jobs j where j.job_id = p_job and j.office_id = p_office) then
    v_ok := true;
  end if;
  if not v_ok then
    raise exception 'deployment credential refused: the caller is not an operator and the work may not use the deployment''s integrations'
      using errcode = '42501';
  end if;
  -- Which secret is this office's. Google's tokens are the office's own; everything else is the deployment's, and
  -- the deployment's belongs to the offices that see it (the OAuth client is the deployment's app, used only to
  -- exchange that office's own refresh token).
  if v_base_per_office then
    -- The worker acting for the deployment itself reads the deployment's own Google; a job or an operator reads its own.
    v_office := case when p_system then app.google_home_office() else p_office end;
    v_name := app.google_vault_name(v_office, p_name);
  elsif p_name = 'google.client_secret' or app.office_sees_the_deployment(p_office) then
    v_name := p_name;
  else
    raise exception 'deployment credential refused: the caller is not an operator and the work may not use the deployment''s integrations'
      using errcode = '42501';
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = v_name);
end;
$f$;
revoke all on function app.deployment_credential(uuid, text, text, uuid, boolean) from public, anon, authenticated, service_role;

create function public.deployment_credential(
  p_office uuid, p_name text, p_operator text default null, p_job uuid default null)
 returns text
 language sql
 stable
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.deployment_credential(p_office, p_name, p_operator, p_job, false) $f$;
revoke all on function public.deployment_credential(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.deployment_credential(uuid, text, text, uuid) to service_role;

create function app.hq_store_google_refresh(p_office uuid, p_refresh_token text, p_scopes text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_name  text;
begin
  perform app.require_office(p_office);
  if coalesce(trim(p_refresh_token), '') = '' then
    return jsonb_build_object('error', 'no refresh token');
  end if;
  /*
    THE GUARD (see the header). Until the single health row and the global scope/enable settings have an office,
    only the deployment's own Google office can hold a Google credential: a second office's connect would store a
    token nothing shows, and its sign-out would have no row of its own to mark. Refused in the same words whoever
    the office is, so the sentence does not describe anybody else's connection.
  */
  if p_office is distinct from app.google_home_office() then
    return jsonb_build_object('error',
      'Google can be connected for one person on this deployment at the moment. Ask the operator.');
  end if;
  v_name := app.google_vault_name(p_office, 'google.refresh_token');
  perform app.store_secret(v_name, trim(p_refresh_token),
    format('Google refresh token, granted %s. Scopes: %s', app.now_utc(), p_scopes));

  -- Global, so written only by the office the guard above lets through.
  insert into public.system_config (key, value, description)
  values ('google.granted_scopes', to_jsonb(p_scopes),
          'What Google actually granted, which can be less than what was asked for.')
  on conflict (key) do update set value = excluded.value;

  -- The light goes green because a token exists, not because we hope one does. The row is THIS office's: the key
  -- is still (service, credential), so an office can only ever update a row it owns.
  insert into public.connection_health (office_id, service, credential, state, detail, owner, action)
  values (p_office, 'google_calendar', 'oauth_client', 'ok',
          'connected — a refresh token is in the vault', app.office_actor(p_office), '')
  on conflict (service, credential) do update
    set state = excluded.state, detail = excluded.detail,
        action = excluded.action, checked_at = app.now_utc()
    where public.connection_health.office_id = excluded.office_id;

  return jsonb_build_object('stored', true);
end;
$f$;
revoke all on function app.hq_store_google_refresh(uuid, text, text) from public, anon, authenticated, service_role;

create function public.hq_store_google_refresh(p_office uuid, p_refresh_token text, p_scopes text)
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.hq_store_google_refresh(p_office, p_refresh_token, p_scopes) $f$;
revoke all on function public.hq_store_google_refresh(uuid, text, text) from public, anon, authenticated;
grant execute on function public.hq_store_google_refresh(uuid, text, text) to service_role;

create function app.google_revoke_begin(p_office uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_token  text;
  v_job    uuid;
  v_old    uuid;
  v_live   text;
  v_parked text;
begin
  perform app.require_office(p_office);
  v_live   := app.google_vault_name(p_office, 'google.refresh_token');
  v_parked := app.google_vault_name(p_office, 'google.revoking_refresh_token');
  select decrypted_secret into v_token from vault.decrypted_secrets where name = v_live;

  if v_token is null or btrim(v_token) = '' then
    return jsonb_build_object('parked', false, 'job_id', null);
  end if;

  -- Overwrite rather than accumulate: a second Disconnect before the first revoke has run must not leave two live
  -- tokens parked. The parked name is the office's own, so two offices never share one slot.
  select id into v_old from vault.secrets where name = v_parked;
  if v_old is null then
    perform vault.create_secret(v_token, v_parked,
      'A Google refresh token awaiting revocation at Google (#109). Deleted by '
      || 'app.google_revoke_finish whether the revoke succeeds or fails.');
  else
    perform vault.update_secret(v_old, v_token, v_parked);
  end if;

  -- This office's copy goes NOW, and only this office's.
  delete from vault.secrets where name = v_live;

  insert into public.jobs
    (office_id, correlation_id, project_id, idempotency_key, kind, requested_by, priority)
  -- `hq` is how the database says "the deployment's own plumbing asked" (see app.internal_root_ok, spliced below), so
  -- the revoke job may read the parked token whichever office it is for. It used to name 'grant', which only the
  -- deployment's own office could be.
  values (p_office, gen_random_uuid(), null,
          format('google-revoke-%s', gen_random_uuid()),
          'google.revoke', 'hq', 400)
  returning job_id into v_job;

  return jsonb_build_object('parked', true, 'job_id', v_job);
end;
$f$;
revoke all on function app.google_revoke_begin(uuid) from public, anon, authenticated, service_role;

-- The caller that has not moved yet (hq_forget_google, cluster d-governance) keeps working and keeps meaning what it
-- always meant: the deployment's own Google. It can no longer reach another office's.
create or replace function app.google_revoke_begin()
 returns jsonb
 language sql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$ select app.google_revoke_begin(app.google_home_office()) $f$;

-- app.internal_root_ok recognises the jobs the database itself creates. The Google revoke job was recognised by the pair
-- (grant, google.revoke), which only the deployment's own office could ever produce; it is now also (hq, google.revoke),
-- the pair google_revoke_begin writes for every office. Spliced from the live definition and asserted to have landed.
do $m$
declare v text;
begin
  v := pg_get_functiondef('app.internal_root_ok(uuid)'::regprocedure);
  if position('(j.requested_by in (''grant'', ''hq'') and j.kind = ''google.revoke'')' in v) = 0 then
    if position('(j.requested_by = ''grant'' and j.kind = ''google.revoke'')' in v) = 0 then
      raise exception 'splice anchor missing: internal_root_ok';
    end if;
    v := replace(v, '(j.requested_by = ''grant'' and j.kind = ''google.revoke'')',
                    '(j.requested_by in (''grant'', ''hq'') and j.kind = ''google.revoke'')');
    if position('(j.requested_by in (''grant'', ''hq'') and j.kind = ''google.revoke'')' in v) = 0 then
      raise exception 'internal_root_ok splice did not land';
    end if;
    execute v;
  end if;
end $m$;

create function app.google_revoke_finish(p_office uuid, p_ok boolean, p_detail text default ''::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $f$
declare
  v_gone int := 0;
begin
  perform app.require_office(p_office);
  delete from vault.secrets where name = app.google_vault_name(p_office, 'google.revoking_refresh_token');
  get diagnostics v_gone = row_count;

  update public.connection_health
     set state = 'missing',
         detail = case when p_ok
           then 'signed out, and the grant is revoked at Google'
           else 'signed out here; Google did not confirm the revoke'
                || case when btrim(coalesce(p_detail, '')) = '' then ''
                        else ' (' || left(btrim(p_detail), 120) || ')' end
         end,
         action = case when p_ok
           then 'Sign in with Google on the Set up page'
           -- The honest instruction when we could not do it ourselves, and the reason this branch says something
           -- different rather than pretending: a person who thinks a grant is dead does not go and kill it.
           else 'Revoke it yourself at https://myaccount.google.com/permissions'
         end,
         checked_at = app.now_utc()
   where service = 'google_calendar'
     and office_id = p_office;

  return jsonb_build_object('ok', true, 'parked_copy_removed', v_gone, 'revoked', p_ok);
end;
$f$;
revoke all on function app.google_revoke_finish(uuid, boolean, text) from public, anon, authenticated, service_role;

-- The retired raw reader named the resolver in its refusal as "app.deployment_credential (0648)", which a body scan for
-- calls to office-first functions reads as a call with no office. Same refusal, said without looking like a call.
create or replace function app.vault_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $f$
begin
  raise exception 'retired: read a deployment credential through its one resolver (0648)' using errcode = '42501';
end;
$f$;

-- the old signatures go: no door onto a Google credential that does not say whose
drop function public.google_revoke_finish(boolean, text);
drop function app.google_revoke_finish(boolean, text);
drop function public.hq_store_google_refresh(text, text);
drop function app.hq_store_google_refresh(text, text);
drop function public.deployment_credential(text, text, uuid);
drop function app.deployment_credential(text, text, uuid, boolean);

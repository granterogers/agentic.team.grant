-- 1000 - a Google credential is one CONNECTION of an office (HQ-GOOG-003, multi-account future-proofing).
--
-- THE MODEL, stated once:
--
--   office (tenant) -> integration connection(s) -> provider (google) -> provider account identity -> scopes
--
-- Today the credential is keyed per OFFICE (0800): a vault name chosen by app.google_vault_name(office, base). That
-- is correct for one Google account per office and it is the wrong KEY for two: a second account would have had to
-- re-key the vault name, the health row and every reader at once. This migration puts the missing level in the
-- middle and changes nothing a person can see.
--
-- V1 STILL ALLOWS ONE ACTIVE GOOGLE ACCOUNT PER OFFICE. There is no multi-account screen and none is built. What
-- changes is that the limit is now a CONSTRAINT on rows (a partial unique index on (office, provider) where the
-- connection is active, plus a trigger that refuses in words) instead of an accident of there being one vault name.
-- Allowing a second account later is deleting that constraint, not re-keying a credential.
--
-- WHAT IS ADDED.
--
--   public.integration_connections   one row per (office, provider, account). Holds the NAME of the vault secret
--                                    that is the credential (never the secret), the scopes Google granted, and
--                                    active|revoked. Written only by the app.* functions below.
--   app.active_connection(office, provider)       THE resolver: the one active connection of an office, or nothing.
--   app.active_connection_secret(office, provider) the vault name of its credential.
--   app.google_vault_name(office, base)           now asks the resolver for the live refresh token, and falls back
--                                    to the 0800 name rule when the office has no connection row. The parked
--                                    (revoking) name is unchanged. Every existing reader reaches the credential
--                                    through this function (deployment_credential, store, revoke), so every call site
--                                    keeps working untouched.
--   app.hq_store_google_refresh      also records the connection (active). Spliced from the live definition.
--   app.google_revoke_begin / _finish  also mark the connection revoked. Spliced from the live definitions.
--
-- WHAT IS NOT DONE (the next step for real multi-account): an OAuth account chooser, reading the Google account's
-- identity at consent (account_ref is 'primary' until then), a per-service choice of account, and relaxing the one
-- constraint. See docs/ux-closure-goog-notes.md.
--
-- BACKFILL. For every office whose legacy-named Google secret exists in the vault, one active connection naming that
-- secret. On a database with no Google credential this inserts nothing. The secret is NOT renamed or copied.
--
-- Rollback: the worker does not read this table directly; drop the table and restore app.google_vault_name,
-- hq_store_google_refresh and the two revoke functions from migrations 0800 and 0742.

create table public.integration_connections (
  connection_id uuid primary key default gen_random_uuid(),
  office_id     uuid not null references public.offices(office_id),
  provider      text not null check (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  -- The provider's stable id for the account (for Google: its subject id or email). 'primary' until the consent
  -- flow reads the identity; unique per (office, provider) in V1 by the rule below, so it is never ambiguous.
  account_ref   text not null check (btrim(account_ref) <> '' and length(account_ref) <= 320),
  state         text not null default 'active' check (state in ('active', 'revoked')),
  -- What the provider actually granted. A set of scope strings, never inferred from what was asked for.
  scopes        text[] not null default '{}',
  -- The NAME of the vault secret that is this connection's credential. A name is not a secret.
  secret_name   text not null check (btrim(secret_name) <> '' and length(secret_name) <= 200),
  created_at    timestamptz not null default app.now_utc(),
  revoked_at    timestamptz,
  constraint integration_connections_account_once unique (office_id, provider, account_ref),
  constraint integration_connections_revoked_has_a_time check ((state = 'revoked') = (revoked_at is not null))
);
-- THE V1 RULE, as a constraint. Deleting this index (and the trigger below) is what a second account will be.
create unique index integration_connections_one_active_per_provider
  on public.integration_connections (office_id, provider) where state = 'active';
create index integration_connections_by_office on public.integration_connections (office_id, provider);
comment on table public.integration_connections is
  'An office''s connection to a provider account (HQ-GOOG-003). secret_name names the vault secret; it is not the secret. V1: at most one ACTIVE connection per (office, provider). Written only by app.hq_store_google_refresh, app.google_revoke_begin and app.google_revoke_finish.';

create trigger a1_office_write_once
  before update on public.integration_connections
  for each row execute function app.office_id_is_write_once();

-- The same rule as the index, said in words. The index is the guarantee; this is what a person or an agent reads.
create function app.integration_connection_one_active() returns trigger
 language plpgsql security definer set search_path to ''
as $f$
begin
  if new.state = 'active' and exists (
       select 1 from public.integration_connections c
        where c.office_id = new.office_id and c.provider = new.provider
          and c.state = 'active' and c.connection_id <> new.connection_id
          -- the SAME account is not a second one: an insert of it resolves to an update through the unique key
          and c.account_ref <> new.account_ref) then
    raise exception 'an office has at most one active % connection in this version: revoke the current one before connecting another account', new.provider
      using errcode = '23505';
  end if;
  return new;
end
$f$;
revoke all on function app.integration_connection_one_active() from public, anon, authenticated, service_role;
create trigger b1_one_active_connection
  before insert or update on public.integration_connections
  for each row execute function app.integration_connection_one_active();

alter table public.integration_connections enable row level security;
revoke all on table public.integration_connections from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- the resolver
-- ---------------------------------------------------------------------------------------------------------------------
create function app.active_connection(p_office uuid, p_provider text)
 returns table (connection_id uuid, account_ref text, secret_name text, scopes text[])
 language sql stable security definer set search_path to ''
as $f$
  -- No office is no connection: a null reads nothing rather than somebody's. The partial unique index means this
  -- is at most one row.
  select c.connection_id, c.account_ref, c.secret_name, c.scopes
    from public.integration_connections c
   where p_office is not null and c.office_id = p_office and c.provider = p_provider and c.state = 'active'
$f$;
revoke all on function app.active_connection(uuid, text) from public, anon, authenticated, service_role;

create function app.active_connection_secret(p_office uuid, p_provider text) returns text
 language sql stable security definer set search_path to ''
as $f$ select (app.active_connection(p_office, p_provider)).secret_name $f$;
revoke all on function app.active_connection_secret(uuid, text) from public, anon, authenticated, service_role;

-- 0800's name rule, kept verbatim as the fallback for an office that has no connection row yet.
create function app.google_legacy_vault_name(p_office uuid, p_base text) returns text
 language sql stable security definer set search_path to ''
as $f$
  select case
    when p_base not in ('google.refresh_token', 'google.revoking_refresh_token') then p_base
    when p_office is null then null
    when p_office = app.google_home_office() then p_base
    else p_base || '.' || p_office::text
  end
$f$;
revoke all on function app.google_legacy_vault_name(uuid, text) from public, anon, authenticated, service_role;

create or replace function app.google_vault_name(p_office uuid, p_base text) returns text
 language sql stable security definer set search_path to ''
as $f$
  select case
    when p_base = 'google.refresh_token' and p_office is not null
      then coalesce(app.active_connection_secret(p_office, 'google'),
                    app.google_legacy_vault_name(p_office, p_base))
    else app.google_legacy_vault_name(p_office, p_base)
  end
$f$;
revoke all on function app.google_vault_name(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- backfill: one active connection per office that already holds a Google credential. Works on rows and on none.
-- ---------------------------------------------------------------------------------------------------------------------
insert into public.integration_connections (office_id, provider, account_ref, state, scopes, secret_name)
select o.office_id, 'google', 'primary', 'active',
       case when o.office_id = app.google_home_office()
            then coalesce((select regexp_split_to_array(btrim(sc.value #>> '{}'), '\s+')
                             from public.system_config sc
                            where sc.key = 'google.granted_scopes' and btrim(sc.value #>> '{}') <> ''), '{}')
            else '{}'::text[] end,
       app.google_legacy_vault_name(o.office_id, 'google.refresh_token')
  from public.offices o
 where exists (select 1 from vault.secrets s
                where s.name = app.google_legacy_vault_name(o.office_id, 'google.refresh_token'))
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------------
-- the three writers record the connection (spliced from the live definitions, each asserted to have landed)
-- ---------------------------------------------------------------------------------------------------------------------
do $m$
declare v text;
begin
  -- store: after the secret is written, the connection is active. A reconnect of the same account reactivates its row.
  v := pg_get_functiondef('app.hq_store_google_refresh(uuid,text,text)'::regprocedure);
  if position('  perform app.store_secret(v_name, trim(p_refresh_token),' in v) = 0 then
    raise exception 'splice anchor missing: hq_store_google_refresh';
  end if;
  v := replace(v, '  -- Global, so written only by the office the guard above lets through.',
    '  -- The connection (1000): V1 keeps one active Google account per office, and the account''s identity is not read yet.' || chr(10) ||
    '  insert into public.integration_connections (office_id, provider, account_ref, state, scopes, secret_name)' || chr(10) ||
    '  values (p_office, ''google'', coalesce((select account_ref from app.active_connection(p_office, ''google'')), ''primary''),' || chr(10) ||
    '          ''active'', coalesce(regexp_split_to_array(nullif(btrim(p_scopes), ''''), ''\s+''), ''{}''), v_name)' || chr(10) ||
    '  on conflict (office_id, provider, account_ref) do update' || chr(10) ||
    '    set state = ''active'', revoked_at = null, scopes = excluded.scopes, secret_name = excluded.secret_name;' || chr(10) || chr(10) ||
    '  -- Global, so written only by the office the guard above lets through.');
  if position('insert into public.integration_connections' in v) = 0 then
    raise exception 'hq_store_google_refresh splice did not land';
  end if;
  execute v;

  -- begin: signing out revokes the connection the moment the live token goes.
  v := pg_get_functiondef('app.google_revoke_begin(uuid)'::regprocedure);
  if position('  delete from vault.secrets where name = v_live;' in v) = 0 then
    raise exception 'splice anchor missing: google_revoke_begin';
  end if;
  v := replace(v, '  delete from vault.secrets where name = v_live;',
    '  delete from vault.secrets where name = v_live;' || chr(10) ||
    '  update public.integration_connections set state = ''revoked'', revoked_at = app.now_utc()' || chr(10) ||
    '   where office_id = p_office and provider = ''google'' and state = ''active'';');
  if position('update public.integration_connections' in v) = 0 then
    raise exception 'google_revoke_begin splice did not land';
  end if;
  execute v;

  -- finish: idempotent, for a begin that predates this migration.
  v := pg_get_functiondef('app.google_revoke_finish(uuid,boolean,text)'::regprocedure);
  if position('  update public.connection_health' in v) = 0 then
    raise exception 'splice anchor missing: google_revoke_finish';
  end if;
  v := replace(v, '  update public.connection_health',
    '  update public.integration_connections set state = ''revoked'', revoked_at = app.now_utc()' || chr(10) ||
    '   where office_id = p_office and provider = ''google'' and state = ''active'';' || chr(10) || chr(10) ||
    '  update public.connection_health');
  if position('update public.integration_connections' in v) = 0 then
    raise exception 'google_revoke_finish splice did not land';
  end if;
  execute v;
end $m$;

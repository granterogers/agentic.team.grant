-- 0654 - the office: the one thing that owns private data (multi-user P2, ADR-0060, #399/#402).
--
-- ONE AUTHENTICATED ACCOUNT -> ONE PRIVATE OFFICE -> MANY PROJECTS. This creates the primitive and binds the
-- principals that exist; nothing reads it yet and no row anywhere has an office yet (0655 adds the columns, the
-- backfill waves follow). It is additive and its rollback is `drop table public.offices cascade`.
--
-- Four kinds:
--   person  a human with a login. auth_user_id is required and unique.
--   sample  a demonstration office (Phase 6 of the design). Same shape as a person; never a deployment operator.
--   test    harness state: the test principal's office and the quarantine for traffic a suite made.
--   system  the deployment itself: duties that belong to no human (retention, backups, capacity). It has NO login and
--           exactly one may exist, so no session can ever resolve to it.
--
-- The office is not the operator. `public.deployment_operators` (0647) answers "who may administer the deployment" and is
-- keyed by owner key; this answers "whose private data is this". A person office does not become an operator by being a
-- person office, and there is deliberately no `uses_system_integrations` column: the credential resolver (0648) already
-- decides integration use from operator authority and job origin, and an office property that could be flipped to grant
-- deployment-wide reach is exactly the conflation the design warns about.
--
-- Immutability: office_id, kind and auth_user_id never change after insert. A mis-set `kind` would turn containment on
-- or off for a whole office; a re-pointed auth_user_id would hand one person's private data to another login. A repair
-- is a reviewed migration that disables the trigger by name, not an UPDATE.
--
-- Email is never the ownership key. The bind below matches office_members.email to auth.users.email ONCE, here, to
-- discover the auth user id; after that only the uuid is used.

create table public.offices (
  office_id    uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete restrict,
  kind         text not null check (kind in ('person', 'sample', 'test', 'system')),
  name         text not null check (btrim(name) <> ''),
  state        text not null default 'active' check (state in ('active', 'disabled')),
  timezone     text not null default 'UTC' check (btrim(timezone) <> ''),
  created_at   timestamptz not null default app.now_utc(),
  disabled_at  timestamptz,
  constraint offices_disabled_has_time check ((state = 'disabled') = (disabled_at is not null)),
  constraint offices_person_has_login check (kind not in ('person', 'sample') or auth_user_id is not null),
  constraint offices_system_has_no_login check (kind <> 'system' or auth_user_id is null)
);

-- Exactly one system office, ever.
create unique index offices_one_system on public.offices ((true)) where kind = 'system';

comment on table public.offices is
  'The owner of private data. One authenticated account -> one private office. kind person|sample|test|system; the system office has no login. Immutable identity (office_id, kind, auth_user_id). Not an operator role: see deployment_operators.';

create function app.offices_identity_is_immutable()
returns trigger
language plpgsql
set search_path to ''
as $f$
begin
  if new.office_id is distinct from old.office_id
     or new.kind is distinct from old.kind
     or new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'an office''s identity (office_id, kind, auth_user_id) is immutable' using errcode = '23514';
  end if;
  return new;
end;
$f$;

create trigger offices_identity_is_immutable
  before update on public.offices
  for each row execute function app.offices_identity_is_immutable();

-- Offices are retired, never deleted: private data hangs off them.
create function app.offices_are_never_deleted()
returns trigger
language plpgsql
set search_path to ''
as $f$
begin
  raise exception 'an office is retired (state = disabled), never deleted' using errcode = '23514';
end;
$f$;

create trigger offices_are_never_deleted
  before delete on public.offices
  for each row execute function app.offices_are_never_deleted();

alter table public.offices enable row level security;
create policy offices_app_all on public.offices for all to ai_team_app using (true) with check (true);
revoke all on table public.offices from anon, authenticated;

-- ---- who an authenticated session is -----------------------------------------------------------------------------
create function app.office_of_auth(p_auth uuid)
returns table (office_id uuid, kind text, state text)
language sql
stable
security definer
set search_path to ''
as $f$
  select o.office_id, o.kind, o.state from public.offices o where o.auth_user_id = p_auth
$f$;

-- Idempotent on the auth user; refuses to rebind an existing login to a different kind. Service role only.
create function app.provision_office(p_auth uuid, p_kind text, p_name text, p_timezone text default 'UTC')
returns uuid
language plpgsql
security definer
set search_path to ''
as $f$
declare
  v public.offices;
begin
  if p_kind not in ('person', 'sample', 'test') then
    raise exception 'provision_office makes person, sample or test offices; the system office is made once, by migration'
      using errcode = '22023';
  end if;
  select * into v from public.offices where auth_user_id = p_auth;
  if found then
    if v.kind <> p_kind then
      raise exception 'that login already has a % office, not %', v.kind, p_kind using errcode = '23505';
    end if;
    return v.office_id;
  end if;
  insert into public.offices (auth_user_id, kind, name, timezone)
  values (p_auth, p_kind, p_name, coalesce(nullif(btrim(p_timezone), ''), 'UTC'))
  returning office_id into v.office_id;
  return v.office_id;
end;
$f$;

revoke all on function app.office_of_auth(uuid) from public, anon, authenticated, service_role;
revoke all on function app.provision_office(uuid, text, text, text) from public, anon, authenticated, service_role;

-- ---- the backfill's own record -------------------------------------------------------------------------------------
-- Every ownership wave writes what rule proved each group of rows and how many. Append-only: a backfill that cannot
-- show its working is a claim with nothing behind it. SYSTEM class (no person reads it).
create table public.office_backfill_report (
  report_id   bigint generated always as identity primary key,
  wave        text not null,
  table_name  text not null,
  rule        text not null,
  n           bigint not null check (n >= 0),
  recorded_at timestamptz not null default app.now_utc()
);
comment on table public.office_backfill_report is
  'P2 ownership backfill: which rule proved how many rows of which table. Rules named UNATTRIBUTABLE put terminal history in the system office (fail closed), never in a person office.';
create or replace function app.office_backfill_report_is_append_only()
returns trigger language plpgsql set search_path to '' as $f$
begin
  raise exception 'office_backfill_report is append-only' using errcode = '23514';
end
$f$;
create trigger office_backfill_report_append_only before update or delete on public.office_backfill_report
  for each row execute function app.office_backfill_report_is_append_only();
alter table public.office_backfill_report enable row level security;
create policy office_backfill_report_app_all on public.office_backfill_report for all to ai_team_app using (true) with check (true);
revoke all on table public.office_backfill_report from anon, authenticated, service_role;
revoke all on function app.office_backfill_report_is_append_only() from public, anon, authenticated, service_role;

-- ---- edges the history cannot satisfy ---------------------------------------------------------------------------
-- A composite ownership key refuses a cross-office edge. A handful of EXISTING rows in append-only ledgers hold one
-- (a suite's session ran inside the real catch-all project and wrote a lesson replacing a fixture's lesson) and a
-- ledger cannot be corrected. Those rows are named here, once, and the key for that edge stays NOT VALID: it still
-- refuses every new or changed row, and a check asserts the violating set is exactly this list and cannot grow.
create table public.office_edge_exceptions (
  edge        text not null,
  child_table text not null,
  child_id    text not null,
  parent_id   text not null,
  why         text not null,
  recorded_at timestamptz not null default app.now_utc(),
  primary key (edge, child_id)
);
create trigger office_edge_exceptions_append_only before update or delete on public.office_edge_exceptions
  for each row execute function app.office_backfill_report_is_append_only();
alter table public.office_edge_exceptions enable row level security;
create policy office_edge_exceptions_app_all on public.office_edge_exceptions for all to ai_team_app using (true) with check (true);
revoke all on table public.office_edge_exceptions from anon, authenticated, service_role;

-- ---- the offices that exist today --------------------------------------------------------------------------------
do $m$
declare
  v_grant uuid;
  v_test  uuid;
  v_n     int;
  v_tz    text;
begin
  -- Characterise before binding: exactly the principals this was written against, each with exactly one login.
  select count(*) into v_n from public.office_members;
  if v_n < 2 then raise exception '0654 expected the person and the test principal in office_members, found %', v_n; end if;

  if (select count(*) from public.office_members m where m.kind = 'person') <> 1 then
    raise exception '0654 expected exactly one person member';
  end if;
  if exists (
    select 1 from public.office_members m
     where (select count(*) from auth.users u where lower(u.email) = m.email) <> 1
  ) then
    raise exception '0654: every office_members row must match exactly one auth user';
  end if;

  select coalesce((select value #>> '{}' from public.system_config where key = 'grant.timezone'), 'UTC') into v_tz;

  insert into public.offices (auth_user_id, kind, name, timezone)
  select u.id, 'person', 'Grant', v_tz
    from public.office_members m join auth.users u on lower(u.email) = m.email
   where m.kind = 'person' and m.owner_key = 'grant'
  returning office_id into v_grant;
  if v_grant is null then raise exception '0654: the person office was not created'; end if;

  insert into public.offices (auth_user_id, kind, name)
  select u.id, 'test', 'Test principal and quarantine'
    from public.office_members m join auth.users u on lower(u.email) = m.email
   where m.kind <> 'person'
  on conflict do nothing;
  select count(*) into v_n from public.offices where kind = 'test';
  if v_n <> (select count(*) from public.office_members where kind <> 'person') then
    raise exception '0654: expected one test office per test member';
  end if;
  if v_n > 1 then
    raise exception '0654: more than one test member; the quarantine must be a single office - decide before binding';
  end if;

  insert into public.offices (kind, name) values ('system', 'The deployment');
end
$m$;

-- ROLLBACK (not part of the migration): nothing references public.offices yet - drop table public.offices cascade;
-- drop function app.offices_identity_is_immutable(), app.offices_are_never_deleted(), app.office_of_auth(uuid),
-- app.provision_office(uuid, text, text, text).

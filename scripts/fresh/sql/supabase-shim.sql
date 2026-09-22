-- ---------------------------------------------------------------------------
-- SUPABASE COMPATIBILITY SHIM — for a DISPOSABLE local Postgres only
-- ---------------------------------------------------------------------------
--
-- Why this file exists
--
-- The master prompt's §10 is the biggest gate in the fresh-install run: apply
-- every migration to a database with NO application schema and NO data, and
-- prove the result is a valid operational state. It also says, in the same
-- breath, NEVER to use Grant's production database as that target, and it
-- permits "a disposable fresh project OR the strongest faithful isolated
-- equivalent".
--
-- Creating a real Supabase project needs a human: an account, an email, a
-- consent click. That is a genuine §8 human-only step, and waiting for it would
-- have left the single most important gate unproven for the whole run. A local
-- Postgres 16 is the strongest equivalent available with no account at all —
-- and it is strictly SAFER, because a local socket cannot reach anybody's
-- production project by any accident of configuration.
--
-- What the migrations assume that stock Postgres does not have
--
-- Counted from the migration corpus rather than remembered:
--   * roles `anon`, `authenticated`, `service_role`   — 103 / 53 / 19 files
--   * a `vault` schema                                 — 36 files
--   * an `extensions` schema holding pg_trgm           — 31 files
--   * `storage.objects` / `storage.buckets`            — 4 files
--   * `cron.schedule` / `cron.job`                     — 1 file
--   * `net.http_post`                                  — 2 files
--
-- Each is shimmed below to the SHAPE the migrations actually use, and no
-- further. A shim that guessed at a wider surface would be a second place for
-- the truth to rot, which CLAUDE.md already warns about; a shim that guessed
-- narrower would fail loudly on the first migration that needed it, which is
-- the safe direction.
--
-- WHAT THIS SHIM DOES NOT CLAIM
--
-- It is NOT Supabase. Specifically:
--   * `vault.secrets.secret` here holds PLAINTEXT. Supabase's real vault
--     encrypts at rest with a key the database never exposes. A secret written
--     into a shimmed vault is readable by anybody who can read the table.
--   * pg_net's `http_post` performs NO request. It records the call and returns
--     an id, because a zero-state proof must not make outbound calls.
--   * pg_cron's `schedule` runs NOTHING. It records the schedule, because a
--     disposable database must not start doing work on a timer.
--   * PostgREST, GoTrue, Storage and Realtime are absent entirely, so anything
--     proven here is proven about the SCHEMA, not about the HTTP surface.
--
-- Therefore: this shim is for a throwaway database holding invented values.
-- `scripts/fresh/zero-state.ts` refuses to run it against any host that is not
-- loopback, and refuses any database name outside the harness namespace. Never
-- put a real credential in a database that has been shimmed.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Roles
--
-- Supabase ships these; the migrations grant to them by name and a missing role
-- is a hard failure on `grant`. NOLOGIN, because nothing should connect as one:
-- the migrations only ever `grant` to them and `set local role` to them.
-- ---------------------------------------------------------------------------
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role','authenticator','supabase_admin']
  loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
  -- Supabase's `authenticator` can become the other three. Some migrations
  -- assume that chain exists when they test a grant with SET LOCAL ROLE.
  execute 'grant anon, authenticated, service_role to authenticator';
end $$;

-- ---------------------------------------------------------------------------
-- 2. The `extensions` schema
--
-- CLAUDE.md: "Extensions live in the `extensions` schema. A function with
-- `search_path = ''` must qualify `extensions.similarity`." So the schema name
-- is load-bearing, not cosmetic — putting pg_trgm in `public` would compile and
-- then fail at the first qualified call.
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
grant usage on schema extensions to public;
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists pgcrypto with schema extensions;
-- gen_random_uuid() is in pg_catalog from Postgres 13, so it needs no help.

-- ---------------------------------------------------------------------------
-- 3. The vault
--
-- Shaped from what the corpus actually reads: `name`, `decrypted_secret`,
-- `secret`, `created_at`, `id`, `description`, and the three writers
-- create_secret / update_secret / delete_secret with Supabase's argument order.
--
-- PLAINTEXT. See the header. This is why the harness refuses a non-local host.
-- ---------------------------------------------------------------------------
create schema if not exists vault;

create table if not exists vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text not null default '',
  secret      text not null,
  key_id      uuid,
  nonce       bytea,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table vault.secrets is
  'SHIM of Supabase Vault for the fresh-install zero-state harness. The secret '
  'column is PLAINTEXT and this table must never hold a real credential.';

create or replace view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret,
         key_id, nonce, created_at, updated_at
  from vault.secrets;

create or replace function vault.create_secret(
  new_secret text, new_name text default null,
  new_description text default '', new_key_id uuid default null)
  returns uuid language plpgsql security definer set search_path = vault, pg_catalog as $$
declare v_id uuid;
begin
  insert into vault.secrets (secret, name, description, key_id)
  values (new_secret, new_name, coalesce(new_description,''), new_key_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function vault.update_secret(
  secret_id uuid, new_secret text default null, new_name text default null,
  new_description text default null, new_key_id uuid default null)
  returns void language plpgsql security definer set search_path = vault, pg_catalog as $$
begin
  update vault.secrets set
    secret      = coalesce(new_secret, secret),
    name        = coalesce(new_name, name),
    description = coalesce(new_description, description),
    key_id      = coalesce(new_key_id, key_id),
    updated_at  = now()
  where id = secret_id;
end $$;

create or replace function vault.delete_secret(secret_id uuid)
  returns void language sql security definer set search_path = vault, pg_catalog as $$
  delete from vault.secrets where id = secret_id;
$$;

grant usage on schema vault to service_role;

-- ---------------------------------------------------------------------------
-- 4. Storage
--
-- Only `objects` and `buckets` are read, and only for a byte tally and one
-- bucket insert. `metadata` carries the size, which 0180's own comment says.
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id             uuid primary key default gen_random_uuid(),
  bucket_id      text references storage.buckets(id),
  name           text,
  owner          uuid,
  metadata       jsonb,
  path_tokens    text[],
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_accessed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 5. pg_cron and pg_net are STUB EXTENSIONS, not inline shims
--
-- 0121 writes `create extension if not exists pg_cron`, which cannot be
-- satisfied by creating a schema of the same name: Postgres looks for a control
-- file on disk and fails with "extension is not available" regardless of what
-- already exists. So the harness installs two stub extension packages into the
-- cluster's extension directory (scripts/fresh/sql/stub-extensions/) and the
-- migration's own statement then succeeds unchanged.
--
-- Both stubs RECORD and do not ACT: `cron.schedule` writes a row and fires
-- nothing, `net.http_post` writes a row and sends nothing. A disposable
-- database must not start a heartbeat or make outbound calls.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. A marker, so nothing can mistake a shimmed database for a real one
--
-- Read by the harness and by any check that needs to refuse to run somewhere
-- real. Its presence is the definition of "this is a throwaway".
-- ---------------------------------------------------------------------------
create schema if not exists fresh_install_harness;
create table if not exists fresh_install_harness.marker (
  only_row  boolean primary key default true check (only_row),
  shimmed_at timestamptz not null default now(),
  note      text not null default
    'Disposable local database for the fresh-install zero-state harness. '
    'The vault here is PLAINTEXT. Never store a real credential.'
);
insert into fresh_install_harness.marker (only_row) values (true) on conflict do nothing;

-- Local stand-ins for what Supabase provides before any migration runs.
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator login noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_admin login superuser; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_storage_admin nologin; exception when duplicate_object then null; end $$;
do $$ begin create role pgsodium_keyiduser nologin; exception when duplicate_object then null; end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm with schema extensions;
alter database postgres set search_path to "$user", public, extensions;
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default extensions.gen_random_uuid(), name text unique, description text default '', secret text not null, key_id uuid, nonce bytea, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create or replace view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, key_id, nonce, created_at, updated_at from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null) returns uuid language sql as $$ insert into vault.secrets(secret,name,description) values (new_secret,new_name,coalesce(new_description,'')) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null) returns void language sql as $$ update vault.secrets set secret=coalesce(new_secret,secret), name=coalesce(new_name,name), description=coalesce(new_description,description), updated_at=now() where id=secret_id $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default extensions.gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz default now());
-- The two logins office_members (0646) names, so that 0654 can bind the offices on a replica as it does in production.
-- Fixed ids keep a rebuilt replica reproducible; production's real ids are never copied.
insert into auth.users (id, email) values
  ('11111111-0000-4000-8000-000000000001', 'grant.e.rogers@gmail.com'),
  ('11111111-0000-4000-8000-000000000002', 'verify.operator@example.com')
on conflict (id) do nothing;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text unique, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now(), owner uuid);
create table if not exists storage.objects (id uuid primary key default extensions.gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz, path_tokens text[]);

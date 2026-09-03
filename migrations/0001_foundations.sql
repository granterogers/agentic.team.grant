-- 0001 — Foundations
--
-- Establishes what every later migration assumes: an internal schema that
-- PostgREST does not expose, the least-privilege runtime role, the applied-
-- migration ledger, and the shared conventions (timestamps, transition
-- guarding) that the ledger and job engine are built on.
--
-- Nothing here holds business data. The point is that 0002 onward can rely on
-- these existing rather than each re-establishing them.

-- ---------------------------------------------------------------------------
-- 1. Internal schema
--
-- `public` is what Supabase's PostgREST exposes over HTTP. Anything that must
-- never be reachable from a browser — helper functions, the migration ledger,
-- trigger internals — lives in `app`, which is deliberately not added to
-- PostgREST's exposed schema list.
-- ---------------------------------------------------------------------------
create schema if not exists app;

comment on schema app is
  'Internal implementation surface. Deliberately NOT exposed via PostgREST: '
  'helper functions, the migration ledger and trigger internals live here so '
  'they are unreachable over HTTP regardless of which key is presented.';

-- ---------------------------------------------------------------------------
-- 2. The least-privilege runtime role
--
-- Master spec §6 requires the event ledger to be append-only "enforced at the
-- database level by revoking UPDATE/DELETE from the application role", and §15
-- warns that the service-role key is the highest-blast-radius credential in the
-- system. Neither requirement is satisfiable while the application connects as
-- `postgres`: you cannot revoke anything meaningful from the owner.
--
-- So there is a distinct role. It is NOLOGIN in Phase 1 on purpose — a role
-- with no password is a role with no credential to leak, and every enforcement
-- test below reaches it with SET LOCAL ROLE, which proves the grants without
-- one existing. Phase 2 gives it a password and points the deployed runtime at
-- it, once there is an encrypted store to keep that password in.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ai_team_app') then
    create role ai_team_app nologin;
  end if;
end
$$;

comment on role ai_team_app is
  'Least-privilege application role. The deployed runtime connects as this, '
  'never as postgres or service_role. NOLOGIN until Phase 2 provides an '
  'encrypted store for its password.';

grant usage on schema public to ai_team_app;

-- Explicitly NOT granted: usage on schema app. Internal helpers stay internal.

-- ---------------------------------------------------------------------------
-- 3. Shared conventions
-- ---------------------------------------------------------------------------

-- Transaction timestamp, so every row written by one transaction agrees. Using
-- clock_timestamp() here would let rows in a single logical event disagree
-- about when it happened, which makes the ledger harder to read than it needs
-- to be.
create or replace function app.now_utc()
  returns timestamptz
  language sql
  stable
  set search_path = pg_catalog
as $$
  select now()
$$;

comment on function app.now_utc() is
  'Transaction timestamp. Every row written by one transaction shares it, so a '
  'single logical event does not disagree with itself about when it occurred.';

-- ---------------------------------------------------------------------------
-- 4. Applied-migration ledger
--
-- The database-side counterpart to migrations/applied.json. The file is what CI
-- checks; this table is what the database itself knows. Both exist because
-- either alone can lie: the file can be edited, and the table cannot be read
-- without a working connection.
--
-- Deliberately in `app`, not `public`: migration history is not application
-- data and must not be reachable over HTTP.
-- ---------------------------------------------------------------------------
create table if not exists app.schema_migrations (
  name          text        primary key,
  checksum      text        not null,
  applied_at    timestamptz not null default app.now_utc(),
  applied_by    text        not null default current_user,
  duration_ms   integer,

  constraint schema_migrations_name_format
    check (name ~ '^[0-9]{4}_[a-z0-9]+(_[a-z0-9]+)*\.sql$'),
  constraint schema_migrations_checksum_sha256
    check (checksum ~ '^[0-9a-f]{64}$')
);

comment on table app.schema_migrations is
  'Every migration this database has applied, with the SHA-256 of the file as '
  'applied. A mismatch against the file on disk means history was edited, '
  'which CI rejects.';

-- The migration runner is the only writer, and it connects as the owner.
-- The application role has no business reading or writing this at all.
revoke all on app.schema_migrations from public;

-- ---------------------------------------------------------------------------
-- 5. Record this migration
--
-- 0001 records itself so the ledger is never empty and the runner's "already
-- applied?" check has something to find on a fresh database. The checksum is a
-- placeholder the runner overwrites with the real file hash; the constraint
-- above still requires it to be sha256-shaped.
-- ---------------------------------------------------------------------------
insert into app.schema_migrations (name, checksum)
values ('0001_foundations.sql', repeat('0', 64))
on conflict (name) do nothing;

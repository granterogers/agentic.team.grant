-- 0002 — Project registry and system configuration
--
-- The minimum identity layer the ledger and job engine need to reference.
-- Master spec §7: one Gemini Notebook = one project, and Postgres — not
-- Notebook — is authoritative for the registry. A Notebook outage must not make
-- the system forget which projects exist.
--
-- Staff identities (§9) are deliberately NOT here. They are Phase 3, and Phase 1
-- is forbidden from building ahead.

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table public.projects (
  project_id      uuid        primary key default gen_random_uuid(),
  slug            text        not null unique,
  name            text        not null,
  status          text        not null default 'active',

  -- Notebook is a replaceable adapter (§7, ADR-0003), so its identifier is a
  -- nullable annotation on a project rather than the project's identity. A
  -- project exists whether or not a notebook is attached, and survives the
  -- adapter being swapped for a different knowledge system entirely.
  notebook_ref    text,

  created_at      timestamptz not null default app.now_utc(),
  updated_at      timestamptz not null default app.now_utc(),

  constraint projects_slug_format   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint projects_name_present  check (length(trim(name)) > 0),
  constraint projects_status_known  check (status in ('active', 'paused', 'archived'))
);

comment on table public.projects is
  'Authoritative project registry. Postgres owns this, never Notebook (§7) — a '
  'Notebook outage is a degraded mode, not amnesia about which projects exist.';

comment on column public.projects.notebook_ref is
  'Optional knowledge-adapter identifier. Nullable because Notebook is a '
  'replaceable adapter (ADR-0003), not a project''s identity.';

create index projects_status_idx on public.projects (status) where status = 'active';

-- ---------------------------------------------------------------------------
-- System configuration
--
-- §4: "All model and provider identifiers are configuration, never constants."
-- §19: automatic adaptation may change only low-risk structured preferences;
-- everything else needs Grant's approval. `self_adjustable` is that boundary,
-- expressed as data the policy engine reads rather than a rule in a prompt.
-- ---------------------------------------------------------------------------
create table public.system_config (
  key             text        primary key,
  value           jsonb       not null,
  description     text        not null,

  -- False means: automatic adaptation must never touch this. Role identity,
  -- authority, tool permissions, spending policy, quality rules and
  -- destructive-action policy all live behind it (§19).
  self_adjustable boolean     not null default false,

  updated_at      timestamptz not null default app.now_utc(),
  updated_by      text        not null default current_user,

  constraint system_config_key_format check (key ~ '^[a-z0-9]+(\.[a-z0-9_]+)*$')
);

comment on table public.system_config is
  'Runtime configuration. Model and provider identifiers live here, never as '
  'constants in code (§4).';

comment on column public.system_config.self_adjustable is
  'False means automatic adaptation must never change this key — it requires '
  'the weekly versioned proposal and Grant''s manual approval (§19).';

-- ---------------------------------------------------------------------------
-- Keep updated_at honest
--
-- A timestamp the application is trusted to maintain is a timestamp that is
-- eventually wrong. A trigger cannot be forgotten.
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function app.touch_updated_at();

create trigger system_config_touch_updated_at
  before update on public.system_config
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security (§6: "throughout")
--
-- Single-user today. RLS is on anyway because §15 names the service-role key as
-- the highest-blast-radius credential in the system, and it must not be the
-- only thing standing between a bug and the data.
--
-- The permissive policies below are the Phase 1 posture: the application role
-- may read and write project data. They exist so that RLS is ENABLED with
-- deliberate, reviewable policies rather than enabled with none — which would
-- silently deny everything and get switched off again under deadline.
-- ---------------------------------------------------------------------------
alter table public.projects      enable row level security;
alter table public.system_config enable row level security;

-- FORCE means the table owner is subject to its own policies too. Without it,
-- anything connecting as the owner bypasses RLS entirely and the protection is
-- theatre.
alter table public.projects      force row level security;
alter table public.system_config force row level security;

create policy projects_app_read on public.projects
  for select to ai_team_app using (true);
create policy projects_app_write on public.projects
  for insert to ai_team_app with check (true);
create policy projects_app_update on public.projects
  for update to ai_team_app using (true) with check (true);

create policy system_config_app_read on public.system_config
  for select to ai_team_app using (true);

-- Deliberately no write policy for the application role on system_config.
-- §19 forbids autonomous changes to anything but low-risk preferences, and
-- Phase 1 has no mechanism to tell the two apart yet. Until it does, writes go
-- through a migration, which is reviewable. Absence of a policy is the
-- enforcement.

grant select, insert, update on public.projects to ai_team_app;
grant select                 on public.system_config to ai_team_app;

-- Not granted anywhere: DELETE on projects. A project is archived via status,
-- never deleted, because the event ledger references it forever.

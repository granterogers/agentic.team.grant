-- 0026 — project switching
--
-- The last open Phase 4 item. "Switch to the pricing project" has to mean
-- something durable, per-surface, and recoverable after a restart.
--
-- ## Why an append-only log rather than a mutable "current project" row
--
-- The obvious table is `(scope, project_id)` with an UPDATE on each switch.
-- That answers "what am I working on" and destroys "what was I working on when
-- that job was created", which is the question anyone actually asks of a
-- system that ran unattended overnight. §6 pins configuration at job start for
-- the same reason.
--
-- So switches are appended and the current project is the latest row. History
-- is free, and the audit question is answerable without a second table that
-- can disagree with the first.
--
-- ## Why scope is a pair, not a user
--
-- The same person in a project-mapped Slack channel and in a Telegram DM is
-- not in the same context, and §CMCA is explicit that the channel is transport
-- rather than identity. Scope is therefore (kind, ref): a channel has its own
-- context, a DM has its own, and `global` exists for the surfaces that have no
-- natural container - voice, and the dashboard.
--
-- ## The resolution order, and the one case that must NOT resolve
--
-- A channel permanently mapped to a project (0014) outranks a switch made in
-- it: the map is a deliberate configuration and a passing "let's look at X"
-- should not silently repoint the team's project channel. Explicit beats both.
-- And when nothing resolves, the answer is NULL - ask - never "the most recent
-- project", which is how work lands in the wrong place while looking fine.

begin;

create type public.project_scope_kind as enum (
  'slack_channel',
  'telegram_chat',
  'voice',
  'dashboard',
  'global'
);

create table public.project_switches (
  switch_id     uuid        primary key default gen_random_uuid(),

  scope_kind    public.project_scope_kind not null,
  -- The channel id, chat id, or a fixed marker for the singleton scopes. Not
  -- nullable: a null ref would make two different scopes compare equal, and
  -- `is not distinct from` semantics in a uniqueness rule is a trap worth
  -- avoiding entirely.
  scope_ref     text        not null,

  -- Nullable, and that is a feature: a switch TO nothing is how "stop scoping
  -- me to a project" is expressed, and it must be a recorded event rather than
  -- a deletion.
  project_id    uuid        references public.projects (project_id),

  switched_by   text        not null,
  -- Free text. "Grant said so" is a reason; so is "the only project matching
  -- 'pricing'". Required, because a context switch nobody can explain later is
  -- how a job ends up filed under the wrong project with no way to tell why.
  reason        text        not null,

  switched_at   timestamptz not null default app.now_utc(),

  constraint project_switches_scope_ref_present check (length(trim(scope_ref)) > 0),
  constraint project_switches_actor_present check (length(trim(switched_by)) > 0),
  constraint project_switches_reason_present check (length(trim(reason)) >= 5)
);

create index project_switches_current
  on public.project_switches (scope_kind, scope_ref, switched_at desc);

comment on table public.project_switches is
  'Append-only log of project context changes. The current context is the '
  'latest row; the history is what makes "which project was this job filed '
  'under, and why" answerable after the fact.';
comment on column public.project_switches.project_id is
  'Null means "no project context" - an explicit, recorded un-scoping rather '
  'than a deleted row.';

revoke update, delete, truncate on public.project_switches from ai_team_app;

create trigger project_switches_reject_update
  before update on public.project_switches
  for each row execute function app.reject_ledger_mutation();
create trigger project_switches_reject_truncate
  before truncate on public.project_switches
  for each statement execute function app.reject_ledger_mutation();

-- A switch must not point at a project that is gone. Archived projects are
-- kept forever (0002 grants no DELETE), so this is a live check rather than a
-- referential one.
create or replace function app.enforce_switch_target_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if new.project_id is null then
    return new;
  end if;

  select status::text into v_status from public.projects where project_id = new.project_id;

  if v_status <> 'active' then
    raise exception
      'cannot switch to project %: it is %. Switching into an archived project '
      'would file new work somewhere nobody is looking.', new.project_id, v_status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger project_switches_enforce_target
  before insert on public.project_switches
  for each row execute function app.enforce_switch_target_active();

-- ---------------------------------------------------------------------------
-- Reading the context back
-- ---------------------------------------------------------------------------

create or replace function app.current_project(
  p_scope_kind public.project_scope_kind,
  p_scope_ref text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select project_id
  from public.project_switches
  where scope_kind = p_scope_kind and scope_ref = p_scope_ref
  order by switched_at desc, switch_id desc
  limit 1;
$$;

comment on function app.current_project is
  'The latest switch for a scope. Returns null both when nothing was ever set '
  'and when the last switch was an explicit un-scoping - which are the same '
  'thing to a caller, and both mean ask.';

-- The full resolution order, in one place so that no caller reimplements it
-- slightly differently.
create or replace function app.resolve_project(
  p_scope_kind public.project_scope_kind,
  p_scope_ref text,
  p_explicit uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mapped uuid;
begin
  -- 1. What the message itself named.
  if p_explicit is not null then
    return p_explicit;
  end if;

  -- 2. A permanent channel mapping. Outranks a switch made IN that channel:
  --    the map is deliberate configuration, and a passing "let's look at X"
  --    must not silently repoint the team's project channel.
  if p_scope_kind = 'slack_channel' then
    v_mapped := app.project_for_slack_channel(p_scope_ref);
    if v_mapped is not null then
      return v_mapped;
    end if;
  end if;

  -- 3. The scope's current switch.
  -- 4. Null, meaning ASK. Deliberately not "the most recently touched
  --    project", which is how work lands in the wrong place while looking
  --    entirely reasonable.
  return app.current_project(p_scope_kind, p_scope_ref);
end;
$$;

comment on function app.resolve_project is
  'Explicit > permanent channel mapping > the scope''s current switch > null. '
  'Null means ask; there is deliberately no "most recent project" fallback.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

alter table public.project_switches enable row level security;
alter table public.project_switches force  row level security;

grant select, insert on public.project_switches to ai_team_app;
grant execute on function app.current_project(public.project_scope_kind, text) to ai_team_app;
grant execute on function app.resolve_project(public.project_scope_kind, text, uuid) to ai_team_app;

create policy project_switches_app_read on public.project_switches
  for select to ai_team_app using (true);
create policy project_switches_app_insert on public.project_switches
  for insert to ai_team_app with check (true);

commit;

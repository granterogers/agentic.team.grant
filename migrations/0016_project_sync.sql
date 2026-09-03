-- 0016 — project discovery and sync
--
-- Phase 4's acceptance: *"a new notebook is discovered and becomes a project
-- unattended; 50 sources added rapidly are processed without duplication; a
-- worker crash mid-sync resumes cleanly; Notebook outage degrades rather than
-- fails."*
--
-- Three of those four are properties of the schema rather than of the code
-- that runs against it, which is why they are settled here:
--
--   - **without duplication** is a unique index, not a check-then-insert. Gate
--     2 measured that Notebook itself does NOT de-duplicate a repeated source,
--     so this is load-bearing rather than defensive.
--   - **resumes cleanly** needs a sync to be a resumable row rather than a
--     function call, so a crash leaves a record saying where it got to.
--   - **degrades rather than fails** is already structural: nothing here is
--     referenced by jobs, events or config, so this whole file can be
--     unavailable without the operational core noticing.
--
-- The fourth, *unattended discovery*, is the only one that is genuinely code.

begin;

-- ---------------------------------------------------------------------------
-- Sync runs
-- ---------------------------------------------------------------------------

create type public.sync_run_state as enum (
  'running',
  'complete',
  'failed',
  -- The state that makes "resumes cleanly" checkable: a run whose worker died.
  -- Distinct from 'failed', which is a run that finished by deciding it could
  -- not proceed. One is a crash, the other is a verdict.
  'abandoned'
);

-- One row per discovery/sync cycle, kept.
--
-- The history is the point rather than a nicety: a sync that quietly stopped
-- finding a notebook is invisible in a current-state table and obvious in a
-- sequence of runs. §7 expects this dependency to break in undocumented ways,
-- and "when did it last work?" is the first question.
create table public.sync_runs (
  run_id            uuid        primary key default gen_random_uuid(),

  state             public.sync_run_state not null default 'running',

  -- What the run saw and did. Counts rather than payloads: the payloads live
  -- in notebook_sources, and a run record that duplicated them would be a
  -- second source of truth for the same facts.
  notebooks_seen    integer     not null default 0,
  projects_created  integer     not null default 0,
  sources_seen      integer     not null default 0,
  sources_added     integer     not null default 0,
  sources_changed   integer     not null default 0,
  sources_removed   integer     not null default 0,

  -- Which worker, so a crash can be attributed and a stalled run recovered.
  -- Same pattern as jobs.leased_by (0005): the lease is what tells "a worker
  -- is on this" from "a worker died on this".
  leased_by         text,
  leased_until      timestamptz,

  -- Non-secret. A failure records what failed, never a credential.
  detail            text,

  started_at        timestamptz not null default app.now_utc(),
  finished_at       timestamptz,

  constraint sync_runs_finished_iff_settled
    check ((state in ('complete', 'failed', 'abandoned')) = (finished_at is not null)),
  constraint sync_runs_lease_is_paired
    check ((leased_by is null) = (leased_until is null)),
  constraint sync_runs_counts_non_negative
    check (
      notebooks_seen >= 0 and projects_created >= 0 and sources_seen >= 0
      and sources_added >= 0 and sources_changed >= 0 and sources_removed >= 0
    )
);

create index sync_runs_recent on public.sync_runs (started_at desc);
create index sync_runs_live on public.sync_runs (leased_until) where state = 'running';

comment on table public.sync_runs is
  'One row per sync cycle, kept rather than overwritten. A sync that quietly '
  'stopped finding a notebook is invisible in a current-state table and obvious '
  'in a sequence of runs.';

-- Only one sync may run at a time.
--
-- A partial unique index rather than an advisory lock, because the guarantee
-- has to survive the worker dying: an advisory lock is released when the
-- connection drops, which is exactly the moment a crashed run must still be
-- visible as in-flight rather than silently re-runnable.
create unique index sync_runs_one_at_a_time on public.sync_runs ((true))
  where state = 'running';

-- Recover a run whose worker died.
--
-- The same shape as app.recover_stalled_jobs (0006). `abandoned`, not `failed`:
-- a crash is not a verdict, and the distinction is what lets the next run
-- report "the previous run was interrupted" rather than "the previous run
-- decided to stop".
create or replace function app.recover_stalled_syncs()
returns integer
language sql
as $$
  with recovered as (
    update public.sync_runs
    set state = 'abandoned',
        finished_at = app.now_utc(),
        leased_by = null,
        leased_until = null,
        detail = coalesce(detail, '') ||
          case when detail is null then '' else '; ' end ||
          'lease expired at ' || leased_until::text || ' - the worker died mid-sync'
    where state = 'running'
      and leased_until is not null
      and leased_until < app.now_utc()
    returning 1
  )
  select coalesce(count(*), 0)::integer from recovered;
$$;

comment on function app.recover_stalled_syncs() is
  'Marks runs whose lease expired as abandoned. A crash is not a verdict, so it '
  'is not recorded as a failure.';

-- ---------------------------------------------------------------------------
-- Discovery: a notebook becoming a project
-- ---------------------------------------------------------------------------

-- One project per notebook, enforced.
--
-- `projects.notebook_ref` was nullable and unconstrained, which was right while
-- nothing populated it. Now that discovery does, two projects claiming the same
-- notebook is a state the resolver cannot use, so it is made impossible.
-- Partial, because null means "no notebook attached" and nulls must not
-- collide: several projects may legitimately have none.
create unique index projects_one_per_notebook on public.projects (notebook_ref)
  where notebook_ref is not null;

-- Notebooks deliberately NOT turned into projects.
--
-- Without this, "ignore that one" has nowhere to live and every sync
-- re-creates a project Grant has already archived. §17's kill-switch logic
-- applied at the row level: a decision to exclude something must be
-- recordable, or it will be re-litigated every ten minutes.
create table public.notebook_exclusions (
  remote_notebook_id text      primary key,
  title              text,
  reason             text      not null,
  excluded_at        timestamptz not null default app.now_utc(),

  constraint notebook_exclusions_reason_present
    check (length(trim(reason)) > 0)
);

comment on table public.notebook_exclusions is
  'Notebooks that must not become projects. Without it, "ignore that one" has '
  'nowhere to live and every sync re-creates what Grant archived.';

-- ---------------------------------------------------------------------------
-- Tier-derived budgets (§11, and Phase 4 by name)
-- ---------------------------------------------------------------------------

-- Budgets computed from the tier the adapter actually reported.
--
-- Phase 4 says "tier-derived budgets from AccountLimits.tier, never
-- hard-coded", and §11 says why: Google changes the numbers without updating
-- its own published tables. So the observed limits are stored, with the probe
-- that observed them, and the budget is derived from those rather than from a
-- constant anywhere.
create table public.notebook_budgets (
  budget_id         uuid        primary key default gen_random_uuid(),

  -- The probe these figures came from. Not nullable: a budget with no
  -- provenance is a hard-coded number with extra steps, which is the thing
  -- §11 forbids.
  probe_id          uuid        not null
                      references public.notebook_capability_probes (probe_id),

  detected_tier     integer     not null,
  notebook_limit    integer     not null,
  source_limit      integer     not null,

  -- Derived, and deliberately conservative. §7's plan spends ~5-15 chats/day
  -- against a 50/day allowance; the reserve is what keeps a bad day from
  -- exhausting the quota before the evening briefing.
  daily_chat_budget integer     not null,
  chat_reserve      integer     not null,

  computed_at       timestamptz not null default app.now_utc(),

  constraint notebook_budgets_limits_positive
    check (detected_tier >= 0 and notebook_limit > 0 and source_limit > 0),
  constraint notebook_budgets_reserve_within_budget
    check (chat_reserve >= 0 and chat_reserve < daily_chat_budget),
  constraint notebook_budgets_budget_positive
    check (daily_chat_budget > 0)
);

create index notebook_budgets_recent on public.notebook_budgets (computed_at desc);

create or replace view public.notebook_budget as
  select detected_tier, notebook_limit, source_limit,
         daily_chat_budget, chat_reserve, computed_at, probe_id
  from public.notebook_budgets
  order by computed_at desc
  limit 1;

comment on table public.notebook_budgets is
  '§11: derive budgets from the DETECTED tier, never hard-code quota. probe_id '
  'is NOT NULL because a budget without provenance is a hard-coded number with '
  'extra steps.';

-- Today's spend against the derived budget. Counted from inference_usage's
-- sibling: Notebook chats are not inference_usage rows (that table is the
-- provider router's), so they need their own count.
create table public.notebook_chat_usage (
  usage_id        uuid        primary key default gen_random_uuid(),
  project_id      uuid        references public.projects (project_id),
  correlation_id  uuid        not null,
  remote_notebook_id text     not null,
  -- §6 forbids storing chain-of-thought and §12 forbids exposing raw traces,
  -- so the question and answer are NOT stored here. Only that a chat happened,
  -- how big it was, and how long it took.
  prompt_chars    integer     not null default 0,
  answer_chars    integer     not null default 0,
  latency_ms      integer,
  occurred_at     timestamptz not null default app.now_utc(),

  constraint notebook_chat_usage_sizes_non_negative
    check (prompt_chars >= 0 and answer_chars >= 0)
);

create index notebook_chat_usage_today
  on public.notebook_chat_usage (occurred_at desc);

comment on table public.notebook_chat_usage is
  'That a chat happened and how big it was - never the question or the answer. '
  '§6 forbids storing chain-of-thought; §12 forbids exposing raw traces.';

-- May we spend a Notebook chat right now?
--
-- In SQL for the same reason app.notification_allowed is (0013): more than one
-- caller needs it, and §11''s lesson about a guard applied in one of two call
-- paths applies just as much to a budget.
create or replace function app.notebook_chat_allowed(p_urgent boolean default false)
returns boolean
language plpgsql
stable
as $$
declare
  v_budget record;
  v_spent integer;
begin
  select * into v_budget from public.notebook_budget;

  -- No measured budget means no basis for spending. Refusing is the §11-safe
  -- answer: inventing a default here would be the hard-coding the whole table
  -- exists to prevent.
  if v_budget is null then
    return false;
  end if;

  select count(*)::integer into v_spent
  from public.notebook_chat_usage
  where occurred_at >= date_trunc('day', app.now_utc());

  -- Urgent work may draw on the reserve; ordinary work may not. That is what
  -- makes the reserve a reserve rather than a smaller budget.
  if p_urgent then
    return v_spent < v_budget.daily_chat_budget;
  end if;
  return v_spent < (v_budget.daily_chat_budget - v_budget.chat_reserve);
end;
$$;

comment on function app.notebook_chat_allowed(boolean) is
  'Budget check against the DERIVED daily allowance. Urgent work may draw on '
  'the reserve; ordinary work may not, which is what makes it a reserve.';

-- ---------------------------------------------------------------------------
-- Project briefs
-- ---------------------------------------------------------------------------

create table public.project_briefs (
  brief_id        uuid        primary key default gen_random_uuid(),
  project_id      uuid        not null references public.projects (project_id),

  body            text        not null,

  -- §16's structured metadata, as far as Phase 4 needs it. `sources_used` is
  -- how a brief is auditable at all: a brief that cannot say what it read is
  -- an assertion.
  sources_used    integer     not null,
  source_fingerprints text[]  not null,

  -- Which model wrote it, so a bad brief is attributable. §11's registry makes
  -- this knowable; recording it makes it checkable.
  model            text        not null,

  -- §12: show Verified/Inferred/Speculative. A brief generated from cached
  -- source text is inferred, not verified, and saying so is the point.
  confidence      text        not null default 'inferred',

  generated_at    timestamptz not null default app.now_utc(),

  constraint project_briefs_body_substantive
    check (length(trim(body)) >= 50),
  constraint project_briefs_confidence_known
    check (confidence in ('verified', 'inferred', 'speculative')),
  constraint project_briefs_sources_counted
    check (sources_used >= 0 and sources_used = coalesce(array_length(source_fingerprints, 1), 0))
);

create index project_briefs_by_project
  on public.project_briefs (project_id, generated_at desc);

comment on table public.project_briefs is
  'Briefs are append-only history, not a current-value column on projects: '
  '"what did we think last week?" is a question §16''s provenance requirements '
  'make answerable only if old briefs survive.';

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------

alter table public.sync_runs             enable row level security;
alter table public.sync_runs             force  row level security;
alter table public.notebook_exclusions   enable row level security;
alter table public.notebook_exclusions   force  row level security;
alter table public.notebook_budgets      enable row level security;
alter table public.notebook_budgets      force  row level security;
alter table public.notebook_chat_usage   enable row level security;
alter table public.notebook_chat_usage   force  row level security;
alter table public.project_briefs        enable row level security;
alter table public.project_briefs        force  row level security;

grant select, insert, update on public.sync_runs to ai_team_app;
grant select, insert, delete on public.notebook_exclusions to ai_team_app;
grant select, insert on public.notebook_budgets to ai_team_app;
grant select, insert on public.notebook_chat_usage to ai_team_app;
grant select, insert on public.project_briefs to ai_team_app;
grant execute on function app.recover_stalled_syncs() to ai_team_app;
grant execute on function app.notebook_chat_allowed(boolean) to ai_team_app;

create policy sync_runs_app_all on public.sync_runs
  for select to ai_team_app using (true);
create policy sync_runs_app_insert on public.sync_runs
  for insert to ai_team_app with check (true);
create policy sync_runs_app_update on public.sync_runs
  for update to ai_team_app using (true) with check (true);
create policy notebook_exclusions_app_read on public.notebook_exclusions
  for select to ai_team_app using (true);
create policy notebook_exclusions_app_insert on public.notebook_exclusions
  for insert to ai_team_app with check (true);
create policy notebook_exclusions_app_delete on public.notebook_exclusions
  for delete to ai_team_app using (true);
create policy notebook_budgets_app_read on public.notebook_budgets
  for select to ai_team_app using (true);
create policy notebook_budgets_app_insert on public.notebook_budgets
  for insert to ai_team_app with check (true);
create policy notebook_chat_usage_app_read on public.notebook_chat_usage
  for select to ai_team_app using (true);
create policy notebook_chat_usage_app_insert on public.notebook_chat_usage
  for insert to ai_team_app with check (true);
create policy project_briefs_app_read on public.project_briefs
  for select to ai_team_app using (true);
create policy project_briefs_app_insert on public.project_briefs
  for insert to ai_team_app with check (true);

-- The sync interval, as configuration. Self-adjustable: unlike a kill-switch,
-- a system backing off its own polling when a dependency is struggling is
-- desirable rather than dangerous.
insert into public.system_config (key, value, description, self_adjustable)
values
  ('notebook.sync_interval_minutes', '10'::jsonb,
   'How often the discovery/sync cycle runs. Self-adjustable so the system may '
   'back off when Notebook is degraded.', true),
  ('notebook.sync_lease_minutes', '15'::jsonb,
   'How long a sync run may hold its lease before app.recover_stalled_syncs '
   'treats the worker as dead. Longer than the interval on purpose: a slow run '
   'must not be declared crashed by the next tick.', false)
on conflict (key) do nothing;

commit;

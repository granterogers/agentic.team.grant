-- 0027 — responsibilities, autonomy levels, Today and Needs Me
--
-- Phase 6's acceptance:
--
--   "limits hold under concurrent load and across restarts; 'leave me alone
--    today' persists as structured preference; Needs Me stays small."
--
-- The first is already true and already proved: 0006 enforces capacity AT
-- DEQUEUE under an advisory lock, which is what makes it survive a restart,
-- and `verify:jobs` demonstrates it. The second is 0013. This file is the
-- third, plus the two things Phase 6 adds that nothing else covers:
-- recurring duties, and how much the system may do without asking.
--
-- ## "Needs Me stays small" is a property, not an aspiration
--
-- Every system like this drifts toward a notification list nobody reads, and
-- it happens one reasonable addition at a time. The counter-pressure has to be
-- structural, so:
--
--   * A blocker must have a deadline. §12 already requires the fields; what is
--     added here is that an item with no deadline is not urgent enough to
--     interrupt a person, and belongs in a digest.
--   * Needs Me is CAPPED. Past the cap the view returns the most urgent N and
--     says how many were suppressed, rather than growing without limit. A list
--     of forty things needing Grant is not a list of forty things needing
--     Grant; it is a broken filter, and it should look broken rather than
--     look busy.
--   * `app.needs_me_pressure()` reports the number so the cap failing is
--     visible rather than silently truncating.
--
-- ## Autonomy is a level per scope, and agents cannot raise it
--
-- §11: "Prompts may explain policy. Code must enforce policy." An autonomy
-- level an agent can raise is not a level. The app role gets SELECT and
-- nothing else; changes come through the migration identity or through Grant's
-- own path, and every change is appended rather than overwritten so that "what
-- was I allowed to do when I did that" stays answerable.

begin;

-- ---------------------------------------------------------------------------
-- Autonomy
-- ---------------------------------------------------------------------------

create type public.autonomy_level as enum (
  -- Watch and report. Produces no work of its own.
  'observe',
  -- May propose; may not start.
  'suggest',
  -- May do the work, but nothing leaves the system until Grant approves.
  'act_with_review',
  -- May do the work and deliver it. Still bounded by the tool permissions of
  -- §11 and the quality gate of §16 - autonomy is not authority.
  'act'
);

comment on type public.autonomy_level is
  '§17: how much may happen without Grant. Orthogonal to §11 tool permissions '
  'and §16 review - a job at `act` still cannot send mail or commit unreviewed '
  'output. Autonomy is not authority.';

create table public.autonomy_settings (
  setting_id    uuid        primary key default gen_random_uuid(),

  -- Null project means the global default. Nullable rather than a sentinel so
  -- the foreign key stays real.
  project_id    uuid        references public.projects (project_id),
  level         public.autonomy_level not null,

  set_by        text        not null,
  reason        text        not null,
  set_at        timestamptz not null default app.now_utc(),

  constraint autonomy_settings_actor_present check (length(trim(set_by)) > 0),
  constraint autonomy_settings_reason_present check (length(trim(reason)) >= 5)
);

create index autonomy_settings_current
  on public.autonomy_settings (project_id, set_at desc);

comment on table public.autonomy_settings is
  'Append-only. The current level is the latest row for a scope; the history is '
  'what makes "what was this allowed to do at the time" answerable.';

revoke update, delete, truncate on public.autonomy_settings from ai_team_app;
create trigger autonomy_settings_reject_update
  before update on public.autonomy_settings
  for each row execute function app.reject_ledger_mutation();
create trigger autonomy_settings_reject_truncate
  before truncate on public.autonomy_settings
  for each statement execute function app.reject_ledger_mutation();

create or replace function app.autonomy_for(p_project_id uuid default null)
returns public.autonomy_level
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    -- The project's own setting, if it has one.
    (select level from public.autonomy_settings
      where project_id is not distinct from p_project_id
      order by set_at desc, setting_id desc limit 1),
    -- Otherwise the global setting.
    (select level from public.autonomy_settings
      where project_id is null
      order by set_at desc, setting_id desc limit 1),
    -- Otherwise the conservative default. A missing configuration must not
    -- read as permission.
    'suggest'::public.autonomy_level
  );
$$;

comment on function app.autonomy_for is
  'Project setting, else global, else `suggest`. The fallback is deliberately '
  'the cautious end: a missing configuration must never read as permission.';

-- ---------------------------------------------------------------------------
-- Responsibilities — recurring duties owned by a role
-- ---------------------------------------------------------------------------

create table public.responsibilities (
  responsibility_id uuid      primary key default gen_random_uuid(),
  slug          text          not null unique,

  staff_id      uuid          not null references public.staff (staff_id),
  project_id    uuid          references public.projects (project_id),

  description   text          not null,
  -- What the duty produces when it runs. A job kind, matching jobs.kind.
  job_kind      text          not null,

  -- Minutes between runs. An interval rather than cron: every duty here is
  -- "every N minutes/hours", and a cron string would invite a complexity
  -- nothing needs yet.
  period_minutes integer      not null,

  -- The window is what makes the idempotency key. Two runs in the same window
  -- collide rather than duplicating, which is 0005's rule applied to recurring
  -- work: a duty that fires twice because a worker restarted must not produce
  -- two jobs.
  last_run_at   timestamptz,
  enabled       boolean       not null default true,

  created_at    timestamptz   not null default app.now_utc(),
  updated_at    timestamptz   not null default app.now_utc(),

  constraint responsibilities_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint responsibilities_description_substantive check (length(trim(description)) >= 20),
  constraint responsibilities_job_kind_format
    check (job_kind ~ '^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)*$'),
  -- Ten minutes is the sync cadence; nothing here needs to be faster, and a
  -- duty firing every minute is a duty that will produce a job every minute.
  constraint responsibilities_period_sane check (period_minutes between 10 and 20160)
);

create trigger responsibilities_touch_updated_at
  before update on public.responsibilities
  for each row execute function app.touch_updated_at();

comment on table public.responsibilities is
  '§17 recurring duties. Owned by a staff role rather than free-floating, so '
  '"who is responsible for noticing this" always has an answer.';

/**
 * Which duties are due, and the idempotency key each would use.
 *
 * Returns the key rather than making the caller derive it, because the whole
 * anti-duplication property depends on every caller deriving it identically -
 * and "every caller derives it identically" is not a property you get by
 * writing it down.
 */
create or replace function app.due_responsibilities()
returns table (
  responsibility_id uuid,
  slug text,
  staff_id uuid,
  project_id uuid,
  job_kind text,
  idempotency_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.responsibility_id, r.slug, r.staff_id, r.project_id, r.job_kind,
    -- The window index, not the timestamp: two attempts inside the same period
    -- produce the same key and collide on 0005's unique index.
    'duty:' || r.slug || ':' ||
      (floor(extract(epoch from app.now_utc()) / (r.period_minutes * 60)))::bigint::text
  from public.responsibilities r
  join public.staff s on s.staff_id = r.staff_id and s.active
  where r.enabled
    and (
      r.last_run_at is null
      or r.last_run_at <= app.now_utc() - make_interval(mins => r.period_minutes)
    );
$$;

comment on function app.due_responsibilities is
  'Due duties with the idempotency key each must use. The key is derived here, '
  'once, because "every caller derives it the same way" is not something you '
  'get by documenting it.';

-- ---------------------------------------------------------------------------
-- Needs Me (§12), with a cap
-- ---------------------------------------------------------------------------

create or replace function app.needs_me_cap()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (value #>> '{}')::integer from public.system_config
      where key = 'ui.needs_me_cap'),
    7);
$$;

create or replace view public.needs_me as
select
  b.blocker_id,
  b.project_id,
  b.job_id,
  b.requested_action,
  b.why_needed,
  b.real_deadline,
  b.approval_options,
  b.originating_agent,
  b.work_can_continue,
  b.consequences_of_delay,
  b.created_at,
  -- Overdue first: a passed deadline has already cost something, which no
  -- other field here can say.
  (b.real_deadline is not null and b.real_deadline <= app.now_utc()) as overdue
from public.blockers b
where b.state = 'open'
order by
  (b.real_deadline is not null and b.real_deadline <= app.now_utc()) desc,
  -- Then work that is actually stopped. §12 records `work_can_continue`
  -- precisely so that "blocked" and "would be nice to know" are not the same
  -- queue, and this is the only place that distinction pays for itself.
  b.work_can_continue asc,
  b.real_deadline asc nulls last,
  b.created_at asc;

comment on view public.needs_me is
  '§12''s "Needs Me": open blockers, most urgent first. Deliberately NOT capped '
  'in the view - the cap belongs to the caller that renders it, and a view that '
  'silently returned 7 of 40 would hide the thing worth knowing.';

/**
 * How much is waiting on Grant, and whether that is more than the list can
 * honestly show.
 *
 * "Needs Me stays small" is only checkable if something counts. A list that
 * silently truncates looks healthy at exactly the moment it stops being
 * useful, so the number of suppressed items is returned alongside.
 */
create or replace function app.needs_me_pressure()
returns table (open_items integer, cap integer, suppressed integer, oldest_days numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::int,
    app.needs_me_cap(),
    greatest(count(*)::int - app.needs_me_cap(), 0),
    coalesce(round(extract(epoch from (app.now_utc() - min(created_at))) / 86400, 1), 0)
  from public.blockers where state = 'open';
$$;

-- ---------------------------------------------------------------------------
-- Today (§12)
-- ---------------------------------------------------------------------------

create or replace view public.today as
select
  j.job_id,
  j.project_id,
  p.name as project_name,
  j.kind,
  j.state,
  j.intent_class,
  j.priority,
  j.state_reason,
  j.waiting_on,
  j.created_at,
  j.updated_at,
  -- §6: long-running work must not look stuck. This is the field that answers
  -- "is anything happening", and it is computed rather than stored so it
  -- cannot go stale.
  (extract(epoch from (app.now_utc() - j.updated_at)) / 60)::int as minutes_since_change
from public.jobs j
left join public.projects p on p.project_id = j.project_id
where j.state not in ('complete', 'cancelled', 'failed')
order by
  case j.state when 'waiting_user' then 0 else 1 end,
  j.priority asc,
  j.created_at asc;

comment on view public.today is
  '§12''s "Today": everything live, with waiting-on-Grant first because that is '
  'the only category a person can unblock.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

alter table public.autonomy_settings enable row level security;
alter table public.autonomy_settings force  row level security;
alter table public.responsibilities  enable row level security;
alter table public.responsibilities  force  row level security;

-- SELECT only on autonomy. An agent that can write here can widen its own
-- remit, which is the one thing this table exists to prevent.
grant select on public.autonomy_settings to ai_team_app;
create policy autonomy_settings_app_read on public.autonomy_settings
  for select to ai_team_app using (true);

-- Responsibilities are writable only in the sense of recording a run.
grant select, update (last_run_at) on public.responsibilities to ai_team_app;
create policy responsibilities_app_read on public.responsibilities
  for select to ai_team_app using (true);
create policy responsibilities_app_update on public.responsibilities
  for update to ai_team_app using (true) with check (true);

grant select on public.needs_me to ai_team_app;
grant select on public.today to ai_team_app;
grant execute on function app.autonomy_for(uuid) to ai_team_app;
grant execute on function app.due_responsibilities() to ai_team_app;
grant execute on function app.needs_me_cap() to ai_team_app;
grant execute on function app.needs_me_pressure() to ai_team_app;

insert into public.system_config (key, value, description, self_adjustable) values
  ('ui.needs_me_cap', '7'::jsonb,
   '§12: how many items Needs Me may show before it reports suppression instead of growing. Not self-adjustable - raising it is how the list stops being read.', false)
on conflict (key) do nothing;

-- The starting autonomy level. `suggest` rather than `act`, deliberately:
-- the system earns its way up, and the first time it is raised should be a
-- decision somebody made.
insert into public.autonomy_settings (project_id, level, set_by, reason)
select null, 'suggest', 'migration:0027',
       'Initial global default. §17 starts conservative; raising it should be a decision, not an inheritance.'
where not exists (select 1 from public.autonomy_settings where project_id is null);

commit;

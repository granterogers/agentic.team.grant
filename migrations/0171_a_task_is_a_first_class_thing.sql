-- A task is a first-class thing.
--
-- Issue #11. Grant's project IA names Tasks as one of the seven sections of a
-- project, with states, owners and milestones:
--
--     ├── TASKS
--     │   ├── To-do
--     │   ├── In progress
--     │   ├── Waiting / blocked
--     │   ├── Completed
--     │   ├── Assigned to human
--     │   ├── Assigned to agent
--     │   └── Milestones
--
-- There is no tasks table. The studio prototype's tasks are literal objects in
-- `web/studio/data.js`. Three things Grant has asked for are blocked on this
-- and cannot be faked any further:
--
--   * "Extract tasks" as a named agent action (#27) has nowhere to write.
--   * "Assigned to human / assigned to agent" is a distinction with no column.
--   * The relational graph (#29) has Task → Document, Task → Agent and
--     Task → Contact edges with no left-hand side.
--
-- ## Why not reuse `jobs`
--
-- Tempting, because a job already has a state machine, an owner and a project.
-- It is wrong. A job is a unit of work the QUEUE runs; a task is a unit of work
-- a PERSON tracks. They differ in every way that matters: a task can be
-- assigned to Grant, has a due date he cares about, survives being abandoned,
-- and is completed by judgement rather than by exit code. Conflating them would
-- put "conduct first five interviews" in a lease-and-retry loop.
--
-- They are RELATED, which is what `tasks.job_id` is for: the job a task spawned,
-- or the job that proposed it.
--
-- ## States
--
-- Exactly his four, plus `cancelled`, which is not the same as completed and is
-- the state every task system regrets omitting. `blocked_on` carries the reason
-- in the same shape the in-tray already uses for jobs, because "waiting" with
-- no stated blocker is the failure the Active Jobs section was built to fix.
--
-- ## Assignment
--
-- `assignee_staff` and `assigned_to_human` are separate columns rather than one
-- polymorphic "owner", because the question asked of this table is almost always
-- "what is MINE" or "what is the office's", and a single column makes both
-- queries a filter on a discriminator instead of an index hit. A task may have
-- neither, which means nobody has picked it up.

begin;

create table if not exists public.tasks (
  task_id        uuid primary key default extensions.gen_random_uuid(),
  project_id     uuid not null references public.projects(project_id) on delete cascade,

  title          text not null check (length(btrim(title)) > 0),
  detail         text not null default '',

  -- His four, plus cancelled.
  state          text not null default 'todo'
                 check (state in ('todo', 'doing', 'blocked', 'done', 'cancelled')),
  -- Stated, never implied. A blocked task with no reason is the defect the
  -- Active Jobs section exists to prevent.
  blocked_on     text not null default '',

  -- Assignment. Both may be null: nobody has picked it up yet.
  assignee_staff uuid references public.staff(staff_id) on delete set null,
  assigned_to_human boolean not null default false,

  priority       int  not null default 100,
  due_on         date,
  starts_on      date,

  -- A milestone is a task with no work of its own that others hang off, rather
  -- than a separate table. Grant lists Milestones under Tasks, not beside it.
  is_milestone   boolean not null default false,
  parent_task_id uuid references public.tasks(task_id) on delete cascade,

  -- The job that produced or proposed this task, when an agent did.
  job_id         uuid references public.jobs(job_id) on delete set null,
  -- Who put it here: 'grant', a staff slug, or a connector name.
  added_by       text not null default 'grant',

  -- Same escape hatch as everywhere else in this schema.
  is_fixture     boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  done_at        timestamptz,

  -- A task cannot be blocked without saying on what, and cannot claim a
  -- completion time unless it is actually finished. Both have been wrong in
  -- this product's mock data at some point, which is why they are constraints
  -- rather than conventions.
  constraint blocked_needs_a_reason
    check (state <> 'blocked' or length(btrim(blocked_on)) > 0),
  constraint done_at_matches_state
    check ((state = 'done') = (done_at is not null))
);

create index if not exists tasks_project_state_idx
  on public.tasks (project_id, state) where not is_fixture;
create index if not exists tasks_assignee_idx
  on public.tasks (assignee_staff) where assignee_staff is not null;
create index if not exists tasks_mine_idx
  on public.tasks (project_id, due_on) where assigned_to_human and state <> 'done';
create index if not exists tasks_parent_idx
  on public.tasks (parent_task_id) where parent_task_id is not null;

-- `updated_at` maintained by the database, because six callers will otherwise
-- each forget it once.
create or replace function app.touch_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  -- Keep done_at honest without making every caller remember it.
  if new.state = 'done' and old.state <> 'done' then new.done_at := now(); end if;
  if new.state <> 'done' then new.done_at := null; end if;
  return new;
end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function app.touch_task();

alter table public.tasks enable row level security;

-- Same posture as the rest of this schema: the service role works, nobody else
-- reaches the table directly, and reads go through a wrapper.
drop policy if exists tasks_service on public.tasks;
create policy tasks_service on public.tasks
  for all to service_role using (true) with check (true);

commit;

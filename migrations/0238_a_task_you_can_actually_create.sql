-- A task you can actually create (#11, and the thing #94 was about to be built
-- on top of).
--
-- `public.tasks` has existed for weeks, with a good schema: five states, a due
-- date, an assignee that can be a person or an agent, a parent for subtasks, a
-- milestone flag. `app.studio_tasks` reads it and the studio renders it.
--
-- It has ZERO ROWS, and there is no way to make one. No RPC, no API action, no
-- control anywhere in the interface. The checkbox in the Tasks section ticks a
-- Set in browser memory that is gone on the next render.
--
-- This was found while building Google Calendar sync (#94), whose whole job is
-- to put dated tasks into a diary: `app.calendar_task_plan()` correctly
-- returned nothing to create, nothing to update and nothing to remove. Shipping
-- the sync on top of that would have been the exact pattern filed as #72 this
-- morning -- a mechanism with no mouth, passing its own tests, with no caller
-- and nothing to carry.
--
-- ## Written against the constraints, read in one query first
--
-- Ten of them on this table, and three shape the RPCs below:
--
--   tasks_state_check      todo | doing | blocked | done | cancelled
--   done_at_matches_state  (state = 'done') = (done_at is not null)
--   blocked_needs_a_reason state <> 'blocked' or blocked_on is non-empty
--
-- The second is the one that would have bitten: marking a task done without
-- setting `done_at` fails, and so does un-doing it without clearing `done_at`.
-- Both directions are handled here rather than left to the caller, because a
-- caller that forgets is a constraint error in front of Grant.

-- ---------------------------------------------------------------------------
-- Add one
-- ---------------------------------------------------------------------------
create or replace function app.hq_task_add(
  p_project   text,
  p_title     text,
  p_detail    text default null,
  p_due_on    date default null,
  p_assignee  text default null   -- a staff SLUG, resolved to the uuid here
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_staff   uuid;
  v_title   text := btrim(coalesce(p_title, ''));
  v         jsonb;
begin
  if v_title = '' then
    return jsonb_build_object('error', 'a task needs a title');
  end if;

  select project_id into v_project from public.projects
   where slug = p_project and not is_archived;
  if v_project is null then
    return jsonb_build_object('error', format('no dashboard project called %L', p_project));
  end if;

  /*
    `assignee_staff` is a UUID, not a slug.

    That has already cost a debugging session once, and the interface naturally
    holds slugs. Resolved here so no caller has to know, and an unknown slug is
    refused rather than silently leaving the task unassigned -- an assignment
    that quietly did not happen is worse than one that was rejected.
  */
  if coalesce(btrim(p_assignee), '') <> '' then
    select staff_id into v_staff from public.staff where slug = btrim(p_assignee);
    if v_staff is null then
      return jsonb_build_object('error', format('nobody here is called %L', btrim(p_assignee)));
    end if;
  end if;

  insert into public.tasks (project_id, title, detail, due_on, assignee_staff, added_by)
  values (v_project, v_title, coalesce(btrim(p_detail), ''), p_due_on, v_staff, 'grant')
  returning jsonb_build_object(
    'id', task_id, 'title', title, 'state', state, 'due_on', due_on
  ) into v;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Move one between states
-- ---------------------------------------------------------------------------
create or replace function app.hq_task_state(
  p_task_id text,
  p_state   text,
  p_reason  text default null   -- required by the schema when state is blocked
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v    jsonb;
begin
  begin
    v_id := p_task_id::uuid;
  exception when others then
    return jsonb_build_object('error', 'that is not a task id');
  end;

  if p_state not in ('todo', 'doing', 'blocked', 'done', 'cancelled') then
    return jsonb_build_object('error', format(
      '%L is not a state — it is one of todo, doing, blocked, done, cancelled', p_state));
  end if;

  -- blocked_needs_a_reason. Said here, with the reason why, rather than
  -- arriving as a constraint name.
  if p_state = 'blocked' and coalesce(btrim(p_reason), '') = '' then
    return jsonb_build_object('error',
      'say what it is blocked on — a blocked task with no reason cannot be unblocked by anyone but the person who blocked it');
  end if;

  /*
    done_at moves with the state, in both directions.

    `(state = 'done') = (done_at is not null)` is a check constraint, so
    marking done without a timestamp fails AND so does re-opening a done task
    without clearing one. Handling only the first is the bug that looks fixed.
  */
  update public.tasks
     set state      = p_state,
         done_at    = case when p_state = 'done' then coalesce(done_at, app.now_utc()) else null end,
         blocked_on = case when p_state = 'blocked' then btrim(p_reason) else '' end
   where task_id = v_id
  returning jsonb_build_object('id', task_id, 'title', title, 'state', state) into v;

  return coalesce(v, jsonb_build_object('error', 'no such task'));
end;
$$;

-- PostgREST only exposes `public`. The defaults are repeated deliberately: the
-- wrapper is the half that silently drops a new parameter.
create or replace function public.hq_task_add(
  p_project text, p_title text, p_detail text default null,
  p_due_on date default null, p_assignee text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_task_add(p_project, p_title, p_detail, p_due_on, p_assignee) $$;

create or replace function public.hq_task_state(
  p_task_id text, p_state text, p_reason text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_task_state(p_task_id, p_state, p_reason) $$;

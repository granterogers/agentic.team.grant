-- A project's tasks are its own, fixture or not.
--
-- `app.project_tasks` filtered `not is_fixture`. Copied from the health
-- queries, where it is right, and wrong here — which the verification script
-- found on its first run: it created three tasks on a fixture project, read
-- them back, and got nothing.
--
-- The distinction that was missed:
--
--   AGGREGATE queries across every project must exclude fixtures. That is what
--   `app.office_health` does, and the reason it exists — 264 harness jobs were
--   once reported to Grant as the office collapsing.
--
--   SCOPED queries about ONE project must not. The caller has already said
--   which project it wants. A fixture project's tasks belong to that fixture
--   project, and hiding them makes the function untestable except by writing
--   into real data — which is precisely the pressure that produces polluted
--   production tables.
--
-- So the filter moves out. Nothing aggregates through this function.

begin;

drop function if exists public.project_tasks(uuid);
drop function if exists app.project_tasks(uuid);

create function app.project_tasks(p_project uuid)
returns table (
  task_id uuid, title text, detail text, state text, blocked_on text,
  assignee_slug text, assignee_name text, assigned_to_human boolean,
  priority int, due_on date, is_milestone boolean, parent_task_id uuid,
  added_by text, created_at timestamptz, done_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select t.task_id, t.title, t.detail, t.state, t.blocked_on,
         s.slug, s.name, t.assigned_to_human,
         t.priority, t.due_on, t.is_milestone, t.parent_task_id,
         t.added_by, t.created_at, t.done_at
    from public.tasks t
    left join public.staff s on s.staff_id = t.assignee_staff
   where t.project_id = p_project
   order by
     case t.state when 'blocked' then 0 when 'doing' then 1
                  when 'todo' then 2 when 'done' then 3 else 4 end,
     t.due_on asc nulls last,
     t.priority asc,
     t.created_at asc
$$;

create function public.project_tasks(p_project uuid)
returns table (
  task_id uuid, title text, detail text, state text, blocked_on text,
  assignee_slug text, assignee_name text, assigned_to_human boolean,
  priority int, due_on date, is_milestone boolean, parent_task_id uuid,
  added_by text, created_at timestamptz, done_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select * from app.project_tasks(p_project)
$$;

commit;
